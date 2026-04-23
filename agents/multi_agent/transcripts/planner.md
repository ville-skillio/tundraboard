---
agent: planner
model: claude-sonnet-4-6
input_tokens: 13102
output_tokens: 987
total_tokens: 14089
wall_clock_seconds: 38.4
---

## Input

Here are the TundraBoard source files to analyse:

### prisma/schema.prisma
[7,982 chars — full schema including Task model with all fields]

### src/services/taskService.ts
[3,373 chars — pre-implementation taskService with ILIKE search via findMany]

### src/routes/tasks.ts
[2,516 chars — tasks route handler]

### tests/tasks.test.ts
[20,814 chars — 36 tests including SQL injection regression tests]

Produce the ImplementationPlan JSON.

## Output

```json
{
  "migration_sql": "ALTER TABLE tasks ADD COLUMN IF NOT EXISTS search_vector tsvector;\n\nUPDATE tasks SET search_vector = to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''));\n\nCREATE INDEX IF NOT EXISTS tasks_search_vector_idx ON tasks USING GIN (search_vector);\n\nCREATE OR REPLACE FUNCTION tasks_search_vector_update()\nRETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  NEW.search_vector := to_tsvector('english', coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, ''));\n  RETURN NEW;\nEND;\n$$;\n\nDROP TRIGGER IF EXISTS tasks_search_vector_trigger ON tasks;\nCREATE TRIGGER tasks_search_vector_trigger\n  BEFORE INSERT OR UPDATE OF title, description\n  ON tasks\n  FOR EACH ROW EXECUTE FUNCTION tasks_search_vector_update();",
  "schema_change": "searchVector   Unsupported(\"tsvector\")? @map(\"search_vector\")",
  "function_signature": "export async function searchTasks(projectId: string, searchTerm: string, filters: SearchFilters, page?: number, pageSize?: number, sortBy?: 'createdAt' | 'estimatedHours'): Promise<Task[]>",
  "internal_helper": {
    "name": "searchTasksFullText",
    "parameters": [
      "projectId: string",
      "searchTerm: string",
      "filters: SearchFilters",
      "page: number",
      "pageSize: number",
      "sortBy: 'createdAt' | 'estimatedHours'"
    ],
    "phase1_description": "Use prisma.$queryRaw with plainto_tsquery('english', ${searchTerm}) to get task IDs ordered by ts_rank DESC (or estimatedHours ASC when sortBy=estimatedHours). Parameterised tagged template — no string interpolation. Returns Array<{ id: string }>.",
    "phase2_description": "Use prisma.task.findMany with { id: { in: ids } } plus any filter conditions from SearchFilters. Include { project: true } relation. Pagination is already applied in phase 1 — no skip/take here.",
    "rank_restoration": "Build a Map<id, task> from findMany results. Map the phase-1 ids array through the Map to get tasks in rank order. Filter out nulls with type guard."
  },
  "test_scenarios": [
    {
      "name": "routes to $queryRaw when non-empty search term given",
      "setup": "mock $queryRaw to return []",
      "assertion": "$queryRaw called, findMany not called"
    },
    {
      "name": "returns empty array when $queryRaw returns no IDs",
      "setup": "mock $queryRaw to return []",
      "assertion": "response body data equals [], findMany not called (early return)"
    },
    {
      "name": "fetches full records via findMany with IDs from $queryRaw",
      "setup": "mock $queryRaw to return [{id:'task-1'}], mock findMany to return [MOCK_TASK]",
      "assertion": "findMany called with { where: { id: { in: ['task-1'] } }, include: { project: true } }"
    },
    {
      "name": "preserves tsvector rank order in response",
      "setup": "$queryRaw returns [{id:'task-2'},{id:'task-1'}], findMany returns [task1, task2] (wrong order)",
      "assertion": "response data[0].id === 'task-2' (rank order restored)"
    },
    {
      "name": "routes to findMany when search term is empty string",
      "setup": "mock findMany to return []",
      "assertion": "findMany called, $queryRaw not called"
    },
    {
      "name": "routes to findMany when search term is whitespace only",
      "setup": "mock findMany to return []",
      "assertion": "findMany called, $queryRaw not called (trim guard)"
    }
  ],
  "files_to_modify": [
    "prisma/schema.prisma",
    "prisma/sql/add_full_text_search.sql",
    "src/services/taskService.ts",
    "tests/tasks.test.ts"
  ],
  "known_trade_offs": [
    "Filter-after-pagination: status/priority/assigneeId filters applied in phase 2 after pagination in phase 1. A page of N tsvector matches may yield fewer than N results when filters eliminate some. Alternative (pushing filters into $queryRaw) would require dynamic SQL construction.",
    "plainto_tsquery does not support prefix matching — searching 'auth' will not match 'authentication'. Use to_tsquery with :* prefix if prefix matching is required."
  ],
  "safety_invariants": [
    "$queryRawUnsafe must never be called — existing regression test asserts this",
    "searchTerm and projectId must be passed as $queryRaw parameters, never interpolated",
    "existing 36 tests must continue to pass without modification (except the one regression test that must be updated to expect $queryRaw instead of findMany OR clause)"
  ]
}
```
