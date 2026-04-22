// Module 3 — Exercise 2 Submission: Regression Tests
// Test file: tests/tasks.test.ts
// Run with: npm test

// ---------------------------------------------------------------------------
// PART 1 — Regression tests (one per Exercise 1 fix)
// ---------------------------------------------------------------------------

export const regressionTests = [
  {
    fix: "Fix 1 — SQL injection in searchTasks",
    bugDescription:
      "searchTasks built a WHERE clause by string-concatenating all filter " +
      "params and executed it with $queryRawUnsafe. Every query param " +
      "(projectId, searchTerm, status, priority, assigneeId) was injectable.",
    testFile: "tests/tasks.test.ts",
    describeBlock: "Regression Fix 1 — SQL injection in searchTasks",
    tests: [
      "never calls $queryRawUnsafe regardless of search input",
      "passes the search term as a value inside the Prisma where clause, not a raw string",
    ],
    revertEvidence: {
      revertedCode:
        "Restored $queryRawUnsafe implementation in searchTasks (taskService.ts)",
      result: "10 tests failed — both Fix 1 regression assertions and all GET /tasks happy-path tests that depend on findMany",
      conclusion: "PASS — regression tests correctly catch the original bug",
    },
  },
  {
    fix: "Fix 2 — ignoreExpiration: true in authenticate.ts",
    bugDescription:
      "jwt.verify was called with { ignoreExpiration: true }, causing the " +
      "middleware to accept expired tokens indefinitely. A stolen token from " +
      "any point in time remained valid forever.",
    testFile: "tests/tasks.test.ts",
    describeBlock: "Regression Fix 2 — expired JWT accepted (ignoreExpiration: true)",
    tests: [
      "rejects an expired token with 401",
      "still accepts a valid non-expired token",
    ],
    revertEvidence: {
      revertedCode: "Re-added { ignoreExpiration: true } to jwt.verify in authenticate.ts",
      result: "1 test failed — 'rejects an expired token with 401' received 200 instead",
      conclusion: "PASS — regression test correctly catches the original bug",
    },
  },
  {
    fix: "Fix 3 — express-content-sanitizer bad import in taskService.ts",
    bugDescription:
      "taskService.ts imported sanitizeHtml from 'express-content-sanitizer', " +
      "a package not in package.json. In production Node.js, this throws " +
      "'Cannot find module' at startup, crashing the entire service before " +
      "any request is handled.",
    testFile: "tests/tasks.test.ts",
    describeBlock: "Regression Fix 3 — express-content-sanitizer crash on createTask",
    tests: [
      "creates a task with a description and returns 201",
      "passes the description to prisma.task.create unchanged (no sanitisation applied)",
      "creates a task without a description without throwing",
    ],
    revertEvidence: {
      revertedCode: "Re-added import { sanitizeHtml } from 'express-content-sanitizer' to taskService.ts",
      result: "0 tests failed",
      conclusion:
        "LIMITATION — Vitest's Vite-based module sandbox handles missing ESM imports " +
        "more gracefully than Node.js require(), so the module-load crash is not " +
        "reproducible in this test environment. Tests were updated to verify the " +
        "observable post-fix contract instead: description forwarded to " +
        "prisma.task.create unchanged, 201 returned. The startup crash is best " +
        "verified by a Node.js integration or smoke test outside Vitest.",
    },
  },
] as const;

// ---------------------------------------------------------------------------
// PART 2 — Test results
// ---------------------------------------------------------------------------

export const testResults = {
  command: "npm test",
  runner: "Vitest v3.2.4",
  testFiles: 2,
  totalTests: 28,
  passed: 28,
  failed: 0,
  duration: "554ms",
  output: `
  Test Files  2 passed (2)
       Tests  28 passed (28)
    Start at  08:25:55
    Duration  554ms (transform 89ms, setup 0ms, collect 440ms, tests 73ms)
  `,
} as const;

