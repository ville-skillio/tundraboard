// Module 3 — Exercise 3 Submission: OWASP Top 10 Security Audit
// Audit targets: Authentication module (src/routes/auth.ts, src/middleware/authenticate.ts)
//                Task management module (src/routes/tasks.ts, src/services/taskService.ts)
//                Supporting modules (src/services/cryptoUtils.ts, src/routes/attachments.ts)
// Security tests: tests/security.test.ts
// Test results:   40 tests passing (3 test files)

// ---------------------------------------------------------------------------
// PART 1 — Audit Report
// ---------------------------------------------------------------------------

export const auditFindings = [
  // --- Authentication Module ---

  {
    id: "F1",
    module: "Authentication",
    file: "src/routes/auth.ts:8 + src/middleware/authenticate.ts:4",
    owaspCategory: "A07 — Identification and Authentication Failures",
    severity: "Critical",
    title: "Hardcoded JWT secret fallback enables token forgery",
    description:
      "Both files fall back to the literal string 'change-me-to-a-real-secret-in-production' " +
      "when JWT_SECRET is unset. Because the same fallback is used for signing (auth.ts) and " +
      "verification (authenticate.ts), any attacker who reads the source can forge valid JWTs " +
      "for any userId with no server interaction.",
    attackVector:
      "jwt.sign({ userId: '<any-uuid>', email: 'admin@example.com' }, " +
      "'change-me-to-a-real-secret-in-production', { expiresIn: '999d' }) " +
      "produces a fully accepted token against every authenticated endpoint.",
    recommendedFix:
      "Remove the string literal fallback entirely. Require JWT_SECRET at startup " +
      "and throw if absent or shorter than 32 characters.",
    verification: "Genuine vulnerability",
    genuineReasoning:
      "The fallback is committed in public source, used at runtime when the env var is " +
      "absent, and shared between the signer and verifier — a complete authentication bypass.",
  },
  {
    id: "F2",
    module: "Authentication",
    file: "src/routes/auth.ts:13 (register) + auth.ts:30 (login)",
    owaspCategory: "A03 — Injection / A07 — Identification and Authentication Failures",
    severity: "High",
    title: "No input validation on register and login endpoints",
    description:
      "email, password, and displayName are destructured from req.body and used directly " +
      "with no type checking, length limits, or format validation. An empty string password " +
      "passes bcrypt.compare successfully against a bcrypt hash of an empty string if one " +
      "exists. A missing email causes Prisma to throw a constraint error that leaks the " +
      "database schema in the error message.",
    attackVector:
      "POST /auth/register with { email: null } causes an unhandled Prisma error exposing " +
      "the internal schema. POST /auth/login with email: '' can match existing accounts " +
      "registered with an empty email.",
    recommendedFix:
      "Add Zod schema validation at the route level before any database interaction. " +
      "Validate email format, minimum password length (≥8 chars), and displayName length.",
    verification: "Genuine vulnerability",
    genuineReasoning:
      "Missing boundary validation at the entry point is directly exploitable to cause " +
      "error disclosure and potentially authenticate as accounts with degenerate credentials.",
  },

  // --- Task Management Module ---

  {
    id: "F3",
    module: "Task Management",
    file: "src/routes/tasks.ts:59-66 + src/services/taskService.ts:39-47 (pre-fix)",
    owaspCategory: "A01 — Broken Access Control",
    severity: "High",
    title: "Mass assignment: req.body spread directly into Prisma.TaskUpdateInput",
    description:
      "updateTask accepted Prisma.TaskUpdateInput and spread req.body directly into the " +
      "Prisma update call. An attacker could include createdById, projectId, or even nested " +
      "relation operations (e.g. { comments: { deleteMany: {} } }) in the PATCH body.",
    attackVector:
      "PATCH /tasks/<id> with body { 'createdById': '<attacker-uuid>' } reassigns task " +
      "ownership. Body { 'projectId': '<other-project>' } moves the task to a different " +
      "project silently. Body { 'comments': { 'deleteMany': {} } } deletes all comments.",
    recommendedFix:
      "Replace Prisma.TaskUpdateInput with an explicit TaskUpdateFields type that only " +
      "exposes title, description, status, priority, assigneeId, and dueDate. " +
      "Use conditional spread to only include keys that are actually present in the body.",
    verification: "Genuine vulnerability — FIXED",
    genuineReasoning:
      "Directly exploitable: any authenticated user could overwrite ownership, relational " +
      "integrity, and server-controlled fields with a crafted PATCH body.",
  },
  {
    id: "F4",
    module: "Task Management",
    file: "src/routes/tasks.ts:59-76",
    owaspCategory: "A01 — Broken Access Control",
    severity: "High",
    title: "No ownership or membership check on PATCH/DELETE tasks",
    description:
      "PATCH /tasks/:id and DELETE /tasks/:id operate on any task by UUID with no " +
      "verification that req.user.id belongs to the task's workspace or project. " +
      "Any authenticated user can permanently delete any task in the system.",
    attackVector:
      "DELETE /tasks/<victim-task-uuid> with any valid JWT permanently destroys a task " +
      "belonging to a completely different user and workspace.",
    recommendedFix:
      "Before any mutation, resolve the task's project → workspace and verify " +
      "req.user.id is a WorkspaceMember of that workspace with a role of admin or member.",
    verification: "Genuine vulnerability",
    genuineReasoning:
      "Authentication is present but authorization is entirely absent. The exploit " +
      "requires only a valid JWT (any user) and a guessable task UUID.",
  },
  {
    id: "F5",
    module: "Task Management",
    file: "src/routes/attachments.ts:7-22 (pre-fix)",
    owaspCategory: "A01 — Broken Access Control",
    severity: "High",
    title: "IDOR: GET /attachments/:id returns any attachment to any authenticated user",
    description:
      "The endpoint retrieved any attachment record by ID without checking whether the " +
      "requesting user belonged to the workspace that owns the attachment's parent task. " +
      "Full attachment data including storageKey was returned.",
    attackVector:
      "Authenticated attacker iterates UUIDs via GET /attachments/<uuid>. For every hit " +
      "they receive the storageKey (a path into object storage) belonging to another " +
      "user's private project — enabling direct file download from storage.",
    recommendedFix:
      "Resolve the attachment → task → project → workspace chain and verify the caller " +
      "is a WorkspaceMember before returning any data. Return 403, not 404, on access " +
      "denial to avoid confirming UUID existence to the attacker.",
    verification: "Genuine vulnerability — FIXED",
    genuineReasoning:
      "Classic IDOR with high-value data exposure (storageKey). Exploitable by any " +
      "registered user with no special privileges.",
  },

  // --- Crypto Module ---

  {
    id: "F6",
    module: "Crypto Utilities",
    file: "src/services/cryptoUtils.ts:6-16 (pre-fix)",
    owaspCategory: "A02 — Cryptographic Failures",
    severity: "Critical",
    title: "Deprecated crypto.createCipher uses zero IV — deterministic encryption",
    description:
      "crypto.createCipher / crypto.createDecipher are removed in Node.js 22+ and use " +
      "the deprecated EVP_BytesToKey KDF with a static all-zero IV. Encryption is fully " +
      "deterministic: the same plaintext always produces the same ciphertext. An attacker " +
      "who observes two identical ciphertexts knows the underlying API keys are identical. " +
      "Combined with the hardcoded fallback key, all stored ciphertext is decryptable " +
      "offline with zero brute force.",
    attackVector:
      "1. Attacker reads source → knows key = 'default-encryption-key', IV = 0x00*16. " +
      "2. Attacker obtains any encrypted API key from the database. " +
      "3. Attacker runs crypto.createDecipher('aes-256-cbc', 'default-encryption-key') " +
      "locally and recovers the plaintext API key in milliseconds.",
    recommendedFix:
      "Replace createCipher/createDecipher with createCipheriv/createDecipheriv. " +
      "Generate a random 16-byte IV per encryption with crypto.randomBytes(16). " +
      "Prepend the IV to the ciphertext (iv-hex:ciphertext-hex) so decryption is " +
      "self-contained. Derive the key buffer via SHA-256 to ensure the correct 32-byte " +
      "key size for AES-256.",
    verification: "Genuine vulnerability — FIXED",
    genuineReasoning:
      "Deterministic AES-CBC with a known key is equivalent to no encryption. " +
      "The exploit requires only source access and a single database row.",
  },
  {
    id: "F7",
    module: "Crypto Utilities",
    file: "src/services/cryptoUtils.ts:3",
    owaspCategory: "A02 — Cryptographic Failures",
    severity: "High",
    title: "Hardcoded encryption key fallback",
    description:
      "ENCRYPTION_KEY falls back to the literal string 'default-encryption-key' when the " +
      "environment variable is absent. Any ciphertext produced with this default key is " +
      "trivially decryptable by anyone with source access.",
    attackVector:
      "Attacker reads source, obtains a DB row, calls decryptApiKey(ciphertext) locally " +
      "with the known default key to recover the plaintext API key.",
    recommendedFix:
      "Remove the string literal fallback. Require ENCRYPTION_KEY at startup (minimum " +
      "32 bytes from a secret manager). Reject launch if absent.",
    verification: "Genuine vulnerability",
    genuineReasoning:
      "Independently exploitable: the known default key is sufficient to decrypt any " +
      "ciphertext produced when ENCRYPTION_KEY was unset, requiring no brute force.",
  },

  // --- Webhook Module ---

  {
    id: "F8",
    module: "Webhook Service",
    file: "src/services/webhookService.ts:9-23",
    owaspCategory: "A08 — Software and Data Integrity Failures",
    severity: "High",
    title: "Incoming webhooks accepted without HMAC signature verification",
    description:
      "handleIncomingWebhook processes any payload for a known webhookId without verifying " +
      "an HMAC-SHA256 signature against the webhook's stored secret. The Webhook schema " +
      "has a 'secret' field specifically for this purpose, but it is never used. An attacker " +
      "who knows any valid webhookId can forge arbitrary events.",
    attackVector:
      "Attacker sends POST /webhooks/<valid-id> with a crafted payload " +
      "{ event: 'task.deleted', payload: { taskId: '<uuid>' } }. " +
      "The server processes it as a legitimate event with no signature check.",
    recommendedFix:
      "Compute HMAC-SHA256 of the raw request body using webhook.secret and compare " +
      "against the X-Signature-256 header using timingSafeEqual. Reject with 401 on mismatch.",
    verification: "Genuine vulnerability",
    genuineReasoning:
      "The schema explicitly stores a signing secret that is never used for verification — " +
      "a clear implementation gap with a concrete, direct exploit path.",
  },

  // --- False Positive ---

  {
    id: "FP1",
    module: "Authentication",
    file: "src/routes/auth.ts",
    owaspCategory: "A07 — Identification and Authentication Failures",
    severity: "N/A",
    title: "[FALSE POSITIVE] No rate limiting on login endpoint",
    description:
      "The AI flagged the absence of brute-force rate limiting on POST /auth/login as a " +
      "High severity finding.",
    attackVector: "Unlimited login attempts allow password enumeration or brute force.",
    recommendedFix: "N/A — false positive",
    verification: "False positive",
    genuineReasoning:
      "Rate limiting is a hardening measure, not a code-level vulnerability. The exercise " +
      "instructions explicitly exclude 'Rate limiting or resource exhaustion issues' and " +
      "'A lack of hardening measures'. The code is not incorrect — it simply delegates " +
      "rate limiting to infrastructure (e.g. API gateway, reverse proxy), which is the " +
      "correct architectural pattern. No code change is required.",
  },
] as const;

