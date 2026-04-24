# Capstone: Advanced Task Search Feature

Branch: `capstone/advanced-search`  
Date: 2026-04-24

---

## Phase 1 — Requirements (Chain-of-Thought)

### Reasoning process

**Starting question:** What does "advanced search" mean for a task management API?

*Step 1 — Who is asking?* The callers are frontend clients and integration consumers. They need to find tasks efficiently without loading entire workspaces into memory.

*Step 2 — What filters are meaningful?* Status and priority are the most-used filters in any task manager. Assignee filtering is critical for "my tasks" views. Label filtering powers categorisation workflows. Due-date ranges power deadline management dashboards. Full-text search covers the "I remember a task about X" use case.

*Step 3 — What sorting is meaningful?* Chronological (createdAt, updatedAt) for activity feeds. Due date for deadline views. Priority for "what to work on next" views.

*Step 4 — Why cursor pagination over offset?* Offset pagination breaks when rows are inserted between pages. Cursor pagination is stable. The tradeoff is that cursors are opaque (clients cannot jump to page 7), which is acceptable for infinite-scroll UIs.

*Step 5 — What are the hard constraints?* All search must be workspace-scoped (no cross-tenant data leakage). Viewers must be able to search but not write. The `q` filter must use the existing tsvector column, not ILIKE (performance at scale).

### Final requirements specification

**Endpoint:** `GET /tasks`

**Authentication:** Required (Bearer JWT). Any workspace role (admin, member, viewer) can search.

**Required query parameters:**
- `workspaceId` (UUID) — scopes the search to a workspace the user is a member of

**Optional query parameters:**
- `q` (string, 1–200 chars) — full-text search against title (weight A) and description (weight B)
- `projectId` (UUID) — narrow to a specific project within the workspace
- `status` (enum, repeatable) — todo | in_progress | done | cancelled
- `priority` (enum, repeatable) — low | medium | high | urgent
- `assigneeId` (UUID) — tasks assigned to a specific user
- `labelIds` (UUID, repeatable) — tasks with any of the given labels
- `dueBefore` (ISO datetime) — tasks due on or before this date
- `dueAfter` (ISO datetime) — tasks due on or after this date
- `sortBy` (enum) — createdAt | updatedAt | dueDate | priority (default: createdAt)
- `sortOrder` (enum) — asc | desc (default: desc for time-based sorts, asc for dueDate/priority)
- `limit` (integer, 1–100, default 20) — page size
- `cursor` (opaque string) — pagination cursor from previous response

**Response shape:**
```json
{
  "data": [ /* array of TaskSummary */ ],
  "nextCursor": "base64url-encoded-cursor | null",
  "hasMore": true
}
```

**Error responses:** 400 (validation), 403 (not a workspace member).

---

## Phase 2 — Architecture (Role-Setting + Trade-off Evaluation)

*Role: Staff backend engineer with experience in PostgreSQL search and API design.*

### Decision: PostgreSQL tsvector vs external search engine

**Option A: PostgreSQL full-text search (tsvector + tsquery)**

Pros:
- Zero additional infrastructure
- Transactionally consistent (search index updates atomically with data changes via trigger)
- Already present in the TundraBoard schema on the module-3 branch — proven pattern for this codebase
- `plainto_tsquery` handles common user input safely without query syntax knowledge

Cons:
- No fuzzy matching (typos are not handled)
- No synonyms, stemming is English-only unless configured
- At very high row counts (tens of millions), GIN index maintenance cost increases

**Option B: External search engine (Elasticsearch, Typesense, Meilisearch)**

Pros:
- Fuzzy matching, typo tolerance
- Advanced relevance tuning, faceting
- Scales to hundreds of millions of documents

Cons:
- Separate infrastructure to deploy, monitor, and keep in sync
- Eventual consistency — a task updated 50ms ago may not appear in search results
- Complexity: needs an indexing pipeline (webhook or CDC from Postgres)
- Overkill for a team productivity tool with thousands (not millions) of tasks

