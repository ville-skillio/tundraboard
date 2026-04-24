# Mode Choice Analysis

## Task 1 — Routine generation: `DELETE /labels/:id` endpoint

**Categories chosen:** Routine generation, Planning / multi-file refactor

**Task 1 description:** Add a `DELETE /labels/:id` endpoint that removes a label and its task associations, following the existing label routes in `src/routes/labels.ts`.

### Comparison

Both modes produced a correct implementation that followed the established file pattern. The fast mode response (6.2 s) gave a working, readable solution with a clear explanation of why `taskLabel.deleteMany` runs first. The extended thinking response (28.7 s) produced the same core logic but wrapped the two deletes in a `prisma.$transaction`, which the fast version did not. It also surfaced two follow-up concerns: a role-check gap present in the existing POST endpoint (viewers can delete labels), and the idempotency behaviour on repeated deletes.

### Mode choice verdict

**Fast generation was the right mode for this task.** The task was a well-scoped pattern completion — the correct structure was already demonstrated three times in the same file. The fast version produced a complete, safe implementation. The transaction wrapping that extended thinking added is a real improvement, but for a routine endpoint that mirrors existing code, the overhead of extended thinking (28.7 s vs 6.2 s, 4.6× slower) is not justified. The role-check observation is useful but is a separate task, not something the exercise required.

---

## Task 2 — Planning / multi-file refactor: Soft-delete across the Task model

**Task 2 description:** Plan how to introduce soft-delete (`deleted_at`) across the Task model without breaking existing queries.

### Comparison

The fast mode plan (9.1 s) was structurally correct and covered the main files — `tasks.ts`, `comments.ts`, `taskLabels`. It listed the migration, the schema change, the index recommendation, and the deploy ordering constraint. The extended thinking plan (47.3 s) covered all of the same ground but went further in three places that the fast version missed:

1. It identified `notifications.ts` and `webhooks.ts` as additional files needing guards — the fast version stopped at the obvious task and comment routes.
2. It flagged a webhook race condition: a background dispatcher could emit `task.deleted` events for tasks that still exist in the DB as soft-deleted rows.
3. It recommended centralising the `deletedAt: null` filter in a helper (`whereActive()`) to make a future restore path feasible without touching every query site.

The `deletedAt: null` guard on the `update` call in the DELETE handler (preventing double-soft-delete) was present in the extended thinking response but absent from the fast version.

### Mode choice verdict

**Extended thinking was the right mode for this task.** This is a refactor that touches seven or more files across different layers (routes, webhooks, notifications, background jobs) and introduces a constraint — "every read path must filter soft-deleted rows" — that is easy to violate by omission. The fast version gave a plan that would work for the happy path but would leave `notifications.ts` and the webhook dispatcher uncovered, creating subtle bugs discoverable only in production. Extended thinking surfaced those gaps and the webhook race condition, which are exactly the kind of cross-cutting consequences that justify the extra latency for a planning task.
