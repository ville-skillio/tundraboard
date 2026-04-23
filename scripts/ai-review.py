#!/usr/bin/env python3
"""
AI-powered code review and security scanner for TundraBoard PRs.

Usage:
  python scripts/ai-review.py [--mode review|security|both] [--diff-file path]

Environment variables:
  OPENROUTER_API_KEY  Required. OpenRouter API key.
  GITHUB_TOKEN        Required. GitHub token with pull-requests:write, statuses:write.
  REPO                Required. GitHub repository in owner/repo format.
  PR_NUMBER           Required. Pull request number.
  PR_HEAD_SHA         Required. PR head commit SHA (for commit status checks).
  REVIEW_MODEL        Optional. OpenRouter model slug (default: anthropic/claude-haiku-4-5).
  MAX_DIFF_LINES      Optional. Max diff lines to review (default: 10000).

Exit codes:
  0  Review complete, no blocking issues (or AI unavailable — fail open).
  1  Blocking issues found (request_changes for code review, critical for security).
  2  Configuration error (missing env vars) — do not use as a merge gate.

Local testing:
  git diff main...HEAD > /tmp/pr.diff
  GITHUB_TOKEN=ghp_... REPO=owner/repo PR_NUMBER=42 PR_HEAD_SHA=abc123 \\
    python scripts/ai-review.py --mode both --diff-file /tmp/pr.diff
"""

import argparse
import json
import os
import re
import sys
import time

import requests

try:
    from openai import OpenAI, APIError, APITimeoutError, RateLimitError
except ImportError:
    print("ERROR: openai package not installed. Run: pip install -r scripts/requirements-ai-review.txt", file=sys.stderr)
    sys.exit(2)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REVIEW_MODEL    = os.environ.get("REVIEW_MODEL", "anthropic/claude-haiku-4-5")
MAX_DIFF_LINES  = int(os.environ.get("MAX_DIFF_LINES", "10000"))
MAX_RETRIES     = 3
RETRY_BASE_WAIT = 5  # seconds, doubles each retry

GITHUB_API  = "https://api.github.com"
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
REPO         = os.environ.get("REPO", "")
PR_NUMBER    = os.environ.get("PR_NUMBER", "")
PR_HEAD_SHA  = os.environ.get("PR_HEAD_SHA", "")

# ---------------------------------------------------------------------------
# GitHub API helpers
# ---------------------------------------------------------------------------

def _gh_headers(accept: str = "application/vnd.github.v3+json") -> dict:
    return {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": accept,
        "X-GitHub-Api-Version": "2022-11-28",
    }


def get_pr_diff() -> str:
    url = f"{GITHUB_API}/repos/{REPO}/pulls/{PR_NUMBER}"
    resp = requests.get(url, headers=_gh_headers("application/vnd.github.v3.diff"), timeout=30)
    resp.raise_for_status()
    return resp.text


def get_pr_labels() -> list[str]:
    url = f"{GITHUB_API}/repos/{REPO}/pulls/{PR_NUMBER}"
    resp = requests.get(url, headers=_gh_headers(), timeout=30)
    resp.raise_for_status()
    return [label["name"] for label in resp.json().get("labels", [])]


def post_pr_review(verdict: str, body: str, inline_comments: list[dict]) -> None:
    """Post a PR review. verdict: 'approve' | 'comment' | 'request_changes'."""
    event_map = {"approve": "APPROVE", "comment": "COMMENT", "request_changes": "REQUEST_CHANGES"}
    url = f"{GITHUB_API}/repos/{REPO}/pulls/{PR_NUMBER}/reviews"
    payload = {"body": body, "event": event_map.get(verdict, "COMMENT"), "comments": inline_comments}
    resp = requests.post(url, headers=_gh_headers(), json=payload, timeout=30)
    resp.raise_for_status()
    print(f"Posted {payload['event']} review with {len(inline_comments)} inline comment(s).")


def post_pr_comment(body: str) -> None:
    """Post a general issue comment (used for error/status messages)."""
    url = f"{GITHUB_API}/repos/{REPO}/issues/{PR_NUMBER}/comments"
    resp = requests.post(url, headers=_gh_headers(), json={"body": body}, timeout=30)
    resp.raise_for_status()


def set_commit_status(state: str, description: str, context: str) -> None:
    """Set a commit status check. state: 'pending' | 'success' | 'failure' | 'error'."""
    if not PR_HEAD_SHA:
        return
    url = f"{GITHUB_API}/repos/{REPO}/statuses/{PR_HEAD_SHA}"
    resp = requests.post(
        url,
        headers=_gh_headers(),
        json={"state": state, "description": description[:140], "context": context},
        timeout=30,
    )
    resp.raise_for_status()

# ---------------------------------------------------------------------------
# Diff utilities
# ---------------------------------------------------------------------------