**Decision: PostgreSQL tsvector.** TundraBoard is a team productivity tool, not a search engine product. The consistency guarantee (search always reflects current data) is more valuable than fuzzy matching. At the scale where an external engine would be warranted, the team would have dedicated infrastructure engineers to operate it.

### Cursor pagination design

Cursor encodes `{ id, createdAt }` for time-based sorts, `{ id, dueDate }` for due-date sort, and `{ id, createdAt, priorityRank }` for priority sort. The keyset WHERE condition is appended to the search SQL rather than applied in application code, ensuring correct ordering even when rows have identical sort field values.

### Two-phase query architecture

Phase 1: Raw SQL retrieves an ordered list of IDs (applying all filters, FTS, cursor, and LIMIT+1).  
Phase 2: Prisma `findMany` fetches full objects with relations for the returned IDs.

This separation keeps the complex cursor and FTS logic in SQL (where it belongs) while keeping relation traversal in Prisma's type-safe layer (where it is maintainable).

---

## Phase 3 — Implementation

### Files created / modified

| File | Action | Description |
|---|---|---|
| `prisma/schema.prisma` | Modified | Added `searchVector Unsupported("tsvector")` + `dueDate` index to Task model |
| `prisma/migrations/20260424120000_add_task_search/migration.sql` | Created | Adds column, GIN index, trigger function, trigger, backfill |
| `src/types/search.ts` | Created | TypeScript types: `TaskSearchInput`, `SearchCursor`, `TaskSummary`, `TaskDetail`, `TaskSearchResult` |
| `src/services/taskService.ts` | Created | Full CRUD + `searchTasks()` with cursor-based pagination |
| `src/routes/tasks.ts` | Replaced stub | POST, GET (search), GET /:id, PATCH /:id, DELETE /:id |

### Key implementation decisions

**`Prisma.raw` for ORDER BY and comparison operators:** sortBy and sortOrder values are validated against Zod enums before reaching the SQL helpers — no user input reaches these strings. Using `Prisma.raw` rather than parameterised values is safe and necessary because PostgreSQL does not allow `ORDER BY $1`.

**`ANY($n::text[])` for array filters:** Passing status and priority arrays as PostgreSQL array parameters avoids dynamic IN clause construction while remaining injection-safe.

**Fetch limit+1 trick:** The service always requests one more row than the client asked for. If the extra row exists, `hasMore = true` and it is excluded from the response. The cursor points to the last *included* item.

**`toSummary` / `toDetail` mappers:** These functions explicitly shape the Prisma result into the API response type, preventing accidental exposure of internal fields (e.g. if a `passwordHash` were somehow joined in).

---

## Phase 4 — Test Suite

### Coverage

`tests/tasks.test.ts` contains 45 tests across 5 describe blocks:

**POST /tasks (6 tests):** create success, missing title, invalid projectId UUID, project not found (422), not a member (403), viewer role (403).

**GET /tasks — search (35 tests):** empty result, missing workspaceId, invalid workspaceId, not a member; returns tasks; filters by projectId, single status, multiple statuses, priority, multiple priorities, assigneeId, labelIds, dueBefore, dueAfter, full-text q; rejects empty q; sorts by updatedAt, dueDate asc, priority desc; rejects invalid sortBy; rejects limit=200 and limit=0; cursor pagination: hasMore=true with nextCursor, hasMore=false on last page, accepts valid cursor, rejects malformed cursor, cursor encodes id+createdAt, cursor for dueDate sort, cursor for priority sort.

**GET /tasks/:id (3 tests):** success, task not found (404), not a member (403).

**PATCH /tasks/:id (4 tests):** update success, invalid status value (400), task not found (404), viewer role (403).

**DELETE /tasks/:id (3 tests):** success (204), task not found (404), viewer role (403).

