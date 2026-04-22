# Module 3 Submission — Structured AI Code Review

## Target Code

Three files covering the complete task feature: route handlers, service layer, and authentication middleware.

- `src/routes/tasks.ts` — 77 lines
- `src/services/taskService.ts` — 88 lines (original, pre-fix)
- `src/middleware/authenticate.ts` — 38 lines (original, pre-fix)

---

## Code Reviewed (original, pre-fix)

### `src/routes/tasks.ts`

```typescript
import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import * as taskService from "../services/taskService.js";

export const taskRouter = Router();

// Create task
taskRouter.post("/", authenticate, async (req, res, next) => {
  try {
    const task = await taskService.createTask({
      title: req.body.title,
      description: req.body.description,
      projectId: req.body.projectId,
      priority: req.body.priority,
      assigneeId: req.body.assigneeId,
      createdById: req.user!.id,
    });
    res.status(201).json({ data: task });
  } catch (error) {
    next(error);
  }
});

// Search/list tasks
taskRouter.get("/", authenticate, async (req, res, next) => {
  try {
    const tasks = await taskService.searchTasks(
      req.query.projectId as string,
      req.query.search as string || "",
      {
        status: req.query.status as string,
        priority: req.query.priority as string,
        assigneeId: req.query.assigneeId as string,
      },
      parseInt(req.query.page as string) || 1,
      parseInt(req.query.pageSize as string) || 20,
    );
    res.json({ data: tasks });
  } catch (error) {
    next(error);
  }
});

// Get task by ID
taskRouter.get("/:id", authenticate, async (req, res, next) => {
  try {
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: { message: "Task not found" } });
      return;
    }
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
});

// Update task
taskRouter.patch("/:id", authenticate, async (req, res, next) => {
  try {
    const task = await taskService.updateTask(req.params.id, req.body);
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
});

// Delete task
taskRouter.delete("/:id", authenticate, async (req, res, next) => {
  try {
    await taskService.deleteTask(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
```

### `src/services/taskService.ts` (original)

```typescript
import { prisma } from "../utils/prisma.js";
import type { Prisma } from "@prisma/client";

import { sanitizeHtml } from "express-content-sanitizer";

export async function createTask(data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: string;
  assigneeId?: string;
  createdById: string;
}) {
  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description ? sanitizeHtml(data.description) : undefined,
      projectId: data.projectId,
      priority: data.priority || "medium",
      assigneeId: data.assigneeId || null,
      createdById: data.createdById,
    },
  });

  return task;
}

export async function getTask(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      taskLabels: { include: { label: true } },
      project: true,
    },
  });

  return task;
}

export async function updateTask(id: string, data: Prisma.TaskUpdateInput) {
  const task = await prisma.task.update({
    where: { id },
    data: { ...data, updatedAt: new Date() },
  });

  return task;
}

export async function deleteTask(id: string) {
  await prisma.task.delete({ where: { id } });
}

export async function searchTasks(
  projectId: string,
  searchTerm: string,
  filters: { status?: string; priority?: string; assigneeId?: string },
  page: number = 1,
  pageSize: number = 20,
) {
  let whereClause = `WHERE t.project_id = '${projectId}'`;

  if (searchTerm) {
    whereClause += ` AND (t.title ILIKE '%${searchTerm}%' OR t.description ILIKE '%${searchTerm}%')`;
  }
  if (filters.status) {
    whereClause += ` AND t.status = '${filters.status}'`;
  }
  if (filters.priority) {
    whereClause += ` AND t.priority = '${filters.priority}'`;
  }
  if (filters.assigneeId) {
    whereClause += ` AND t.assignee_id = '${filters.assigneeId}'`;
  }

  const offset = (page - 1) * pageSize;

  const tasks = await prisma.$queryRawUnsafe(
    `SELECT t.*, p.title as project_title
     FROM tasks t
     JOIN projects p ON t.project_id = p.id
     ${whereClause}
     ORDER BY t.created_at DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
  );

  return tasks;
}
```

### `src/middleware/authenticate.ts` (original)

```typescript
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-to-a-real-secret-in-production";

