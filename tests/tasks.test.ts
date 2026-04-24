import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any imports that pull in the real modules.
// ---------------------------------------------------------------------------

const TEST_USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROJECT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const TASK_ID_1 = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const TASK_ID_2 = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

vi.mock("../src/middleware/authenticate.js", () => ({
  authenticate: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: unknown }).user = {
      id: TEST_USER_ID,
      email: "test@tundraboard.dev",
      displayName: "Test User",
    };
    next();
  },
}));

const mockPrisma = {
  $queryRaw: vi.fn(),
  workspaceMember: { findUnique: vi.fn() },
  project: { findUnique: vi.fn() },
  task: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("../src/utils/prisma.js", () => ({ prisma: mockPrisma }));

// App must be imported AFTER mocks are set up.
const { app } = await import("../src/app.js");

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const membershipAdmin = {
  id: "mem-1",
  userId: TEST_USER_ID,
  workspaceId: WORKSPACE_ID,
  role: "admin",
  joinedAt: new Date(),
};

const membershipViewer = { ...membershipAdmin, role: "viewer" };

const project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  title: "Test Project",
  description: null,
  status: "active",
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TASK_ID_1,
    title: "Fix the bug",
    description: "Details here",
    status: "todo",
    priority: "high",
    assigneeId: null,
    projectId: PROJECT_ID,
    createdById: TEST_USER_ID,
    dueDate: null,
    createdAt: new Date("2026-04-10T12:00:00Z"),
    updatedAt: new Date("2026-04-10T12:00:00Z"),
    assignee: null,
    taskLabels: [],
    comments: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /tasks
// ---------------------------------------------------------------------------

describe("POST /tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.project.findUnique.mockResolvedValue(project);
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(membershipAdmin);
    mockPrisma.task.create.mockResolvedValue(makeTask());
  });

  it("creates a task and returns 201 with data", async () => {
    const res = await request(app).post("/tasks").send({
      projectId: PROJECT_ID,
      title: "Fix the bug",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(TASK_ID_1);
    expect(res.body.data.title).toBe("Fix the bug");
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(app).post("/tasks").send({ projectId: PROJECT_ID });
    expect(res.status).toBe(400);
  });

  it("returns 400 when projectId is not a UUID", async () => {
    const res = await request(app).post("/tasks").send({ projectId: "not-a-uuid", title: "T" });
    expect(res.status).toBe(400);
  });

  it("returns 422 when project does not exist", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/tasks").send({ projectId: PROJECT_ID, title: "T" });
    expect(res.status).toBe(422);
  });

  it("returns 403 when user is not a workspace member", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/tasks").send({ projectId: PROJECT_ID, title: "T" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when user is a viewer", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(membershipViewer);
    const res = await request(app).post("/tasks").send({ projectId: PROJECT_ID, title: "T" });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /tasks (advanced search)
// ---------------------------------------------------------------------------

describe("GET /tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(membershipAdmin);
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.task.findMany.mockResolvedValue([]);
  });

  it("returns empty result when no tasks match", async () => {
    const res = await request(app).get("/tasks").query({ workspaceId: WORKSPACE_ID });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  it("returns 400 when workspaceId is missing", async () => {
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(400);
  });

  it("returns 400 when workspaceId is not a UUID", async () => {
    const res = await request(app).get("/tasks").query({ workspaceId: "bad-id" });
    expect(res.status).toBe(400);
  });

  it("returns 403 when user is not a workspace member", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);
    const res = await request(app).get("/tasks").query({ workspaceId: WORKSPACE_ID });
    expect(res.status).toBe(403);
  });

  it("returns tasks for the workspace", async () => {
    const task = makeTask();
    mockPrisma.$queryRaw.mockResolvedValue([{ id: TASK_ID_1 }]);
    mockPrisma.task.findMany.mockResolvedValue([task]);

    const res = await request(app).get("/tasks").query({ workspaceId: WORKSPACE_ID });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(TASK_ID_1);
  });

  it("filters by projectId", async () => {
    const res = await request(app)
      .get("/tasks")
      .query({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID });
    expect(res.status).toBe(200);
    // The raw SQL mock receives projectId — we verify the call was made
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it("filters by single status", async () => {
    const res = await request(app)
      .get("/tasks")
      .query({ workspaceId: WORKSPACE_ID, status: "todo" });
    expect(res.status).toBe(200);
  });

  it("filters by multiple statuses (repeated param)", async () => {
    const res = await request(app)
      .get("/tasks")
      .query({
        workspaceId: WORKSPACE_ID,
        status: ["todo", "in_progress"],
      });
    expect(res.status).toBe(200);
  });

  it("filters by priority", async () => {
    const res = await request(app)
      .get("/tasks")
      .query({ workspaceId: WORKSPACE_ID, priority: "high" });
    expect(res.status).toBe(200);
  });

  it("filters by multiple priorities", async () => {
    const res = await request(app)
      .get("/tasks")
      .query({
        workspaceId: WORKSPACE_ID,
        priority: ["high", "urgent"],
      });
    expect(res.status).toBe(200);
  });

  it("filters by assigneeId", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      assigneeId: TEST_USER_ID,
    });
    expect(res.status).toBe(200);
  });

  it("filters by labelIds (single)", async () => {
    const labelId = "11111111-1111-1111-1111-111111111111";
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      labelIds: labelId,
    });
    expect(res.status).toBe(200);
  });

  it("filters by dueBefore", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      dueBefore: "2026-05-01T00:00:00.000Z",
    });
    expect(res.status).toBe(200);
  });

  it("filters by dueAfter", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      dueAfter: "2026-04-01T00:00:00.000Z",
    });
    expect(res.status).toBe(200);
  });

  it("accepts q (full-text search term)", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      q: "bug authentication",
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid q (empty string)", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      q: "",
    });
    expect(res.status).toBe(400);
  });

  it("sorts by updatedAt", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      sortBy: "updatedAt",
    });
    expect(res.status).toBe(200);
  });

  it("sorts by dueDate asc", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      sortBy: "dueDate",
      sortOrder: "asc",
    });
    expect(res.status).toBe(200);
  });

  it("sorts by priority desc", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      sortBy: "priority",
      sortOrder: "desc",
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid sortBy value", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      sortBy: "nonexistent",
    });
    expect(res.status).toBe(400);
  });

  it("caps limit at 100", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      limit: "200",
    });
    expect(res.status).toBe(400); // zod max(100) rejects 200
  });

  it("returns 400 for limit=0", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      limit: "0",
    });
    expect(res.status).toBe(400);
  });

  // --- Cursor pagination ---

  it("sets hasMore=true and nextCursor when more results exist", async () => {
    const task1 = makeTask({ id: TASK_ID_1 });
    const task2 = makeTask({ id: TASK_ID_2, createdAt: new Date("2026-04-09T12:00:00Z") });

    // Fetch limit=1, so we request 2 from DB; DB returns 2 → hasMore=true
    mockPrisma.$queryRaw.mockResolvedValue([{ id: TASK_ID_1 }, { id: TASK_ID_2 }]);
    mockPrisma.task.findMany.mockResolvedValue([task1]);

    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      limit: "1",
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.hasMore).toBe(true);
    expect(typeof res.body.nextCursor).toBe("string");
    expect(res.body.nextCursor.length).toBeGreaterThan(10);
    void task2; // suppress unused variable warning
  });

  it("sets hasMore=false and nextCursor=null on the last page", async () => {
    const task = makeTask();
    // DB returns exactly limit items → no extra item → hasMore=false
    mockPrisma.$queryRaw.mockResolvedValue([{ id: TASK_ID_1 }]);
    mockPrisma.task.findMany.mockResolvedValue([task]);

    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      limit: "1",
    });

    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  it("accepts a valid cursor without error", async () => {
    // Construct a valid base64url cursor manually
    const cursorPayload = {
      id: TASK_ID_1,
      createdAt: "2026-04-10T12:00:00.000Z",
    };
    const cursor = Buffer.from(JSON.stringify(cursorPayload), "utf8").toString("base64url");

    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      cursor,
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 for a malformed cursor", async () => {
    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      cursor: "this-is-not-valid-base64url-json!!!",
    });
    expect(res.status).toBe(400);
  });

  it("nextCursor encodes a decodable JSON with id and createdAt", async () => {
    const task = makeTask();
    mockPrisma.$queryRaw.mockResolvedValue([{ id: TASK_ID_1 }, { id: TASK_ID_2 }]);
    mockPrisma.task.findMany.mockResolvedValue([task]);

    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      limit: "1",
    });

    const decoded = JSON.parse(
      Buffer.from(res.body.nextCursor as string, "base64url").toString("utf8"),
    );
    expect(decoded.id).toBe(TASK_ID_1);
    expect(decoded.createdAt).toBe("2026-04-10T12:00:00.000Z");
  });

  it("cursor for dueDate sort encodes dueDate field", async () => {
    const due = new Date("2026-05-01T00:00:00Z");
    const task = makeTask({ dueDate: due });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: TASK_ID_1 }, { id: TASK_ID_2 }]);
    mockPrisma.task.findMany.mockResolvedValue([task]);

    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      sortBy: "dueDate",
      limit: "1",
    });

    const decoded = JSON.parse(
      Buffer.from(res.body.nextCursor as string, "base64url").toString("utf8"),
    );
    expect(decoded.dueDate).toBe(due.toISOString());
  });

  it("cursor for priority sort encodes priorityRank", async () => {
    const task = makeTask({ priority: "urgent" });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: TASK_ID_1 }, { id: TASK_ID_2 }]);
    mockPrisma.task.findMany.mockResolvedValue([task]);

    const res = await request(app).get("/tasks").query({
      workspaceId: WORKSPACE_ID,
      sortBy: "priority",
      limit: "1",
    });

    const decoded = JSON.parse(
      Buffer.from(res.body.nextCursor as string, "base64url").toString("utf8"),
    );
    expect(decoded.priorityRank).toBe(4); // urgent = 4
  });
});

