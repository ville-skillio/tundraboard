# Reasoning Budget Policy — TundraBoard Team (6 developers)

## Default mode per tool slot

| Tool slot | Default mode | Justification |
|-----------|-------------|---------------|
| IDE assistant (Copilot / Cursor) | Fast generation | Inline completions and short edits are pattern-matching tasks. Latency matters more than depth here — a 30-second wait for a line completion breaks flow. |
| Terminal agent (Claude Code / Aider) | Fast generation | Most agent steps are file reads, edits, and command runs. Extended thinking per step would compound to minutes per task. Reserve extended thinking for the planning step only (see below). |
| Web chat (Claude.ai / ChatGPT) | Fast generation | Default to fast; developers opt in manually per session when the task warrants it. |

## Task categories where extended thinking is encouraged

1. **Cross-cutting refactors** (e.g. adding soft-delete, introducing a new auth layer, changing how workspace membership is resolved). These tasks have hidden constraints across multiple files and layers. Fast generation reliably misses edge cases in non-obvious files. Use extended thinking for the planning prompt; switch back to fast for the individual implementation steps.

2. **Debugging with non-obvious root causes** (e.g. a test passes locally and times out in CI, a query returns duplicate rows after a join change). Extended thinking works through more hypotheses before settling on an answer. Fast generation tends to anchor on the most obvious explanation.

3. **Security and authorization design** (e.g. designing a new permission model, reviewing whether an endpoint is correctly scoped to workspace members). Missing an authorization path has high impact. The extra reasoning time is worth it.

## Task categories where extended thinking should not be used

1. **Routine endpoint additions** that follow an established pattern already present in the same file (e.g. adding a DELETE endpoint when GET and POST already exist in the same route file). Fast generation matches the pattern correctly in seconds.

2. **Boilerplate and type generation** (e.g. converting an OpenAPI spec to TypeScript types, generating Zod schemas from Prisma models). These are deterministic transformations. Extended thinking adds latency with no quality benefit.

3. **Test writing for already-implemented code** where the implementation is stable and the test structure follows an existing pattern. Fast generation with the implementation file in context is sufficient.

## Escalation rule

Any terminal agent run that involves extended thinking on a loop with more than 20 steps requires a brief note in the team Slack channel (`#dev-ai-usage`) before starting — just the task description and the agent command. This keeps the team aware of long-running agent sessions and makes it easy to spot runaway loops early.
