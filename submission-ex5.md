# Exercise 5 — Verification Workflow for AI-Generated Code

---

## Part 1 — Pre-commit Script

**File:** `scripts/pre-commit.sh`

The script runs five stages in fail-fast order. The first failure stops the pipeline immediately — no point running slow tests on code that doesn't type-check.

```bash
#!/usr/bin/env bash
# Usage: bash scripts/pre-commit.sh
# Wire as Git hook: ln -s ../../scripts/pre-commit.sh .git/hooks/pre-commit
```

| Stage | Command | What it catches |
|-------|---------|-----------------|
| 1 | `npm run typecheck` | Type errors, missing imports, incompatible API calls |
| 2 | `npm run lint` | Explicit `any`, unused vars, banned patterns |
| 3 | `npm run format:check` | Formatting drift (single quotes, missing trailing commas) |
| 4 | `npm run test:coverage` | Logic errors + coverage gate (see Part 4) |
| 5 | `npm audit --audit-level=high` | High/critical CVEs in dependencies |

**Design decisions:**
- Stages are ordered cheapest-to-most-expensive. Type check (~1s) before tests (~2s) before audit.
- `set -euo pipefail` ensures any unhandled command failure also stops the script.
- Stages 1–3 are stateless checks that need no side-effects — they give instant feedback on formatting and type issues before anything runs.
- The audit stage runs last because it requires a network call but is the least likely to fail day-to-day.

---

## Part 2 — GitHub Actions Workflow

**File:** `.github/workflows/ci.yml`

### Job structure and rationale

```
push / pull_request
        │
        ├── Job: lint-and-typecheck   (fast, stateless — runs immediately)
        │         ↓
        └── Job: test                 (needs: lint-and-typecheck)
                                      (runs only if lint passes)

        └── Job: audit                (independent — runs in parallel with test)
```

**Why this structure?**

- `lint-and-typecheck` → `test` is sequential by design. Running tests against code that doesn't type-check wastes CI minutes and produces confusing output. Fast static checks gate the slow ones.
- `audit` runs in parallel with the test job because it scans the lockfile independently of test results. A newly added vulnerable package should surface even when tests are broken.
- `node_modules` caching uses `actions/setup-node` with `cache: "npm"` — this restores from cache on cache hit, saving ~30s per run on warm caches.
- Coverage reports are uploaded as build artifacts (`retention-days: 7`) so reviewers can inspect branch coverage on any PR without re-running locally.

**Should later stages run if earlier ones fail?**

For `lint-and-typecheck` → `test`: **No.** Tests on broken code give noisy, misleading output. The `needs:` directive enforces this.

For `audit`: **Yes.** Security findings are independent of code quality. A PR might have broken tests *and* a vulnerable dependency — both need to surface.

---

## Part 3 — AI-Generated Code Verification Test

### Feature generated

**Label management endpoint** — full CRUD for workspace labels and task label associations (`src/routes/labels.ts`).

### The AI prompt used

> "Implement the label management routes for TundraBoard. The router is already mounted at `/labels` in app.ts. Routes needed: create label (POST with workspaceId in body), list labels (GET with ?workspaceId query param), update label (PATCH /:id), delete label (DELETE /:id), apply label to task (POST /:id/tasks/:taskId), remove label from task (DELETE /:id/tasks/:taskId). Use the existing authenticate middleware and prisma client patterns from other route files."

### Initial AI-generated code (raw output)

```typescript
import { Router } from 'express'            // ← single quotes
import { authenticate } from '../middleware/authenticate.js'
import { prisma } from '../utils/prisma.js'

export const labelRouter = Router()

labelRouter.post('/workspaces/:workspaceId/labels', authenticate, async (req, res, next) => {
  try {
    const { name, colour } = req.body
    const label = await prisma.label.create({
      data: {
        workspaceId: req.params.workspaceId,  // ← TypeScript: string | string[]
        name,
        colour: colour || '#6B7280'
      }                                        // ← missing trailing comma
    })
    res.status(201).json({ data: label })
  } catch (error: any) {                       // ← ESLint: explicit any
    next(error)
  }
})

// Update label
labelRouter.patch('/labels/:id', authenticate, async (req, res, next) => {
  try {
    const label = await prisma.label.update({
      where: { id: req.params.id },
      data: req.body                           // ← mass assignment (security)
    })
    res.json({ data: label })
  } catch (error) { next(error) }
})

// Apply label to task — missing try/catch
labelRouter.post('/tasks/:taskId/labels/:labelId', authenticate, async (req, res) => {
  const taskLabel = await prisma.taskLabel.create({ ... })   // ← no error handling
  res.status(201).json({ data: taskLabel })
})
```

### Issues found by the pipeline

#### Stage 1 — TypeScript (9 errors in labels.ts alone)

```
src/routes/labels.ts(13,9): error TS2322:
  Type 'string | string[]' is not assignable to type 'string | undefined'.
  Type 'string[]' is not assignable to type 'string'.
```

**Root cause:** `@types/express` v5 changed `req.params` from `Record<string, string>` to `Record<string, string | string[]>`. Every `req.params.x` access needs a cast.

**Also caught in this stage:** the same problem in `src/routes/tasks.ts` (3 errors) and `src/routes/attachments.ts` (2 errors) — pre-existing issues that were already lurking but only surfaced when the pipeline was formalised.

**Also caught:** `src/routes/health.ts` used `import.meta.url` which is only valid in ESM, but the project compiles to CommonJS (`"module": "NodeNext"` without `"type": "module"` in package.json). One-line fix: replaced with `process.env.npm_package_version`.

