# Task 1 — Routine generation | Extended thinking mode

**Task description:** Add a `DELETE /labels/:id` endpoint that removes a label and its task associations, following the existing label routes in `src/routes/labels.ts`.

**Model:** claude-sonnet-4-5 (thinking enabled, budget_tokens: 8000)

**Latency:** 28.7 s

---

## Prompt

```
I'm working on the TundraBoard API (TypeScript, Express, Prisma, PostgreSQL).

Here is the current src/routes/labels.ts file:

[contents of labels.ts pasted here]

Add a DELETE /labels/:id endpoint. It should:
- Require authentication (use the existing authenticate middleware)
- Verify the label belongs to the authenticated user's workspace
- Delete all TaskLabel rows associated with this label first (cascade via Prisma or explicit delete)
- Then delete the label itself
- Return 204 on success, 404 if not found, 403 if the label belongs to a different workspace

Follow the exact same pattern as the other endpoints in this file.
```

---

## Response

Here's the `DELETE /labels/:id` endpoint:

```typescript
// DELETE /labels/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const { id } = req.params;

  const label = await prisma.label.findUnique({
    where: { id },
    include: { workspace: true },
  });

  if (!label) {
    return res.status(404).json({ error: 'Label not found' });
  }

  const member = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: label.workspaceId,
      userId: req.user!.id,
    },
  });

  if (!member) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await prisma.$transaction([
    prisma.taskLabel.deleteMany({ where: { labelId: id } }),
    prisma.label.delete({ where: { id } }),
  ]);

  return res.status(204).send();
});
```

A few notes on this implementation:

**Transaction wrapping:** I wrapped the two deletes in a `prisma.$transaction` so that if the `label.delete` fails for any reason, the `taskLabel.deleteMany` is also rolled back. In the fast-mode version the two operations were sequential but not atomic — if something went wrong between them you could end up with orphaned `TaskLabel` rows pointing to a deleted label, which would silently corrupt aggregation queries. For a delete operation on a shared resource, the transaction is the safer default.

**Role check scope:** The current check only verifies workspace membership, not role. If viewer-role members should not be able to delete labels, add `role: { in: ['admin', 'member'] }` to the `findFirst` where clause. The existing POST endpoint has the same gap — worth a follow-up.

**Idempotency:** If the label has already been deleted and a client retries, this returns 404. That is consistent with the rest of the file but worth documenting if consumers expect 204 on repeated deletes.
