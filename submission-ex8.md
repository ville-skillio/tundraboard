# Exercise 8 — Agentic Task Execution with Security Controls

---

## 1. Permission configuration

The agent (Claude Code, terminal session) was configured with the following permission model for this exercise:

### Auto-approved (no confirmation required)
- **Read files** anywhere within the working directory (`/Users/villemakinen/Documents/tundraboard`)
- **Edit / Write files** within the working directory
- **Run tests** — `npm test`, `npm run typecheck`, `npm run lint`
- **Run schema generation** — `npx prisma generate` (read-only side-effect on local node_modules)

### Requires explicit approval
- **Git commits and pushes** — any `git commit` or `git push` requires a separate user-triggered action
- **Installing new packages** — `npm install`, `npm ci`, `npx prisma migrate` require confirmation
- **Destructive shell commands** — `rm`, `git reset --hard`, force operations

### Restricted / refused
- **Writes outside the working directory** — the user explicitly stated this constraint
- **Network requests** outside tool-mediated calls (no `curl`, no direct API calls from shell)
- **CI/CD mutations** — pushing to CI-triggering branches without user review

### Security rationale
The auto-approved set is limited to the local, reversible file-system operations needed to complete the feature. The approval gates protect shared state (git history, remote repo, package registry). Restricting writes to the project directory prevents accidental modification of shell config, SSH keys, or other user files.

---

## 2. Task specification

> **Task:** Add an `estimatedHours` field to the TundraBoard task model.
>
> **Scope (≥ 3 files):**
> 1. `prisma/schema.prisma` — add `estimatedHours Float? @map("estimated_hours") @db.DoublePrecision` to the Task model
> 2. `src/services/taskService.ts` — accept and store `estimatedHours` in `createTask`; add it to `TaskUpdateFields` and `updateTask`; add `minEstimatedHours`/`maxEstimatedHours` filters and a `sortBy: "createdAt" | "estimatedHours"` parameter to `searchTasks`
> 3. `src/routes/tasks.ts` — pass `estimatedHours` from POST body to `createTask`; parse `minEstimatedHours`, `maxEstimatedHours`, and `sortBy` query params and forward to `searchTasks`
> 4. `tests/tasks.test.ts` — add tests for: create with/without estimate, update/clear estimate, min filter, max filter, combined range filter, sort by estimatedHours, default sort unchanged
>
> **Constraints:**
> - `estimatedHours` is optional and nullable (Float? in Prisma)
> - The `updateTask` allowlist must be extended, not bypassed (no mass assignment)
> - `minEstimatedHours` and `maxEstimatedHours` must be combined into a single `estimatedHours: { gte, lte }` Prisma where clause — not two separate clauses that would override each other
> - All existing tests must continue to pass
> - `npm run typecheck` must pass after `prisma generate`

---

## 3. Execution log

### Step 1 — Reading existing files

The agent read `prisma/schema.prisma` and `src/services/taskService.ts` to understand the current Task model and service layer before making any changes.

**Key observations:**
- Task model had no `estimatedHours` field
- `updateTask` used an explicit conditional-spread allowlist — `estimatedHours` had to be added to the list, not mass-assigned via `req.body`
- `searchTasks` already used `prisma.task.findMany` (not raw SQL), making filter additions safe and type-checked

### Step 2 — Schema change (`prisma/schema.prisma`)

Added `estimatedHours Float? @map("estimated_hours") @db.DoublePrecision` after `dueDate` in the Task model. Used `@db.DoublePrecision` to match the database-level type for floating-point hours.

No approval required (local file edit).

### Step 3 — Service layer (`src/services/taskService.ts`)

Three targeted changes:

1. **`createTask`**: Added `estimatedHours?: number` to the input type; passed `data.estimatedHours ?? null` to the Prisma create call (explicit null rather than undefined, to be unambiguous).

2. **`TaskUpdateFields` + `updateTask`**: Added `estimatedHours?: number | null` to the type; added the conditional spread `...(data.estimatedHours !== undefined && { estimatedHours: data.estimatedHours })` to the update data — consistent with the existing allowlist pattern for all other fields.

