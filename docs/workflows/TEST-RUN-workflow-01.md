# Workflow 01 Test Run — authenticate middleware

**Date:** 2026-04-21  
**Workflow:** 01-route-implementation.md  
**Task:** Implement `src/middleware/authenticate.ts`

---

## What I did

Ran Workflow 01 step-by-step against the `authenticate` middleware stub. This is the
smallest bounded unit in the project — one exported function, no Prisma, one clear
contract — which makes it a good workflow smoke test.

**Prompt 1 (Role-setting)** established the stack and hard conventions (no req.body
spread, Zod before Prisma, status codes). For the middleware specifically, the relevant
constraint was: return 401 for missing/expired/invalid tokens and populate `req.user`
with `{ id, email, displayName }` from `src/types/express.d.ts`.

**Prompt 2 (CoT analysis)** surfaced three decisions before writing any code:

1. *Payload shape:* The JWT must encode `{ id, email, displayName }` to match `req.user`.
   A simpler payload (just `userId`) would have worked at auth time but broken downstream
   handlers that read `req.user.displayName`.
2. *Missing header:* An absent `Authorization` header must return 401, not throw.
   The CoT step made explicit that `authHeader?.startsWith("Bearer ")` needs the optional
   chaining — otherwise a missing header crashes the process before the try/catch.
3. *Empty secret:* `process.env.JWT_SECRET` can be `undefined` at type level.
   `jwt.verify(token, undefined)` throws a synchronous error rather than a 401.
   The fix is `process.env.JWT_SECRET ?? ""` — an empty secret causes verify to fail
   the signature check, which is caught and returns 401 rather than crashing.

**Prompt 3 (Code generation)** produced the implementation below. The only manual
adjustment needed was realizing `jwt` needs a default import style (`import jwt from`)
rather than a named import, because the `jsonwebtoken` package is CommonJS.

---

## Generated Code (accepted with one minor edit)

```typescript
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: { message: "Authorization header missing or malformed" } });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? "") as {
      id: string;
      email: string;
      displayName: string;
    };
    req.user = { id: payload.id, email: payload.email, displayName: payload.displayName };
    next();
  } catch {
    res.status(401).json({ error: { message: "Invalid or expired token" } });
  }
}
```

*Manual edit:* The initial CoT output used `import * as jwt from "jsonwebtoken"` which
TypeScript rejected under `esModuleInterop: true`. Changed to default import.
This is a real edge case the workflow didn't catch in Prompt 1's role-setting context —
it could be fixed by adding "use default imports for CJS packages" to the conventions.

---

## Verification Checklist Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` passes for authenticate.ts | PASS |
| 401 returned for missing Authorization header | PASS (optional-chain guard) |
| 401 returned for malformed (non-Bearer) header | PASS (startsWith check) |
| 401 returned for invalid/expired token | PASS (catch block) |
| `req.user` populated with correct shape | PASS (explicit field assignment) |
| No secret leaked in error response | PASS |
| No `req.body` spread (N/A for middleware) | N/A |

---

## What the Workflow Got Right

- **The CoT step was the most valuable.** Without it, the `undefined` JWT secret
  issue and the payload shape mismatch would have been caught only in tests (or not
  at all). The analysis step converted a runtime surprise into a design decision.
- **Role-setting prevented style drift.** Without the project conventions loaded
  upfront, the generated code used `throw` for auth failures instead of `res.status(401)`
  — correct in service code, wrong in Express middleware where next(err) or direct
  response is needed.

## What I Would Change

- Add "CJS package imports use default import style" to Prompt 1's conventions list.
- For middleware specifically, add a fourth prompt: "Write a unit test for this
  middleware using a mock Request/Response." The verification checklist currently
  only covers TypeScript validity, not runtime behavior.
- The workflow's verification checklist has no step for running the actual test suite.
  Add: `[ ] npx vitest run tests/<name>.test.ts exits 0`.

---

## Reflection — Workflow vs Ad-Hoc

### Ad-hoc approach
Open the file, look at the TODO, start typing. Likely get the happy path right but
miss the `undefined` secret edge case. Discover it when the server crashes in staging.
Total time: ~10 minutes coding + 30 minutes debugging.

### Workflow approach
Spend 3 minutes filling in placeholders, 5 minutes reviewing the CoT output, 2 minutes
checking the generated code against the checklist. Total time: ~15 minutes, zero
debugging.

**Concrete benefits:**
1. **Error cases caught before running.** The CoT step externalized reasoning — the
   `jwt.verify(token, undefined)` bug was caught at analysis time, not runtime.
2. **Consistent conventions enforced.** The role-setting prompt acts as a linter for
   things TypeScript can't check (status code semantics, field allowlists).
3. **Portable and teachable.** A new team member can run this workflow and produce
   code that matches the codebase conventions without reading every other route file.

**Trade-offs:**
1. **Overhead for small tasks.** The authenticate middleware is ~20 lines. The
   workflow overhead (filling placeholders, reviewing CoT) is proportionally high.
   For sub-30-line implementations, ad-hoc with a quick checklist review is faster.
2. **Prompt maintenance.** The role-setting prompt needs updating whenever the project
   conventions change (e.g., if the team switches from offset pagination to cursor
   pagination). A stale Prompt 1 produces code that violates current patterns.
3. **False confidence from green checklists.** A passing TypeScript check does not
   mean the logic is correct — the workflow still needs a real test run to close the
   loop. Currently the checklist doesn't include running tests.

---

## Stretch Goal — Critique of the Four-Component Structure

The four components (Trigger, Prerequisites, Prompt sequence, Verification checklist)
cover the *happy path* of a workflow well. What's missing:

### Proposed addition: Failure Modes section

```
## Failure Modes

| Symptom | Likely cause | Recovery |
|---------|-------------|----------|
| Generated code uses req.body spread | Prompt 1 context was too short or truncated | Re-run with a shorter schema paste; break into two prompts |
| TypeScript errors on jwt import | CJS/ESM import style mismatch | Change to default import; add note to Prompt 1 conventions |
| Zod schema doesn't cover all fields | Prompt 2 CoT missed an optional field | Re-run Prompt 2 with the Prisma model pasted explicitly |
| Auth check present but wrong model queried | WorkspaceMember vs Workspace confusion | Add model relationship diagram to Prerequisites |
```

**Why this matters:** When a workflow fails mid-execution (generated code doesn't
compile, or the CoT analysis is incomplete), there's currently no recovery path
documented. A developer hits the failure, doesn't know whether to re-run the same
prompt, adjust the context, or abandon the workflow. The Failure Modes section
turns a confusing dead end into a decision tree. It also accumulates team knowledge
about *which prompts are fragile* — exactly the kind of non-obvious insight that
belongs in a workflow document rather than in a commit message.
