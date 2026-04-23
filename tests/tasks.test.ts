import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { prisma } from "../src/utils/prisma.js";

// ---------------------------------------------------------------------------
// Prisma mock — keeps tests fast and DB-free
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

function makeExpiredToken() {
  const expiredAt = Math.floor(Date.now() / 1000) - 3600;
  return jwt.sign({ userId: "user-1", email: "test@example.com", exp: expiredAt }, JWT_SECRET);
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

// ---------------------------------------------------------------------------

describe("Task Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // REGRESSION TESTS
  // Each one would have FAILED on the pre-fix code and PASSES on post-fix.
  // Proof of revert-failure is documented inline.
  // =========================================================================

  describe("Regression Fix 1 — SQL injection in searchTasks", () => {
    // PRE-FIX BEHAVIOUR: searchTasks built a WHERE clause by string-concatenating
    // user input and called prisma.$queryRawUnsafe(). On the pre-fix code both
    // assertions below would fail: $queryRawUnsafe would be called (first test),
    // and findMany would not be called with parameterised args (second test).

    it("never calls $queryRawUnsafe regardless of search input", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);
      const token = makeToken();

      await request(app)
        .get("/tasks?projectId=proj-1&search=' OR '1'='1")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it("passes the search term as a value inside the Prisma where clause, not a raw string", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);
      const token = makeToken();
      const injection = "'; DROP TABLE tasks; --";

      await request(app)
        .get(`/tasks?projectId=proj-1&search=${encodeURIComponent(injection)}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                title: expect.objectContaining({ contains: injection }),
              }),
            ]),
          }),
        }),
      );
    });
  });

  describe("Regression Fix 2 — expired JWT accepted (ignoreExpiration: true)", () => {
    // PRE-FIX BEHAVIOUR: authenticate.ts called jwt.verify with
    // { ignoreExpiration: true }, so an expired token was accepted and the
    // request proceeded to the service layer, returning 200.
    // On the pre-fix code the first test below would receive 200, not 401.

    it("rejects an expired token with 401", async () => {
      const expired = makeExpiredToken();

      const res = await request(app)
        .get("/tasks?projectId=proj-1")
        .set("Authorization", `Bearer ${expired}`)
        .expect(401);

      expect(res.body).toHaveProperty("error");
    });

    it("still accepts a valid non-expired token", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);
    });
  });

  describe("Regression Fix 3 — express-content-sanitizer crash on createTask", () => {
    // PRE-FIX BEHAVIOUR: taskService.ts imported sanitizeHtml from
    // 'express-content-sanitizer', a package absent from package.json.
    // In production Node.js, this throws "Cannot find module" at load time,
    // returning 500 for every task request. In Vitest's Vite-based module
    // sandbox, the missing import silently resolves to an empty module rather
    // than crashing — so the module-load crash cannot be caught by this test
    // environment. Instead, these tests lock in the correct POST behaviour
    // (description forwarded to Prisma unchanged, 201 returned), which would
    // break if sanitizeHtml were defined and mangling the value.

    it("creates a task with a description and returns 201", async () => {
      vi.mocked(prisma.task.create).mockResolvedValue(MOCK_TASK);

      const res = await request(app)
        .post("/tasks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "Task with description", description: "Some details", projectId: "proj-1" })
        .expect(201);

      expect(res.body.data).toHaveProperty("id");
    });

    it("passes the description to prisma.task.create unchanged (no sanitisation applied)", async () => {
      vi.mocked(prisma.task.create).mockResolvedValue(MOCK_TASK);
      const rawDescription = "Plain text <b>description</b>";

      await request(app)
        .post("/tasks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "Task", description: rawDescription, projectId: "proj-1" })
        .expect(201);

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: rawDescription }),
        }),
      );
    });

    it("creates a task without a description without throwing", async () => {
      vi.mocked(prisma.task.create).mockResolvedValue(MOCK_TASK);

      await request(app)
        .post("/tasks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "No description", projectId: "proj-1" })
        .expect(201);
    });
  });

  // =========================================================================
  // AUTHENTICATION
  // =========================================================================

  describe("Authentication guard", () => {
    it("returns 401 when Authorization header is absent", async () => {
      await request(app).get("/tasks?projectId=proj-1").expect(401);
    });

    it("returns 401 when token is malformed", async () => {
      await request(app)
        .get("/tasks?projectId=proj-1")
        .set("Authorization", "Bearer not-a-jwt")
        .expect(401);
    });

    it("returns 401 when Bearer prefix is missing", async () => {
      await request(app)
        .get("/tasks?projectId=proj-1")
        .set("Authorization", makeToken())
        .expect(401);
    });

    it("returns 401 when token is signed with the wrong secret", async () => {
      const wrongToken = jwt.sign({ userId: "u1", email: "a@b.com" }, "wrong-secret");

      await request(app)
        .get("/tasks?projectId=proj-1")
        .set("Authorization", `Bearer ${wrongToken}`)
        .expect(401);
    });
  });

  // =========================================================================
  // POST /tasks — create task
  // =========================================================================

  describe("POST /tasks", () => {
    it("returns 201 and the new task on success", async () => {
      vi.mocked(prisma.task.create).mockResolvedValue(MOCK_TASK);

      const res = await request(app)
        .post("/tasks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "New task", projectId: "proj-1" })
        .expect(201);

      expect(res.body.data).toHaveProperty("id", "task-1");
      expect(res.body.data).toHaveProperty("title", "Test task");
    });

    it("derives createdById from the JWT, never from the request body", async () => {
      vi.mocked(prisma.task.create).mockResolvedValue(MOCK_TASK);

      await request(app)
        .post("/tasks")
        .set("Authorization", `Bearer ${makeToken("jwt-user-id")}`)
        .send({ title: "Task", projectId: "proj-1", createdById: "attacker-id" })
        .expect(201);

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ createdById: "jwt-user-id" }),
        }),
      );
    });

    it("defaults priority to 'medium' when omitted", async () => {
      vi.mocked(prisma.task.create).mockResolvedValue(MOCK_TASK);

      await request(app)
        .post("/tasks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "Task", projectId: "proj-1" })
        .expect(201);

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: "medium" }),
        }),
      );
    });

    it("forwards an explicit priority to Prisma", async () => {
      vi.mocked(prisma.task.create).mockResolvedValue({ ...MOCK_TASK, priority: "urgent" });

      await request(app)
        .post("/tasks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "Urgent task", projectId: "proj-1", priority: "urgent" })
        .expect(201);

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: "urgent" }),
        }),
      );
    });
  });

  // =========================================================================
  // GET /tasks/:id — get single task
  // =========================================================================

  describe("GET /tasks/:id", () => {
    it("returns 200 and the task when found", async () => {
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        ...MOCK_TASK,
        comments: [],
        taskLabels: [],
        project: { id: "proj-1", title: "My Project" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const res = await request(app)
        .get("/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(res.body.data).toHaveProperty("id", "task-1");
    });

    it("returns 404 when task does not exist", async () => {
      vi.mocked(prisma.task.findUnique).mockResolvedValue(null);

      const res = await request(app)
        .get("/tasks/nonexistent")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(404);

      expect(res.body.error.message).toMatch(/not found/i);
    });
  });

  // =========================================================================
  // GET /tasks — search / list tasks
  // =========================================================================

  describe("GET /tasks", () => {
    it("returns 200 with an array of tasks", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([MOCK_TASK]);

      const res = await request(app)
        .get("/tasks?projectId=proj-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it("defaults to page 1 and pageSize 20", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it("honours explicit page and pageSize", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1&page=3&pageSize=10")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it("forwards status filter to Prisma where clause", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1&status=done")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "done" }),
        }),
      );
    });

    it("forwards priority filter to Prisma where clause", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1&priority=high")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ priority: "high" }),
        }),
      );
    });

    it("omits OR search clause when no searchTerm is provided", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = vi.mocked(prisma.task.findMany).mock.calls[0][0] as any;
      expect(call.where).not.toHaveProperty("OR");
    });
  });

  // =========================================================================
  // PATCH /tasks/:id — update task
  // =========================================================================

  describe("PATCH /tasks/:id", () => {
    it("returns 200 and the updated task", async () => {
      vi.mocked(prisma.task.update).mockResolvedValue({ ...MOCK_TASK, title: "Updated" });

      const res = await request(app)
        .patch("/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "Updated" })
        .expect(200);

      expect(res.body.data).toHaveProperty("title", "Updated");
    });
  });

  // =========================================================================
  // DELETE /tasks/:id
  // =========================================================================

  describe("DELETE /tasks/:id", () => {
    it("returns 204 on successful deletion", async () => {
      vi.mocked(prisma.task.delete).mockResolvedValue(MOCK_TASK);

      await request(app)
        .delete("/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(204);
    });
  });

  // =========================================================================
  // MANUALLY WRITTEN — coverage gaps the AI missed
  // =========================================================================

  describe("Coverage gap 1 — page=0 boundary value", () => {
    // parseInt("0") === 0, which is falsy. The route does `|| 1`, so page=0
    // silently becomes page=1 (skip=0). This is arguably correct but the
    // behaviour should be locked in as a documented contract.
    it("treats page=0 as page 1 (skip=0) due to falsy fallback", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1&page=0")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    });
  });

  describe("Coverage gap 2 — SQL injection via assigneeId filter", () => {
    // The original bug covered all five filter params including assigneeId.
    // The two Fix 1 regression tests only verify searchTerm. This test locks
    // in that assigneeId is also parameterised in the post-fix code.
    it("passes a malicious assigneeId as a value, not interpolated SQL", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);
      const token = makeToken();
      const malicious = "'; DELETE FROM tasks WHERE '1'='1";

      await request(app)
        .get(`/tasks?projectId=proj-1&assigneeId=${encodeURIComponent(malicious)}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ assigneeId: malicious }),
        }),
      );
    });
  });

  // =========================================================================
  // estimatedHours — new field tests
  // =========================================================================

  describe("estimatedHours — POST /tasks", () => {
    it("stores estimatedHours when provided on creation", async () => {
      vi.mocked(prisma.task.create).mockResolvedValue({ ...MOCK_TASK, estimatedHours: 4.5 });

      const res = await request(app)
        .post("/tasks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "Task with estimate", projectId: "proj-1", estimatedHours: 4.5 })
        .expect(201);

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ estimatedHours: 4.5 }),
        }),
      );
      expect(res.body.data).toHaveProperty("estimatedHours", 4.5);
    });

    it("stores null for estimatedHours when not provided", async () => {
      vi.mocked(prisma.task.create).mockResolvedValue({ ...MOCK_TASK, estimatedHours: null });

      await request(app)
        .post("/tasks")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ title: "No estimate", projectId: "proj-1" })
        .expect(201);

      expect(prisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ estimatedHours: null }),
        }),
      );
    });
  });

  describe("estimatedHours — PATCH /tasks/:id", () => {
    it("updates estimatedHours when included in the patch body", async () => {
      vi.mocked(prisma.task.update).mockResolvedValue({ ...MOCK_TASK, estimatedHours: 8 });

      const res = await request(app)
        .patch("/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ estimatedHours: 8 })
        .expect(200);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ estimatedHours: 8 }),
        }),
      );
      expect(res.body.data).toHaveProperty("estimatedHours", 8);
    });

    it("clears estimatedHours when explicitly set to null", async () => {
      vi.mocked(prisma.task.update).mockResolvedValue({ ...MOCK_TASK, estimatedHours: null });

      await request(app)
        .patch("/tasks/task-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .send({ estimatedHours: null })
        .expect(200);

      expect(prisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ estimatedHours: null }),
        }),
      );
    });
  });

  describe("estimatedHours — GET /tasks filters and sorting", () => {
    it("applies minEstimatedHours filter as gte constraint", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1&minEstimatedHours=4")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            estimatedHours: expect.objectContaining({ gte: 4 }),
          }),
        }),
      );
    });

    it("applies maxEstimatedHours filter as lte constraint", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1&maxEstimatedHours=8")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            estimatedHours: expect.objectContaining({ lte: 8 }),
          }),
        }),
      );
    });

    it("combines min and max into a single estimatedHours range", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1&minEstimatedHours=2&maxEstimatedHours=10")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            estimatedHours: { gte: 2, lte: 10 },
          }),
        }),
      );
    });

    it("sorts by estimatedHours asc when sortBy=estimatedHours", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1&sortBy=estimatedHours")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ estimatedHours: "asc" }, { id: "asc" }],
        }),
      );
    });

    it("defaults to createdAt sort when sortBy is not estimatedHours", async () => {
      vi.mocked(prisma.task.findMany).mockResolvedValue([]);

      await request(app)
        .get("/tasks?projectId=proj-1")
        .set("Authorization", `Bearer ${makeToken()}`)
        .expect(200);

      expect(prisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        }),
      );
    });
  });
});