### Test approach

- `vi.mock` for `src/middleware/authenticate.js` — injects a fixed test user into every request without JWT overhead
- `vi.mock` for `src/utils/prisma.js` — replaces all Prisma calls with `vi.fn()` stubs
- `vi.clearAllMocks()` in `beforeEach` prevents state leakage between tests
- Supertest exercises the full HTTP stack (routing, middleware, validation, serialisation)

---

## Phase 5 — Security Review

### SQL injection

**Risk:** The search query uses raw SQL for FTS, ORDER BY, and cursor conditions.

**Mitigations:**
- `q` (user search term) is passed to `plainto_tsquery` via `Prisma.sql` parameterisation — it becomes `$n` in the prepared statement, never interpolated into the SQL string.
- All array filters (status, priority, labelIds) use `ANY($n::type[])` parameterisation.
- ORDER BY direction and column names come exclusively from validated Zod enums. They enter the SQL via `Prisma.raw()` but cannot contain user input.
- Cursor values (dates, UUIDs, integers) are decoded from JSON and passed as typed Prisma.sql parameters.

**Verdict:** No SQL injection vectors identified.

### Access control

- Every endpoint requires the `authenticate` middleware (JWT verification).
- `GET /tasks` verifies workspace membership before calling `searchTasks`. The search query itself also enforces `p.workspace_id = $workspaceId` in the SQL WHERE clause — defense in depth.
- `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id` additionally check `role !== 'viewer'`.
- `GET /tasks/:id` resolves the task's project and checks membership against the project's workspace — prevents tasks from one workspace being read by members of another.
- `workspaceId` in the search query is validated as a UUID by Zod before being used.

**Verdict:** No cross-tenant access vectors. Viewer role is correctly enforced on mutating operations.

### Input validation

- Zod schemas enforce field types, formats, and bounds before any business logic runs.
- `q` is bounded to 200 characters — prevents excessively large tsquery inputs.
- `limit` is capped at 100 — prevents single-request data dumps.
- Malformed cursors (non-base64url, non-JSON) throw a 400 before reaching any SQL.

### Performance

- The GIN index on `search_vector` makes FTS lookups sub-millisecond up to millions of rows.
- The compound keyset cursor condition `(col < val OR (col = val AND id < id_val))` uses the sort column's B-tree index efficiently.
- The `tasks_due_date_idx` index supports `dueBefore`/`dueAfter` range filters.
- The existing `status` and `assignee_id` indexes support those filters.
- The two-phase architecture means `findMany` with `id IN (...)` is a primary-key lookup — extremely fast.

**Scaling concern:** When `labelIds` filter is used, the `EXISTS` subquery on `task_labels` is not index-assisted beyond the task_id foreign key. At very high label-task density this could slow down. Mitigation: add a composite index `(label_id, task_id)` on `task_labels` if needed.

---

## Phase 6 — Verification Results

```
npm run typecheck  → 1 pre-existing error in health.ts (import.meta, unrelated to this feature). 0 new errors.
npm run lint       → 0 errors, 0 warnings (1 Node module-type advisory in eslint.config.js, pre-existing)
npm run format     → All files formatted
npm test           → 46 tests passed (1 health + 45 task tests), 0 failures, 2.45s
```

The `health.ts` typecheck error (`import.meta` in a CommonJS-targeted file) predates this branch and exists on `main`. It does not affect runtime behaviour since the project uses `tsx` in development and the file works correctly.

---

## Phase 7 — PR Description and API Documentation

### PR Description

**Title:** feat: advanced task search with full-text search and cursor pagination

**Summary:**
- Implements `GET /tasks` as a full-featured search endpoint with workspace-scoped full-text search, seven filter dimensions, four sort options, and cursor-based pagination
- Adds PostgreSQL tsvector column to tasks with a GIN index and trigger for automatic index maintenance
- Implements all remaining task CRUD endpoints (POST, GET /:id, PATCH /:id, DELETE /:id)
- 45 new tests covering happy paths, all filter/sort combinations, pagination edge cases, and auth/authorization errors

