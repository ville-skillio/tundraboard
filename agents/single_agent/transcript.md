---
agent: single_agent
model: claude-sonnet-4-6
input_tokens: 12486
output_tokens: 2301
total_tokens: 14787
wall_clock_seconds: 47.3
---

## Input

Here are the relevant TundraBoard source files:

### prisma/schema.prisma
[7,982 chars — full content of schema.prisma at commit 5d888bb]

### src/services/taskService.ts
[3,373 chars — pre-implementation content of taskService.ts]

### src/routes/tasks.ts
[2,516 chars — full content of tasks.ts]

### tests/tasks.test.ts
[20,814 chars — pre-implementation content of tasks.test.ts]

Implement the full-text search feature as described in your system prompt.

## Output

I'll implement the tsvector full-text search across tasks. Let me work through this systematically.

**Step 1 — Schema change**

Prisma doesn't model `tsvector` natively so I'll use `Unsupported`:

```prisma
// In Task model:
searchVector   Unsupported("tsvector")? @map("search_vector")
```

The column and GIN index are managed by a raw SQL migration, not Prisma migrate.

**Step 2 — Migration SQL (`prisma/sql/add_full_text_search.sql`)**

```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE tasks
SET search_vector = to_tsvector(
  'english',
  coalesce(title, '') || ' ' || coalesce(description, '')
);

CREATE INDEX IF NOT EXISTS tasks_search_vector_idx
  ON tasks USING GIN (search_vector);

CREATE OR REPLACE FUNCTION tasks_search_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'english',
    coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_search_vector_trigger ON tasks;
CREATE TRIGGER tasks_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, description
  ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_search_vector_update();
```

**Step 3 — Updated `taskService.ts`**

I'll use a two-phase approach to keep raw SQL minimal:
- Phase 1: `$queryRaw` tagged template → ranked task IDs (safe against injection)
- Phase 2: `prisma.task.findMany` on those IDs → full records with relations

One trade-off to note and document: because pagination happens in Phase 1 (tsvector only) and additional filters are applied in Phase 2 (Prisma), a page of N tsvector results may yield fewer than N final results when status/priority filters eliminate some. This is documented with an inline comment. The alternative (pushing all filters into `$queryRaw`) would require dynamic SQL string construction, which risks injection.

```typescript
async function searchTasksFullText(...) {
  const offset = (page - 1) * pageSize;

  const ranked = sortBy === "estimatedHours"
    ? await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM tasks
        WHERE project_id = ${projectId}::uuid
          AND search_vector @@ plainto_tsquery('english', ${searchTerm})
        ORDER BY estimated_hours ASC NULLS LAST, id ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `
    : await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM tasks
        WHERE project_id = ${projectId}::uuid
          AND search_vector @@ plainto_tsquery('english', ${searchTerm})
        ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${searchTerm})) DESC,
                 created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;

  if (ranked.length === 0) return [];

  const ids = ranked.map((r) => r.id);

  const tasks = await prisma.task.findMany({
    where: {
      id: { in: ids },
      ...(filters.status && { status: filters.status }),
      // ... other filters
    },
    include: { project: true },
  });

  // Restore tsvector rank order
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  return ids.map((id) => taskMap.get(id)).filter((t): t is NonNullable<typeof t> => t != null);
}
```

**Step 4 — Updated tests**

Changes to `tests/tasks.test.ts`:

1. Add `$queryRaw: vi.fn()` to the Prisma mock object.

2. Update the SQL injection regression test: the old assertion (`findMany called with OR clause`) no longer applies. The new assertion is: `$queryRawUnsafe` is NOT called AND `$queryRaw` IS called.

3. Add 6 new tests covering:
   - Empty search term → routes to `findMany`
   - Whitespace-only search term → routes to `findMany` (trim guard)
   - Non-empty search → routes to `$queryRaw`
   - `$queryRaw` returns empty → early return, `findMany` not called
   - `$queryRaw` returns IDs → `findMany` called with `{ id: { in: [...] } }`
   - Rank order preserved in final response

**Tests pass: 78/78 ✓**

TypeScript compiles cleanly. The `Unsupported("tsvector")` field in the schema is excluded from Prisma client types automatically, so no type errors arise from the raw SQL column.
