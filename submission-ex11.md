# Exercise 11 — AI-Powered PR Code Review and Security Scanning

---

## 1. Files Produced

| File | Purpose |
|------|---------|
| `.github/workflows/ai-review.yml` | GitHub Actions workflow — triggers on PR events |
| `scripts/ai-review.py` | Python review script — diff ingestion, AI calls, GitHub API |
| `scripts/requirements-ai-review.txt` | Python dependencies (`anthropic`, `requests`) |

---

## 2. Workflow Design

### Trigger

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

Fires on PR creation, any new push to the PR branch, and reopening a closed PR. Does not fire on `push` to avoid double-running on direct pushes.

### Job Structure

```
┌─────────────────────┐    ┌─────────────────┐
│   ai-code-review    │    │  security-scan  │
│                     │    │                 │
│  Posts COMMENT or   │    │  Exits 1 on     │
│  REQUEST_CHANGES    │    │  critical/high  │
│  review on the PR   │    │  findings →     │
│                     │    │  blocks merge   │
└─────────────────────┘    └─────────────────┘
       (independent — no `needs` relationship)
```

The two jobs run in parallel. `security-scan` has no dependency on `ai-code-review` — a slow review job does not delay the security gate.

### Blocking merge

`security-scan` exits with code 1 on critical or high findings, which fails the GitHub Actions job. To enforce this as a merge gate:

1. Go to **Settings → Branches → Branch protection rules → main**
2. Enable **"Require status checks to pass before merging"**
3. Add `Security Scan` to the required checks list

The `ai-code-review` job is informational — it posts review comments but does not enforce blocking. It can optionally be added to required checks if the team wants to enforce AI-requested changes.

---

## 3. Review Script Architecture

### Diff ingestion

```python
diff = get_pr_diff()           # GitHub API: Accept: application/vnd.github.v3.diff
diff, was_truncated = truncate_diff(diff, MAX_DIFF_LINES)
changed_lines = parse_diff_changed_lines(diff)
```

`parse_diff_changed_lines` walks the unified diff and builds `{filename: {line_numbers}}` for all added/modified lines. This is used to validate inline comment positions — GitHub rejects comments on lines not in the diff.

### AI call with retry

```python
def call_claude(system, user) -> str:
    for attempt in range(MAX_RETRIES):
        try:
            return client.messages.create(model=REVIEW_MODEL, ...).content[0].text
        except RateLimitError:
            time.sleep(RETRY_BASE_WAIT * 2**attempt)  # exponential backoff
        except APITimeoutError:
            time.sleep(RETRY_BASE_WAIT)
```

`RateLimitError` uses exponential backoff (5s → 10s → 20s). `APITimeoutError` retries with fixed delay. Non-retryable `APIError` (invalid request) raises immediately.

### Response parsing and comment posting

The AI returns structured JSON. The script:
1. Validates JSON parsability
2. Filters `comments` against `changed_lines` — only posts inline comments for valid diff positions
3. Remaining comments go into the review body as a findings list
4. Posts a single PR review (`APPROVE` / `COMMENT` / `REQUEST_CHANGES`) with all inline comments attached

### Commit status checks

Both modes set named commit statuses (`ai-review/code`, `ai-review/security`) to `pending` at start and `success`/`failure` at end. These appear as separate named checks in the PR checks UI, independent of the job pass/fail status.

---

## 4. Permissions Required

### GitHub Actions permissions (workflow-level)

```yaml
permissions:
  contents: read          # checkout the repository
  pull-requests: write    # post PR reviews and comments
  statuses: write         # set commit status checks
```

**Why not `write-all`:** Principle of least privilege. The script only needs to read code, write PR reviews, and set statuses. It does not need `issues:write`, `actions:write`, `deployments:write`, or any other permission.

**`GITHUB_TOKEN` is auto-provisioned** by GitHub Actions with these permissions — no manual secret needed for GitHub API access.

### Secrets required

| Secret | Where it comes from | Why |
|--------|-------------------|-----|
| `ANTHROPIC_API_KEY` | Anthropic console → API keys | Authenticates calls to Claude API |
| `GITHUB_TOKEN` | Auto-injected by GitHub Actions | Authenticates GitHub API calls (PR reviews, statuses) |

`GITHUB_TOKEN` does not need to be set manually — GitHub injects it automatically into every workflow run. Only `ANTHROPIC_API_KEY` requires manual configuration.