def truncate_diff(diff: str, max_lines: int) -> tuple[str, bool]:
    """Truncate diff if too large. Returns (diff, was_truncated)."""
    lines = diff.splitlines()
    if len(lines) <= max_lines:
        return diff, False
    truncated = "\n".join(lines[:max_lines])
    truncated += f"\n\n[... diff truncated at {max_lines} lines — {len(lines) - max_lines} lines omitted ...]"
    return truncated, True


def parse_diff_changed_lines(diff: str) -> dict[str, set[int]]:
    """
    Parse a unified diff and return {filepath: {new_file_line_numbers}} for
    added/modified lines only. Used to validate inline comment positions.
    """
    changed: dict[str, set[int]] = {}
    current_file: str | None = None
    current_line = 0

    for raw_line in diff.splitlines():
        if raw_line.startswith("+++ b/"):
            current_file = raw_line[6:]
            changed[current_file] = set()
            current_line = 0
        elif raw_line.startswith("@@") and current_file is not None:
            # @@ -old_start[,count] +new_start[,count] @@
            match = re.search(r"\+(\d+)", raw_line)
            if match:
                current_line = int(match.group(1)) - 1  # will increment on first real line
        elif current_file is not None:
            if raw_line.startswith("+++"):
                pass  # skip +++ header line
            elif raw_line.startswith("+"):
                current_line += 1
                changed[current_file].add(current_line)
            elif raw_line.startswith("-"):
                pass  # removed lines don't advance new-file counter
            else:
                current_line += 1  # context line

    return changed

# ---------------------------------------------------------------------------
# Claude API wrapper
# ---------------------------------------------------------------------------

def call_claude(system: str, user: str) -> str:
    """Call the model via OpenRouter with exponential-backoff retry on rate limits and timeouts."""
    client = OpenAI(
        api_key=os.environ.get("OPENROUTER_API_KEY"),
        base_url="https://openrouter.ai/api/v1",
    )
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES):
        try:
            response = client.chat.completions.create(
                model=REVIEW_MODEL,
                max_tokens=4096,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user",   "content": user},
                ],
            )
            return response.choices[0].message.content
        except RateLimitError as exc:
            last_error = exc
            wait = RETRY_BASE_WAIT * (2 ** attempt)
            print(f"Rate limited — waiting {wait}s (attempt {attempt + 1}/{MAX_RETRIES})", file=sys.stderr)
            time.sleep(wait)
        except APITimeoutError as exc:
            last_error = exc
            print(f"Timeout — retrying (attempt {attempt + 1}/{MAX_RETRIES})", file=sys.stderr)
            time.sleep(RETRY_BASE_WAIT)
        except APIError as exc:
            # Non-retryable API error (e.g. invalid request)
            raise

    raise RuntimeError(f"All {MAX_RETRIES} retries exhausted. Last error: {last_error}")

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

REVIEW_SYSTEM_PROMPT = """\
You are a senior software engineer reviewing a pull request on TundraBoard — a TypeScript/Node.js
task management API built with Express, Prisma, and PostgreSQL.

Review the diff for:
1. Correctness — logic errors, off-by-one errors, null/undefined mishandling, missing error handling
2. Style — TypeScript idioms, naming conventions, patterns already established in the codebase
3. Security — missing input validation, authentication bypass, hardcoded secrets, injection risks

Return ONLY a valid JSON object with this exact structure (no markdown fences):
{
  "summary": "2-3 sentence overall assessment",
  "verdict": "approve" | "comment" | "request_changes",
  "comments": [
    {
      "file": "relative/path/to/file.ts",
      "line": <integer — line number in the NEW file version>,
      "severity": "info" | "warning" | "error" | "critical",
      "category": "correctness" | "style" | "security" | "performance",
      "title": "Short title (max 60 chars)",
      "body": "Explanation with a concrete suggestion"
    }
  ]
}

Rules:
- verdict MUST be "request_changes" if any comment has severity "error" or "critical"
- verdict MUST be "approve" only when there are zero issues
- Only comment on genuine issues — omit nitpicks and stylistic preferences
- Line numbers must be added/modified lines from the diff, not deleted lines\
"""

SECURITY_SYSTEM_PROMPT = """\
You are a security engineer auditing a pull request on TundraBoard — a TypeScript/Node.js API.

Scan the diff ONLY for security vulnerabilities:
- Hardcoded secrets, API keys, passwords, tokens (OWASP A02)
- SQL/NoSQL injection (OWASP A03)
- Command injection or path traversal
- Broken authentication or missing authorization checks (OWASP A01/A07)
- Sensitive data exposure — PII logged, returned in responses (OWASP A02)
- Insecure direct object references — IDOR (OWASP A01)
- Missing input validation on user-controlled data (OWASP A03)

Return ONLY a valid JSON object (no markdown fences):
{
  "summary": "One sentence security assessment",
  "has_critical": true | false,
  "findings": [
    {
      "file": "relative/path/to/file.ts",
      "line": <integer or null if file-level>,
      "severity": "critical" | "high" | "medium" | "low",
      "cwe": "CWE-XXX" | null,
      "title": "Short finding title",
      "description": "What the vulnerability is and why it is exploitable",
      "recommendation": "Specific fix"
    }
  ]
}

has_critical MUST be true if any finding has severity "critical" or "high".\
"""