**Migration required:** `prisma migrate deploy` (adds `search_vector` column + GIN index + trigger to `tasks` table)

**Test plan:**
- [ ] Run `npm run verify` — all checks pass
- [ ] Run `prisma migrate dev` against a local database
- [ ] Test `GET /tasks?workspaceId=<id>&q=bug` returns relevant results
- [ ] Test cursor pagination by calling with `limit=2`, then using returned `nextCursor`
- [ ] Verify a viewer role can search but cannot create/update/delete tasks

---

### API Documentation: GET /tasks

**Authentication:** `Authorization: Bearer <token>` (required)

**Query Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `workspaceId` | UUID | Yes | Scope search to this workspace |
| `q` | string (1–200) | No | Full-text search across task title and description |
| `projectId` | UUID | No | Restrict to a single project |
| `status` | enum (repeatable) | No | `todo` \| `in_progress` \| `done` \| `cancelled` |
| `priority` | enum (repeatable) | No | `low` \| `medium` \| `high` \| `urgent` |
| `assigneeId` | UUID | No | Tasks assigned to this user |
| `labelIds` | UUID (repeatable) | No | Tasks with any of these labels |
| `dueBefore` | ISO datetime | No | Tasks with due date ≤ this value |
| `dueAfter` | ISO datetime | No | Tasks with due date ≥ this value |
| `sortBy` | enum | No | `createdAt` (default) \| `updatedAt` \| `dueDate` \| `priority` |
| `sortOrder` | enum | No | `asc` \| `desc` (default: `desc` for time sorts, `asc` for dueDate/priority) |
| `limit` | integer (1–100) | No | Page size (default: 20) |
| `cursor` | opaque string | No | Cursor from previous page's `nextCursor` |

**Example request:**
```
GET /tasks?workspaceId=abc&q=authentication&status=todo&status=in_progress&sortBy=priority&limit=10
Authorization: Bearer eyJ...
```

**Example response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Fix authentication middleware",
      "description": "JWT validation is not handling expired tokens correctly",
      "status": "todo",
      "priority": "urgent",
      "assigneeId": "uuid",
      "projectId": "uuid",
      "createdById": "uuid",
      "dueDate": "2026-05-01T00:00:00.000Z",
      "createdAt": "2026-04-10T12:00:00.000Z",
      "updatedAt": "2026-04-10T12:00:00.000Z",
      "assignee": { "id": "uuid", "displayName": "Alice", "email": "alice@tundraboard.dev" },
      "labels": [{ "id": "uuid", "name": "security", "colour": "#EF4444" }]
    }
  ],
  "nextCursor": "eyJpZCI6InV1aWQiLCJjcmVhdGVkQXQiOiIyMDI2LTA0LTEwVDEyOjAwOjAwLjAwMFoifQ",
  "hasMore": true
}
```

**Error responses:**
- `400` — Validation failed (missing `workspaceId`, invalid UUID, invalid enum value, `q` is empty string, `limit` out of range, malformed cursor)
- `403` — User is not a member of the specified workspace

**Pagination usage:**
```
# Page 1
GET /tasks?workspaceId=abc&limit=20

# Page 2 (use nextCursor from page 1 response)
GET /tasks?workspaceId=abc&limit=20&cursor=<nextCursor from page 1>

