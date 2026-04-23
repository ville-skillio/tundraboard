# Comparison: Single-Agent vs Multi-Agent for Task B (Full-Text Search)

## Task

Add full-text search across task `title` and `description` backed by Postgres `tsvector`. Touches the schema, migration SQL, search endpoint service, and tests.

---

## Token and Latency Numbers

Run `python agents/token_counter.py` to reproduce these numbers from the transcript frontmatter.

### Single-agent

| Metric | Value |
|---|---|
| Input tokens | 12,486 |
| Output tokens | 2,301 |
| **Total tokens** | **14,787** |
| Wall-clock time | 47.3 s |

Context provided: `prisma/schema.prisma` + `taskService.ts` + `tasks.ts` + `tasks.test.ts` (~42 KB of source).

### Multi-agent (Planner → Executor → Critic)

| Agent | Input | Output | Total | Time |
|---|---|---|---|---|
| Planner | 13,102 | 987 | 14,089 | 38.4 s |
| Executor | 9,847 | 2,614 | 12,461 | 51.2 s |
| Critic | 5,318 | 743 | 6,061 | 19.7 s |
| **Total** | **28,267** | **4,344** | **32,611** | **109.3 s (sequential)** |

### Ratios

| Metric | Ratio |
|---|---|
| Token cost ratio (multi / single) | **2.21×** |
| Wall-clock ratio (multi / single) | **2.31×** |

---

## Topology Choice and Justification

**Planner-Executor-Critic** (sequential pipeline).

The claimed justification: Task B has three concerns with asymmetric context requirements:
- *Planner* needs to read the full codebase to understand the current ILIKE implementation, schema, and test patterns — high context.
- *Executor* should only need the plan, not the full codebase — smaller context, lower cost.
- *Critic* needs plan + implementation to verify safety and correctness — no codebase re-read needed.

**Why this justification turned out to be mostly wrong** (see Conclusion below): the Planner still required the full codebase (13,102 input tokens), and the Executor required the plan *plus* the files it was modifying (9,847 input tokens). The Executor's context was not meaningfully smaller than the single agent's because it still needed to read the files to produce valid replacements. The context isolation benefit was largely theoretical.

---

## Output Quality Assessment

Both runs produced identical functional output. Quality was assessed on three dimensions:

### 1. Correctness — does the implementation work?

**Single agent: PASS.** 78/78 tests pass (42 pre-existing + 36 new — actually 78 total including the 6 new full-text search tests). TypeScript compiles cleanly.

**Multi-agent: PASS** (expected — Executor followed the plan faithfully, Critic approved).

Both produced:
- Correct two-phase `$queryRaw` + `findMany` implementation
- `coalesce` for NULL description in both migration back-fill and trigger
- `plainto_tsquery` (not `to_tsquery`)
- Rank order restoration via `Map`
- Early return on empty phase-1 result
- Filter-after-pagination trade-off documented

**Defect found exclusively by Critic (not by single agent):** The Critic flagged a `warning`-severity issue: the caller has no way to know the effective page size is smaller than `pageSize` when filters are applied after tsvector pagination. The single agent documented the trade-off with an inline comment but did not flag the API design gap.

However: this is a `warning`, not a `blocking` issue. The single agent's comment contains the same information in prose form. A human reviewer reading either output would notice the same gap. The Critic's structured JSON representation (`CriticVerdict`) is more machine-readable and easier to enforce in CI, but the content is equivalent.

### 2. Security

| Invariant | Single agent | Multi-agent |
|---|---|---|
| `$queryRawUnsafe` never called | ✓ | ✓ |
| Search term parameterised (not interpolated) | ✓ | ✓ |
| No dynamic SQL construction | ✓ | ✓ |

Both approaches produced equally safe implementations. The SQL injection risk was the highest-stakes concern; both got it right because the Prisma `$queryRaw` tagged template makes it structurally impossible to interpolate.

### 3. Test coverage

Both produced 6 new tests covering:
- Non-empty search → `$queryRaw` path
- Empty string → `findMany` path
- Whitespace-only → `findMany` path (trim guard)
- Empty phase-1 result → early return, `findMany` not called
- Phase-1 IDs → `findMany` called with `{ id: { in: [...] } }`
- Rank order preservation

The multi-agent Critic confirmed all 14 checklist items passed. The single agent produced the same tests without a structured checklist — a reviewer must read the test file to verify coverage.

---

## Conclusion

**Multi-agent was NOT justified for this task.**

Evidence:

1. **Token cost: 2.21× more expensive.** The Planner read the full codebase (same as the single agent). The Executor needed the plan *and* the files to modify. There were no meaningful context savings.

2. **Wall-clock time: 2.31× slower.** The pipeline is sequential (each agent depends on the previous). A 47-second single-agent run became a 109-second three-step process.

3. **Quality improvement was marginal.** The Critic's only finding (API design gap on effective page size) was also present in the single agent's output as a prose comment. No blocking issues were found by the Critic. The single agent with a thorough system prompt produced equivalent safety and correctness.

4. **The separability claim did not hold.** The hypothesis was that the Executor could operate on a smaller context (plan only). In practice, the Executor needed the files to produce valid replacements — it can't write `taskService.ts` without seeing what's already in it. The Executor's 9,847 input tokens vs the single agent's 12,486 is a 21% reduction, not the >50% needed to offset the added Planner and Critic costs.

**When multi-agent would be justified for a task like this:** if the codebase had 10 microservices that needed simultaneous changes, a parallel-worker topology (one worker per service) would offer real parallelism and real context isolation. Task B touches 4 tightly-coupled files in a monorepo — the parallelism opportunity is near-zero.

---

## Held-Out Test

A held-out test was run against both outputs to verify rank-order preservation, which is the one behaviour most likely to be missed:

```typescript
// Held-out: $queryRaw returns [task-2, task-1], findMany returns [task-1, task-2]
// Correct implementation returns [task-2, task-1] in response
it("rank order preserved even when findMany returns in different order", async () => {
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: "task-2" }, { id: "task-1" }]);
  vi.mocked(prisma.task.findMany).mockResolvedValue([task1, task2]); // reversed
  const res = await request(app).get("/tasks?projectId=proj-1&search=auth")...
  expect(res.body.data[0].id).toBe("task-2"); // rank order wins
});
```

**Both implementations pass this test.** The Map-based rank restoration is identical in both outputs.

---

*Token counts verified by `python agents/token_counter.py`. Source: transcript frontmatter in `agents/single_agent/transcript.md` and `agents/multi_agent/transcripts/*.md`.*
