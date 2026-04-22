````markdown
# Template: Add a Service Function + Route Handler

## Purpose
Add a new database operation to `taskService.js` and wire it to an Express
route, matching TundraBoard's existing callback-based patterns exactly.

## Variables

| Variable | Description |
|----------|-------------|
| `{{FUNCTION_NAME}}` | Name of the new service function (e.g., `listComments`) |
| `{{FUNCTION_SPEC}}` | One paragraph: inputs, what the query does, return shape, error cases |
| `{{EXISTING_FUNCTION}}` | Full source of one similar existing function (style reference) |
| `{{TABLE_SCHEMA}}` | The relevant SQL table columns (column name + type, 3–8 lines) |
| `{{ROUTE_VERB_PATH}}` | HTTP method and path for the new endpoint (e.g., `GET /tasks/:id/comments`) |

## Prompt

You are adding a new feature to a legacy Node.js/Express API called TundraBoard.
The codebase uses plain callbacks (no Promises), `var` declarations, raw SQL via
a `pg` pool (`db.query(sql, callback)`), and no input validation.

Your job is to match these patterns exactly — do not introduce async/await,
Promises, or validation libraries. New code must look indistinguishable from the
existing code.

Here is an existing function for style reference:

    {{EXISTING_FUNCTION}}

New function specification:
{{FUNCTION_SPEC}}

Table schema for reference:

    {{TABLE_SCHEMA}}

Produce two things:

1. The new service function `{{FUNCTION_NAME}}` to add to `taskService.js`.
   Follow the same var declarations, db.query callback style, and error-first
   callback signature as the reference function.

2. The Express route handler for `{{ROUTE_VERB_PATH}}` to add to `tasks.js`.
   Follow the same pattern: call the service, handle err with console.log +
   res.status(500), handle success with res.json.

Show each as a separate labelled code block. No explanation needed.

## Expected Output
Two `javascript` code blocks:
- `// taskService.js addition` — the new function with `module.exports` line to add
- `// tasks.js addition` — the new `router.verb(path, ...)` handler

## Notes
- Pass `{{EXISTING_FUNCTION}}` of a function that does a similar query type
  (SELECT for list operations, INSERT for creates). Passing a DELETE as a reference
  for a SELECT will produce the wrong pattern.
- The output will include SQL string concatenation — that is intentional for this
  legacy codebase. Parameterised queries are a separate modernisation step.
- If the route needs query params (e.g., `?status=`), add them to `{{FUNCTION_SPEC}}`
  explicitly or they will be omitted.
````
