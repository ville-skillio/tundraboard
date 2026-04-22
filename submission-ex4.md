# Module 3 — Exercise 4 Submission: TundraBoard Bug Hunt

**Branch:** `module-3-planted-bugs`  
**Audit targets:** Authentication module, Task management module, Crypto utilities, Notification service, Webhook service  
**Total planted bugs:** 9 — all nine found and fixed

---

## All Nine Findings

---

### Bug 1 — SQL Injection in `searchTasks`

| Field | Detail |
|-------|--------|
| **Category** | Security vulnerability — OWASP A03: Injection |
| **Location** | `src/services/taskService.ts` (original lines 61–84) |
| **Severity** | Critical |

**Description:**  
`searchTasks` built a raw SQL `WHERE` clause by string-concatenating all five filter parameters (`projectId`, `searchTerm`, `status`, `priority`, `assigneeId`) and executed it with `prisma.$queryRawUnsafe()` — Prisma's explicit "skip all safety checks" API. None of the values were parameterised.

**Impact:**  
Any authenticated user could inject arbitrary SQL via any filter query parameter, enabling full database read/write access, data exfiltration, or table destruction.

**Before:**
```typescript
let whereClause = `WHERE t.project_id = '${projectId}'`;
if (searchTerm) {
  whereClause += ` AND (t.title ILIKE '%${searchTerm}%' OR t.description ILIKE '%${searchTerm}%')`;
}
// ... etc for status, priority, assigneeId
const tasks = await prisma.$queryRawUnsafe(`SELECT ... ${whereClause} LIMIT ${pageSize} OFFSET ${offset}`);
```

**After:**
```typescript
const tasks = await prisma.task.findMany({
  where: {
    projectId,
    ...(searchTerm && {
      OR: [
        { title: { contains: searchTerm, mode: "insensitive" } },
        { description: { contains: searchTerm, mode: "insensitive" } },
      ],
    }),
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
    ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
  },
  include: { project: true },
  orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  skip: (page - 1) * pageSize,
  take: pageSize,
});
```

**Fix:** Replaced the entire raw SQL path with Prisma's native `findMany`, which parameterises all values automatically.

---

### Bug 2 — JWT Expiration Silently Ignored

| Field | Detail |
|-------|--------|
| **Category** | Security vulnerability — OWASP A07: Identification and Authentication Failures |
| **Location** | `src/middleware/authenticate.ts:25` |
| **Severity** | High |

**Description:**  
`jwt.verify` was called with `{ ignoreExpiration: true }`, causing the middleware to accept expired tokens unconditionally. A token stolen at any point in time remained valid forever.

**Impact:**  
Revoked or rotated tokens could be replayed indefinitely. Logout had no server-side effect — the old token continued to grant access.

**Before:**
```typescript
const payload = jwt.verify(token, JWT_SECRET, {
  ignoreExpiration: true,
}) as JwtPayload;
```

**After:**
```typescript
const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
```

**Fix:** Removed the options object. `jwt.verify` now enforces the `exp` claim as intended; expired tokens throw `TokenExpiredError` which the existing `catch` block handles by returning 401.

---

### Bug 3 — Hallucinated Dependency: `express-content-sanitizer`

| Field | Detail |
|-------|--------|
| **Category** | Hallucinated dependency |
| **Location** | `src/services/taskService.ts:4` (original) |
| **Severity** | Critical |

**Description:**  
`taskService.ts` imported `sanitizeHtml` from `express-content-sanitizer` — a package that does not exist in `package.json` and does not export a `sanitizeHtml` function even if installed. This is a classic AI hallucination: the model invented a plausible-sounding package name that does not exist.

**Impact:**  
Node throws `Cannot find module 'express-content-sanitizer'` at startup, crashing the entire service before handling any request. Every task endpoint returns 500.

**Before:**
```typescript
import { sanitizeHtml } from "express-content-sanitizer";
// ...
description: data.description ? sanitizeHtml(data.description) : undefined,
```

**After:**
```typescript
// import removed entirely
// ...
description: data.description ?? undefined,
```

**Fix:** Removed the import and call. Task descriptions are plain text stored in a PostgreSQL `text` column — HTML sanitisation is a client-side rendering concern. If sanitisation were genuinely needed, the correct package is `sanitize-html`.

**Detection technique:** Package registry check — `express-content-sanitizer` returns zero results on npm. The giveaway is that it sounds like a real package but follows no existing naming convention.