# ---------------------------------------------------------------------------
# Review modes
# ---------------------------------------------------------------------------

def _build_inline_comments(
    ai_comments: list[dict],
    changed_lines: dict[str, set[int]],
    body_template: str,
) -> tuple[list[dict], list[dict]]:
    """
    Split AI comments into inline (valid diff position) and general (everything else).
    Returns (inline_comments, general_comments).
    """
    inline, general = [], []
    for c in ai_comments:
        path = c.get("file", "")
        line = c.get("line")
        if path and isinstance(line, int) and path in changed_lines and line in changed_lines[path]:
            inline.append({
                "path": path,
                "line": line,
                "side": "RIGHT",
                "body": body_template.format(**c),
            })
        else:
            general.append(c)
    return inline, general


SEVERITY_ICON = {"info": "ℹ️", "warning": "⚠️", "error": "🔴", "critical": "🚨",
                 "high": "🔴", "medium": "⚠️", "low": "ℹ️"}
VERDICT_ICON  = {"approve": "✅", "comment": "💬", "request_changes": "🔴"}


def run_code_review(diff: str, was_truncated: bool) -> int:
    status_context = "ai-review/code"
    set_commit_status("pending", "AI code review running…", status_context)

    try:
        raw = call_claude(REVIEW_SYSTEM_PROMPT, f"Review this diff:\n\n{diff}")
    except Exception as exc:
        print(f"AI API unavailable: {exc}", file=sys.stderr)
        post_pr_comment(
            "## 🤖 AI Code Review\n\n"
            "⚠️ AI review unavailable (API error). Please review manually.\n\n"
            f"_{type(exc).__name__}_"
        )
        set_commit_status("success", "AI review unavailable — manual review required", status_context)
        return 0  # fail-open: don't block the PR on API errors

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        print(f"Unparseable AI response:\n{raw[:300]}", file=sys.stderr)
        post_pr_comment("## 🤖 AI Code Review\n\n⚠️ AI returned an invalid response. Please review manually.")
        set_commit_status("success", "AI review error — manual review required", status_context)
        return 0

    changed_lines = parse_diff_changed_lines(diff)
    comments      = result.get("comments", [])
    verdict       = result.get("verdict", "comment")

    inline, general = _build_inline_comments(
        comments,
        changed_lines,
        "**[{severity}] {title}**\n\n{body}",
    )

    # Build review body
    verdict_icon = VERDICT_ICON.get(verdict, "💬")
    lines = [f"## 🤖 AI Code Review {verdict_icon}", "", result.get("summary", ""), ""]

    if was_truncated:
        lines.append(f"> ⚠️ Diff truncated at {MAX_DIFF_LINES} lines. Review covers partial diff only.\n")

    if general:
        lines.append("### Findings")
        for c in general:
            icon = SEVERITY_ICON.get(c.get("severity", "info"), "ℹ️")
            ref  = f"`{c.get('file', '?')}:{c.get('line', '?')}`"
            lines.append(f"- {icon} **{c.get('title', '')}** {ref} — {c.get('body', '')}")
        lines.append("")

    lines.append("_To dismiss false positives, add the `ai-dismiss` label to this PR._")

    post_pr_review(verdict, "\n".join(lines), inline)

    status_state = "failure" if verdict == "request_changes" else "success"
    status_desc  = {
        "approve":         "No issues found",
        "comment":         "Review posted — no blockers",
        "request_changes": "Changes requested",
    }.get(verdict, "Review complete")
    set_commit_status(status_state, status_desc, status_context)

    return 1 if verdict == "request_changes" else 0


