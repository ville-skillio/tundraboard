# Exercise 6 — AI-Assisted Production Diagnostics

---

## Method

Each scenario was analysed by providing the raw production data to Claude (Sonnet 4.6) as a structured diagnostic prompt. The prompts follow a consistent format:

> "You are diagnosing a production issue in TundraBoard, a Node.js/Express/Prisma/PostgreSQL task-management API. Here is the evidence: [data]. Identify the root cause, explain why the symptom presents as described, and propose concrete fixes with code examples."

The AI's output was then evaluated against the actual codebase before finalising recommendations.

---

## Scenario 1 — Intermittent Task Creation Failures

### Prompt used

```
You are diagnosing a production issue in TundraBoard (Node.js, Express, Prisma, PostgreSQL).

Error appearing 3–5 times per hour:

  [2026-04-12T14:23:17Z] ERROR TaskService.create: PrismaClientKnownRequestError
    Code: P2002 (Unique constraint violation)
    Meta: { target: ['workspace_id', 'task_number'] }
    Stack: TaskService.create (taskService.ts:42)
           TaskRouter.post (tasks.ts:15)

The task schema has a unique constraint on (workspace_id, task_number). The
task_number is a human-readable sequential counter scoped per workspace (like
PROJ-001, PROJ-002). Identify the root cause, explain the intermittency, and
propose fixes ordered by robustness.
```

### AI's response

**Root cause: application-level race condition (TOCTOU)**

The `task_number` is being generated on the application side with a read-then-write pattern:

```typescript
// Likely implementation in taskService.ts ~line 42
const count = await prisma.task.count({ where: { workspaceId } });
const taskNumber = count + 1;  // ← race window here

await prisma.task.create({
  data: { ..., workspaceId, taskNumber }   // ← P2002 when two land on same number
});
```

Two concurrent requests for the same workspace both execute the `count` query before either commits. Both read the same value (say, 41), both compute 42, and whichever insert lands second hits the unique constraint.

**Why intermittent (3–5×/hour, not constant):**

The race only fires when two requests for the *same workspace* arrive within the same database round-trip window (~5–10ms). Most requests are sequential even under moderate load — the probability depends on:

- Workspace activity level (busy teams trigger it more)
- Server concurrency (more Node.js event-loop concurrency → shorter windows → more frequent races)
- At 3–5×/hour this suggests one or two high-traffic workspaces with teams doing collaborative bursts (morning standups, sprint planning)

**Fix options, ordered by robustness:**

**Option A — Remove application-level generation entirely (recommended)**

Don't store `task_number` at all. Compute it at query time using a window function:

```sql
SELECT *, ROW_NUMBER() OVER (
  PARTITION BY workspace_id ORDER BY created_at, id
) AS task_number
FROM tasks
WHERE workspace_id = $1;
```

In Prisma this means dropping the `taskNumber` column and the unique constraint from the schema, and adding a computed field in the query layer. The number is stable as long as tasks aren't deleted; if deletion is allowed, use a stored sequence instead.

**Option B — PostgreSQL sequence per workspace**

Maintain a dedicated sequence for each workspace:

```sql
-- Run once when workspace is created
SELECT setval(
  format('task_seq_%s', workspace_id::text),
  1, false
);

-- In the task creation transaction
SELECT nextval(format('task_seq_%s', $1::text));
```

`nextval()` is atomic and lock-free at the sequence level — no race possible.

**Option C — Advisory lock inside a transaction**

```typescript
await prisma.$transaction(async (tx) => {
  // Hash workspace UUID to a bigint for the advisory lock
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
  const max = await tx.task.findFirst({
    where: { workspaceId },
    orderBy: { taskNumber: 'desc' },
    select: { taskNumber: true },
  });
  const taskNumber = (max?.taskNumber ?? 0) + 1;
  return tx.task.create({ data: { ..., taskNumber } });
});
```

Serialises all inserts for a given workspace at the DB level with no schema change.

**Option D — Catch and retry (band-aid, not a fix)**

