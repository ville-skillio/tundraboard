# Test Run 02 — Template 04: Legacy Code Audit on `tasks.js`

## Template used
`prompts/review/04-legacy-code-audit.md`

## Filled-in prompt

```
You are a backend security reviewer auditing a legacy Node.js file for a
team that is about to begin modernisation work.

File: tasks.js

Focus areas: mass-assignment, missing-auth, missing-validation, error-leakage

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

    var express = require('express');
    var router = express.Router();
    var taskService = require('../services/taskService');

    router.post('/', function(req, res) {
      taskService.createTask(req.body, function(err, task) {
        if (err) {
          console.log(err);
          res.status(500).json({ error: 'failed to create task' });
          return;
        }
        res.status(201).json(task);
      });
    });

    router.get('/:id', function(req, res) {
      taskService.getTask(req.params.id, function(err, task) {
        ... [full file as shown above]
      });
    });

    [... full tasks.js content ...]
```

---

## AI Output

**1. Line 6–13 · CRITICAL · mass-assignment**
`req.body` is passed directly to `taskService.createTask` without any field
allowlist. A caller can inject arbitrary fields (e.g., `createdById`, `status`,
`id`) that will reach the database.
Fix: extract only known fields before passing to the service.
```js
var data = { title: req.body.title, projectId: req.body.projectId,
             description: req.body.description, priority: req.body.priority,
             assigneeId: req.body.assigneeId, createdById: req.body.createdById };
taskService.createTask(data, callback);
```

**2. Line 33–43 · CRITICAL · mass-assignment**
`req.body` is passed directly to `taskService.updateTask`. Any field on the
`tasks` table can be overwritten, including `created_by_id` and `project_id`.
Fix: use an explicit allowlist.
```js
var updates = {};
if (req.body.title !== undefined) updates.title = req.body.title;
if (req.body.status !== undefined) updates.status = req.body.status;
if (req.body.priority !== undefined) updates.priority = req.body.priority;
if (req.body.assignee_id !== undefined) updates.assignee_id = req.body.assignee_id;
```

**3. Lines 6, 18, 33, 44, 55, 79, 87, 97 · HIGH · missing-auth**
No authentication middleware is applied to any route. Any unauthenticated caller
can create, read, update, and delete tasks and comments.
Fix: add `authenticate` middleware to the router or individual routes.
```js
var authenticate = require('../middleware/authenticate');
router.use(authenticate);
```

**4. Line 9 · HIGH · error-leakage**
`console.log(err)` in the POST / handler prints the full error object including
stack traces and potentially SQL query strings to stdout. In a containerised
environment these appear in log aggregators accessible to more people than
intended.
Fix: use a structured logger or remove the log; rely on a centralised error
handler instead.

**5. Lines 60–66 · MEDIUM · missing-validation**
`req.query.page` and `req.query.limit` are passed through to the service as
strings and used directly in `LIMIT` and `OFFSET` clauses. A caller passing
`page=0` produces a negative offset; passing `limit=99999` causes a full
table scan.
Fix: parse and clamp before use.
```js
var page = Math.max(1, parseInt(req.query.page) || 1);
var limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
```

**6. Lines 79–86 · MEDIUM · missing-validation**
`req.body.authorId` is taken directly from the request body rather than from
an authenticated session. A caller can post a comment attributed to any user ID.
Fix: once authentication is added, use `req.user.id` instead of `req.body.authorId`.

**7. Lines 18–29 · LOW · code-quality**
Error differentiation for `getTask` checks `err.message === 'Task not found'`
as a string comparison. If the error message ever changes, the 404 silently
becomes a 500.
Fix: use a typed error class or an `err.status` property instead.

---

### Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 2 |
| MEDIUM | 2 |
| LOW | 1 |

**Highest-priority fix:** Add authentication middleware (finding 3) — all other
issues are exploitable only by authenticated users once this is in place.

**Effort to address CRITICAL + HIGH:** M (medium) — mass-assignment fixes are
mechanical but require updating every route; auth middleware requires implementing
JWT verification first.

---

## Quality Assessment

**What worked well:**
- Keeping `{{FOCUS_AREAS}}` to four items kept findings tightly relevant. The
  AI did not list style issues (e.g., `var` vs `const`) or formatting complaints.
- The mass-assignment findings (1 and 2) came with concrete allowlist code, not
  just a description. That made the output immediately actionable.
- Finding 6 (`authorId` from body instead of session) was not explicitly in the
  focus areas but was a direct consequence of missing auth — the AI correctly
  inferred it as in scope.

**What to adjust:**
- The template audits the route file in isolation. The most critical vulnerability
  in this codebase (SQL injection via string concatenation) lives in `taskService.js`,
  not `tasks.js`. The template notes section advises running a separate audit for
  the service file, but a new user might not realise the route file alone gives an
  incomplete picture. Add a `{{COMPANION_FILE}}` optional variable and a note:
  "if the route delegates to a service, paste both files — SQL injection risks
  are invisible from the route layer alone."
- Finding 7 (string comparison for error type) is tagged LOW but is arguably MEDIUM
  for a production system — it will silently mask errors after any refactor. The
  severity calibration in the template could be improved by adding an explicit
  instruction: "flag any pattern where a refactor of one file would silently break
  error handling in another."
