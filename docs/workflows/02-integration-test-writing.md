# Workflow 02 — Write Integration Tests for a Route (Code Review / Analysis)

## Trigger

A route has been implemented (or is about to be merged) and has no integration test
file yet — or the existing test file covers only the happy path. Run this workflow
to produce complete Vitest + Supertest coverage.

---

## Prerequisites / Context

| Item | Where to find it |
|------|-----------------|
| The implemented route file | `src/routes/<name>.ts` |
| Style reference test | `tests/health.test.ts` |
| Prisma schema for models the route touches | `prisma/schema.prisma` |
| Auth middleware signature | `src/middleware/authenticate.ts` (JWT Bearer token) |
| Test runner config | `vitest.config.ts` / `package.json` scripts |

Also note: tests run against a real database (no mocking). Each test must seed its
own data and clean up after.

---

## Prompt Sequence

### Prompt 1 — Coverage Analysis

**Slot:** First message  
**Pattern:** Chain-of-Thought (enumerate cases before writing any code)

```
Analyze this Express route handler file and produce an exhaustive list of
integration test cases. Group them into these categories:

1. Happy path — each successful operation with expected response shape
2. Input validation failures — one case per Zod constraint that can fail
3. Authentication failures — missing token, expired token, malformed token
4. Authorization failures — wrong workspace, viewer role attempting mutation,
   accessing another user's resource
5. Not-found cases — valid UUID but resource doesn't exist
6. Business logic edge cases — duplicate records, cascade deletes, pagination
   boundary, empty results

For each case write: test name · HTTP method + path · setup required · expected
status code · key assertions on the response body.

Route file:
[PASTE src/routes/<name>.ts]

Prisma schema (relevant models):
[PASTE MODELS]
```

---

### Prompt 2 — Few-Shot Style Reference + Generation

**Slot:** Second message (after approving the case list)  
**Pattern:** Few-shot

```
Here is the existing test file from this project to use as a style reference:

--- tests/health.test.ts ---
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("GET /health", () => {
  it("should return status ok with version and timestamp", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("version");
    expect(res.body).toHaveProperty("timestamp");
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });
});
---

Now write a Vitest + Supertest integration test file for all cases you listed.
Follow these rules:

- Import and use the Prisma client directly to seed and clean up test data
  (use beforeEach / afterEach, not beforeAll)
- Use a helper function `makeToken(userId, email, displayName)` to generate
  test JWTs — define it at the top of the file
- Each test is independent — no shared mutable state between tests
- Use `describe` blocks matching your category groupings
- Assert both the status code and the key fields in res.body
- Output: complete file ready to save as tests/[route-name].test.ts
```

---

### Prompt 3 — Gap Review (Optional, after first run)

**Slot:** Follow-up after running the tests  
**Pattern:** Critique + fix

```
I ran the test suite. Here is the output:

[PASTE npx vitest run output]

For each failing test: explain the root cause (is it a test bug or a route bug?)
and provide the corrected test or route code. Do not modify passing tests.
```

---

## Verification Checklist

- [ ] `npx vitest run` exits 0 with all tests passing
- [ ] At least one test per HTTP method on the route
- [ ] Auth failure tests confirm 401 response, not 403 or 500
- [ ] Role-based authorization tests confirm 403 for viewer on mutations
- [ ] Validation tests hit Zod schema boundaries (e.g., title length 0 and 201)
- [ ] Prisma seed and cleanup runs in `beforeEach`/`afterEach`, not `beforeAll`
- [ ] No test depends on data created by another test (order-independent)
- [ ] JWT helper generates tokens with the same payload shape as `req.user`
