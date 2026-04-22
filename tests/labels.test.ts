import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { prisma } from "../src/utils/prisma.js";

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    label: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    taskLabel: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    workspaceMember: {
      findUnique: vi.fn(),
    },
  },
}));

const JWT_SECRET = "change-me-to-a-real-secret-in-production";

function makeToken(userId = "user-1") {
  return jwt.sign({ userId, email: "test@example.com" }, JWT_SECRET, { expiresIn: "1h" });
}

const MEMBER = {
  id: "m-1",
  userId: "user-1",
  workspaceId: "ws-1",
  role: "member",
  joinedAt: new Date(),
};
const ADMIN = { ...MEMBER, role: "admin" };
const MOCK_LABEL = {
  id: "label-1",
  workspaceId: "ws-1",
  name: "Bug",
  colour: "#EF4444",
  createdAt: new Date(),
};

describe("Label Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // POST /labels
  // ---------------------------------------------------------------------------

  describe("POST /labels", () => {
    it("creates a label and returns 201 for a workspace member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(MEMBER);
      vi.mocked(prisma.label.create).mockResolvedValue(MOCK_LABEL);

      const res = await request(app)
        .post("/labels")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ name: "Bug", colour: "#EF4444", workspaceId: "ws-1" })
        .expect(201);

      expect(res.body.data).toHaveProperty("id", "label-1");
    });

    it("returns 403 when the user is not a workspace member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      const res = await request(app)
        .post("/labels")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ name: "Bug", workspaceId: "ws-1" })
        .expect(403);

      expect(res.body.error.message).toMatch(/access denied/i);
    });

    it("returns 401 without a token", async () => {
      await request(app).post("/labels").send({ name: "Bug", workspaceId: "ws-1" }).expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /labels
  // ---------------------------------------------------------------------------

  describe("GET /labels?workspaceId=", () => {
    it("returns the list of labels for a workspace member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(MEMBER);
      vi.mocked(prisma.label.findMany).mockResolvedValue([MOCK_LABEL]);

      const res = await request(app)
        .get("/labels?workspaceId=ws-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toHaveProperty("name", "Bug");
    });

    it("returns 403 when the user is not a member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      await request(app)
        .get("/labels?workspaceId=ws-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /labels/:id
  // ---------------------------------------------------------------------------

  describe("PATCH /labels/:id", () => {
    it("updates a label when the user is a member", async () => {
      vi.mocked(prisma.label.findUnique).mockResolvedValue(MOCK_LABEL);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(MEMBER);
      vi.mocked(prisma.label.update).mockResolvedValue({ ...MOCK_LABEL, name: "Feature" });

      const res = await request(app)
        .patch("/labels/label-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ name: "Feature" })
        .expect(200);

      expect(res.body.data.name).toBe("Feature");
    });

    it("returns 404 when the label does not exist", async () => {
      vi.mocked(prisma.label.findUnique).mockResolvedValue(null);

      await request(app)
        .patch("/labels/nonexistent")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ name: "X" })
        .expect(404);
    });

    it("returns 403 when the user is a viewer", async () => {
      vi.mocked(prisma.label.findUnique).mockResolvedValue(MOCK_LABEL);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ ...MEMBER, role: "viewer" });

      await request(app)
        .patch("/labels/label-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ name: "X" })
        .expect(403);
    });

    it("does not forward unknown fields to Prisma (no mass assignment)", async () => {
      vi.mocked(prisma.label.findUnique).mockResolvedValue(MOCK_LABEL);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(ADMIN);
      vi.mocked(prisma.label.update).mockResolvedValue(MOCK_LABEL);

      await request(app)
        .patch("/labels/label-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ name: "Bug", workspaceId: "attacker-ws", id: "evil-id" })
        .expect(200);

      const callArg = vi.mocked(prisma.label.update).mock.calls[0][0] as unknown as {
        data: Record<string, unknown>;
      };
      expect(callArg.data).not.toHaveProperty("workspaceId");
      expect(callArg.data).not.toHaveProperty("id");
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /labels/:id
  // ---------------------------------------------------------------------------

  describe("DELETE /labels/:id", () => {
    it("deletes a label and returns 204 for a member", async () => {
      vi.mocked(prisma.label.findUnique).mockResolvedValue(MOCK_LABEL);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(MEMBER);
      vi.mocked(prisma.label.delete).mockResolvedValue(MOCK_LABEL);

      await request(app)
        .delete("/labels/label-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(204);
    });

    it("returns 403 for a non-member (IDOR prevention)", async () => {
      vi.mocked(prisma.label.findUnique).mockResolvedValue(MOCK_LABEL);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      await request(app)
        .delete("/labels/label-1")
        .set("Authorization", `Bearer ${makeToken("outsider")}`)
        .expect(403);

      expect(prisma.label.delete).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // POST /labels/:id/tasks/:taskId — apply label
  // ---------------------------------------------------------------------------

  describe("POST /labels/:id/tasks/:taskId", () => {
    it("applies a label to a task and returns 201", async () => {
      const taskLabel = { taskId: "task-1", labelId: "label-1" };
      vi.mocked(prisma.taskLabel.create).mockResolvedValue(taskLabel);

      const res = await request(app)
        .post("/labels/label-1/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(201);

      expect(res.body.data).toMatchObject(taskLabel);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /labels/:id/tasks/:taskId — remove label
  // ---------------------------------------------------------------------------

  describe("DELETE /labels/:id/tasks/:taskId", () => {
    it("removes a label from a task and returns 204", async () => {
      vi.mocked(prisma.taskLabel.delete).mockResolvedValue({
        taskId: "task-1",
        labelId: "label-1",
      });

      await request(app)
        .delete("/labels/label-1/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(204);
    });
  });
});