// ---------------------------------------------------------------------------
// PART 3 — Quality evaluation
// ---------------------------------------------------------------------------

export const qualityEvaluation: Record<string, { verdict: string; reasoning: string }> = {
  "Regression Fix 1 — SQL injection": {
    verdict: "Sound",
    reasoning:
      "Both assertions are meaningful. One verifies the dangerous API " +
      "($queryRawUnsafe) is never called; the other verifies the injection payload " +
      "reaches Prisma as a typed value rather than raw SQL. Revert proof confirms " +
      "they catch the original bug (10 failures).",
  },
  "Regression Fix 2 — ignoreExpiration": {
    verdict: "Sound",
    reasoning:
      "Creates a genuinely expired token (exp set to 1 hour in the past via JWT " +
      "payload) and asserts 401. Revert proof shows pre-fix code returned 200. " +
      "Companion test for valid tokens guards against over-correction — not a tautology.",
  },
  "Regression Fix 3 — bad import": {
    verdict: "Partially effective",
    reasoning:
      "The module-load crash cannot be reproduced in Vitest (Vite module sandbox " +
      "silently absorbs missing imports). Tests were revised to verify the observable " +
      "contract: description passed to Prisma unchanged, 201 returned. These catch " +
      "future regressions where the description is mangled or dropped. The startup " +
      "crash requires a Node integration test outside Vitest.",
  },
  "False positives in broader suite": {
    verdict: "None found",
    reasoning:
      "Every assertion checks a specific status code, error message pattern, or " +
      "exact mock call argument. No expect(true).toBe(true) tautologies present.",
  },
  "Meaningful assertion examples": {
    verdict: "Verified",
    reasoning:
      "GET /tasks/:id → 404 asserts error message matches /not found/i, not just " +
      "status. POST /tasks createdById asserts the exact value passed to " +
      "prisma.task.create, ruling out body-supplied override. Pagination asserts " +
      "exact skip and take values, not just that findMany was called.",
  },
};

// ---------------------------------------------------------------------------
// PART 4 — Coverage gaps
// ---------------------------------------------------------------------------

export const coverageGaps = [
  {
    gap: "page=0 boundary value",
    location: "tests/tasks.test.ts — 'Coverage gap 1' describe block",
    aiMissed: true,
    written: true,
    explanation:
      "The AI generated pagination tests for valid pages (e.g. page=3) but missed " +
      "the zero boundary. parseInt('0') is 0, which is falsy, so || 1 silently " +
      "converts it to page 1 (skip=0). The contract is non-obvious: a future refactor " +
      "replacing || 1 with ?? 1 would change semantics for page=0.",
  },
  {
    gap: "SQL injection via assigneeId filter",
    location: "tests/tasks.test.ts — 'Coverage gap 2' describe block",
    aiMissed: true,
    written: true,
    explanation:
      "The Fix 1 regression tests covered searchTerm only. The original vulnerability " +
      "affected all five interpolated params including assigneeId. This test verifies " +
      "assigneeId is also parameterised in the post-fix code and that $queryRawUnsafe " +
      "is never called regardless of which filter carries the injection payload.",
  },
  {
    gap: "Prisma P2025 on delete/update of non-existent task",
    location: "Not written",
    aiMissed: false,
    written: false,
    explanation:
      "PATCH or DELETE on a missing task ID causes Prisma to throw " +
      "PrismaClientKnownRequestError P2025. The route passes this to next(error), " +
      "which returns 500 instead of 404. This is the unfixed EH1 bug from Exercise 1. " +
      "A test would need to mock prisma.task.update/delete to throw the P2025 error.",
  },
  {
    gap: "JWT with valid signature but missing userId claim",
    location: "Not written",
    aiMissed: false,
    written: false,
    explanation:
      "jwt.verify succeeds but payload.userId is undefined. The middleware sets " +
      "req.user.id = undefined. Any downstream Prisma call using it as a foreign key " +
      "throws a database constraint error rather than returning a structured 400 or 401.",
  },
] as const;
