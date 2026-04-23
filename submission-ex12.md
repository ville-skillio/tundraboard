# Exercise 12 — AI as Architecture Partner: Redis Caching Layer for TundraBoard

---

## 1. Chosen Architecture Change

**Introduce a Redis caching layer for frequently-read data.**

Selected because TundraBoard's codebase analysis (see Section 5) reveals a concrete and measurable problem: every authenticated request that touches workspace resources executes at least one synchronous `workspaceMember.findUnique` call to PostgreSQL — a pure point-lookup with no write path, no complex join, and membership data that changes rarely. This is a textbook cache candidate with immediate, low-risk payoff before the currently-TODO routes (projects, workspaces, comments) are even implemented.

---

## 2. Trade-Off Analysis

### Option A — Application-level Redis cache (chosen)

Wrap Prisma calls in a thin cache layer (`src/utils/cache.ts`). Cache `workspaceMember` lookups by `userId:workspaceId` composite key, `task` objects by ID, and `notification` lists by `userId`. Invalidate on writes.

**Pros**
- Eliminates the 5 repeated `workspaceMember.findUnique` calls on every label/attachment request — these hit PostgreSQL on every single authenticated action today
- TTL-based expiry (e.g. 5 min for membership, 60 s for tasks) means stale data risk is bounded without complex invalidation
- Transparent to route handlers: replace `prisma.workspaceMember.findUnique(...)` with `cachedMembership(userId, workspaceId)` — no architectural churn
- Redis is also a natural foundation for future features: rate-limit counters (`express-rate-limit` already in `package.json`), session storage, pub/sub for real-time notifications
- Fabric analogy: same principle as Silver-layer materialized views — compute once, read many times

**Cons**
- New operational dependency: Redis must be provisioned, monitored, and kept available
- Cache invalidation bugs are a real risk — a missed `del` after a membership removal means an evicted user retains access for up to TTL
- Local dev requires Docker Compose or a local Redis instance (developer onboarding friction)
- In tests, the mock boundary moves: currently `prisma` is mocked in vitest; with a cache layer, tests must either bypass the cache or mock `ioredis` as well

**Risks**
- Security risk: stale `workspaceMember` cache entry after role downgrade or removal. Mitigation: always invalidate the cache key on `DELETE /workspaces/:id/members/:userId` and `PATCH .../members` role updates; use short TTL (≤5 min) as a safety net
- Availability risk: if Redis goes down, all membership checks fail. Mitigation: fail-open pattern — catch `RedisError`, fall back to Prisma, log the event

---

### Option B — PostgreSQL query optimisation only

Add composite index on `(user_id, workspace_id)` in `workspace_members` (already present as `@@unique` — Prisma creates this index automatically). Add `EXPLAIN ANALYZE` instrumentation and connection pooling via PgBouncer.

**Pros**
- Zero new infrastructure — no Redis, no Docker Compose changes
- Solves the problem at the source: if the query is fast enough, caching is unnecessary
- Connection pooling via PgBouncer reduces connection overhead under concurrency

**Cons**
- `workspaceMember.findUnique` on a composite unique key already uses the index — the query is likely already <1 ms in isolation. The problem is _frequency_ (N calls per request chain), not individual query speed
- Does not help with `getTask` which joins comments + taskLabels + project — that join cost grows with data volume regardless of indexes
- PgBouncer is itself a new dependency with its own operational burden

**Risks**
- False confidence: benchmark shows fast queries, team declares problem solved, but under concurrent load (10 users × 20 requests/s = 200 DB connections) connection exhaustion surfaces anyway
- Prisma's connection pool is configurable (`connection_limit`) but not as flexible as PgBouncer for multiplexing

---

### Option C — In-process memory cache (node-cache / Map with TTL)

Store cache data in-process using a simple `Map` with manual TTL tracking or a library like `node-cache`. No external service required.

**Pros**
- Zero infrastructure: works in a single Node.js process without Redis
- Zero network latency: in-process reads are sub-microsecond
- Good for read-heavy, low-cardinality data like workspace membership