---

### Bug 4 — Deprecated `crypto.createCipher` with Implicit Zero IV

| Field | Detail |
|-------|--------|
| **Category** | Security vulnerability + outdated API — OWASP A02: Cryptographic Failures |
| **Location** | `src/services/cryptoUtils.ts:6–16` |
| **Severity** | Critical |

**Description:**  
`crypto.createCipher` and `crypto.createDecipher` use the deprecated `EVP_BytesToKey` derivation function with a **static all-zero IV**. This makes encryption fully deterministic — the same plaintext always produces the same ciphertext. These APIs are also removed in Node.js 22+, so the code breaks on upgrade.

**Impact:**  
1. An attacker observing two identical ciphertexts learns the underlying plaintexts are identical.  
2. With the hardcoded fallback key (`"default-encryption-key"`), any stored API key can be decrypted offline in milliseconds — no brute force required.

**Before:**
```typescript
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-encryption-key";

export function encryptApiKey(apiKey: string): string {
  const cipher = crypto.createCipher("aes-256-cbc", ENCRYPTION_KEY);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

export function decryptApiKey(encrypted: string): string {
  const decipher = crypto.createDecipher("aes-256-cbc", ENCRYPTION_KEY);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

**After:**
```typescript
const KEY_BUFFER = Buffer.from(
  crypto.createHash("sha256").update(ENCRYPTION_KEY).digest(),
);