def run_security_scan(diff: str, was_truncated: bool) -> int:
    status_context = "ai-review/security"
    set_commit_status("pending", "Security scan running…", status_context)

    try:
        raw = call_claude(SECURITY_SYSTEM_PROMPT, f"Scan this diff for security vulnerabilities:\n\n{diff}")
    except Exception as exc:
        print(f"AI API unavailable: {exc}", file=sys.stderr)
        post_pr_comment(
            "## 🔒 Security Scan\n\n"
            "⚠️ Security scan unavailable (API error). Manual security review recommended.\n\n"
            f"_{type(exc).__name__}_"
        )
        set_commit_status("success", "Security scan unavailable — manual review recommended", status_context)
        return 0  # fail-open

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        print(f"Unparseable security scan response:\n{raw[:300]}", file=sys.stderr)
        set_commit_status("success", "Security scan error — manual review recommended", status_context)
        return 0

    findings     = result.get("findings", [])
    has_critical = result.get("has_critical", False)
    changed_lines = parse_diff_changed_lines(diff)

    # Inline comments for security findings
    inline = []
    for f in findings:
        path = f.get("file", "")
        line = f.get("line")
        if path and isinstance(line, int) and path in changed_lines and line in changed_lines[path]:
            sev  = f.get("severity", "low")
            icon = SEVERITY_ICON.get(sev, "ℹ️")
            inline.append({
                "path": path,
                "line": line,
                "side": "RIGHT",
                "body": (
                    f"{icon} **Security: {f.get('title', '')}** ({sev.upper()})\n\n"
                    f"{f.get('description', '')}\n\n"
                    f"**Fix:** {f.get('recommendation', '')}"
                ),
            })

    # Review body
    sev_order = ["critical", "high", "medium", "low"]
    sorted_findings = sorted(findings, key=lambda x: sev_order.index(x.get("severity", "low")))

    lines = ["## 🔒 Security Scan", "", result.get("summary", "No findings."), ""]

    if findings:
        lines += ["### Findings", "", "| Severity | Location | Finding | CWE |", "|----------|----------|---------|-----|"]
        for f in sorted_findings:
            sev  = f.get("severity", "low")
            icon = SEVERITY_ICON.get(sev, "ℹ️")
            loc  = f"`{f.get('file', '—')}:{f.get('line', '—')}`" if f.get("line") else f"`{f.get('file', '—')}`"
            cwe  = f.get("cwe") or "—"
            lines.append(f"| {icon} {sev.upper()} | {loc} | **{f.get('title', '')}**: {f.get('description', '')} | {cwe} |")
        lines.append("")

        lines.append("### Recommendations")
        for f in sorted_findings:
            if f.get("recommendation"):
                lines.append(f"- **{f.get('title', '')}**: {f.get('recommendation', '')}")
        lines.append("")

    if has_critical:
        lines += ["---", "🚨 **Critical or high severity findings — merge is blocked.** Resolve these before merging.", ""]

    if was_truncated:
        lines.append(f"> ⚠️ Diff truncated at {MAX_DIFF_LINES} lines. Full codebase not scanned.")

    lines.append("_Add the `ai-dismiss` label to dismiss false positives, then re-run checks._")

    verdict = "request_changes" if has_critical else "comment"
    post_pr_review(verdict, "\n".join(lines), inline)

    state = "failure" if has_critical else "success"
    desc  = "Critical security findings — merge blocked" if has_critical else "No critical security issues"
    set_commit_status(state, desc, status_context)

    return 1 if has_critical else 0

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="AI-powered PR review and security scanner")
    parser.add_argument("--mode",      choices=["review", "security", "both"], default="both")
    parser.add_argument("--diff-file", help="Path to a local diff file (for testing without GitHub API)")
    args = parser.parse_args()

    # Validate required environment
    missing = [k for k, v in {"GITHUB_TOKEN": GITHUB_TOKEN, "REPO": REPO, "PR_NUMBER": PR_NUMBER}.items() if not v]
    if missing:
        print(f"Missing required env vars: {', '.join(missing)}", file=sys.stderr)
        return 2
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("Missing OPENROUTER_API_KEY", file=sys.stderr)
        return 2

    # Honour dismiss label — skip everything
    try:
        if "ai-dismiss" in get_pr_labels():
            print("PR has 'ai-dismiss' label — skipping AI review.")
            set_commit_status("success", "AI review dismissed by developer", "ai-review/code")
            set_commit_status("success", "Security scan dismissed by developer", "ai-review/security")
            return 0
    except requests.HTTPError as exc:
        print(f"Warning: could not fetch PR labels: {exc}", file=sys.stderr)

    # Get diff
    try:
        diff = open(args.diff_file).read() if args.diff_file else get_pr_diff()
    except (requests.HTTPError, OSError) as exc:
        print(f"Failed to get diff: {exc}", file=sys.stderr)
        return 2

    if not diff.strip():
        print("Empty diff — nothing to review.")
        return 0

    diff, was_truncated = truncate_diff(diff, MAX_DIFF_LINES)
    if was_truncated:
        print(f"Diff truncated to {MAX_DIFF_LINES} lines.", file=sys.stderr)

    exit_code = 0
    if args.mode in ("review",   "both"): exit_code = max(exit_code, run_code_review(diff, was_truncated))
    if args.mode in ("security", "both"): exit_code = max(exit_code, run_security_scan(diff, was_truncated))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