**Cons**
- Does not survive process restart — cold starts always hit PostgreSQL
- Does not share state across multiple Node.js instances. TundraBoard will eventually run multiple replicas (horizontal scaling, blue-green deployments). An in-process cache means a user removing a member on instance A leaves instance B's cache stale with no eviction path
- Memory pressure: Node.js heap grows unbounded if cache eviction is not tuned correctly; large task payloads (description + comments + labels) could bloat the process

**Risks**
- Premature optimisation with a short shelf life: as soon as TundraBoard runs two instances (e.g. a canary deployment), the in-process cache becomes a correctness bug, not just a staleness issue

---

### AI Analysis Evaluation

I used Claude as a reasoning partner to structure this analysis. What it got right:

- It correctly identified `workspaceMember.findUnique` as the primary cache candidate by cross-referencing the read-path call count with write-path frequency — a pattern humans often miss because they focus on slow queries rather than frequent ones
- The fail-open fallback suggestion (catch Redis errors, fall back to Prisma) was immediately applicable and is the correct production pattern
- The TTL recommendations (5 min for membership, 60 s for task objects) were reasonable starting points grounded in cache coherence reasoning

What required human correction:

- AI initially suggested Option C (in-process cache) as sufficient for "a small application". This is the classic mistake of optimising for current scale. I overrode this: TundraBoard's TODO routes (projects, workspaces, comments) will substantially increase load, and the architecture must accommodate that growth, not just today's traffic. In-process cache is a dead end once horizontal scaling is needed.
- AI suggested caching `searchTasks` results (the paginated list query). I rejected this: the search query takes 8 parameters with free-text input. Cache key space is effectively unbounded, cache hit rate would be near zero, and write invalidation is complex (any task update in the project must flush all search cache entries for that project). The complexity cost exceeds the benefit.

**Final decision: Option A (Redis).** It solves the real problem (repeated membership checks), is the correct production pattern, and lays the groundwork for future features without locking TundraBoard into a single-process architecture.

---

## 3. Phased Migration Plan

### Phase 0 — Baseline measurement (pre-requisite, not a rollout phase)

Before writing any cache code, instrument the existing system:

```typescript
// src/utils/prisma.ts — add query event logging
export const prisma = new PrismaClient({
  log: [{ emit: "event", level: "query" }],
});
prisma.$on("query", (e) => {
  if (e.duration > 50) console.warn(`Slow query (${e.duration}ms): ${e.query}`);
});
```

Collect: median and p99 latency for `workspaceMember.findUnique` and `task.findUnique` under realistic load (use `k6` or `autocannon` against local dev). This becomes the benchmark against which Phase 1 is measured.

---

### Phase 1 — Infrastructure and cache utility

**Goal:** Redis running locally and in CI; cache utility tested in isolation; no production behaviour change.

**Entry criteria:** Baseline metrics recorded. All existing tests pass.

**Work:**

1. Add `ioredis` to dependencies.
2. Add Redis service to `docker-compose.yml` (dev) and CI workflow.
3. Create `src/utils/cache.ts`:

```typescript
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length > 0) await redis.del(...keys);
}

export function membershipKey(userId: string, workspaceId: string): string {
  return `membership:${userId}:${workspaceId}`;
}

export function taskKey(taskId: string): string {
  return `task:${taskId}`;
}

export function notificationsKey(userId: string): string {
  return `notifications:${userId}`;
}

export { redis };
```

4. Write unit tests for `cache.ts` using `ioredis-mock`.

**Exit criteria:** `npm test` passes. Redis container starts cleanly in CI. `cache.ts` has 100% unit test coverage.

**Risk assessment:** Low. Redis is additive; no existing code path is modified.

**Rollback strategy:** Delete `src/utils/cache.ts`. Remove `ioredis` from `package.json`. Remove Redis from Docker Compose. No data loss possible.

**Testing strategy:** Unit tests with `ioredis-mock` cover get/set/del and TTL expiry. Integration test verifies Redis container connectivity.

---

### Phase 2 — Cache workspace membership checks

**Goal:** All `workspaceMember.findUnique` calls in routes go through the cache. Membership changes invalidate the cache entry.

**Entry criteria:** Phase 1 complete and merged. Redis available in all environments.

**Work:**

Replace inline Prisma calls with a cached helper. Example — `src/routes/labels.ts` line 16:

```typescript
// Before
const membership = await prisma.workspaceMember.findUnique({
  where: { userId_workspaceId: { userId: req.user!.id, workspaceId } },
});

// After
import { cacheGet, cacheSet, membershipKey } from "../utils/cache.js";

async function getCachedMembership(userId: string, workspaceId: string) {
  const key = membershipKey(userId, workspaceId);
  const cached = await cacheGet<{ role: string }>(key);
  if (cached !== null) return cached;

  const member = await prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });

  if (member) await cacheSet(key, member, 300); // 5-minute TTL
  return member;
}
```

Files affected: `src/routes/labels.ts` (4 calls), `src/routes/attachments.ts` (1 call), and future workspace/project routes.

Add cache invalidation in the workspace member removal route (once implemented):

```typescript
await prisma.workspaceMember.delete({ where: { ... } });
await cacheDel(membershipKey(userId, workspaceId));
```

Add fail-open wrapper:

```typescript
async function getCachedMembership(userId: string, workspaceId: string) {
  try {
    // ... cache logic above
  } catch (err) {
    console.error("Redis error, falling back to DB:", err);
    return prisma.workspaceMember.findUnique({ ... });
  }
}
```

**Exit criteria:**
- All existing tests pass (vitest mocks updated to cover cache hit/miss paths)
- Integration test: membership lookup with Redis available returns cached value on second call (verified by asserting `prisma.workspaceMember.findUnique` is called only once for two identical lookups)
- p99 latency for `GET /labels?workspaceId=X` drops by ≥30% vs Phase 0 baseline

**Risk assessment:** Medium. The security invariant (membership check before data access) is preserved — cache misses fall through to Prisma, so the worst case is a cache miss, not a bypass. The real risk is a stale cache entry after a membership removal. Mitigation: 5-minute TTL limits exposure window; invalidation on delete is implemented explicitly.

**Rollback strategy:** Remove the `getCachedMembership` helper. Revert to inline `prisma.workspaceMember.findUnique` in affected routes. Deployment rollback takes <5 minutes with no data migration needed. Redis data can be flushed with `redis-cli FLUSHDB` but is not required — stale keys expire naturally.

**Testing strategy:**
- Unit: test `getCachedMembership` with `ioredis-mock`, assert cache hit skips Prisma call
- Unit: test fail-open — mock Redis to throw, assert Prisma is called as fallback
- Security: test that a user removed from a workspace is denied access after TTL (simulated by calling `cacheDel` then verifying 403)
- Integration: run existing `tests/labels.test.ts` and `tests/security.test.ts` — both must pass without modification (the mock boundary stays at Prisma layer)

---

### Phase 3 — Cache task objects and notification lists

**Goal:** Cache `getTask` results (expensive join: comments + taskLabels + project) and per-user notification lists. Invalidate on writes.

**Entry criteria:** Phase 2 complete and stable in production for ≥1 week. No cache-related incidents logged.

**Work:**

```typescript
// src/services/taskService.ts
export async function getTask(id: string) {
  const key = taskKey(id);
  const cached = await cacheGet(key);
  if (cached) return cached;

  const task = await prisma.task.findUnique({
    where: { id },
    include: { comments: { orderBy: { createdAt: "asc" } }, taskLabels: { include: { label: true } }, project: true },
  });

  if (task) await cacheSet(key, task, 60); // 60-second TTL
  return task;
}

export async function updateTask(id: string, data: TaskUpdateFields) {
  const task = await prisma.task.update({ where: { id }, data: { ... } });
  await cacheDel(taskKey(id)); // invalidate on write
  return task;
}

export async function deleteTask(id: string) {
  await prisma.task.delete({ where: { id } });
  await cacheDel(taskKey(id));
}
```

Similarly for `getNotifications` in `notificationService.ts`: cache by `userId`, TTL 30 s, invalidate on `markAsRead` and `notifyTaskAssigned`.

**Exit criteria:**
- p99 latency for `GET /tasks/:id` drops by ≥40% vs Phase 0 baseline
- Cache hit rate for task objects ≥60% under load test (10 concurrent users, 30-second run)
- Zero test regressions