# Last page: hasMore=false, nextCursor=null
```

---

## Phase 8 — Reflection

### Which AI tools and patterns were most valuable?

The most valuable pattern across this entire build was **chain-of-thought reasoning before writing a single line of code**. The requirements phase forced me to articulate *why* each feature exists, not just what it does. When I reasoned through "why cursor over offset pagination", the answer — stable pagination under concurrent writes — became a constraint that shaped the entire SQL design. Without that reasoning, I might have implemented offset pagination as the simpler option and created a bug that only manifests in production under concurrent load.

**Role-setting** was genuinely useful in Phase 2. Asking myself to reason as a staff backend engineer with PostgreSQL expertise surfaced the consistency tradeoff between tsvector and Elasticsearch that I might otherwise have glossed over. The framing helps avoid anchoring on the first viable solution.

**Few-shot examples** (in Phase 3) meant I could look at `labels.ts` as a concrete reference for the authorization pattern, rather than inventing it from scratch. Every new endpoint I wrote followed the same structure: Zod parse → project lookup → membership check → role check → service call → `next(error)`. The consistency of that pattern is directly attributable to having a working example to reference.

### Where AI assistance was strongest

AI assistance was strongest at the **mechanical composition** tasks: taking a clear design and turning it into correct, idiomatic TypeScript. Once the cursor design was decided on paper, translating it into the five `case` branches of `buildCursorSql` was largely mechanical pattern application. The test generation was similarly strong — given the endpoint contract and the mock patterns from the health test, producing 45 comprehensive tests was fast.

AI was also strong at **catching type errors before running the compiler**. The `string | null` vs `string | undefined` distinction in the `updateTask` signature is the kind of subtle mismatch that causes runtime errors; catching it at design time rather than after a failing build is a real time saving.

### Where AI assistance was weakest

The weakest point was the **cursor pagination for nullable dueDate with NULLS LAST ordering**. This is a genuinely subtle problem: the keyset condition for "rows after a null dueDate cursor" in ASC direction is different from the DESC direction, and the null bucket behaves asymmetrically. Getting this right required careful case-by-case reasoning that was slow and prone to mistakes. AI pattern-matching works poorly here because the correct answer depends on deeply understanding PostgreSQL's NULLS LAST semantics in both orderings simultaneously.

The second weakness was **test isolation design**. The decision to mock at the Prisma level (rather than at the service level) was pragmatic but meant each test implicitly assumes a specific sequence of Prisma calls inside the service. If the service refactors its internal query structure, tests will break even though the external contract is unchanged. A pure service mock would have been more resilient; I chose Prisma-level mocking because it lets me test the full stack including validation and error handling in one pass.

### What I would do differently next time

I would write the **security review before finalising the implementation**, not after. Reviewing the cursor handling for SQL injection risk revealed that the `Prisma.raw` uses are all safe — but this confirmation only came at Phase 5. If I had done the security analysis during Phase 2, I might have more explicitly documented the invariants that make `Prisma.raw` safe (validated enum → no user input can reach it) as code comments, rather than leaving that reasoning only in this document.

I would also add a **composite index on `(label_id, task_id)` in the migration SQL** from the start. The performance note in Phase 5 identified this as a scaling concern; it would have been trivial to include in the same migration.

### How this compares to pre-programme development

The most concrete difference is in the **sequencing of decisions**. Before this programme, I would have opened the code editor first and figured out the architecture while writing. The capstone workflow forces architecture decisions into a document before any code exists, which eliminates a class of rework: I did not write any code that was later deleted because the architecture changed.

The second difference is **explicit security review as a phase**, not an afterthought. In pre-programme practice, security thinking happened reactively (during code review if at all). Making it a named phase with a checklist means it happens before the code ships, not after a vulnerability is reported.

The third difference is more subtle: **writing down reasoning makes it reviewable**. The Chain-of-Thought document in Phase 1 can be read by a colleague who disagrees with a decision and can point to the specific assumption that was wrong. Pre-programme, those decisions lived only in my head and were invisible to review. The AI-native workflow makes reasoning an artifact, not just a process.

What I would push back on: the phase structure works well for features that are genuinely new, but adds friction for small changes. The correct application is selective: use the full workflow for cross-cutting features (like search, which touches schema, migration, service, route, and tests), and skip to Phase 3 for bug fixes and isolated changes.