// ---------------------------------------------------------------------------
// PART 2 — Three fixes: before/after code
// ---------------------------------------------------------------------------

export const fixes = [
  {
    id: "Fix 1",
    finding: "F6",
    title: "A02: Replace deprecated crypto.createCipher with createCipheriv + random IV",
    file: "src/services/cryptoUtils.ts",

    before: `
import crypto from "crypto";

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
}`,

    after: `
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-encryption-key";

// Derive a fixed-length 32-byte key so AES-256 always receives the right key size.
const KEY_BUFFER = Buffer.from(
  crypto.createHash("sha256").update(ENCRYPTION_KEY).digest(),
);

export function encryptApiKey(apiKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", KEY_BUFFER, iv);
  let encrypted = cipher.update(apiKey, "utf8", "hex");
  encrypted += cipher.final("hex");
  // Prepend IV so decryption is self-contained: "<iv-hex>:<ciphertext-hex>"
  return iv.toString("hex") + ":" + encrypted;
}

export function decryptApiKey(encrypted: string): string {
  const separatorIndex = encrypted.indexOf(":");
  const ivHex = encrypted.slice(0, separatorIndex);
  const ciphertext = encrypted.slice(separatorIndex + 1);
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", KEY_BUFFER, iv);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}`,

    explanation:
      "createCipher used EVP_BytesToKey with a static zero IV — encryption was fully " +
      "deterministic, meaning identical plaintexts produced identical ciphertexts and the " +
      "effective IV was always 0x00*16. The fix generates a cryptographically random 16-byte " +
      "IV per encryption call using crypto.randomBytes(16) and stores it as a hex prefix " +
      "(iv:ciphertext). Each encryption call now produces a unique ciphertext even for the " +
      "same plaintext. The key is derived via SHA-256 to ensure the correct 32-byte key " +
      "size for AES-256-CBC.",
  },
  {
    id: "Fix 2",
    finding: "F3",
    title: "A01: Replace Prisma.TaskUpdateInput with explicit field allowlist in updateTask",
    file: "src/services/taskService.ts",

    before: `
export async function updateTask(id: string, data: Prisma.TaskUpdateInput) {
  const task = await prisma.task.update({
    where: { id },
    data: { ...data, updatedAt: new Date() },
  });
  return task;
}`,

    after: `
type TaskUpdateFields = {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  dueDate?: string | Date | null;
};

export async function updateTask(id: string, data: TaskUpdateFields) {
  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.assigneeId !== undefined && { assigneeId: data.assigneeId }),
      ...(data.dueDate !== undefined && {
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      }),
      updatedAt: new Date(),
    },
  });
  return task;
}`,

    explanation:
      "The original function accepted Prisma.TaskUpdateInput — the ORM's own type — and " +
      "spread req.body directly into it. This allowed any Prisma-valid field to be set: " +
      "createdById, projectId, or even nested relation operations like " +
      "{ comments: { deleteMany: {} } }. The fix defines a narrow TaskUpdateFields type " +
      "containing only the six fields a user is permitted to change. Conditional spreading " +
      "ensures only keys actually present in the input are forwarded to Prisma, preventing " +
      "any server-controlled field from being overwritten via the API.",
  },
  {
    id: "Fix 3",
    finding: "F5",
    title: "A01: Add workspace membership check to GET /attachments/:id",
    file: "src/routes/attachments.ts",

    before: `
attachmentRouter.get("/:id", authenticate, async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id },
    });

    if (!attachment) {
      res.status(404).json({ error: { message: "Attachment not found" } });
      return;
    }

    res.json({ data: attachment });
  } catch (error) {
    next(error);
  }
});`,

    after: `
attachmentRouter.get("/:id", authenticate, async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id },
      include: { task: { include: { project: true } } },
    });

    if (!attachment) {
      res.status(404).json({ error: { message: "Attachment not found" } });
      return;
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: req.user!.id,
          workspaceId: attachment.task.project.workspaceId,
        },
      },
    });

    if (!membership) {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    const { task: _, ...attachmentData } = attachment;
    res.json({ data: attachmentData });
  } catch (error) {
    next(error);
  }
});`,

    explanation:
      "The original endpoint returned any attachment to any authenticated user with no " +
      "ownership check — a classic IDOR. The fix traverses the " +
      "attachment → task → project → workspace chain included in the initial Prisma query " +
      "(no extra round-trip for the attachment fetch), then performs a second lookup to " +
      "verify the calling user holds a WorkspaceMember record for that workspace. " +
      "If not, 403 is returned. The task relation is stripped from the response before " +
      "sending so the join data is never exposed to the client.",
  },
] as const;

