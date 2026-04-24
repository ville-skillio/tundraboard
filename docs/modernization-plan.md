# Modernization Plan: taskService.js → taskService.ts

## Assessment (Slot 3 — Chain-of-thought prompt)

**Prompt:**
```
You are reviewing a legacy JavaScript service file for a modernisation exercise.
Think step by step. Analyse this file and list every outdated pattern you find.
For each pattern, explain what it is, why it is a problem, and rate the risk
(probability × impact of a real bug) and the effort to fix it.

Here is the file: [taskService.js pasted in full]
```

**Patterns found:**

1. **`var` declarations** — Function-scoped variables in a codebase that mixes
   ES5 and ES2020 patterns (`crypto.randomUUID()`, template literals in some
   places). Misleading to readers; `var` in a `for` loop leaks to the outer
   function scope.

2. **Callback-based async** — All DB operations use Node.js error-first
   callbacks. `createTask` nests a notification callback inside the DB insert
   callback. `createComment` nests three levels deep (insert → task lookup →
   two notification fires). Classic "callback pyramid" — error paths are easy
   to miss.

3. **No TypeScript types** — All parameters are untyped `any`. No IDE
   completion, no type checking on callers. A typo in a field name (e.g.
   `taskData.projectId` vs `taskData.project_id`) silently produces `undefined`
   in the SQL string.

4. **God-class: 8 distinct responsibilities in one file** — Tasks, comments,
   labels, notifications, webhooks, audit log, user helpers, and DB connection
   are all managed here. The file is ~300 lines and any change risks unintended
   side effects on an unrelated responsibility.

5. **Raw SQL string concatenation** — Every query is built by interpolating
   user-supplied strings directly. e.g. `"WHERE id = '" + taskId + "'"`. This
   is a textbook SQL injection vulnerability on every single function.

6. **Hardcoded database credentials in `db.js`** — `host`, `user`, and
   `password` are literals. Would be committed to version control.

7. **Mixed async styles** — `getTask`, `getCommentsByTaskId`, and
   `getLabelsByTaskId` use `async/await`. All other functions use callbacks.
   This inconsistency makes composition difficult — you cannot `await
   createTask()` from an async caller.

8. **`require()` calls inside a loop inside a callback** — `triggerWebhooks`
   calls `require('http')` and `require('url')` on every iteration of the
   webhook loop. Node.js caches `require()` so it does not cause repeated I/O,
   but it hides dependencies and makes the function hard to read.

9. **Missing author-check in `updateComment`** — A comment literally says
   "No check if userId is the comment author." The `userId` parameter is
   accepted but ignored. Any authenticated user can overwrite any comment.

10. **`createNotification` callback is optional but callers pass `function(){}`**
    — Some call sites pass a no-op callback, others pass `undefined`. If the
    insert fails with no callback, the error is swallowed with no log.

---

## Risk-Effort Matrix

| # | Pattern | Risk | Effort | Action |
|---|---------|------|--------|--------|
| 5 | SQL injection | Critical | High | Module 3 (security focus, not in scope here) |
| 9 | Missing author-check | High | Low | Separate task |
| 6 | Hardcoded credentials | High | Low | Config/env work |
| 2 | Callbacks (`createTask`) | Medium | Medium | **T1** |
| 7 | Mixed async styles | Medium | Medium | **T1, T2** |
| 3 | No TypeScript types | Medium | Low | **T2** |
| 4 | God-class (labels) | Medium | Medium | **T3** |
| 1 | `var` declarations | Low | Low | Covered by T2 (TS enforces `const`/`let`) |
| 8 | `require()` inside callback | Low | Low | Out of scope (webhook refactor is separate) |
| 10 | Optional notification callback | Low | Low | Covered by T1 (async removes the pattern) |

---

## Transformation Sequence

**T1 — Convert `createTask` from callbacks to async/await**
Target: `createTask` is the most instructive callback conversion — it nests
a notification callback inside the DB insert callback, which is the pattern
most likely to cause bugs (error swallowing, double-callback risk). Converting
it first demonstrates the core technique and removes the most tangled nesting.
Depends on: nothing.

