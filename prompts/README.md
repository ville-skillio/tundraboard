# TundraBoard Prompt Template Library

Reusable AI prompt templates for common development tasks on this codebase.
Each template is parameterised with `{{VARIABLE}}` placeholders — fill them in
before sending.

---

## How to use a template

1. Open the template file for your task type.
2. Replace every `{{VARIABLE}}` with the real value (file content, function name, etc.).
3. Send the filled-in prompt to your AI assistant.
4. Check the output against the template's **verification checklist** or
   **expected output** section before applying it.

---

## Library index

### Code Generation
Prompts that produce new working code.

| File | Purpose | Key variables |
|------|---------|---------------|
| [`code-generation/01-add-service-function.md`](code-generation/01-add-service-function.md) | Add a new db operation to `taskService.js` and its Express route | `FUNCTION_SPEC`, `EXISTING_FUNCTION` |

### Refactoring
Prompts that transform existing code without changing behaviour.

| File | Purpose | Key variables |
|------|---------|---------------|
| [`refactoring/02-callback-to-async.md`](refactoring/02-callback-to-async.md) | Convert a callback function to async/await | `TARGET_FUNCTION`, `HELPER_FUNCTIONS` |

### Testing
Prompts that generate test code.

| File | Purpose | Key variables |
|------|---------|---------------|
| [`testing/03-characterization-tests.md`](testing/03-characterization-tests.md) | Write Jest tests capturing current behaviour before a change | `FUNCTION_SOURCE`, `DB_QUERY_COUNT` |

### Review
Prompts that analyse existing code for problems.

| File | Purpose | Key variables |
|------|---------|---------------|
| [`review/04-legacy-code-audit.md`](review/04-legacy-code-audit.md) | Security and quality audit of a legacy file | `FILE_SOURCE`, `FOCUS_AREAS` |

### Documentation
Prompts that generate human-readable docs from code.

| File | Purpose | Key variables |
|------|---------|---------------|
| [`documentation/05-api-docs-from-routes.md`](documentation/05-api-docs-from-routes.md) | Generate API reference from Express route handlers | `ROUTE_FILE`, `BASE_PATH` |

---

## Test runs

Real examples of two templates filled in against actual TundraBoard code,
with quality assessments.

| File | Template tested | Target code |
|------|----------------|-------------|
| [`test-runs/run-01-characterization-updateTask.md`](test-runs/run-01-characterization-updateTask.md) | Template 03 — Characterisation Tests | `updateTask` in `taskService.js` |
| [`test-runs/run-02-legacy-audit-tasks-route.md`](test-runs/run-02-legacy-audit-tasks-route.md) | Template 04 — Legacy Code Audit | `src/routes/tasks.js` |

---

## Organisation logic

Templates are grouped by **what the output is**, not by what technique they use:

- **code-generation/** — output is new production code to add to the repo
- **refactoring/** — output is a replacement for existing code (same behaviour, better form)
- **testing/** — output is test code
- **review/** — output is a findings report, not code
- **documentation/** — output is human-readable text

This means you reach for the right folder based on what you need to produce.
A new endpoint goes in `code-generation/`; converting that same endpoint's tests
goes in `testing/`. The technique used inside the prompt (few-shot, CoT, role-setting)
is an implementation detail of each template, not a reason to reorganise the folders.

**test-runs/** is a separate folder rather than mixed with templates because test
runs are historical records — they show what happened when a template was used on
real code. They are reference material, not reusable templates themselves.

---

## Adding a new template

1. Choose the correct category folder.
2. Name the file `NN-short-description.md` using the next available number.
3. Use the standard structure: name · purpose · variables table · prompt text ·
   expected output · notes.
4. Add a row to the index table above.
5. If you test the template, add a `test-runs/run-NN-*.md` file and a row to the
   test runs table.