// ---------------------------------------------------------------------------
// PART 3 — Security tests (see tests/security.test.ts for runnable code)
// ---------------------------------------------------------------------------

export const securityTests = {
  testFile: "tests/security.test.ts",
  testResults: {
    totalTests: 40,
    passed: 40,
    failed: 0,
    command: "npm test",
    files: ["tests/health.test.ts (1)", "tests/tasks.test.ts (27)", "tests/security.test.ts (12)"],
  },

  fix1CryptoTests: [
    {
      name: "round-trip: decrypts back to the original plaintext",
      rationale:
        "Verifies the new IV-prepended format is correctly parsed by decryptApiKey — " +
        "confirms the fix does not break the basic encryption/decryption contract.",
    },
    {
      name: "produces different ciphertexts for the same plaintext on each call",
      rationale:
        "The key regression test for Fix 1. Pre-fix (zero IV), identical plaintexts " +
        "produced identical ciphertexts. This test would FAIL on the pre-fix code.",
    },
    {
      name: "ciphertext encodes the IV as a 32-char hex prefix separated by ':'",
      rationale:
        "Locks in the storage format so any future refactor preserving the format " +
        "remains compatible with existing stored ciphertexts.",
    },
    {
      name: "different plaintexts produce ciphertexts with different IVs",
      rationale:
        "Confirms IVs are random (not derived from plaintext), ruling out a weak " +
        "deterministic IV scheme that would still produce the zero-IV vulnerability.",
    },
  ],

  fix2MassAssignmentTests: [
    {
      name: "does not forward createdById from request body to Prisma",
      rationale:
        "Directly tests the ownership-reassignment attack vector. Asserts the exact " +
        "Prisma call arguments do not include createdById. Would FAIL on pre-fix code.",
    },
    {
      name: "does not forward projectId from request body to Prisma",
      rationale:
        "Tests the cross-project move attack vector. Confirms projectId is stripped " +
        "from the update payload.",
    },
    {
      name: "still forwards allowed fields (title, status, priority)",
      rationale:
        "Guards against over-correction — ensures the allowlist does not accidentally " +
        "block legitimate updates.",
    },
    {
      name: "strips unknown/arbitrary keys from the update payload",
      rationale:
        "Confirms unknown fields like isAdmin are silently dropped rather than " +
        "passed through to Prisma.",
    },
  ],

  fix3AttachmentIDORTests: [
    {
      name: "returns 403 when the requesting user is not a workspace member",
      rationale:
        "Core regression test. Would FAIL on pre-fix code (returned 200 with full " +
        "attachment data). Confirms non-members are blocked.",
    },
    {
      name: "returns 200 and the attachment when the user is a workspace member",
      rationale:
        "Guards against over-correction — confirms legitimate access is still granted.",
    },
    {
      name: "checks membership against the correct workspace derived from the attachment's task",
      rationale:
        "Verifies the authorization check traverses the correct chain " +
        "(attachment → task → project → workspace) and calls WorkspaceMember.findUnique " +
        "with the right workspaceId.",
    },
    {
      name: "still returns 404 for non-existent attachment before reaching the auth check",
      rationale:
        "Confirms the 404 short-circuit happens before the membership query — " +
        "avoids an unnecessary database call and preserves correct status codes.",
    },
  ],
} as const;