```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    return await createTaskInner(data);
  } catch (e) {
    if (isPrismaError(e, 'P2002') && e.meta?.target?.includes('task_number')) {
      await sleep(Math.random() * 50); // jitter
      continue;
    }
    throw e;
  }
}
```

Hides the symptom. The race still exists; it just retries silently. Acceptable as a short-term mitigation while the real fix is implemented.

### Evaluation of AI analysis

**Accurate:**
- Root cause identification is correct — P2002 on a unique sequence constraint is textbook TOCTOU.
- The explanation of intermittency is precise: the race window is narrow (single DB round-trip), so it only fires on workspace-level concurrency, not global concurrency.
- Option A (window function) and Option B (sequences) are both idiomatic PostgreSQL solutions.

**Worth noting:**
- Option A has a subtle caveat: `ROW_NUMBER()` on `(created_at, id)` produces stable numbers only if tasks are never deleted. If soft-delete isn't used, numbers will shift when a task is hard-deleted, confusing users who have referenced "PROJ-007". This needs to be called out explicitly in the implementation decision.
- Option B requires schema migration work to manage per-workspace sequences — there's no native Prisma support; it would need raw SQL in migrations and a trigger or service layer call on workspace creation.
- The AI correctly ranked Option D last but it should be even more explicit: retrying on P2002 without fixing the root cause means the error rate grows as the workspace grows.

**Verdict:** Analysis is sound. Option C (advisory lock in transaction) is the most pragmatic first fix — it requires no schema change and can ship in one PR.

### Recommendation

**Immediate (this sprint):** Implement Option C (advisory lock). Ship a Prisma migration that adds the advisory lock wrapper around task creation for any workspace that uses sequential numbering. Monitor P2002 error rate — should drop to zero.

**Next sprint:** Evaluate Option A or B as the permanent solution based on whether task deletion is a product requirement. If yes, use a dedicated sequence (Option B). If no, window function (Option A) is simpler.

---

## Scenario 2 — Slow Dashboard Loading

### Prompt used

```
You are diagnosing a performance issue in TundraBoard (Node.js, Express, Prisma, PostgreSQL).

Endpoint: GET /workspaces/:id/dashboard
Performance: p50: 120ms, p95: 3200ms, p99: 8500ms

Database queries executed per request:
  - workspace lookup:          5ms
  - project list:             12ms
  - task counts per project:  45ms × N  (N = number of projects, range 1–50)
  - recent activity:         350ms
  - member list:               8ms
  Total: 7 queries per request

Explain: (1) the specific bottleneck, (2) why p95/p99 diverge so dramatically
from p50, and (3) propose concrete fixes with expected impact on each percentile.
```

### AI's response

**Bottleneck 1: N+1 query on task counts**

The line `task counts per project: 45ms × N` reveals that the code is issuing one `COUNT` query per project rather than a single aggregated query. This is the classic N+1 problem:

```typescript
// Current (broken) approach
for (const project of projects) {
  const count = await prisma.task.count({ where: { projectId: project.id } });
  project.taskCount = count;
}
```

For N=50 this alone contributes **2250ms** to the response time, all in serial.

**Bottleneck 2: Recent activity query (350ms flat)**

A 350ms query that runs regardless of workspace size suggests it is either:
- Missing an index on the column being filtered/sorted (likely `tasks.updated_at` or `tasks.created_at`)
- Scanning a large result set without a `LIMIT` applied early enough
- Performing a cross-join across all projects in the workspace

**Why p50/p95/p99 diverge so dramatically:**

The total query time is roughly:

```
T = 5 + 12 + (45 × N) + 350_activity(N) + 8
```

where `350_activity(N)` likely also scales with N because recent activity aggregates across all workspace projects.

| Percentile | Estimated N | Serial query time |
|-----------|------------|------------------|
| p50 (120ms) | ~1–2 projects | 5 + 12 + 90 + ~30ms activity + 8 ≈ 145ms |
| p95 (3200ms) | ~25–30 projects | 5 + 12 + 1350 + 350 + 8 ≈ 1725ms + contention |
| p99 (8500ms) | ~45–50 projects | 5 + 12 + 2250 + 350×(scale) + 8 + pool queuing |

