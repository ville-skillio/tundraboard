````markdown
# Template: Convert Callback Function to Async/Await

## Purpose
Convert a single callback-based function (and its direct callback helpers) to
`async/await`, preserving identical observable behaviour. Intended to be run
one function at a time during incremental modernisation.

## Variables

| Variable | Description |
|----------|-------------|
| `{{TARGET_FUNCTION}}` | Full source of the function to convert |
| `{{HELPER_FUNCTIONS}}` | Full source of any helper functions the target calls via callbacks (may be empty) |
| `{{CALL_SITES}}` | 2–5 lines showing how the function is currently called, so the AI knows the old signature |
| `{{FUNCTION_NAME}}` | Name of the function (used in the output spec) |

## Prompt

You are modernising a legacy Node.js service one function at a time.
The goal is to convert exactly the functions listed below from error-first
callbacks to async/await. Do not change any other functions.

Rules:
- The converted function must throw on error instead of calling `callback(err, null)`.
- The converted function must return the value instead of calling `callback(null, value)`.
- Remove the `callback` parameter entirely from the converted function's signature.
- Convert helper functions listed in HELPERS the same way.
- Do not convert functions not listed here, even if they are called by the target.
- Keep `var` declarations and string concatenation as-is — only the async pattern changes.

Current call sites (for context — you do not need to update these):

    {{CALL_SITES}}

TARGET FUNCTION to convert:

    {{TARGET_FUNCTION}}

HELPERS to convert (convert these too, same rules):

    {{HELPER_FUNCTIONS}}

Output spec:
- `async function {{FUNCTION_NAME}}(...)` — no callback parameter, throws on error,
  returns value directly.
- Any helper functions listed above converted the same way.

Show the converted functions only. No unchanged code, no explanation.

## Expected Output
One or more `javascript` code blocks with the converted `async function` definitions.

## Notes
- List ALL helper functions that the target calls via callbacks in `{{HELPER_FUNCTIONS}}`.
  If a helper is missed, the AI will leave it as a callback internally and the
  conversion will be incomplete.
- Do not include unrelated exported functions in `{{CALL_SITES}}` — seeing callback
  call patterns for other functions may cause the AI to try converting those too.
- After applying the output, update call sites manually: wrap in try/catch,
  remove the callback argument, use `await` or `.then()`.
- Run characterisation tests immediately after applying — this is the fastest way
  to catch any missed error paths.
````
