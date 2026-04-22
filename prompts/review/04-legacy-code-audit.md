````markdown
# Template: Legacy Code Quality and Security Audit

## Purpose
Identify security vulnerabilities and quality issues in a legacy JavaScript
file, grouped by severity, with a concrete fix for each finding. Designed
for use before beginning a modernisation sprint to understand the risk surface.

## Variables

| Variable | Description |
|----------|-------------|
| `{{FILE_SOURCE}}` | Full source of the file to audit |
| `{{FILE_NAME}}` | Filename (e.g., `taskService.js`) |
| `{{FOCUS_AREAS}}` | Comma-separated list of what to prioritise (e.g., `SQL injection, input validation, error handling`) |

## Prompt

You are a backend security reviewer auditing a legacy Node.js file for a
team that is about to begin modernisation work.

File: `{{FILE_NAME}}`

Focus areas: {{FOCUS_AREAS}}

For each finding report:
- Line number (or range)
- Severity: CRITICAL · HIGH · MEDIUM · LOW
- Category: one of — sql-injection · missing-auth · mass-assignment ·
  error-leakage · hardcoded-config · missing-validation · code-quality
- One sentence describing the issue
- A minimal concrete fix (pseudocode or 2–4 lines is enough)

After all findings, give a summary:
- Count of findings per severity
- The single highest-priority fix to make before touching anything else
- Estimated effort to address all CRITICAL and HIGH findings (S/M/L)

File to audit:

    {{FILE_SOURCE}}

## Expected Output
A numbered findings list followed by a three-line summary section.

## Notes
- Keep `{{FOCUS_AREAS}}` to 3–4 items. More than that dilutes the output — the
  AI starts listing every minor style issue instead of the important findings.
- For `{{FILE_SOURCE}}`, paste the complete file. Partial context causes the AI
  to miss findings that span multiple functions (e.g., a missing auth check that
  is visible only when reading the route and service together).
- If you want to audit the HTTP layer separately from the service layer, run two
  prompts — one for `tasks.js` and one for `taskService.js`. Combined audits of
  two files at once often produce lower-quality output due to context length.
- The "mass-assignment" category applies whenever `req.body` is passed directly
  to a database operation without an allowlist.
````