// ---------------------------------------------------------------------------
// GET /tasks/:id
// ---------------------------------------------------------------------------

describe("GET /tasks/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(membershipAdmin);
    mockPrisma.project.findUnique.mockResolvedValue(project);
    mockPrisma.task.findUnique.mockResolvedValue(makeTask());
  });

  it("returns task detail", async () => {
    const res = await request(app).get(`/tasks/${TASK_ID_1}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(TASK_ID_1);
  });

  it("returns 404 when task does not exist", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/tasks/${TASK_ID_1}`);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not a workspace member", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/tasks/${TASK_ID_1}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /tasks/:id
// ---------------------------------------------------------------------------

describe("PATCH /tasks/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(membershipAdmin);
    mockPrisma.project.findUnique.mockResolvedValue(project);
    mockPrisma.task.findUnique.mockResolvedValue(makeTask());
    mockPrisma.task.update.mockResolvedValue(makeTask({ status: "in_progress" }));
  });

  it("updates a task and returns the updated data", async () => {
    const res = await request(app).patch(`/tasks/${TASK_ID_1}`).send({ status: "in_progress" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("in_progress");
  });

  it("returns 400 for invalid status value", async () => {
    const res = await request(app).patch(`/tasks/${TASK_ID_1}`).send({ status: "invalid_status" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when task does not exist", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    const res = await request(app).patch(`/tasks/${TASK_ID_1}`).send({ status: "done" });
    expect(res.status).toBe(404);
  });

  it("returns 403 for viewers", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(membershipViewer);
    const res = await request(app).patch(`/tasks/${TASK_ID_1}`).send({ status: "done" });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// DELETE /tasks/:id
// ---------------------------------------------------------------------------

describe("DELETE /tasks/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(membershipAdmin);
    mockPrisma.project.findUnique.mockResolvedValue(project);
    mockPrisma.task.findUnique.mockResolvedValue(makeTask());
    mockPrisma.task.delete.mockResolvedValue(undefined);
  });

  it("deletes the task and returns 204", async () => {
    const res = await request(app).delete(`/tasks/${TASK_ID_1}`);
    expect(res.status).toBe(204);
  });

  it("returns 404 when task does not exist", async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    const res = await request(app).delete(`/tasks/${TASK_ID_1}`);
    expect(res.status).toBe(404);
  });

  it("returns 403 for viewers", async () => {
    mockPrisma.workspaceMember.findUnique.mockResolvedValue(membershipViewer);
    const res = await request(app).delete(`/tasks/${TASK_ID_1}`);
    expect(res.status).toBe(403);
  });
});