interface JwtPayload {
  userId: string;
  email: string;
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: { message: "Missing or invalid authorization header" } });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      ignoreExpiration: true,
    }) as JwtPayload;

    req.user = {
      id: payload.userId,
      email: payload.email,
      displayName: "",
    };
    next();
  } catch {
    res.status(401).json({ error: { message: "Invalid token" } });
  }
}
```

---

## AI Review Output — Five-Concern Checklist

### 1. Correctness

**[C1] `sanitizeHtml` imported from non-existent package — `taskService.ts:4`**

`express-content-sanitizer` is not listed in `package.json`. Node throws `Error: Cannot find module 'express-content-sanitizer'` when the module loads, crashing the entire service before handling any request. Even if the package were installed, it is an Express middleware factory and does not export a `sanitizeHtml` function — the call on line 17 would throw `TypeError: sanitizeHtml is not a function` for any `createTask` request with a description.

**[C2] `updateTask` spreads raw `req.body` without a field allowlist — `routes/tasks.ts:61`, `taskService.ts:41–47`**

`req.body` is typed as `Prisma.TaskUpdateInput` and spread directly into the Prisma update. A caller can include any field Prisma will accept: `createdById`, `projectId`, `createdAt`, or even nested relation operations such as `{ "comments": { "deleteMany": {} } }`. There is no allowlist of which fields may be updated.

**[C3] Missing `projectId` silently returns empty results — `routes/tasks.ts:28`, `taskService.ts:61`**

If `req.query.projectId` is omitted, it resolves to the string `"undefined"`, producing `WHERE t.project_id = 'undefined'` — no rows match, no error. The caller receives `{ data: [] }` with no indication the parameter was required.

### 2. Error Handling

**[EH1] `deleteTask` and `updateTask` surface as 500 for non-existent IDs**

`prisma.task.delete` and `prisma.task.update` throw `PrismaClientKnownRequestError` with code `P2025` when the record does not exist. Neither route catches this, so `next(error)` forwards it to the global error handler which returns 500 instead of 404. The `GET /:id` route handles this correctly by checking for `null`, making the behaviour inconsistent across the router.

**[EH2] `updateTask` route has no 404 handling — `routes/tasks.ts:59–66`**

`getTask` explicitly returns a 404 for missing records. `updateTask` does not — a `PATCH` on a missing ID returns 500 with a generic error message.

### 3. Security

**[S1] SQL injection in `searchTasks` — `taskService.ts:61–84`**

Every filter parameter is concatenated directly into a raw SQL string and executed via `$queryRawUnsafe`:

```typescript
whereClause += ` AND (t.title ILIKE '%${searchTerm}%' ...`
whereClause += ` AND t.status = '${filters.status}'`
whereClause += ` AND t.priority = '${filters.priority}'`
whereClause += ` AND t.assignee_id = '${filters.assigneeId}'`
LIMIT ${pageSize} OFFSET ${offset}
```

Any of `searchTerm`, `status`, `priority`, or `assigneeId` can inject arbitrary SQL. The `LIMIT`/`OFFSET` values are also unparameterized integers from query strings. `$queryRawUnsafe` is Prisma's explicit "bypass safety checks" API. All the functionality is available through Prisma's native `findMany`.

**[S2] `ignoreExpiration: true` in authenticate middleware — `authenticate.ts:25–27`**

```typescript
const payload = jwt.verify(token, JWT_SECRET, {
  ignoreExpiration: true,
}) as JwtPayload;
```

JWT expiration is completely bypassed. Tokens issued with `expiresIn` are accepted indefinitely. A stolen or old token remains valid forever, defeating token rotation, logout flows, and any session revocation mechanism.

**[S3] Mass assignment via `req.body` in `updateTask` (same root cause as C2)**

Because `req.body` is spread directly into `prisma.task.update`, an authenticated attacker can send `{ "createdById": "<other-user-id>" }` to reassign task ownership, or `{ "projectId": "<other-project-id>" }` to move tasks across projects they do not own.

**[S4] No authorization check on update/delete — `routes/tasks.ts:59–76`**

Any authenticated user can `PATCH` or `DELETE` any task by ID. There is no check that `req.user.id` belongs to the task's project or created the task.

### 4. Performance

**[P1] Unbounded `pageSize` — `routes/tasks.ts:36`**

`parseInt(req.query.pageSize as string) || 20` has no maximum. Passing `?pageSize=100000` causes the database to return 100,000 rows in a single query.

**[P2] `getTask` eagerly loads all comments — `taskService.ts:31–34`**

The `include: { comments: { orderBy: { createdAt: "asc" } } }` has no `take` limit. A task with thousands of comments returns them all in one response.

### 5. Maintainability

**[M1] Raw SQL in `searchTasks` while all other operations use Prisma**

`searchTasks` is the only function using raw SQL. Every filter it applies — `ILIKE`, equality checks, pagination — is natively supported by Prisma's `findMany`. The raw SQL adds complexity, loses type safety, and is inconsistent with the rest of the service.

**[M2] `Prisma.TaskUpdateInput` exposed as a service API type — `taskService.ts:41`**

The service function parameter type leaks the ORM layer into the public API. Any future ORM change requires updating all callers.

---

## Finding Classification

| ID  | Finding                                               | Classification          | Notes                                                                 |
|-----|-------------------------------------------------------|-------------------------|-----------------------------------------------------------------------|
| C1  | `sanitizeHtml` import from non-existent package       | Genuine issue           | Planted bug — crashes service on startup                              |
| C2  | `updateTask` spreads raw `req.body`                   | Genuine issue           | Mass assignment — no field allowlist                                  |
| C3  | Missing `projectId` silently returns empty results    | Improvement suggestion  | Poor API ergonomics but not a bug; no incorrect data is returned      |
| EH1 | P2025 not caught → 500 on delete/update of missing ID | Genuine issue           | Wrong HTTP status; inconsistent with `getTask` behaviour              |
| EH2 | `updateTask` route has no 404 handling                | Genuine issue           | Same root cause as EH1                                                |
| S1  | SQL injection in `searchTasks`                        | Genuine issue           | Planted bug — directly exploitable via any filter query param         |
| S2  | `ignoreExpiration: true`                              | Genuine issue           | Planted bug — all tokens valid forever                                |
| S3  | Mass assignment security consequence (same as C2)     | Genuine issue           | Security dimension of C2; same fix resolves both                      |
| S4  | No authorization check on update/delete               | Improvement suggestion  | No spec defines ownership rules; depends on intended design           |
| P1  | Unbounded `pageSize`                                  | Improvement suggestion  | Real production concern but not a correctness or security bug         |
| P2  | Unbounded comment loading in `getTask`                | Improvement suggestion  | Same — production scaling concern, not a defect                       |
| M1  | Raw SQL mixed with Prisma                             | Improvement suggestion  | Resolved as a side effect of the S1 fix                               |
| M2  | ORM type leaking into service API                     | Improvement suggestion  | Coupling concern; no functional impact                                |

---

## Three Fixes

### Fix 1 — SQL injection in `searchTasks` (`taskService.ts`)

**What was wrong:**
`searchTasks` built SQL by concatenating user-supplied query parameters directly into a string, then executed it with `$queryRawUnsafe` — Prisma's explicit "skip all safety checks" API. Any of the five parameters (`projectId`, `searchTerm`, `status`, `priority`, `assigneeId`) could inject arbitrary SQL.

**What was changed:**
Replaced the entire raw SQL implementation with Prisma's native `findMany`, using the structured `where` clause with proper parameterization, `mode: "insensitive"` for case-insensitive search, and `skip`/`take` for pagination.

```typescript
// Before
let whereClause = `WHERE t.project_id = '${projectId}'`;
if (searchTerm) {
  whereClause += ` AND (t.title ILIKE '%${searchTerm}%' OR t.description ILIKE '%${searchTerm}%')`;
}
// ...
const tasks = await prisma.$queryRawUnsafe(`SELECT ... ${whereClause} LIMIT ${pageSize} OFFSET ${offset}`);

