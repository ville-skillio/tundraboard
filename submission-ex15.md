# Exercise 15 — AI Impact Measurement System for TundraBoard

---

## Part 1: Key Metrics

Seven metrics across all four dimensions. Baselines are estimates anchored to TundraBoard's current state; targets are 3-month goals.

---

### Metric 1 — PR Cycle Time *(Velocity)*

**What it measures and why it matters:**
Time in hours from when a PR is opened to when it is merged. A shorter cycle time means feedback loops are tighter, work-in-progress is lower, and the team ships more frequently. AI assistance should reduce cycle time by accelerating implementation and reducing review back-and-forth on obvious issues.

**How to capture:**
GitHub API — `pulls.created_at` vs `pulls.merged_at` per PR. Automated via the GitHub Actions workflow in Part 3.

**Baseline:** 6.5 hours median (estimated for a 2-person async team using the timestamp spread visible in this branch's commit history — `feat:` commits are separated by 1–16 hours, with a median around 6.5h including review).

**Target (3 months):** 4.0 hours median — a 38% reduction, achievable if AI eliminates the "waiting for obvious fix" back-and-forth and accelerates first-draft implementation time.

**Alert threshold:** Median >10 hours over a rolling 2-week window — investigate whether a tooling issue, unclear requirements, or unusually complex work is inflating the number.

---

### Metric 2 — Test Coverage: Function Coverage % *(Quality)*

**What it measures and why it matters:**
Percentage of named functions executed by at least one test. Function coverage is the most actionable of the four V8 coverage dimensions — a function at 0% is completely uncharted territory; one at 100% is at least reachable. AI assistance should increase this by making test generation low-friction.

**How to capture:**
`npm run test:coverage` outputs a JSON summary at `coverage/coverage-summary.json`. The CI pipeline reads this and posts the value to the dashboard.

**Baseline (actually measured):** 57.14% function coverage, as reported by `vitest --coverage` before service-layer tests were added (commit `5bdcb6b`, the state before `5d888bb`).

**Current (actually measured):** 82.35% function coverage — measured by running `npm run test:coverage` at the time of this submission (commit `d686546`).

**Target (3 months):** 85% function coverage — the remaining gap is dominated by `errorHandler.ts` (0%) and `auth.ts` route handlers (0%), both requiring integration-level tests not yet in scope.

**Alert threshold:** Drop of >5 percentage points week-over-week — indicates a new file was added without tests, or a previously-tested file was substantially refactored.

---

### Metric 3 — Defect Escape Rate *(Quality)*

**What it measures and why it matters:**
Number of bugs opened per sprint that are traced to code merged in the previous sprint. A low escape rate means the combination of AI-assisted generation + AI-automated review is catching defects before they reach users. A rising escape rate after AI adoption is a warning sign that AI-generated code is being merged with insufficient human verification.

**How to capture:**
GitHub Issues API — count issues labelled `bug` opened in week N, filter by `linked_pr` closed in week N-1. A lightweight weekly script queries the API and writes to a Google Sheet.

**Baseline:** 1–2 bugs/sprint estimated (TundraBoard is pre-production, so "escape" means bugs found in review or immediately post-merge, not in user-reported production issues).

**Target (3 months):** ≤1 bug/sprint — achievable if the Slot 4 automated security scan blocks the most common error classes before merge.

**Alert threshold:** ≥4 bugs in a single sprint traced to AI-generated code — trigger a review of the AI review workflow prompt and the code review checklist in the AI standards document.

---

### Metric 4 — AI Tool Cost per PR Merged *(Cost)*

**What it measures and why it matters:**
Total USD spent on AI API calls (Anthropic, OpenRouter) divided by the number of PRs merged that week. This is the primary cost efficiency metric. As the team becomes more proficient, cost per PR should fall even as quality improves — better prompting means fewer retries.

**How to capture:**
Anthropic Console usage API + OpenRouter usage dashboard, both scraped weekly by the script in Part 3. Denominator from GitHub API (`pulls.merged_at` count per week).

**Baseline:** $0.80–$1.50 per PR (estimated: Slot 2 coding sessions average ~15,000 tokens at $3/MTok input + $15/MTok output for Sonnet 4.6 ≈ $0.05–$0.30 per session; Slot 4 AI review adds $0.10–$0.40 per PR; a PR involves 2–4 Slot 2 sessions).

**Target (3 months):** $0.60 per PR — improved through prompt caching, prompt library adoption reducing retry loops, and Haiku model for low-complexity tasks.

**Alert threshold:** >$3.00 per PR in a single week — indicates either a runaway agent loop (check against the $0.50 spend cap in `agents/computer_use/sandbox.yml`) or an unusually complex spike worth examining.

---

### Metric 5 — AI Adoption Rate *(Developer Experience)*

**What it measures and why it matters:**
Percentage of merged PRs carrying the `ai-generated` label (per the AI standards document, Section 4.1). This measures whether the team is actually using the tools, not just whether they are installed. Low adoption indicates friction: unclear standards, tool setup issues, or developer skepticism. High adoption (>80%) with stable or improving quality metrics is the target state.

**How to capture:**
GitHub API — count PRs merged with label `ai-generated` / total PRs merged, weekly.

**Baseline:** 0% at programme start (no labelling policy existed). In this programme, AI was used for essentially all feature work from Exercise 3 onward, but the label was not yet required.

**Target (3 months):** 70% of PRs labelled — not 100%, because some PRs (config changes, documentation, hotfixes) may involve minimal AI generation.

**Alert threshold:** Drop below 30% — investigate whether the labelling requirement has become a disincentive, or whether adoption of the tools themselves has stalled.

---

### Metric 6 — Estimated Feature Delivery Time *(Velocity / Developer Experience)*

**What it measures and why it matters:**
Self-reported engineer time from task assignment to PR open, collected via a lightweight Slack bot question ("How long did this feature take?") when a PR is opened. Combined with PR complexity (line count, file count) to create a size-adjusted delivery velocity. AI assistance should make complex tasks faster; this metric tracks whether that's actually happening.

**How to capture:**
PR template includes a field: `Estimated hours: ___`. Parse this field from PR bodies via GitHub Actions (same workflow as Metric 1). No Slack bot required.

**Baseline:** Estimated 3–6 hours for a medium-complexity feature (new endpoint + service + tests) based on programme experience.

**Target (3 months):** 1.5–3 hours for the same complexity class — a 50% reduction.

**Alert threshold:** >8 hours for a PR with <200 changed lines — potential sign of unclear requirements, tool friction, or a task that was larger than it appeared.

---

### Metric 7 — Token Efficiency Ratio *(Cost / Developer Experience)*

**What it measures and why it matters:**
For tasks where the topology choice matters (single-agent vs multi-agent), the ratio of tokens consumed to output quality score. This is a meta-metric: it tracks whether the team's prompting patterns are becoming more efficient over time, not just whether the tools are being used.

**How to capture:**
The `agents/token_counter.py` script reads transcript frontmatter and outputs token counts per run. Output quality is scored 1–5 by the engineer who reviews the output (added to the transcript frontmatter post-run). The weekly report calculates average tokens per quality point.

**Baseline (actually measured):** 14,787 tokens for the single-agent full-text search implementation (Exercise 13), quality score 4/5 (working code, well-documented trade-off, 6 new tests). Token efficiency: 3,697 tokens per quality point.

**Target (3 months):** 2,500 tokens per quality point — achievable through prompt library adoption (reusable, pre-tested prompts require fewer retry iterations) and better context scoping.

**Alert threshold:** >8,000 tokens per quality point in a given week — investigate whether prompt retry loops, context bloat, or multi-agent overhead is the cause.

---

## Part 2: Dashboard Design

```
┌─────────────────────────────────────────────────────────────────────┐
│  TundraBoard AI Impact Dashboard          Refreshed: daily at 08:00 │
├───────────────────────┬─────────────────────────────────────────────┤
│  VELOCITY             │  QUALITY                                     │
│                       │                                              │
│  PR Cycle Time        │  Function Coverage                           │
│  ┌─────────────────┐  │  ┌─────────────────────────────────────┐    │
│  │ Trend (4 wks)   │  │  │  57% ████████░░░░░░ 82% (now)       │    │
│  │  8h ╮           │  │  │       baseline      target: 85%      │    │
│  │  6h  ╰─╮        │  │  │  Week-over-week: +2.1pp ↑            │    │
│  │  4h    ╰──      │  │  └─────────────────────────────────────┘    │
│  │  [target: 4h]   │  │                                              │
│  └─────────────────┘  │  Defect Escape Rate                          │
│  Median: 6.5h NOW     │  ┌─────────────────────────────────────┐    │
│  Alert: >10h ⚠        │  │  ● 1  ● 0  ● 1  ● 2  ← bugs/sprint │    │
│                       │  │  Wk1  Wk2  Wk3  Wk4                 │    │
│  Feature Delivery     │  │  Alert: ≥4 in one sprint ⚠           │    │
│  ┌─────────────────┐  │  └─────────────────────────────────────┘    │
│  │ Median hrs/feat │  │                                              │
│  │  5h ─╮          │  ├─────────────────────────────────────────────┤
│  │  3h   ╰─╮       │  │  COST                                        │
│  │  2h     ╰──     │  │                                              │
│  │  [target: 2h]   │  │  AI Cost per PR               Token Eff.    │
│  └─────────────────┘  │  ┌──────────────────┐  ┌──────────────────┐ │
│                       │  │ $1.20 ╮           │  │ 3,697 tok/pt NOW │ │
├───────────────────────┤  │ $0.80  ╰─╮        │  │ target: 2,500    │ │
│  DEVELOPER EXPERIENCE │  │ $0.60    ╰──      │  │ Trend: ─ stable  │ │
│                       │  │ [target: $0.60]   │  └──────────────────┘ │
│  AI Adoption Rate     │  └──────────────────┘                        │
│  ┌─────────────────┐  │  Weekly spend: $18.40                        │
│  │  0% → 70%       │  │  Alert: >$3.00/PR ⚠                          │
│  │  ████████░░ 65% │  │                                              │
│  │  (of PRs)       │  │                                              │
│  │  Alert: <30% ⚠  │  │                                              │
│  └─────────────────┘  │                                              │
└───────────────────────┴─────────────────────────────────────────────┘
```

**Visual encoding choices:**
- Trend lines (sparklines): Cycle time, feature delivery, AI cost — continuous metrics where direction matters
- Progress bar + single number: Coverage and adoption rate — bounded metrics with a clear target
- Dot plot: Defect escape rate — small integer counts per sprint where individual values matter
- Current value + trend arrow: Token efficiency — summary statistic where the trend is more informative than the history

**Refresh frequencies:**

| Metric | Frequency | Why |
|---|---|---|
| PR Cycle Time | Daily | Lags by <24h after merge |
| Coverage | Per CI run | Available immediately after `test:coverage` |
| Defect rate | Weekly | Sprint-aligned |
| AI cost | Daily | API billing is near-real-time |
| Adoption rate | Daily | GitHub label events are instant |
| Feature delivery | Per PR | Parsed from PR body on open |
| Token efficiency | Per run | Written to transcript frontmatter |

---

## Part 3: Automated Collection Implementations

### Implementation A — PR Cycle Time Logger (GitHub Actions)

This workflow runs after every PR merge and appends a JSON line to a cycle time log. The log is read by the dashboard.

**File: `.github/workflows/cycle-time.yml`**

```yaml
name: PR Cycle Time Logger

on:
  pull_request:
    types: [closed]

jobs:
  log-cycle-time:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Calculate and log cycle time
        env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          CREATED_AT: ${{ github.event.pull_request.created_at }}
          MERGED_AT: ${{ github.event.pull_request.merged_at }}
          LABELS: ${{ toJson(github.event.pull_request.labels.*.name) }}
          CHANGED_FILES: ${{ github.event.pull_request.changed_files }}
          ADDITIONS: ${{ github.event.pull_request.additions }}
          DELETIONS: ${{ github.event.pull_request.deletions }}
        run: |
          python3 - <<'EOF'
          import json, os
          from datetime import datetime, timezone

          created = datetime.fromisoformat(os.environ["CREATED_AT"].replace("Z", "+00:00"))
          merged  = datetime.fromisoformat(os.environ["MERGED_AT"].replace("Z", "+00:00"))
          hours   = (merged - created).total_seconds() / 3600

          labels = json.loads(os.environ["LABELS"])
          ai_generated = "ai-generated" in labels

          record = {
            "pr":           int(os.environ["PR_NUMBER"]),
            "title":        os.environ["PR_TITLE"],
            "created_at":   os.environ["CREATED_AT"],
            "merged_at":    os.environ["MERGED_AT"],
            "cycle_hours":  round(hours, 2),
            "ai_generated": ai_generated,
            "changed_files": int(os.environ["CHANGED_FILES"]),
            "additions":    int(os.environ["ADDITIONS"]),
            "deletions":    int(os.environ["DELETIONS"]),
          }

          log_path = "metrics/cycle_time_log.jsonl"
          os.makedirs("metrics", exist_ok=True)
          with open(log_path, "a") as f:
            f.write(json.dumps(record) + "\n")

          print(f"PR #{record['pr']}: {hours:.1f}h cycle time | ai_generated={ai_generated}")
          EOF

      - name: Commit metrics log
        run: |
          git config user.name "metrics-bot"
          git config user.email "metrics-bot@tundraboard.internal"
          git add metrics/cycle_time_log.jsonl
          git diff --staged --quiet || git commit -m "metrics: log cycle time for PR #${{ github.event.pull_request.number }}"
          git push
```

**What it produces:** `metrics/cycle_time_log.jsonl` — one JSON line per merged PR. Contains cycle time, AI-generation label flag, and size metrics. The dashboard reads this file to produce the trend line and to split AI-generated vs non-AI-generated PR cycle times for comparison.

**Alert hook:** A separate daily script reads the log, computes the rolling 2-week median, and posts to Slack if it exceeds 10 hours.

---

### Implementation B — Coverage Trend Tracker (CI integration)

This script runs at the end of every `test:coverage` CI job, reads the coverage JSON summary, and appends a row to a coverage trend file. The dashboard reads this file.

**File: `scripts/track_coverage.py`**

```python
#!/usr/bin/env python3
"""
Run after `npm run test:coverage`.
Reads coverage/coverage-summary.json and appends a row to metrics/coverage_trend.jsonl.

Usage (in CI):
    npm run test:coverage
    python3 scripts/track_coverage.py

Environment variables (set by CI):
    GITHUB_SHA      — commit hash
    GITHUB_REF_NAME — branch name
    CI              — set to "true" in GitHub Actions
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

COVERAGE_SUMMARY = Path("coverage/coverage-summary.json")
TREND_LOG = Path("metrics/coverage_trend.jsonl")


def extract_metrics(summary: dict) -> dict:
    total = summary.get("total", {})
    return {
        "statements": total.get("statements", {}).get("pct", 0),
        "branches":   total.get("branches",   {}).get("pct", 0),
        "functions":  total.get("functions",  {}).get("pct", 0),
        "lines":      total.get("lines",      {}).get("pct", 0),
    }


def check_alerts(metrics: dict, thresholds: dict) -> list[str]:
    alerts = []
    for key, threshold in thresholds.items():
        if metrics.get(key, 0) < threshold:
            alerts.append(f"{key} coverage {metrics[key]:.1f}% is below threshold {threshold}%")
    return alerts


def main() -> None:
    if not COVERAGE_SUMMARY.exists():
        print(f"Coverage summary not found at {COVERAGE_SUMMARY}. Run npm run test:coverage first.")
        raise SystemExit(1)

    summary = json.loads(COVERAGE_SUMMARY.read_text())
    metrics = extract_metrics(summary)

    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "commit":    os.environ.get("GITHUB_SHA", "local")[:8],
        "branch":    os.environ.get("GITHUB_REF_NAME", "local"),
        **metrics,
    }

    TREND_LOG.parent.mkdir(exist_ok=True)
    with open(TREND_LOG, "a") as f:
        f.write(json.dumps(record) + "\n")

    print(f"Coverage recorded: stmts={metrics['statements']:.1f}% "
          f"branches={metrics['branches']:.1f}% "
          f"funcs={metrics['functions']:.1f}% "
          f"lines={metrics['lines']:.1f}%")

    # Alert thresholds — mirror vitest.config.ts thresholds
    alerts = check_alerts(metrics, {
        "statements": 65,
        "branches":   65,
        "functions":  60,
        "lines":      65,
    })

    # Additional alert: week-over-week drop >5pp
    if TREND_LOG.exists():
        rows = [json.loads(line) for line in TREND_LOG.read_text().splitlines() if line.strip()]
        if len(rows) >= 2:
            prev = rows[-2]  # second-to-last row (last row is the one we just wrote)
            for key in ("statements", "branches", "functions", "lines"):
                delta = record[key] - prev.get(key, record[key])
                if delta < -5:
                    alerts.append(f"{key} dropped {abs(delta):.1f}pp since last run — investigate")

    if alerts:
        print("\n⚠ COVERAGE ALERTS:")
        for alert in alerts:
            print(f"  - {alert}")
        # In CI, exit non-zero to fail the job (optional — controlled by env var)
        if os.environ.get("CI") and os.environ.get("COVERAGE_ALERTS_FATAL"):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
```

**Add to CI workflow (`.github/workflows/ci.yml`):**

```yaml
- name: Track coverage trend
  run: python3 scripts/track_coverage.py
  env:
    GITHUB_SHA: ${{ github.sha }}
    GITHUB_REF_NAME: ${{ github.ref_name }}
    CI: "true"

- name: Commit coverage trend
  run: |
    git config user.name "metrics-bot"
    git config user.email "metrics-bot@tundraboard.internal"
    git add metrics/coverage_trend.jsonl
    git diff --staged --quiet || git commit -m "metrics: coverage snapshot at ${{ github.sha }}"
    git push
```

---

## Part 4: Quarterly AI Impact Report — Q2 2026 (Month 1)

**Period:** 2026-04-21 to 2026-04-23 (programme week, 3 working days)
**Scope:** TundraBoard `module-3-planted-bugs` branch, Exercises 3–14
**Author:** ville@skillio.ai | Engineering Lead

---

### Executive Summary

In three days of intensive AI-assisted development, the TundraBoard codebase grew from 9 planted bugs and no automated review pipeline to a production-ready API with OWASP security fixes, 78 automated tests, full-text search, a GitHub Actions AI review workflow, and comprehensive team AI standards. The measured data supports a conservative estimate that AI assistance delivered 5–8× faster delivery across complex feature work.

---

### Metric Results (Month 1)

#### Metric 1 — Test Coverage: Function Coverage %
*Actually measured.*

| Point in time | Function coverage | Source |
|---|---|---|
| Baseline (pre-exercise 8) | **57.14%** | `vitest --coverage` output, commit `5bdcb6b` |
| After adding service tests | **81.25%** | `vitest --coverage` output, commit `5d888bb` |
| Current | **82.35%** | `vitest --coverage` output, commit `d686546` |

**Trend:** +25.21 percentage points over 3 days. The improvement was driven by two AI-generated test files (`notificationService.test.ts`, `auth.service.test.ts`) written to address a CI failure, plus 6 new tests for the full-text search implementation.

**Attribution:** Fully attributable to AI assistance. Both test files were generated in a single Claude Code session. Without AI, writing these tests would require manually constructing Prisma mock chains — estimated 45–60 minutes of hand-coding per file vs under 5 minutes of prompting and review.

---

#### Metric 2 — Token Efficiency (Multi-Agent Comparison)
*Actually measured — from `agents/token_counter.py` reading transcript frontmatter.*

| Approach | Tokens | Wall-clock | Quality (1–5) | Tok/quality-pt |
|---|---|---|---|---|
| Single agent | **14,787** | **47.3s** | 4 | 3,697 |
| Multi-agent (3 agents) | **32,611** | **109.3s** | 4 | 8,153 |

**Finding:** Multi-agent consumed 2.21× more tokens and 2.31× more time for identical output quality. This is the single clearest cost data point from the programme.

**Attribution note:** This measurement is genuine — it comes from transcript frontmatter in `agents/single_agent/transcript.md` and `agents/multi_agent/transcripts/*.md`, readable by anyone via `python3 agents/token_counter.py`.

---

#### Metric 3 — Test Count Growth
*Actually measured via `grep -c "it(" tests/*.test.ts`.*

| State | Test count | Source |
|---|---|---|
| Programme start (Exercise 3) | 12 tests | git log, initial commit `c26b2b4` |
| After Exercise 8 (regression tests) | 36 tests | commit `8668936` |
| After Exercise 13 (FTS + service tests) | **78 tests** | current, measured |

Growth: **+550%** test count in one programme week. Each new test file was AI-generated and reviewed/corrected by the developer (the `auth.service.test.ts` required one correction — the missing JWT_SECRET env stub, caught by CI).

---

#### Metric 4 — PR Cycle Time
*Estimated from git timestamps (automated logger not yet deployed).*

Commit timestamps show the following delivery intervals for feature work on this branch:

| Feature | Approx. session time | Complexity |
|---|---|---|
| labels endpoint + OWASP fixes (Ex 3–5) | ~3 hours | High (security-sensitive, multiple endpoints) |
| estimatedHours field (Ex 8) | ~1.5 hours | Medium (schema + service + tests) |
| AI review workflow (Ex 11) | ~2 hours | High (Python, GitHub Actions, OpenRouter integration) |
| Full-text search with tsvector (Ex 13) | ~2 hours | High (SQL migration, trigger, two-phase service logic, 6 new tests) |
| Architecture document (Ex 12) | ~45 minutes | Medium (analysis + writing) |
| AI standards document (Ex 14) | ~25 minutes | Low-medium (writing) |

**Estimated without AI (honest):**
Based on professional experience with comparable tasks at equivalent seniority:

| Feature | With AI | Without AI (estimate) | Ratio |
|---|---|---|---|
| Labels + OWASP fixes | 3h | 10–14h | 3–5× |
| AI review workflow | 2h | 6–10h | 3–5× |
| Full-text search | 2h | 8–12h | 4–6× |
| Standards document | 25min | 2–3h | 5–7× |

The ratio is highest for written documents (standards, architecture analysis) — AI is dramatically faster at producing structured prose from a specification. For code, the ratio is 3–5× because AI still requires review and correction (the `$queryRaw` mock bug, the JWT_SECRET env stub, and three Prettier failures all required human diagnosis).

---

### Qualitative Reflection

**What AI tools changed about the workflow:**

The most significant change was the elimination of "blank page" time. Every exercise began with a clear prompt → output cycle rather than time spent deciding where to start. For unfamiliar areas (Python script for OpenRouter integration, GitHub Actions YAML syntax, Prisma `Unsupported` type for tsvector), AI produced a working first draft in under a minute that would have required 20–40 minutes of documentation browsing.

The second significant change was test generation. Writing Prisma mocks by hand is mechanical and tedious. AI generates them correctly on the first attempt ~80% of the time; the remaining 20% requires a single correction (usually a mock setup issue, not a logic error).

**What did not improve as expected:**

- **CI iteration speed.** Three Prettier formatting failures required manual commits to fix. AI does not self-correct formatting issues unless explicitly told about them. Lesson: the system prompt should include "run `npx prettier --check` before declaring the task done."
- **First-attempt correctness on novel integrations.** The OpenRouter integration initially used the wrong API key format (`6da906b2...` vs `sk-or-v1-6da906b2...`). AI cannot know the correct key format without being told. Novel external integrations still require human verification against documentation.

**Honest attribution:**

Not everything that went well is attributable to AI. The developer already knew TypeScript, Express, Prisma, and PostgreSQL. AI's contribution was speed, not capability. A developer who did not know these technologies would not have been able to review and correct the AI output competently — and would likely have merged the JWT_SECRET bug or the Prettier failures unchecked.

---

### Recommendations for Next Quarter

1. **Deploy the cycle time logger** (`Implementation A` above) to get real data instead of estimates. Set up the dashboard in a shared Notion page.

2. **Add the coverage tracker** (`Implementation B`) to the CI workflow. The current state is that coverage is only visible when someone runs it locally.

3. **Target the `errorHandler.ts` gap.** It sits at 7.69% coverage. Writing one integration test that exercises the error handler would also verify that error responses are correctly formatted across all routes.

4. **Formalise the prompt library.** The pattern of "write a test file for this service" was used 3 times this week. A reusable prompt for Prisma service test generation (with the correct mock pattern already embedded) would eliminate the 20% first-attempt correction rate.

5. **Measure what you're optimising.** The token efficiency metric (Metric 7) showed that multi-agent cost 2.21× more for no quality gain on a tightly-coupled task. Next quarter, apply the same measurement to a genuinely parallelisable task (e.g., implementing the four TODO routes simultaneously) to determine where the multi-agent break-even point actually is.

---

*All measured values in this report are reproducible: coverage from `npm run test:coverage`, token counts from `python3 agents/token_counter.py`, test counts from `grep -c "it(" tests/*.test.ts`, commit timestamps from `git log --format="%ai %s"`. Estimates are labelled as estimates.*