**Risk assessment:** Medium. Task cache invalidation must cover all write paths: `updateTask`, `deleteTask`, and any future comment-add path (comments are included in the task join). A missed invalidation means stale task data but not a security breach. Notification staleness is cosmetic.

**Rollback strategy:** Same as Phase 2 — remove cache calls from service layer, revert to direct Prisma. No schema migration involved.

**Testing strategy:**
- Integration test: GET task twice, assert Prisma `findUnique` is called once
- Integration test: update task, GET task, assert updated data is returned (invalidation works)
- Load test: `autocannon -c 10 -d 30 http://localhost:3000/tasks/task-1` — compare p99 against Phase 0 baseline

---

## 4. IP Protection Demonstration

### 4a — Abstracted prompt (as if TundraBoard were proprietary)

> I'm designing a caching layer for a Node.js REST API that uses an ORM backed by PostgreSQL. The API has an authorisation pattern where every data-access endpoint performs a point-lookup on a membership table to verify the requesting user belongs to the resource's owning entity. This lookup is stateless and idempotent — the membership record changes only when an admin explicitly adds or removes a user.
>
> I want to introduce Redis to cache these membership checks. Please analyse the trade-offs between: (a) a TTL-only strategy, (b) write-through invalidation on membership changes, and (c) a hybrid TTL + explicit invalidation approach. Include the security implications of each — specifically, how each handles the case where a user is removed from the owning entity mid-session.

**What was abstracted and why:**

| Removed | Replaced with | Reason |
|---|---|---|
| "TundraBoard" | "a Node.js REST API" | Product name is proprietary |
| "Prisma" | "an ORM" | Reveals technology stack choices that may be trade secrets |
| "workspace_members table", schema details | "membership table" | Schema is proprietary IP |
| "labels, attachments routes" | "data-access endpoints" | Route names reveal product features |
| `workspaceMember.findUnique` call locations | "point-lookup" | File paths reveal internal module structure |

This abstracted prompt returns exactly the architectural reasoning needed while disclosing nothing about TundraBoard's implementation, schema, or feature set.

---

### 4b — Full prompt (with real TundraBoard details)

> I'm adding a Redis caching layer to TundraBoard, a TypeScript/Express API using Prisma ORM with PostgreSQL. The access control pattern is: every route in `src/routes/labels.ts` (4 call sites: lines 16, 38, 67, 105) and `src/routes/attachments.ts` (line 19) calls `prisma.workspaceMember.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } })` to verify the requesting user is a member of the workspace before allowing the operation. This lookup is repeated on every request with no caching.
>
> The `workspace_members` table has a `@@unique([userId, workspaceId])` constraint (Prisma creates the index automatically). Membership changes only when an admin calls the future `DELETE /workspaces/:id/members/:userId` or `PATCH /workspaces/:id/members` routes (not yet implemented).
>
> Please analyse the trade-offs between: (a) TTL-only (5-minute expiry, no explicit invalidation), (b) write-through invalidation on the membership write routes, and (c) hybrid TTL + explicit invalidation. Include the security implications — specifically how each handles a mid-session membership revocation.

**What was abstracted (delta between 4a and 4b):**

- Exact file paths and line numbers → reveals module structure
- "TundraBoard" brand name → product identity
- Prisma-specific query syntax → ORM choice and query API details
- Schema constraint (`@@unique`) → database design decisions
- Specific route paths (`DELETE /workspaces/:id/members/:userId`) → API surface map