The gap between the linear model (~2600ms) and actual p99 (8500ms) is explained by **connection pool exhaustion**: when large-workspace requests monopolise the DB connection pool with 50+ serial queries, subsequent requests queue rather than execute. One slow workspace can spike p99 for the entire instance.

**Fixes and expected impact:**

**Fix 1 — Replace N+1 with a single GROUP BY query (highest impact)**

```typescript
// Replace loop with:
const counts = await prisma.task.groupBy({
  by: ['projectId'],
  where: { projectId: { in: projectIds } },
  _count: { id: true },
});
const countMap = Object.fromEntries(
  counts.map(c => [c.projectId, c._count.id])
);
```

Impact: Reduces N queries to 1. For N=50: **−2205ms**. p99 drops from ~8500ms to ~1000ms.

**Fix 2 — Parallelise independent queries**

Workspace lookup, project list, task counts, recent activity, and member list are all independent reads. Run them concurrently:

```typescript
const [workspace, projects, activity, members] = await Promise.all([
  prisma.workspace.findUnique({ where: { id } }),
  prisma.project.findMany({ where: { workspaceId: id } }),
  getRecentActivity(id),
  prisma.workspaceMember.findMany({ where: { workspaceId: id } }),
]);
```

After Fix 1 the remaining serial bottleneck is `recent_activity` (350ms) and `project_list + task_count` as one grouped query. Parallelising them: **p50 ~50ms, p95 ~400ms, p99 ~800ms**.

**Fix 3 — Index the recent activity query**

Add a composite index for the activity query pattern:

```sql
CREATE INDEX idx_tasks_workspace_updated
  ON tasks(workspace_id, updated_at DESC);
```

*(Requires workspace_id on the task table, or via project_id JOIN — if via JOIN, index `(project_id, updated_at DESC)`.)*

Expected: reduces the 350ms baseline to ~15–30ms.

**Fix 4 — Short-TTL cache for dashboard data**

Dashboard data is read-heavy and can tolerate 30–60 seconds of staleness:

```typescript
const CACHE_TTL_MS = 30_000;
const cacheKey = `dashboard:${workspaceId}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

const data = await buildDashboard(workspaceId);
await redis.setex(cacheKey, 30, JSON.stringify(data));
return data;
```

Impact: p50/p95/p99 collapse to cache read latency (~2–5ms) for the majority of requests. Effective for workspaces that are viewed frequently.

### Evaluation of AI analysis

**Accurate:**
- N+1 identification is correct and matches the performance data precisely.
- The arithmetic for query time vs percentile is directionally right. The p99 gap being explained by connection pool exhaustion is the most likely mechanism and is a critical insight that goes beyond the surface data.
- Fix 1 and Fix 2 are both correct and idiomatic Prisma.

**Gap in the analysis:**
- The AI assumed `workspace_id` exists on the `tasks` table for the index suggestion. Looking at the actual TundraBoard schema, `tasks` has `project_id` but not `workspace_id` directly — the workspace is reached through `projects.workspace_id`. The index should be on `(project_id, updated_at DESC)` and the query should join through projects. This is a case where the AI produced a plausible but not schema-accurate recommendation.
- Fix 4 (Redis cache) introduces operational complexity (cache invalidation, a new infrastructure dependency). For a team that doesn't already have Redis, Fix 1 + Fix 2 alone bring p99 inside acceptable range without adding infrastructure.

**Verdict:** The N+1 diagnosis and parallelisation fix are high-confidence and directly implementable. The index and cache suggestions are correct in principle but need schema-aware refinement before implementation.

### Recommendation

**Ship in order:**

1. Fix 1 (GROUP BY) — single PR, no infrastructure change, highest ROI.
2. Fix 2 (Promise.all) — same PR as Fix 1, trivial change.
3. Fix 3 (index) — add as a Prisma migration using `@@index([projectId, updatedAt(sort: Desc)])` on the Task model.
4. Fix 4 (cache) — only if p99 is still unacceptable after 1–3, or if the workspace count grows beyond 50 projects being common.

**Add an alert:** set a p95 latency alert threshold at 500ms for this endpoint so regression is caught before it reaches users.

---

## Scenario 3 — Log Pattern Mystery

### Prompt used

```
You are analysing a suspicious log pattern in TundraBoard production logs.
The API has rate limiting on POST /tasks (limit: 3 requests per 10-second
window per user). All entries are from the same authenticated user [REDACTED-A].
The pattern repeats continuously for 2 hours.

