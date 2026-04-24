# Task 2 — Planning / multi-file refactor | Fast generation mode

**Task description:** Plan how to introduce soft-delete (`deleted_at`) across the Task model without breaking existing queries.

**Model:** claude-sonnet-4-5 (thinking disabled)

**Latency:** 9.1 s

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

## Prompt

Here is a plan for introducing soft-delete on the `Task` model:

**1. Schema change**

Add `deletedAt DateTime?` to the `Task` model in `prisma/schema.prisma`:

```prisma
model Task {
  // ... existing fields
  deletedAt DateTime? @map("deleted_at")
}
```

**2. Migration**

Run:
```bash
npx prisma migrate dev --name add_task_soft_delete
```

This generates `ALTER TABLE "Task" ADD COLUMN "deleted_at" TIMESTAMP;`. The column is nullable, so all existing rows get `NULL` and remain visible — no data loss.

**3. Queries to update**

Add `deletedAt: null` to every `findMany`, `findFirst`, and `findUnique` call in `tasks.ts`:

- `GET /tasks` (list) — add `where: { deletedAt: null }`
- `GET /tasks/:id` (fetch single) — add `deletedAt: null` to the where clause
- `PATCH /tasks/:id` — the ownership check query needs `deletedAt: null` too, otherwise you can patch a soft-deleted task
- `GET /tasks` search/filter path — same filter

Also check `comments.ts` and `taskLabels` — any query that joins or looks up a Task by ID should guard against soft-deleted tasks.

**4. DELETE endpoint**

Change the handler from `prisma.task.delete` to:
```typescript
await prisma.task.update({
  where: { id },
  data: { deletedAt: new Date() },
});
res.status(204).send();
```

**5. Risks**

- Deploy order: run the migration before deploying new code. The new column is nullable so old code continues to work during the rollout window.
- Indexes: if the task list is large, add an index on `deleted_at` to keep filtered queries fast.