**T2 — Add TypeScript types + convert `updateTask` to async/await**
Target: `updateTask` is the second most complex callback function (dynamic SET
clause, two error paths). After T1, adding types to the whole file costs little
extra effort since all function shapes are already understood.
Depends on: T1 (the full async signature of `createTask` is easier to type once
the callback wrapper is gone).

**T3 — Extract label operations into `labelService.ts`**
Target: The five label functions (`createLabel`, `getLabelsByWorkspace`,
`getLabelsByTaskId`, `addLabelToTask`, `removeLabelFromTask`) form a coherent
responsibility with no cross-cutting concerns. They can be extracted cleanly
and converted to async/await as part of the move.
Depends on: T2 (`Label` type from `src/types/task.ts` needed for the new module).

---

## T1 — `createTask` callback → async/await

### Prompt (Slot 1, few-shot)
```
I am converting legacy Node.js callback-based functions to async/await in
TypeScript. Here is a simple example to establish the pattern:

BEFORE (callback):
function deleteTask(taskId, callback) {
  db.query("DELETE FROM tasks WHERE id = '" + taskId + "'", function(err) {
    if (err) { callback(err); return; }
    callback(null, { deleted: true });
  });
}

AFTER (async/await):
async function deleteTask(taskId: string): Promise<{ deleted: boolean }> {
  await db.query("DELETE FROM tasks WHERE id = '" + taskId + "'");
  return { deleted: true };
}

Now convert this function. It nests a notification callback inside the DB
callback. The notification must remain best-effort: if it fails, task
creation must still succeed and return the task. Do not propagate the
notification error.

[createTask from taskService.js pasted]
```

### AI response (adjustment made)
The AI produced a version that called `createNotification` without awaiting it,
using a floating `.catch()`. This changed the observable timing: the task would
resolve before the notification was attempted, breaking the characterisation test
that asserts `db.query` was called twice before the function returns.

**Adjustment:** wrapped the notification call in `new Promise<void>((resolve) => {...})`
and awaited that Promise, so the function only returns after the notification
attempt completes. The notification error is still swallowed — only the timing
of resolution is preserved.

### Before (excerpt from `taskService.js`)
```javascript
function createTask(taskData, callback) {
  var assigneeId = taskData.assigneeId || null;
  var id = crypto.randomUUID();
  var query = "INSERT INTO tasks ... RETURNING *";

  db.query(query, function(err, result) {
    if (err) { callback(err, null); return; }
    var task = result.rows[0];

    if (assigneeId) {
      createNotification(assigneeId, 'task_assigned', '...', { taskId: id }, function(notifErr) {
        if (notifErr) console.log('Failed to create notification:', notifErr);
        callback(null, task);          // ← called after notification attempt
      });
    } else {
      callback(null, task);
    }
  });
}
```

### After (in `taskService.ts`)
```typescript
async function createTask(taskData: CreateTaskInput): Promise<Task> {
  const { title, description = '', projectId, priority = 'medium',
          assigneeId = null, createdById } = taskData;
  const id = crypto.randomUUID();
  const result = await db.query("INSERT INTO tasks ... RETURNING *") as { rows: Task[] };
  const task = result.rows[0];

  if (assigneeId) {
    // Awaited for timing parity with legacy; error intentionally swallowed.
    await new Promise<void>((resolve) => {
      createNotification(assigneeId, 'task_assigned',
        'You have been assigned a new task: ' + title, { taskId: id },
        (notifErr) => { if (notifErr) console.log('Failed to create notification:', notifErr); resolve(); });
    });
  }

  return task;
}
```

### Test results after T1
Characterisation tests updated: callback-style `done()` tests for `createTask`
replaced with `async/await`. All 4 `createTask` tests: **PASS**.
All `getTask` tests: **PASS** (no change). All `updateTask` tests: **PASS** (no change).