[14:00:01Z] INFO  POST /tasks 201 45ms  user=[REDACTED-A]
[14:00:03Z] INFO  POST /tasks 201 52ms  user=[REDACTED-A]
[14:00:04Z] INFO  POST /tasks 201 48ms  user=[REDACTED-A]
[14:00:05Z] WARN  POST /tasks 429 2ms   user=[REDACTED-A]
[14:00:15Z] INFO  POST /tasks 201 43ms  user=[REDACTED-A]
[14:00:16Z] INFO  POST /tasks 201 55ms  user=[REDACTED-A]
[14:00:17Z] INFO  POST /tasks 201 41ms  user=[REDACTED-A]
[14:00:18Z] WARN  POST /tasks 429 1ms   user=[REDACTED-A]
... (repeats for 2 hours)

What is happening mechanically? Is this normal or concerning? What should the
team investigate, and what mitigations are appropriate?
```

### AI's response

**What is happening mechanically**

The pattern is consistent and has a fixed structure: 3 successful requests → 1 rate-limited rejection → exactly 10-second pause → repeat. Over 2 hours (7200 seconds) this produces approximately **2160 successful task creation attempts** and **720 rate-limit hits**.

The 10-second cooldown after each 429 is not coincidental — it is precisely the rate-limit window length. The client is reading the `Retry-After` response header (or `X-RateLimit-Reset`) and waiting for the exact window to expire before retrying. This is the behaviour of a **well-behaved automated client**, not a human user.

**Is this normal behaviour?**

It depends on context, but several signals make this notable:

| Signal | Implication |
|--------|-------------|
| Mechanical regularity (3/10s cycle) | Definitively automated — humans don't create tasks at exactly this cadence for 2 hours |
| Continuously hits rate limit | The script makes no attempt to stay under the limit — it creates as fast as the limit allows |
| Same user for 2 continuous hours | Either a batch job or a long-running integration |
| 429 latency is 1–2ms | Rate limiter is rejecting in-memory, no DB query — working as designed |

**What to investigate**

*Priority 1 — Identity of [REDACTED-A]:*
- Is this a human user account or a service account / API key?
- If a human account: was this person aware their credentials were being used for automation? Could indicate compromised credentials.
- If a service account: is this a known, registered integration? Check API key audit logs.

*Priority 2 — Task content:*
- What are the tasks being created? Titles, descriptions, projectId?
- Are they meaningful work items or noise/garbage data?
- Are they all going to the same project, or spread across the workspace?

*Priority 3 — Triggering event:*
- When exactly did this pattern start? Does it correlate with a deployment, a new integration being added, or a calendar event?
- Did it stop on its own after 2 hours? If yes, what stopped it (cron job completion? Script hitting an error?)?

*Priority 4 — Volume impact:*
- 2160 tasks created — does this represent unusual growth in one workspace?
- Is DB storage or task list performance being affected?

**Possible explanations (most to least likely)**

1. **Legitimate bulk import / migration script** — a team member running a one-time data import. Explains the 2-hour bounded duration and respecting of rate limits. Most likely.
2. **Scheduled integration / webhook replay** — a CI pipeline or external webhook replaying task creation events in batch. The rate-limit-aware backoff suggests the client was designed to handle 429s.
3. **Compromised token being used by a third party** — less likely given the respectful rate-limit handling, but can't be ruled out without checking the source IP.
4. **Stress test / load test** — someone testing the API rate limiting behaviour. The exact 3/10s cycle is exactly what you'd get from a test script targeting the limit.

**Mitigations to consider**

*Operational:*
- Contact [REDACTED-A] immediately to confirm whether they authorised this automation
- If the pattern is still ongoing: revoke the token as a precaution, investigate, then reissue if legitimate
- Check source IP — if from an unexpected geography or cloud provider, treat as compromised

*Product / engineering:*
- Add a workspace-level rate limit in addition to per-user — prevents one automation from flooding a single workspace even if the token is legitimate
- Add an alert: sustained 429s from a single user for >5 minutes should trigger an investigation notification
- Consider requiring API keys (separate from user tokens) for automation use cases, making the audit trail explicit

### Evaluation of AI analysis

**Accurate:**
- The mechanical decoding of the pattern (3 requests, 10s window, retry-after) is correct and well-reasoned.
- The estimate of ~2160 tasks in 2 hours is accurate.
- The ranked list of explanations (bulk import most likely, compromised token least likely given respectful rate-limit handling) is sensible risk-ordering.
- The distinction between "the rate limiter is working correctly" and "the pattern still warrants investigation" is the key nuance — and the AI captured it.

**Gap in the analysis:**
- The AI assumed `POST /tasks` has rate limiting in the prompt. Looking at the actual TundraBoard codebase, rate limiting was added only to `POST /auth/login`. If this pattern appeared in the real system, the 429s would not occur — meaning the log scenario either describes a future state or a different layer (reverse proxy / API gateway rate limiting). The team should be aware that application-level rate limiting on task creation is not currently implemented.
- The AI didn't mention one important investigative step: **correlate with the auth log** — does [REDACTED-A] have a login event before the pattern starts, or was an existing session/token used? A login event at 13:59Z followed immediately by the pattern suggests a deliberate scripted run; no login event suggests an API token or a pre-existing session.

**Verdict:** Diagnosis is solid. The most actionable immediate step (which the AI identified) is to determine whether [REDACTED-A] is a service account or a human account, as that single fact resolves whether this is expected automation or a security incident.

### Recommendation

**Immediate actions:**

1. Check API key / session logs: was [REDACTED-A] a service account token or a user JWT?
2. Review the tasks created during the 2-hour window for content anomalies.
3. If the token is a user JWT and the user didn't initiate this: rotate the token and open a security incident.

**Engineering backlog:**

- Add rate limiting to `POST /tasks` at the workspace level (e.g., max 100 tasks/minute per workspace) — this prevents a single automation from degrading performance for other workspace members regardless of intent.
- Implement an automated alert: if a single identity issues >50 requests/minute sustained for >2 minutes, flag for review.
- Separate human-authentication tokens from service account tokens in the auth model — makes future audit trails unambiguous.

---

## Cross-scenario observations

**What AI analysis does well:**
- Pattern recognition in structured data (query profiles, log sequences) is fast and accurate
- It correctly identifies the *class* of problem (TOCTOU, N+1, automation signature) from minimal evidence
- It produces ranked, actionable fix lists rather than abstract descriptions

**Where AI analysis needs human verification:**
- Schema accuracy: the index suggestion in Scenario 2 referenced `workspace_id` on tasks, which doesn't exist in the actual TundraBoard schema — a fast but wrong recommendation that would only be caught by reading the codebase
- Context awareness: Scenario 3's analysis assumes rate limiting on `POST /tasks` exists; it doesn't in the current implementation, which changes the severity assessment
- Business context: "is 2160 tasks concerning?" depends on workspace size and normal usage patterns the AI has no access to

**General principle:** AI diagnostic analysis is most reliable when the symptoms map cleanly to known problem classes (N+1, race conditions, automation fingerprints). When the fix requires knowledge of the specific schema, infrastructure topology, or business context, AI output should be treated as a hypothesis to verify rather than a confirmed diagnosis.