// After
const tasks = await prisma.task.findMany({
  where: {
    projectId,
    ...(searchTerm && {
      OR: [
        { title: { contains: searchTerm, mode: "insensitive" } },
        { description: { contains: searchTerm, mode: "insensitive" } },
      ],
    }),
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
    ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
  },
  include: { project: true },
  orderBy: { createdAt: "desc" },
  skip: (page - 1) * pageSize,
  take: pageSize,
});
```

**Why:** Eliminates the injection surface entirely. Prisma's query builder parameterizes all values automatically — there is no string interpolation path. The fix also removes the inconsistency between `searchTasks` and every other function in the service.

---

### Fix 2 — `ignoreExpiration: true` in `authenticate.ts`

**What was wrong:**
`jwt.verify` was called with `{ ignoreExpiration: true }`, which tells the `jsonwebtoken` library to skip the `exp` claim check. Any token — regardless of age or intended lifetime — was accepted as valid, forever.

**What was changed:**
Removed the options object entirely, restoring standard JWT verification behaviour.

```typescript
// Before
const payload = jwt.verify(token, JWT_SECRET, {
  ignoreExpiration: true,
}) as JwtPayload;

// After
const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
```

**Why:** Without this option, `jsonwebtoken` enforces the `exp` claim as intended. Expired tokens throw `TokenExpiredError`, which the existing `catch` block already handles correctly by returning 401. No other code changes were needed.

---

### Fix 3 — Bad `express-content-sanitizer` import (`taskService.ts`)

**What was wrong:**
`taskService.ts` imported `sanitizeHtml` from `express-content-sanitizer`, a package that (1) is not in `package.json` and therefore not installed, and (2) even if it were installed, does not export a `sanitizeHtml` function — it is an Express middleware factory. Node throws `Cannot find module 'express-content-sanitizer'` at module load time, crashing the entire service before it can handle any request.

**What was changed:**
Removed the import and the `sanitizeHtml` call. The description is now passed directly to Prisma.

```typescript
// Before
import { sanitizeHtml } from "express-content-sanitizer";
// ...
description: data.description ? sanitizeHtml(data.description) : undefined,

