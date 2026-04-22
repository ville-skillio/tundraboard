````markdown
# Template: Generate Characterisation Tests

## Purpose
Write Jest tests that capture the current observable behaviour of a legacy
service function *before* making any changes. These tests act as a safety net
during modernisation — if they pass before and after a transformation, behaviour
is preserved.

## Variables

| Variable | Description |
|----------|-------------|
| `{{FUNCTION_SOURCE}}` | Full source of the function to test |
| `{{FUNCTION_NAME}}` | Name of the function |
| `{{EXISTING_TEST_BLOCK}}` | One complete `describe` block from the existing test file (few-shot style reference) |
| `{{MOCK_SETUP}}` | The `jest.mock` + `require` lines at the top of the test file |
| `{{DB_QUERY_COUNT}}` | How many `db.query` calls the function makes (helps the AI plan mocks correctly) |

## Prompt

You are writing characterisation tests for a legacy Node.js service.
Characterisation tests capture what code *currently does*, not what it *should* do.
If the code has a bug, capture the buggy behaviour — do not fix it in the test.

Here is the existing test file setup and one example test block for style reference:

Mock setup:

    {{MOCK_SETUP}}

Example test block (follow this exact style — describe/it structure, done callbacks
for async, mockImplementationOnce chaining for multiple db calls):

    {{EXISTING_TEST_BLOCK}}

Function to test (`{{FUNCTION_NAME}}`):

    {{FUNCTION_SOURCE}}

This function makes {{DB_QUERY_COUNT}} `db.query` call(s).

Write a `describe('{{FUNCTION_NAME}}', ...)` block covering:
1. The happy path — mock all db calls to succeed, assert on the return value shape
2. Each distinct error path — one test per db.query call that can fail
3. Any conditional branches (e.g., "when X is null", "when result is empty")

Rules:
- Use `mockImplementationOnce` not `mockResolvedValueOnce` — the legacy code uses
  callbacks, not Promises.
- Each test must call `done()` at the end of its callback.
- Do not assert on SQL string content unless the test is specifically about query
  construction.
- Copy `beforeEach(() => { jest.clearAllMocks(); })` is already in the file — do
  not add it again.

## Expected Output
A single `describe('{{FUNCTION_NAME}}', ...)` block ready to paste into
`tests/taskService.characterization.test.js`.

## Notes
- `{{DB_QUERY_COUNT}}` is the most important variable to get right. If you pass
  the wrong number, the AI will set up too few or too many `mockImplementationOnce`
  chains and tests will hang or fail.
- If the function calls another service function internally (not `db.query` directly),
  note that in `{{FUNCTION_SOURCE}}` as a comment — the AI needs to know whether to
  mock at the db level or the service level.
- Characterisation tests deliberately capture bugs. If `updateComment` does not check
  authorship, write the test to confirm it *doesn't* check — the bug becomes visible
  documentation.
````
