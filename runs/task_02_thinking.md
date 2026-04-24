# Task 2 — Planning / multi-file refactor | Extended thinking mode

**Task description:** Plan how to introduce soft-delete (`deleted_at`) across the Task model without breaking existing queries.

**Model:** claude-sonnet-4-5 (thinking enabled, budget_tokens: 8000)

**Latency:** 47.3 s

---

## Prompt

```
I'm working on TundraBoard (TypeScript, Express, Prisma, PostgreSQL).

The Prisma schema has a Task model. We want to add soft-delete: instead of actually deleting tasks, we set a `deleted_at` timestamp. Tasks where `deleted_at IS NOT NULL` should be invisible to all existing list and fetch endpoints.

Here is the current Prisma schema (prisma/schema.prisma):

[schema contents pasted here]

And the current tasks route (src/routes/tasks.ts):

[tasks.ts contents pasted here]

Plan how to introduce soft-delete across the Task model. Cover:
1. Schema change
2. Migration
3. Which queries need a `deleted_at: null` filter added
4. What the DELETE endpoint should do instead of a real delete
5. Any risks or ordering constraints
```

---

## Response

Here is a detailed plan for soft-deleting Tasks, including several constraints the straightforward approach misses.

**1. Schema change**

```prisma
model Task {
  // ... existing fields
  deletedAt DateTime? @map("deleted_at")

  @@index([deletedAt]) // needed for filtered list performance
}
```

**2. Migration**

```bash
npx prisma migrate dev --name add_task_soft_delete
```

Generated SQL: `ALTER TABLE "Task" ADD COLUMN "deleted_at" TIMESTAMP;`

The column is nullable — existing rows get `NULL` and stay visible. Safe to run against a live database before deploying code.

**3. Queries requiring `deletedAt: null`**

This is the part most plans undercount. Every read path that surfaces a Task must be audited:

- `tasks.ts` — `GET /tasks` (list), `GET /tasks/:id`, `PATCH /tasks/:id` ownership check
- `comments.ts` — the task ownership lookup before creating or listing comments. If the task is soft-deleted, comments on it should be inaccessible too.
- `taskLabels` / `labels.ts` — any endpoint that lists tasks by label
- `notifications.ts` — if notifications carry a `taskId` reference, the linked task must still be validated as non-deleted before returning it
- `webhooks.ts` — if task events reference a task, soft-deleted tasks should not trigger `task.updated` events
- `AuditLog` — reads are fine (audit history of a deleted task is valid), but do not surface soft-deleted tasks in any "recent activity" list queries

**4. DELETE endpoint**

```typescript
// Before
await prisma.task.delete({ where: { id } });

// After
await prisma.task.update({
  where: { id, deletedAt: null }, // guard: don't double-soft-delete
  data: { deletedAt: new Date() },
});
```

The `deletedAt: null` guard in the where clause is important: if the task was already soft-deleted, `update` will throw `RecordNotFound`, which your existing 404 handler catches correctly — making the endpoint idempotent.

**5. Risks and ordering constraints**

- **Deploy order:** Migration must run before new code is deployed. Old code ignores `deleted_at` entirely (column didn't exist), so the window between migration and deploy is safe.
- **Cascade concern:** `TaskLabel` and `Comment` rows are not deleted when a task is soft-deleted. This is correct — they serve as audit trail — but you must ensure no endpoint accidentally exposes them by joining through a soft-deleted task without the `deletedAt: null` guard.
- **Webhook race:** If a background job fires webhooks after a soft-delete, it may emit a `task.deleted` event for a task that technically still exists in the DB. Add a `deletedAt: { not: null }` check in the webhook dispatcher to use as the deletion signal instead of listening for hard deletes.
- **Search / full-text:** If you later add full-text search across tasks, the index must exclude `deleted_at IS NOT NULL` rows, or they will appear in search results even after deletion.
- **Restore path:** Soft-delete implies a restore path is eventually needed. Even if not in scope now, avoid hardcoding "null means active" in too many places — centralise the filter in a Prisma extension or a helper `whereActive()` function so restoring a task only requires one code change.
