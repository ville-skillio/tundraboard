# Modernisation Report — Legacy Task Service

**Branch:** module-2-legacy  
**Source file:** src/services/taskService.js (350 lines, plain JavaScript)  
**Approach:** beginner path — one function at a time, tests before every change

---

## Characterisation Tests

Written before any code changes to lock in observable behaviour.

**File:** `tests/taskService.characterization.test.js`  
**Framework:** Jest (chosen for native CJS module support)  
**Mock strategy:** `src/__mocks__/db.js` manual mock intercepting `require('../db')`

**11 tests across 3 groups:**

| Group | Tests | What is captured |
|-------|-------|-----------------|
| `getTask` | 5 | Returns task + comments + labels; errors from each of the 3 nested queries; empty arrays |
| `createTask` | 4 | Happy path; notification fired when assignee present; task returned even if notification fails; task insert error |
| `createNotification` | 2 | Successful insert; error propagation |

**Baseline result:** 11/11 PASS before any transformation.

---

## Transformation 1 — `getTask` callback → async/await

### Why this function first

`getTask` has three levels of nested callbacks (task query → comments query → labels
query). Each level has its own error-check-and-return pattern. It is the most
readable example of callback complexity and small enough (~30 lines) to change safely.

### Prompt used

> Role-setting: You are modernising a legacy Node.js service one function at a time.
> Chain-of-thought: Trace the three nested db.query callbacks in getTask and identify
> every error path. Then convert getTask, getCommentsByTaskId, and getLabelsByTaskId
> to async/await. Keep all other functions unchanged.

### Before

```js
function getTask(taskId, callback) {
  db.query("SELECT * FROM tasks WHERE id = '" + taskId + "'", function(err, result) {
    if (err) { callback(err, null); return; }
    if (result.rows.length === 0) { callback(new Error('Task not found'), null); return; }
    var task = result.rows[0];
    getCommentsByTaskId(taskId, function(commentErr, comments) {
      if (commentErr) { callback(commentErr, null); return; }
      task.comments = comments;
      getLabelsByTaskId(taskId, function(labelErr, labels) {
        if (labelErr) { callback(labelErr, null); return; }
        task.labels = labels;
        callback(null, task);
      });
    });
  });
}
```

### After

```js
async function getTask(taskId) {
  const result = await db.query("SELECT * FROM tasks WHERE id = '" + taskId + "'");
  if (result.rows.length === 0) {
    throw new Error('Task not found');
  }
  const task = result.rows[0];
  task.comments = await getCommentsByTaskId(taskId);
  task.labels = await getLabelsByTaskId(taskId);
  return task;
}
```

### Test result after T1

Characterisation tests updated from callback-style (`done`) to `async/await` style.
**11/11 PASS.**

The only test change was style — the assertions remain identical, confirming the
behaviour is preserved.

---

## Transformation 2 — TypeScript types for `getTask` and `createTask`

### Why these two functions

`getTask` was just rewritten in T1 and has a clear return shape (Task with embedded
comments and labels). `createTask` is the most-called function in the service and its
`taskData` parameter is currently an untyped object.

### Prompt used

> Few-shot + role-setting: You are adding TypeScript types to a modernised Node.js
> service. Using the Task, Comment, Label, and CreateTaskInput interfaces (provided),
> add return type annotations and parameter types to getTask and createTask.
> Rename the file to taskService.ts. Keep all other functions unchanged.

### What was added

New file: `src/types/task.ts` — defines `Task`, `Comment`, `Label`, `CreateTaskInput`.

Key signatures before (implicit `any`):
```js
function createTask(taskData, callback) { ... }
function getTask(taskId, callback) { ... }
```

Key signatures after (explicit types):
```ts
function createTask(taskData: CreateTaskInput, callback: (err: Error | null, task: Task | null) => void): void
async function getTask(taskId: string): Promise<Task>
```

### Test result after T2

Jest configured with `ts-jest` to handle the renamed `.ts` file.  
**11/11 PASS.** One TypeScript error resolved during setup: `@types/node` needed in
tsconfig `types` array for `module.exports` recognition.

---

## Transformation 3 — Extract `notificationService.ts`

### Why notifications

The god-class has eight distinct responsibilities. Notifications are the cleanest
extraction target: three functions (`createNotification`, `getNotifications`,
`markNotificationRead`) with no dependencies on other taskService internals, only on
`db` and `crypto`.

### Prompt used

> Role-setting + targeted context: Extract the three notification functions from
> taskService.ts into a new src/services/notificationService.ts. The new module owns
> its db import. Update taskService.ts to import from it. Show both complete files.

### Before (in taskService.ts)

Three functions defined inline, consuming ~35 lines.  
`createNotification` called directly by `createTask` and `createComment`.

### After

`src/services/notificationService.ts` — standalone module with named exports:
- `createNotification(userId, type, body, metadata, callback?)`
- `getNotifications(userId, callback)`
- `markNotificationRead(notificationId, callback)`

`taskService.ts` imports them:
```ts
import { createNotification, getNotifications, markNotificationRead } from './notificationService';
```

### Test result after T3

**11/11 PASS.** One resolution issue encountered: ts-jest required bare module
specifiers (`'./notificationService'`) rather than explicit `.js` extensions.
Fixed in one edit.

---

## Summary

| | Before | After |
|--|--------|-------|
| Language | JavaScript (`.js`) | TypeScript (`.ts`) |
| `getTask` interface | `(taskId, callback)` | `(taskId: string): Promise<Task>` |
| `createTask` interface | `(taskData, callback)` | `(taskData: CreateTaskInput, callback): void` |
| Notification functions | Inline in god-class | `notificationService.ts` |
| Test suite | None | 11 characterisation tests, all green |

**Remaining work** (from plan.ts):
- Replace string-concatenated SQL with parameterised queries (critical — SQL injection)
- Move db credentials out of `db.js` to environment variables
- Extract labels, webhooks, audit log, and user helpers into separate modules
- Convert remaining callback functions to async/await
