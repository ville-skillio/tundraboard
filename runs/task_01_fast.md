# Task 1 — Routine generation | Fast generation mode

**Task description:** Add a `DELETE /labels/:id` endpoint that removes a label and its task associations, following the existing label routes in `src/routes/labels.ts`.

**Model:** claude-sonnet-4-5 (thinking disabled)

**Latency:** 6.2 s

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

Here's the `DELETE /labels/:id` endpoint following the existing pattern in `labels.ts`:

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

  await prisma.taskLabel.deleteMany({ where: { labelId: id } });
  await prisma.label.delete({ where: { id } });

  return res.status(204).send();
});
```

Add this block before the final `export default router;` line. The `taskLabel.deleteMany` call clears associations before the label is deleted, avoiding a foreign-key constraint violation. The membership check reuses the same `WorkspaceMember` lookup pattern used in the POST endpoint above it.
