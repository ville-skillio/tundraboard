# TundraBoard — AI Context Management Guide

A practical reference for the team on what to include (and exclude) when prompting
an AI assistant on this codebase.

---

## Core Principle

Context is not free. Every token you add has a cost: latency, expense, and — past a
threshold — *noise that degrades output quality*. The goal is not maximum context; it
is *minimum sufficient context* for the task at hand.

The three strategies from our experiment, in order of cost:

| Strategy | When to use | Typical token range |
|----------|-------------|---------------------|
| **Targeted** | Default for almost everything | 600 – 1,200 |
| **Full** | Architecture decisions only | 2,500 – 5,000 |
| **Minimal** | First-pass exploration only | 200 – 600 |

---

## Decision Tree — Which Strategy?

```
Is this a question about the big picture (architecture, design, "what should we do")?
  └─ YES → Full context. You need the AI to reason across the whole system.
  └─ NO ↓

Does the task touch more than one file?
  └─ NO → Targeted context with only the one file + relevant type signatures.
  └─ YES ↓

Do you know exactly which other files matter?
  └─ NO → Minimal first. Get a sketch, then fill gaps with targeted follow-ups.
  └─ YES → Targeted context. Include those specific files (or excerpts).
```

---

## How to Identify Relevant Dependencies

Walk outward from the file you are changing, one layer at a time. Stop when you
reach something that has no bearing on the task.

**Layer 1 — Direct imports** (always include)
The files your target file imports. For a route file: the service, the prisma
singleton, the authenticate middleware.

**Layer 2 — Shared contracts** (include the interface, not the implementation)
- `src/types/express.d.ts` — whenever `req.user` shape matters
- `src/middleware/errorHandler.ts` — whenever you throw from a service
- The relevant Prisma models — paste only the models the task touches, not the full schema

**Layer 3 — Convention examples** (include one, not all)
If the AI needs to follow a pattern (e.g., "make this look like other services"),
paste one existing example. One is enough; multiple examples add noise.

**Layer 4 — Infrastructure files** (almost never needed)
`tsconfig.json`, `package.json`, `app.ts`, `.env.example` — include only if the
task is specifically about build config, dependencies, or middleware wiring.

---

## Token Budget Guidelines by Task Type

### Bug fix in a single function (~300–500 tokens)
Include: the function + its direct callers' call sites (not the full caller file).
Skip: schema, middleware, config.

### Implement a new route endpoint (~700–1,000 tokens)
Include: the TODO comment + relevant Prisma models + errorHandler contract (5 lines)
+ authenticate.ts signature (3 lines) + one existing implemented route as style reference.
Skip: unrelated models, app.ts, tsconfig.

### Extract a service layer (~800–1,200 tokens)
Include: the fat file to refactor + prisma singleton + errorHandler contract
+ req.user type (if relevant) + **explicit output spec** (function signatures with
return types and throw conditions).
Skip: full schema, other route files, config.

### Write integration tests (~900–1,400 tokens)
Include: the route file under test + relevant Prisma models + one existing test file
as style reference + the JWT helper shape (for auth header construction).
Skip: service internals, app.ts, config.

### Security / authorization audit (~1,500–2,500 tokens)
Include: the route file + WorkspaceMember model + authenticate middleware + errorHandler.
For this task, broader schema context is justified — authorization bugs often involve
cross-model relationships.

### Architecture design or tech-debt discussion (~3,000–5,000 tokens)
Full context is appropriate here. The AI needs to see the whole picture to reason
about trade-offs.

---

## The Output Spec Pattern (Highest ROI)

The single most effective token you can add to a prompt is an explicit output
specification. Before writing a generation prompt, answer these questions in 4–6 lines:

```
Output spec:
  functionName(param: type, ...) → Promise<ReturnType>
  throws: { message: "...", status: NNN } when [condition]
  stays in: src/services/name.ts
  does NOT: [list one or two things the AI should not add]
```

This eliminates the AI's largest source of error: guessing what shape is expected.
In our experiment, the absence of an output spec caused Output A to use the wrong
JWT payload key (`userId` instead of `id`) and Output B to add unrequested audit
logging. The spec cost ~60 tokens and prevented both issues.

---

## What to Always Include for This Project

These four items are cheap and prevent the most common errors. Paste them in any
prompt that involves business logic or error handling:

```
1. req.user type  (src/types/express.d.ts — 9 lines)
   Why: AI invents payload shapes without it; breaks authenticate middleware downstream.

2. errorHandler contract  (5-line excerpt)
   Why: Plain `throw new Error()` without .status produces 500 for all domain errors.

3. prisma singleton  (src/utils/prisma.ts — 5 lines)
   Why: AI creates a second PrismaClient() without it, opening a second connection pool.

4. Relevant Prisma models  (only the ones the task touches)
   Why: Without model field names, AI invents column names or uses camelCase where
   Prisma expects the mapped name.
```

---

## What to Never Include (Noise Sources)

| File | Why it causes problems |
|------|----------------------|
| Full `prisma/schema.prisma` | 11 models of irrelevant context; AI pattern-matches on models it sees and adds unrequested behavior (audit logs, notifications, etc.) |
| `src/app.ts` (for non-wiring tasks) | AI may suggest changing middleware order or adding routes as a "helpful" side effect |
| All route files at once | AI averages across patterns it sees; inconsistencies in existing routes bleed into the new one |
| `tsconfig.json` / `package.json` | Almost never relevant; adds tokens with zero benefit for feature work |

---

## Quick Reference Card

```
Task                       Include                              Skip
─────────────────────────────────────────────────────────────────────
Fix a service bug          Broken function + types              Schema, routes, config
New route (1 endpoint)     TODO spec + models + 1 route sample  Other routes, app.ts
Service extraction         Fat file + contracts + output spec   Full schema, config
Integration tests          Route + models + 1 test sample       Service internals
Auth/authz audit           Route + WorkspaceMember + middleware  Unrelated models
Architecture discussion    Everything                            Nothing
```