// After
// (import removed)
// ...
description: data.description ?? undefined,
```

**Why:** Task descriptions in this API are plain text stored in a PostgreSQL `text` column — HTML rendering is a client-side concern. The schema has no HTML fields. Removing the call is the correct fix. If HTML sanitization is genuinely needed in the future, the right package is `sanitize-html`, which actually exports a function with that name.


---

## Regression Tests

See `tests/tasks.test.ts` for the full suite (28 tests). The regression tests are the first three `describe` blocks.

### Revert evidence

| Fix | Reverted file | Tests that failed | Conclusion |
|-----|--------------|-------------------|------------|
| Fix 1 — SQL injection | `searchTasks` reverted to `$queryRawUnsafe` | 10 tests failed, including both Regression Fix 1 assertions and all `GET /tasks` happy-path tests | Regression tests correctly catch the original bug |
| Fix 2 — `ignoreExpiration` | `{ ignoreExpiration: true }` re-added to `authenticate.ts` | 1 test failed: "rejects an expired token with 401" returned 200 | Regression test correctly catches the original bug |
| Fix 3 — bad import | `import { sanitizeHtml } from "express-content-sanitizer"` re-added | 0 tests failed | See quality evaluation |

---

## Test Quality Evaluation

### Regression Fix 1 — SQL injection
**Verdict: Sound.** Both assertions are meaningful — one verifies the dangerous API (`$queryRawUnsafe`) is never called, the other verifies the injection payload reaches Prisma as a typed value rather than raw SQL. The revert proof confirms they catch the original bug.

### Regression Fix 2 — `ignoreExpiration`
**Verdict: Sound.** The test creates a genuinely expired token (exp set to one hour in the past) and asserts 401. The revert proof shows the pre-fix code returned 200 for that token. The companion test confirming valid tokens still pass is not a tautology — it guards against over-correction (e.g., accidentally rejecting all tokens).

### Regression Fix 3 — bad import
**Verdict: Partially effective.** The module-load crash (`Cannot find module`) cannot be reproduced in Vitest's Vite-based sandbox, which handles missing ESM imports more gracefully than Node.js `require()`. The tests were updated to instead verify the observable contract: a task with a description returns 201 and `prisma.task.create` receives the description string unchanged. These tests would catch a future regression where the description is mangled or dropped, and they verify the correct post-fix code path. The module-load crash itself can only be reliably tested via a Node.js integration or smoke test outside Vitest.

### False positives in the broader suite
None identified. Every assertion checks a specific return value, status code, or mock call argument — no `expect(true).toBe(true)` tautologies present.

### Meaningful assertions check
- `GET /tasks/:id` → 404: asserts the error message matches `/not found/i`, not just the status code.
- `POST /tasks` createdById: asserts the exact value passed to `prisma.task.create`, ruling out a body-supplied override.
- Pagination: asserts exact `skip` and `take` values, not just that `findMany` was called.

---

## Coverage Gap Analysis — Manually Written Tests

### Gap 1 — `page=0` boundary value (line 223)
The AI generated pagination tests for explicit valid pages (page=3) but missed the zero boundary. `parseInt("0")` is falsy, so `|| 1` silently converts it to page 1. This is arguably correct behaviour but the contract is non-obvious and worth locking in. A future refactor that replaces `|| 1` with `?? 1` would change the semantics for `page=0`.

### Gap 2 — SQL injection via `assigneeId` filter (line 240)
The AI's Fix 1 regression tests covered `searchTerm` only. The original vulnerability affected all five interpolated values including `assigneeId`. This test verifies that `assigneeId` is also passed as a Prisma value (not interpolated SQL) in the post-fix code, and that `$queryRawUnsafe` is not called regardless of which filter carries the payload.

### Additional gaps not yet covered (not written — identified for completeness)
- **Concurrent task deletion**: `DELETE` on a task that is simultaneously deleted by another request — Prisma P2025 error surfaces as 500 instead of 404 (the EH1 bug from Exercise 1 that was not fixed).
- **JWT with valid signature but missing `userId` claim**: `jwt.verify` succeeds but `payload.userId` is undefined, meaning `req.user.id` is undefined. Any downstream Prisma call using it as a FK would throw a database error rather than returning a structured 400.