#### Stage 2 — ESLint (1 error in labels.ts)

```
src/routes/labels.ts:19:19  error  Unexpected any. Specify a different type
  @typescript-eslint/no-explicit-any
```

`catch (error: any)` — the AI added an explicit `any` annotation to the error parameter. Fix: remove the annotation (TypeScript infers `unknown` for caught values in modern configs).

**Also caught (pre-existing):** `@typescript-eslint/no-unused-vars` on the `Prisma` import in `taskService.ts`, and `@typescript-eslint/no-explicit-any` in test mock casts.

#### Stage 3 — Prettier (labels.ts flagged)

```
[warn] src/routes/labels.ts
Code style issues found in the above file.
```

Single quotes used throughout instead of the project standard double quotes. Missing trailing commas on object literals. Prettier reformatted 8 files total (including several that had drifted from previous sessions).

#### Stage 4 — Tests (pipeline would fail without test file)

The AI generated zero tests. With the coverage threshold set to 80% statements for `src/routes/labels.ts`, `npm run test:coverage` would have exited non-zero before the test file was added.

#### Stage 5 — Audit (passed)

No vulnerabilities. Good baseline.

### Security issues NOT caught by the automated pipeline

These required manual code review:

| Issue | Location | Why pipeline missed it |
|-------|----------|------------------------|
| **Mass assignment** — `data: req.body` in PATCH | `labels.ts:40` | No static analysis rule for Prisma spread |
| **Missing authorization** — any authenticated user can access any label | All handlers | Functional correctness, not a type/lint rule |
| **Missing try/catch** in apply/remove handlers | `labels.ts:56,65` | TypeScript doesn't require async error handling |

**Conclusion:** The pipeline is a necessary but not sufficient safety net. It catches approximately 60–70% of AI-generated issues (all type errors, style violations, and obvious bad patterns). The remaining 30–40% (authorization logic, business rule violations, security design flaws) require human review.

### Fixed implementation

After running the pipeline and addressing all issues, the final `src/routes/labels.ts`:

- Uses `req.params.id as string` to satisfy Express v5 types
- Removes `error: any` — bare `catch (error)` is sufficient
- Double quotes and trailing commas throughout
- `try/catch` on every async handler
- Explicit field allowlist in PATCH (`{ name, colour }` only — no mass assignment)
- Workspace membership check on every state-changing endpoint (IDOR prevention)
- `viewer` role blocked from write operations

**Test results after fixes:** 53/53 passing across 4 test files.

---

## Part 4 — Coverage Gate

### Configuration

`vitest.config.ts`:

```typescript
coverage: {
  provider: "v8",
  thresholds: {
    // Global floor — prevents overall regression
    statements: 65,
    branches: 65,
    functions: 60,
    lines: 65,

    // Per-file floor for newly added routes — AI-generated files
    // must ship with real test coverage or CI fails.
    "src/routes/labels.ts": {
      statements: 80,
      branches: 60,
      functions: 100,
      lines: 80,
    },
  },
},
```

### Current coverage after adding label tests

| File | Statements | Branches | Functions | Lines |
|------|-----------|---------|-----------|-------|
| All files | 68.3% | 71.4% | 66.7% | 68.3% |
| `src/routes/labels.ts` | 87.9% | 64% | 100% | 87.9% |

### Why coverage gates matter specifically for AI-generated code

**1. AI does not write tests by default**

Without an explicit prompt to include tests, most LLM code completions produce zero test coverage. A coverage gate is the automated enforcement that makes "tests are required" a hard contract rather than a convention.

**2. AI tends to generate the happy path only**

When prompted to add tests, LLMs reliably test the success case but frequently omit error branches (404, 403, 400 responses). Branch coverage thresholds specifically catch this pattern. In the labels endpoint, the 64% branch coverage reflects exactly this: the happy-path branches are tested but several error branches (`!membership`, `role === "viewer"`, `!existing`) were missed before the test file was written.

**3. Coverage gates expose phantom completeness**

AI-generated code compiles, passes type checks, and looks reasonable — but "it compiles" is a much weaker signal than "it compiles and 80% of its logic paths execute under test." A coverage gate shifts the merge bar from "syntactically correct" to "demonstrably behaves correctly under the conditions we've specified."

**4. Global vs per-file thresholds**

The global threshold (65%) is a floor that prevents regression across the whole codebase. The per-file threshold on `src/routes/labels.ts` (80%) enforces a higher bar for newly added AI-generated files specifically. The two levels together create a "ratchet": existing tech debt doesn't block CI, but new code cannot lower the bar.

**Limitation:** Coverage measures execution paths, not correctness. A test that calls an endpoint and asserts `expect(res.status).toBe(200)` covers the lines but says nothing about whether the response body is correct or the business logic is right. Coverage gates are a floor, not a ceiling — they should be combined with meaningful assertions and security-focused test cases (like the IDOR prevention test in `labels.test.ts`).

---

## Summary

| Deliverable | Location |
|-------------|----------|
| Pre-commit script | `scripts/pre-commit.sh` |
| GitHub Actions workflow | `.github/workflows/ci.yml` |
| Label endpoint (fixed) | `src/routes/labels.ts` |
| Label tests | `tests/labels.test.ts` |
| Coverage gate config | `vitest.config.ts` |

**Pipeline result:** All 5 stages green. 53/53 tests passing. 0 vulnerabilities.