The full prompt produces more targeted advice (e.g., AI can reference specific line numbers and Prisma's `cacheDel` integration). The abstracted prompt produces the same strategic reasoning with no IP leakage.

---

## 5. Codebase Analysis (Terminal Agent Output)

Analysis performed on `module-3-planted-bugs` branch, commit `5bdcb6b`.

### Module inventory

| File | Lines | Role |
|---|---|---|
| `src/app.ts` | 49 | Express app wiring, 10 routers mounted |
| `src/routes/tasks.ts` | 84 | CRUD + search/filter for tasks |
| `src/routes/labels.ts` | 153 | Label CRUD + task–label association |
| `src/routes/attachments.ts` | 57 | Attachment get + upload |
| `src/services/taskService.ts` | 117 | Task DB operations |
| `src/services/notificationService.ts` | 40 | Notification create/list/mark-read |
| `src/services/webhookService.ts` | 66 | HMAC-verified inbound + outbound delivery |
| `src/services/auth.service.ts` | 35 | Register/login, bcrypt, JWT sign |
| `src/middleware/authenticate.ts` | 28 | JWT verify, `req.user` injection |
| `src/utils/prisma.ts` | 5 | Singleton PrismaClient |
| **TODOs (stub only)** | | `routes/projects.ts`, `routes/workspaces.ts`, `routes/comments.ts`, `routes/notifications.ts` |

Total source: **854 lines** across 21 files.

### Prisma read query inventory (17 total)

| Call | File | Frequency | Cache candidate? |
|---|---|---|---|
| `workspaceMember.findUnique` | labels.ts (×4), attachments.ts (×1) | Every authenticated label/attachment request | **Yes — high priority** |
| `task.findUnique` (with joins) | taskService.ts | Every `GET /tasks/:id` | **Yes — medium priority** |
| `task.findMany` | taskService.ts | Every `GET /tasks?...` | No — search space too large |
| `webhook.findUnique` | webhookService.ts | Each inbound webhook | No — low frequency |
| `webhook.findMany` | webhookService.ts | Each outbound delivery | No — low frequency |
| `notification.findMany` | notificationService.ts | Each notification list fetch | **Yes — medium priority** |
| `notification.findFirst` | notificationService.ts | Deduplication check on assign | No — write path |
| `label.findUnique` | labels.ts (×2) | Per PATCH/DELETE | No — write path |
| `label.findMany` | labels.ts | Per `GET /labels` | No — write-sensitive |
| `user.findUnique` (×2) | auth.service.ts | Register + login | No — low frequency |
| `attachment.findUnique` | attachments.ts | Per `GET /attachments/:id` | Low priority |

### Coupling analysis

- **High coupling:** `labels.ts` is tightly coupled to both `prisma.workspaceMember` and `prisma.label` — it performs membership checks inline rather than through a shared middleware or service. This is the root cause of the 4 redundant membership lookups. A caching layer abstracts this; a future refactor could extract it into a `requireMembership` middleware.
- **Low coupling:** `taskService.ts` and `notificationService.ts` are clean service modules — routes delegate all DB access to them. This makes cache injection straightforward (modify the service, routes are unaware).
- **Zero coupling to cache:** No file imports any caching utility today. Adding `src/utils/cache.ts` is purely additive.

### Dependency graph (relevant subset)

```
labels.ts ──→ prisma.workspaceMember (×4)  ← cache here
           ──→ prisma.label (×3)

attachments.ts ──→ prisma.workspaceMember (×1)  ← cache here
               ──→ prisma.attachment (×2)

taskService.ts ──→ prisma.task (findUnique with joins)  ← cache here
               ──→ prisma.task (findMany, update, delete, create)

notificationService.ts ──→ prisma.notification (findMany)  ← cache here
                       ──→ prisma.notification (findFirst, create, update)
```

### Key finding

The `getTask` query (`taskService.ts:28`) is the most expensive single query: it joins `comments` (ordered), `taskLabels` → `label`, and `project` in one round-trip. As task comment volume grows, this join grows linearly. A 60-second cache TTL with write-invalidation on `updateTask`/`deleteTask`/future comment mutations will flatten this cost under repeated reads (e.g. a user refreshing a task detail view).

The `workspaceMember.findUnique` calls are the highest-frequency cache opportunity: they fire on every label and attachment operation with no write path interleaving during normal use.

---

## Summary

| Dimension | Decision |
|---|---|
| Architecture change | Redis application-level cache |
| Primary target | `workspaceMember.findUnique` (5 call sites, every authenticated request) |
| Secondary target | `task.findUnique` with joins, `notification.findMany` |
| Migration phases | 3 phases: infrastructure → membership cache → object cache |
| Security invariant | Fail-open (Redis down → fall back to Prisma), explicit invalidation on member removal |
| IP protection | Abstracted prompt omits product name, file paths, schema details, ORM syntax |
| AI usefulness | Strong on pattern identification and fail-open design; required human override on in-process cache recommendation and search result caching scope |
