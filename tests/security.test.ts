import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { prisma } from "../src/utils/prisma.js";
import { encryptApiKey, decryptApiKey } from "../src/services/cryptoUtils.js";

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    task: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    attachment: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JWT_SECRET = "change-me-to-a-real-secret-in-production";

function makeToken(userId = "user-1", email = "test@example.com") {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "1h" });
}

const MOCK_TASK = {
  id: "task-1",
  title: "Test task",
  description: null,
  status: "todo",
  priority: "medium",
  projectId: "project-1",
  assigneeId: null,
  createdById: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_ATTACHMENT = {
  id: "attachment-1",
  taskId: "task-1",
  fileName: "report.pdf",
  fileSize: 1024,
  mimeType: "application/pdf",
  storageKey: "uploads/report.pdf",
  uploadedBy: "user-1",
  createdAt: new Date(),
};

const MOCK_ATTACHMENT_WITH_RELATIONS = {
  ...MOCK_ATTACHMENT,
  task: {
    project: { workspaceId: "workspace-1" },
  },
};

// ---------------------------------------------------------------------------

describe("OWASP Security Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Fix 1 — A02 Cryptographic Failures: deprecated createCipher with zero IV
  // cryptoUtils.ts — replaced with createCipheriv + random IV
  // =========================================================================

  describe("Fix 1 — A02: cryptoUtils now uses random IV (non-deterministic encryption)", () => {
    it("round-trip: decrypts back to the original plaintext", () => {
      const original = "sk-live-abc123secretkey";
      expect(decryptApiKey(encryptApiKey(original))).toBe(original);
    });

    it("produces different ciphertexts for the same plaintext on each call", () => {
      const plaintext = "sk-live-abc123secretkey";
      const enc1 = encryptApiKey(plaintext);
      const enc2 = encryptApiKey(plaintext);
      // Pre-fix (createCipher with zero IV) these would be identical
      expect(enc1).not.toBe(enc2);
    });

    it("ciphertext encodes the IV as a hex prefix separated by ':'", () => {
      const enc = encryptApiKey("test-key");
      expect(enc).toContain(":");
      const ivHex = enc.split(":")[0];
      // 16 random bytes → 32 hex characters
      expect(ivHex).toHaveLength(32);
    });

    it("different plaintexts produce ciphertexts with different IVs (IVs are random, not derived from plaintext)", () => {
      const enc1 = encryptApiKey("key-one");
      const enc2 = encryptApiKey("key-two");
      const iv1 = enc1.split(":")[0];
      const iv2 = enc2.split(":")[0];
      // Statistically almost certain to differ since IVs are crypto.randomBytes
      expect(iv1).not.toBe(iv2);
    });
  });

  // =========================================================================
  // Fix 2 — A01 Broken Access Control: mass assignment via raw req.body
  // taskService.ts — updateTask now uses an explicit field allowlist
  // =========================================================================

  describe("Fix 2 — A01: updateTask field allowlist prevents mass assignment", () => {
    it("does not forward createdById from request body to Prisma", async () => {
      vi.mocked(prisma.task.update).mockResolvedValue(MOCK_TASK);

      await request(app)
        .patch("/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken("attacker-id")}`)
        .send({ title: "Updated title", createdById: "attacker-id" })
        .expect(200);

      const callArg = vi.mocked(prisma.task.update).mock.calls[0][0] as any;
      expect(callArg.data).not.toHaveProperty("createdById");
    });

    it("does not forward projectId from request body to Prisma", async () => {
      vi.mocked(prisma.task.update).mockResolvedValue(MOCK_TASK);

      await request(app)
        .patch("/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ projectId: "other-project" })
        .expect(200);

      const callArg = vi.mocked(prisma.task.update).mock.calls[0][0] as any;
      expect(callArg.data).not.toHaveProperty("projectId");
    });

    it("still forwards allowed fields (title, status, priority)", async () => {
      vi.mocked(prisma.task.update).mockResolvedValue({
        ...MOCK_TASK,
        title: "New title",
        status: "done",
        priority: "high",
      });

      await request(app)
        .patch("/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "New title", status: "done", priority: "high" })
        .expect(200);

      const callArg = vi.mocked(prisma.task.update).mock.calls[0][0] as any;
      expect(callArg.data).toMatchObject({
        title: "New title",
        status: "done",
        priority: "high",
      });
    });

    it("strips unknown/arbitrary keys from the update payload", async () => {
      vi.mocked(prisma.task.update).mockResolvedValue(MOCK_TASK);

      await request(app)
        .patch("/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "Ok", isAdmin: true, __proto__: { evil: true } })
        .expect(200);

      const callArg = vi.mocked(prisma.task.update).mock.calls[0][0] as any;
      expect(callArg.data).not.toHaveProperty("isAdmin");
    });
  });

  // =========================================================================
  // Fix 3 — A01 Broken Access Control: IDOR on GET /attachments/:id
  // attachments.ts — now verifies workspace membership before returning data
  // =========================================================================

  describe("Fix 3 — A01: GET /attachments/:id enforces workspace membership", () => {
    it("returns 403 when the requesting user is not a workspace member", async () => {
      vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
        MOCK_ATTACHMENT_WITH_RELATIONS as any,
      );
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      const res = await request(app)
        .get("/attachments/attachment-1")
        .set("Authorization", `Bearer ${makeToken("outsider-id")}`)
        .expect(403);

      expect(res.body.error.message).toMatch(/access denied/i);
    });

    it("returns 200 and the attachment when the user is a workspace member", async () => {
      vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
        MOCK_ATTACHMENT_WITH_RELATIONS as any,
      );
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        id: "member-1",
        userId: "user-1",
        workspaceId: "workspace-1",
        role: "member",
        joinedAt: new Date(),
      });

      const res = await request(app)
        .get("/attachments/attachment-1")
        .set("Authorization", `Bearer ${makeToken("user-1")}`)
        .expect(200);

      expect(res.body.data).toHaveProperty("id", "attachment-1");
    });

    it("checks membership against the correct workspace derived from the attachment's task", async () => {
      vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
        MOCK_ATTACHMENT_WITH_RELATIONS as any,
      );
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      await request(app)
        .get("/attachments/attachment-1")
        .set("Authorization", `Bearer ${makeToken("user-1")}`)
        .expect(403);

      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_workspaceId: {
              userId: "user-1",
              workspaceId: "workspace-1",
            },
          },
        }),
      );
    });

    it("still returns 404 for a non-existent attachment before reaching the auth check", async () => {
      vi.mocked(prisma.attachment.findUnique).mockResolvedValue(null);

      await request(app)
        .get("/attachments/nonexistent")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(404);

      expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
    });
  });
});
