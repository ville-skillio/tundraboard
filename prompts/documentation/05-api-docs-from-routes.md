````markdown
# Template: Generate API Documentation from Route Handlers

## Purpose
Produce human-readable API documentation for a set of Express route handlers.
Useful when endpoints exist but were never documented, or when onboarding new
team members to a legacy codebase.

## Variables

| Variable | Description |
|----------|-------------|
| `{{ROUTE_FILE}}` | Full source of the Express router file |
| `{{SERVICE_FILE_EXCERPT}}` | The service functions called by the routes (to reveal return shapes) |
| `{{BASE_PATH}}` | The URL prefix for this router (e.g., `/tasks`) |
| `{{AUTH_DESCRIPTION}}` | One sentence on how auth works (e.g., "No auth — all endpoints are public") |

## Prompt

You are writing API documentation for a legacy Node.js/Express application.
Generate a concise reference document covering every route in the file below.

Base path: `{{BASE_PATH}}`
Authentication: {{AUTH_DESCRIPTION}}

For each endpoint produce:
- Method and path (e.g., `POST /tasks`)
- One-sentence description
- Request body or query params (name · type · required/optional · description)
- Success response: status code + JSON shape (use the service return value)
- Error responses: status code + when it occurs

Format: use markdown with a `###` heading per endpoint.

Route file:

    {{ROUTE_FILE}}

Service functions (for return shapes):

    {{SERVICE_FILE_EXCERPT}}

## Expected Output
A markdown document with one `###` section per endpoint. No introduction
paragraph needed — just the endpoint sections.

## Notes
- `{{SERVICE_FILE_EXCERPT}}` should include only the functions directly called
  by the routes, not the whole service file. The return shape is the important
  part — paste from the `RETURNING *` query or the `result.rows[0]` line.
- If error handling is inconsistent across routes (which is common in legacy code),
  the AI will document what the code actually does — `500` with `{ error: "server error" }`
  is a legitimate documented response if that is what the route returns.
- This output is a starting point, not a finished spec. Review each endpoint's
  error responses manually — legacy routes often swallow errors silently and the
  AI cannot infer undocumented failure modes.
````