### Setting up `ANTHROPIC_API_KEY` in the repository

1. Go to **https://console.anthropic.com** → API Keys → Create key
2. In the GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**
3. Name: `ANTHROPIC_API_KEY`, Value: the key from step 1
4. Save

The key is now available as `${{ secrets.ANTHROPIC_API_KEY }}` in any workflow.

**Security note:** Never log the API key. The script only passes it as an environment variable to the Python process, never prints it. GitHub automatically redacts secret values from workflow logs.

---

## 5. Edge Case Handling

### AI API unavailable (timeout, outage, rate limit exhausted)

**Behaviour:** The script catches all `APIError`, `APITimeoutError`, and `RateLimitError` after retries. On failure:
- Posts a PR comment: `"⚠️ AI review unavailable — please review manually"`
- Sets commit status to `success` (not failure)
- Exits with code `0`

**Rationale:** A transient API outage should not block a developer's PR. Fail-open is the right default for a tooling dependency. The comment ensures the team knows to review manually rather than assuming AI checked it.

### Large diff (>10,000 lines)

**Behaviour:** `truncate_diff()` cuts the diff at `MAX_DIFF_LINES` (default 10,000, configurable via env var) and appends a notice:
```
[... diff truncated at 10000 lines — 3421 lines omitted ...]
```
The review body includes a visible warning:
```
⚠️ Diff truncated at 10000 lines. Review covers partial diff only.
```

**Why not reject?** A truncated review is more useful than no review. The first 10,000 lines cover the bulk of typical PRs. Truly enormous PRs (refactors, generated files) should be split anyway — the truncation warning signals this.

**Alternative:** Set `MAX_DIFF_LINES=0` in the environment to skip AI review for oversized diffs and post a manual-review-required comment instead.

### False positive dismissal

**Mechanism:** Add the `ai-dismiss` label to the PR. The script checks for this label before doing anything:

```python
if "ai-dismiss" in get_pr_labels():
    set_commit_status("success", "AI review dismissed by developer", "ai-review/code")
    set_commit_status("success", "Security scan dismissed by developer", "ai-review/security")
    return 0
```

Both commit statuses are set to `success`, unblocking merge. The label persists on the PR so future pushes also skip AI review until the label is removed.

**When to use:** When the AI flags a false positive (e.g., a test file that intentionally contains a hardcoded password, or a security pattern that is safe in context). The developer adds `ai-dismiss`, the checks go green, and they can merge. Remove the label after merging to restore AI review on the next PR.

### Empty diff

If the PR has no changed files (e.g., a label-only update), `diff.strip()` is empty and the script exits 0 with a log message. No API call is made.

### Configuration error (missing env vars)

Exit code `2` — distinct from exit code `1` (blocking findings). The workflow job fails but with a clear error message. Exit code `2` should never be used as a merge gate signal since it indicates a setup problem, not a code quality problem.

---

## 6. Model Choice

Both review modes use `claude-sonnet-4-6` (configurable via `REVIEW_MODEL` env var).

**Why Sonnet for CI review:**
- Inline completions and commit messages → Haiku (high-frequency, simple structure)
- PR code review and security scan → Sonnet (needs to understand code semantics, detect subtle auth bugs, produce low false-positive rate)
- Architecture decisions → Opus (complex trade-offs, low frequency)

Haiku was considered for cost reduction but produces shallower security analysis with more false positives, which increases developer friction (constant `ai-dismiss` label usage). Sonnet is the right balance for CI-frequency usage.

**Cost per PR (Sonnet):**
- Code review: ~5,000 tokens in + ~1,000 out = ~$0.030
- Security scan: ~5,000 tokens in + ~800 out = ~$0.027
- Total per PR: ~$0.057
- Per developer per day (5 PRs): ~$0.29
- Team of 10, monthly: ~$63

---

## 7. Local Testing

Test the script against a stored diff without creating a real PR:

```bash
# Generate a diff from your current branch
git diff main...HEAD > /tmp/pr.diff

# Run both modes against the local diff
ANTHROPIC_API_KEY=sk-ant-... \
GITHUB_TOKEN=ghp_... \
REPO=ville-skillio/tundraboard \
PR_NUMBER=99 \
PR_HEAD_SHA=abc123 \
  python scripts/ai-review.py --mode both --diff-file /tmp/pr.diff
```

The script posts real comments to PR #99 when run this way — use a test PR or a draft PR to avoid noise on real reviews.