export function encryptApiKey(apiKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", KEY_BUFFER, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptApiKey(encrypted: string): string {
  const separatorIndex = encrypted.indexOf(":");
  const iv = Buffer.from(encrypted.slice(0, separatorIndex), "hex");
  const ciphertext = encrypted.slice(separatorIndex + 1);
  const decipher = crypto.createDecipheriv("aes-256-cbc", KEY_BUFFER, iv);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

**Fix:** Replaced with `createCipheriv`/`createDecipheriv`. A random 16-byte IV is generated per encryption call using `crypto.randomBytes(16)` and prepended to the ciphertext. The key is SHA-256 hashed to produce the correct 32-byte length for AES-256.

---

### Bug 5 — IDOR: Any Authenticated User Can Read Any Attachment

| Field | Detail |
|-------|--------|
| **Category** | Security vulnerability — OWASP A01: Broken Access Control |
| **Location** | `src/routes/attachments.ts:7–22` |
| **Severity** | High |

**Description:**  
`GET /attachments/:id` returned any attachment record to any authenticated user without checking workspace membership. The full record including `storageKey` (the path to the file in object storage) was returned.

**Impact:**  
Any registered user could enumerate attachment UUIDs and retrieve files from other users' private projects, including the storage path needed to download the raw file.

**Before:**
```typescript
attachmentRouter.get("/:id", authenticate, async (req, res, next) => {
  const attachment = await prisma.attachment.findUnique({
    where: { id: req.params.id },
  });
  if (!attachment) { res.status(404)...; return; }
  res.json({ data: attachment });
});
```

**After:**
```typescript
attachmentRouter.get("/:id", authenticate, async (req, res, next) => {
  const attachment = await prisma.attachment.findUnique({
    where: { id: req.params.id },
    include: { task: { include: { project: true } } },
  });
  if (!attachment) { res.status(404)...; return; }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: req.user!.id,
        workspaceId: attachment.task.project.workspaceId,
      },
    },
  });
  if (!membership) { res.status(403).json({ error: { message: "Access denied" } }); return; }

  const { task: _, ...attachmentData } = attachment;
  res.json({ data: attachmentData });
});
```

**Fix:** The attachment is now fetched with its task and project included. A second query verifies the caller is a `WorkspaceMember` of the attachment's workspace. Non-members receive 403.

---

### Bug 6 — Race Condition in `notifyTaskAssigned`

| Field | Detail |
|-------|--------|
| **Category** | Logic bug |
| **Location** | `src/services/notificationService.ts:3–26` |
| **Severity** | Medium |

**Description:**  
`notifyTaskAssigned` used a check-then-act pattern: it first queried for an existing notification, and if absent, created one. Between the `findFirst` and `create` calls, two concurrent requests for the same `(taskId, assigneeId)` pair can both observe no existing record and both proceed to insert — creating duplicate notifications.

**Impact:**  
A user reassigned to the same task in rapid succession (e.g. via two concurrent API calls or a webhook storm) receives duplicate "Task assigned" notifications. In a production system with notification emails this means inbox spam and user confusion.

**Before:**
```typescript
const existing = await prisma.notification.findFirst({ where: { ... } });
if (!existing) {
  await prisma.notification.create({ data: { ... } });
}
```

**After:**
```typescript
await prisma.$transaction(async (tx) => {
  const existing = await tx.notification.findFirst({
    where: {
      userId: assigneeId,
      type: "task_assigned",
      metadata: { path: ["taskId"], equals: taskId },
    },
  });
  if (!existing) {
    await tx.notification.create({
      data: {
        userId: assigneeId,
        type: "task_assigned",
        title: "Task assigned",
        body: `You have been assigned: ${title}`,
        metadata: { taskId },
      },
    });
  }
});
```

**Fix:** Wrapped both operations in a `prisma.$transaction`. This serialises the read and write within a single database transaction, closing the window for concurrent duplicate inserts. The complete fix would also add a unique constraint on `(userId, type, metadata->taskId)` at the database schema level to enforce deduplication as a hard guarantee.

---

### Bug 7 — Unsigned Incoming Webhooks

| Field | Detail |
|-------|--------|
| **Category** | Security vulnerability — OWASP A08: Software and Data Integrity Failures |
| **Location** | `src/services/webhookService.ts:9–23` |
| **Severity** | High |

**Description:**  
`handleIncomingWebhook` processed any payload for a valid `webhookId` without verifying an HMAC-SHA256 signature. The `Webhook` schema includes a `secret` field specifically for this purpose, but it was never used. An attacker knowing any valid webhook ID could forge arbitrary events.

**Impact:**  
A forged `task.deleted` event could cause mass data deletion. A forged `user.promoted` event (in a system acting on webhook events) could escalate privileges. The webhook endpoint becomes an unauthenticated write path into the system's internal event processing.

**Before:**
```typescript
export async function handleIncomingWebhook(webhookId: string, body: WebhookPayload) {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook || !webhook.active) return null;
  // No signature check
  return { received: true, event: body.event };
}
```

**After:**
```typescript
import crypto from "crypto";

export async function handleIncomingWebhook(
  webhookId: string,
  body: WebhookPayload,
  signature: string,
  rawBody: string,
) {
  const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!webhook || !webhook.active) return null;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", webhook.secret).update(rawBody).digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }

  return { received: true, event: body.event };
}
```

**Fix:** The function now accepts the raw request body string and the `X-Signature-256` header value. It computes `HMAC-SHA256(rawBody, webhook.secret)` and compares using `crypto.timingSafeEqual` (which prevents timing attacks). Payloads with missing or mismatched signatures are rejected before any processing.

---

### Bug 8 — Unstable Pagination Ordering

| Field | Detail |
|-------|--------|
| **Category** | Logic bug |
| **Location** | `src/services/taskService.ts` (`searchTasks` orderBy clause) |
| **Severity** | Medium |

**Description:**  
The original `searchTasks` used `ORDER BY t.created_at DESC` as the only sort key, and the rewritten Prisma version initially used `orderBy: { createdAt: "desc" }`. When multiple tasks share the same `createdAt` timestamp (common in bulk inserts, seeded data, or rapid API calls), the database returns them in an arbitrary, non-deterministic order. Each page request may sort these records differently, causing items to appear on multiple pages or be skipped entirely.

**Impact:**  
In a paginated task list, a user clicking "next page" may see tasks they already saw on the previous page, or miss tasks entirely. The problem is worst when tasks are created in batch (e.g. project templates, imports) and typically surfaces in testing but is hard to reproduce in production until load increases.

**Before:**
```typescript
orderBy: { createdAt: "desc" },
```

**After:**
```typescript
orderBy: [{ createdAt: "desc" }, { id: "asc" }],
```

**Fix:** Added `id` as a tiebreaker sort key. UUIDs are unique, so the combined `(createdAt DESC, id ASC)` ordering is fully deterministic regardless of timestamp collisions. The complete fix for high-traffic systems would be cursor-based pagination (using the last-seen `id` and `createdAt` as the cursor), which eliminates offset drift entirely, but the tiebreaker resolves the determinism bug within the existing offset-based design.

---

### Bug 9 — No Rate Limiting on Login Endpoint

| Field | Detail |
|-------|--------|
| **Category** | Security vulnerability — OWASP A07: Identification and Authentication Failures |
| **Location** | `src/routes/auth.ts:28` |
| **Severity** | High |

**Description:**  
`POST /auth/login` accepted unlimited requests with no throttling. An attacker could attempt millions of password combinations against any known email address with no server-side resistance.

**Impact:**  
Brute-force or credential-stuffing attacks against the login endpoint are unconstrained. The `bcrypt` cost factor (10) slows individual comparisons, but with sufficient parallel requests an attacker can still exhaust the common-password space for any given account in minutes to hours.

**Before:**
```typescript
authRouter.post("/login", async (req, res, next) => {
  // No rate limiting
  ...
});
```

**After:**
```typescript
import rateLimit from "express-rate-limit";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 10,                   // max 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many login attempts, please try again later" } },
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  ...
});
```

**Fix:** Added `express-rate-limit` middleware scoped to the login route. Allows 10 attempts per IP per 15-minute window. Exceeding the limit returns 429 with a standard `Retry-After` header. The `register` endpoint was left unlimited as account creation is less sensitive to brute force.

---

## Fix Summary

| Bug | File | Fixed in |
|-----|------|----------|
| 1 — SQL injection | `taskService.ts` | Exercise 2 |
| 2 — JWT ignoreExpiration | `authenticate.ts` | Exercise 2 |
| 3 — Hallucinated dependency | `taskService.ts` | Exercise 2 |
| 4 — Deprecated crypto | `cryptoUtils.ts` | Exercise 3 |
| 5 — IDOR attachments | `attachments.ts` | Exercise 3 |
| 6 — Race condition | `notificationService.ts` | This exercise |
| 7 — Unsigned webhook | `webhookService.ts` | This exercise |
| 8 — Unstable pagination | `taskService.ts` | This exercise |
| 9 — No rate limiting | `auth.ts` | This exercise |

All 9 bugs fixed. Test suite: **40/40 passing** (`npm test`).

---

## Reflection

### Which issues were hardest to find?

**Hardest: Bug 8 (unstable pagination)** — this requires knowing that `ORDER BY createdAt` is non-deterministic when timestamps collide. It produces no error, no crash, and no obviously wrong output in normal testing. It only manifests as flaky behaviour under specific conditions (bulk inserts, identical timestamps). A standard security scan or linter would not flag it — it requires understanding the semantics of offset-based pagination and SQL ordering.

**Second hardest: Bug 6 (race condition)** — the check-then-act pattern looks correct on first reading. Each individual line is fine; the bug is in the gap between two operations. It requires reasoning about concurrent execution, which is not obvious from static code review. Most AI tools reviewed the function in isolation and reported it as correct logic.

**Easiest: Bug 3 (hallucinated dependency)** — a single `npm ls express-content-sanitizer` or package registry search returns zero results instantly. Once you know to look for non-existent packages, it takes seconds.

### Which tools or techniques were most effective?

| Category | Most effective technique |
|----------|--------------------------|
| Security vulnerabilities (Bugs 1, 2, 4, 5, 7, 9) | Structured OWASP review prompt with role-setting. The AI identified all six on the first pass when given explicit categories to check. |
| Hallucinated dependency (Bug 3) | Package registry check (`npm ls`, npmjs.com search). AI cannot reliably detect its own hallucinations in generated code — external verification is required. |
| Logic bugs (Bugs 6, 8) | Manual inspection combined with asking "what happens if two requests arrive simultaneously?" and "what happens when multiple records share a sort key?". These required adversarial reasoning that the AI did not apply unprompted. |

### What did AI tools miss vs. find manually?

**AI missed (found manually or with targeted prompting):**
- Bug 6 (race condition) — the AI reviewed `notifyTaskAssigned` and assessed the logic as correct without reasoning about concurrency. Only flagged after explicitly asking "is there a race condition in this function?"
- Bug 8 (pagination ordering) — not detected by any security-focused scan. Found by asking specifically about pagination stability and sort key uniqueness.

**AI found confidently:**
- All six security vulnerabilities. The structured OWASP review prompt produced high-confidence findings for SQL injection, JWT bypass, IDOR, deprecated crypto, unsigned webhooks, and missing rate limiting on the first pass.

**Key takeaway for newcomers:** Start with the structured security review — it handles the OWASP-class bugs reliably. Then manually inspect any check-then-act pattern for race conditions, and any sort/pagination logic for determinism. These two categories are the ones where AI tools most consistently underperform without targeted prompting.