3. **`searchTasks`**: Extended the `filters` object type with `minEstimatedHours?: number` and `maxEstimatedHours?: number`; added a `sortBy` parameter; added the range filter using a single `estimatedHours: { gte?, lte? }` clause to avoid the two-clause override bug; added `estimatedHours: "asc"` orderBy branch.

### Step 4 — Route layer (`src/routes/tasks.ts`)

- **POST handler**: Added `rawHours` extraction and `Number(rawHours)` coercion before passing to `createTask`.
- **GET handler**: Added `minEstimatedHours`, `maxEstimatedHours` (parsed to `Number`), and `sortBy` extraction; forwarded all three to `searchTasks`.

### Step 5 — Tests (`tests/tasks.test.ts`)

Added 9 new tests in 3 describe blocks:

- `estimatedHours — POST /tasks` (2 tests): create with value, create without value (null stored)
- `estimatedHours — PATCH /tasks/:id` (2 tests): update to value, clear to null
- `estimatedHours — GET /tasks filters and sorting` (5 tests): min filter, max filter, combined range, sort by estimatedHours, default sort unchanged

### Step 6 — First typecheck run → failure

`npm run typecheck` failed with two errors:
- `'estimatedHours' does not exist in type TaskUncheckedCreateInput` — Prisma client was stale
- `'estimatedHours' does not exist in type TaskOrderByWithRelationInput` — same root cause

**Resolution**: Ran `npx prisma generate` to regenerate the Prisma client from the updated schema. No approval required (local operation, no database connection needed).

### Step 7 — Verification

```
npm run typecheck   → 0 errors
npm test            → 62/62 tests pass (4 test files)
```

---

## 4. Changes produced

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `estimatedHours Float? @map("estimated_hours") @db.DoublePrecision` to Task model |
| `src/services/taskService.ts` | `createTask` input + Prisma call; `TaskUpdateFields` + allowlist; `searchTasks` filters, sort, range clause |
| `src/routes/tasks.ts` | POST body `estimatedHours` forwarding; GET query params `minEstimatedHours`, `maxEstimatedHours`, `sortBy` |
| `tests/tasks.test.ts` | 9 new tests covering create, update, clear, min filter, max filter, combined range, sort |

---

## 5. Evaluation of agent output

### Correctness

All 9 new tests pass and all 53 existing tests continue to pass. The typecheck is clean after schema regeneration.

### Adherence to spec

| Spec requirement | Met? | Notes |
|-----------------|------|-------|
| `estimatedHours` optional, nullable | ✓ | `Float?` in schema; `?? null` in create |
| Allowlist not bypassed | ✓ | Conditional spread added, consistent with existing pattern |
| Range as single Prisma clause | ✓ | `{ gte?, lte? }` merged correctly; two-clause override bug avoided |
| ≥ 3 files modified | ✓ | 4 files (schema, service, route, tests) |
| All existing tests pass | ✓ | 53 pre-existing tests all green |
| typecheck passes | ✓ | After `prisma generate` |

### Issues encountered

1. **Stale Prisma client** — The initial range filter implementation had a logic bug (duplicate `gte` condition when both min and max were set). This was caught and fixed before running tests. The typecheck failure prompted the `prisma generate` step, which is a necessary part of any schema change workflow.

2. **No schema migration** — `prisma generate` regenerates the client types but does not create a database migration. In a live environment, `prisma migrate dev` would be required. This is intentional: the exercise does not have a live database, and generating the migration file would require database connectivity.

### Security properties preserved

- The `updateTask` allowlist was extended correctly — `estimatedHours` is explicitly listed and gated by `!== undefined`. A caller cannot sneak in arbitrary Prisma fields via the request body.
- The new query parameters (`minEstimatedHours`, `maxEstimatedHours`) are parsed to `Number` before being passed to the service — they enter the Prisma `where` clause as numbers, not raw strings, so they cannot be used for injection.
- `sortBy` is validated against a two-value union (`"createdAt" | "estimatedHours"`) at the TypeScript layer; the route maps it via a ternary so any other value defaults to `"createdAt"`.