---

## T2 — TypeScript types + `updateTask` callback → async/await

### Prompt (Slot 3, role)
```
You are a TypeScript expert reviewing a service file that has just had its
first async conversion applied (T1). Add proper TypeScript types to all
remaining functions. Then convert updateTask from callbacks to async/await
— it is the next highest-priority callback function because it has a dynamic
SET clause and two distinct error paths (DB error, not-found).

The types Task, Comment, Label, and CreateTaskInput are already defined in
../types/task.ts. Use those.

For the remaining callback-based functions (deleteTask, listTasks, createComment,
updateComment, deleteComment) add TypeScript types to their signatures but do
NOT convert them to async/await yet — that is out of scope for T2.

Here is the current file: [taskService.ts after T1]
```

### AI response (adjustment made)
The AI suggested typing `updates` in `updateTask` as `Partial<Task>`. This was
rejected — `Partial<Task>` would allow callers to pass `id` or `created_at` as
update fields, which would let them overwrite immutable columns.

**Adjustment:** typed `updates` as `Record<string, unknown>` and added a comment
noting that a future improvement should use an explicit `TaskUpdateInput` type
with only the allowed fields.

Also added a `TaskFilters` interface for `listTasks`, since `Partial<Task>` does
not include `page`, `limit`, or `search`.

### Before (`updateTask` in `taskService.js`)
```javascript
function updateTask(taskId, updates, callback) {
  var setClauses = [];
  var keys = Object.keys(updates);
  for (var i = 0; i < keys.length; i++) { ... }
  setClauses.push("updated_at = NOW()");
  var query = "UPDATE tasks SET " + setClauses.join(', ') + ...;
  db.query(query, function(err, result) {
    if (err) { callback(err, null); return; }
    if (result.rows.length === 0) { callback(new Error('Task not found'), null); return; }
    callback(null, result.rows[0]);
  });
}
```

### After (in `taskService.ts`)
```typescript
async function updateTask(taskId: string, updates: Record<string, unknown>): Promise<Task> {
  const setClauses: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(value === null ? `${key} = NULL` : `${key} = '${value}'`);
  }
  setClauses.push('updated_at = NOW()');
  const query = 'UPDATE tasks SET ' + setClauses.join(', ') + " WHERE id = '" + taskId + "' RETURNING *";
  const result = await db.query(query) as { rows: Task[] };
  if (result.rows.length === 0) throw new Error('Task not found');
  return result.rows[0];
}
```

### Test results after T2
`updateTask` tests updated from `done()` callback style to `async/await`.
All 4 `updateTask` tests: **PASS**. TypeScript compilation: **0 errors**.
All other tests: **PASS**.

---

## T3 — Extract label operations into `labelService.ts`

### Prompt (Slot 3, role)
```
You are a senior engineer performing a responsibility audit on a service module.
The file currently owns tasks, comments, labels, notifications, webhooks,
audit log, and user helpers — a god-class.

Extract all five label operations (createLabel, getLabelsByWorkspace,
getLabelsByTaskId, addLabelToTask, removeLabelFromTask) into a new file
src/services/labelService.ts. As you extract them, convert any remaining
callback-based functions to async/await — consistency within the new module
is more important than preserving the callback style.

Re-export the label functions from taskService.ts so existing callers that
import from taskService are not broken. This is a modernisation pass, not a
breaking-change refactor.

Types to use: Label from ../types/task. DB import: require('../db').

Here is the current taskService.ts: [pasted]
```

### AI response (adjustment made)
The AI suggested NOT re-exporting from `taskService.ts`, reasoning that callers
should update their imports to point at `labelService` directly. This was
rejected — the exercise scope is the service layer, not all callers. Backwards
compatibility via re-export is the correct default for a first modernisation pass.

### Test results after T3
All existing `taskService` characterisation tests: **PASS** (label functions
still accessible via re-export). New `labelService` characterisation tests
(4 tests): **PASS**. TypeScript compilation: **0 errors**.
