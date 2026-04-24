/*
 * ============================================================================
 * PHASE 5 — Testing (prompt used)
 * ============================================================================
 *
 * PROMPT:
 * Generate Vitest tests for POST /tasks following TundraBoard's test
 * conventions. Here is the health test as a conventions example:
 * [health.test.ts pasted]
 *
 * The test suite must:
 * - Use Supertest against the real app object
 * - Mock ../src/utils/prisma.js with vi.mock so no database is needed
 * - Generate a valid JWT using the same JWT_SECRET set in the test env
 * - Cover: happy path (201), missing title (400), invalid projectId UUID (400),
 *   no auth header (401), project not found (404), viewer/non-member (403),
 *   assignee not in workspace (422)
 *
 * RESPONSE:
 * The AI produced a working draft. One adjustment made after review: the AI
 * imported prisma before vi.mock was declared, which caused the mock not to
 * apply. Fixed by moving the import below the vi.mock call and relying on
 * Vitest's automatic hoisting of vi.mock to the top of the module.
 * ============================================================================
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const TEST_SECRET = "test-secret";
process.env.JWT_SECRET = TEST_SECRET;

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
    task: { create: vi.fn() },
  },
}));

import { app } from "../src/app.js";
import { prisma } from "../src/utils/prisma.js";

const mockPrisma = prisma as {
  project: { findUnique: ReturnType<typeof vi.fn> };
  workspaceMember: { findFirst: ReturnType<typeof vi.fn> };
  task: { create: ReturnType<typeof vi.fn> };
};

const PROJECT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ASSIGNEE_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const mockProject = { id: PROJECT_ID, workspaceId: WORKSPACE_ID };
const mockMembership = { id: "m1", role: "member" };
const mockCreatedTask = {
  id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  title: "Build login page",
  description: null,
  status: "todo",
  priority: "medium",
  projectId: PROJECT_ID,
  assigneeId: null,
  createdById: USER_ID,
  dueDate: null,
  createdAt: new Date("2026-04-24T10:00:00Z"),
  updatedAt: new Date("2026-04-24T10:00:00Z"),
};

function makeToken(userId = USER_ID) {
  return jwt.sign(
    { id: userId, email: "test@example.com", displayName: "Test User" },
    TEST_SECRET,
    { expiresIn: "1h" },
  );
}

describe("POST /tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a task and returns 201 with the task object", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(mockProject);
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(mockMembership);
    mockPrisma.task.create.mockResolvedValue(mockCreatedTask);

    const res = await request(app)
      .post("/tasks")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ title: "Build login page", projectId: PROJECT_ID })
      .expect(201);

    expect(res.body).toHaveProperty("task");
    expect(res.body.task).toMatchObject({
      title: "Build login page",
      status: "todo",
      priority: "medium",
      projectId: PROJECT_ID,
    });
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(app)
      .post("/tasks")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ projectId: PROJECT_ID })
      .expect(400);

    expect(res.body.error.message).toBe("Validation failed");
    expect(res.body.error.issues).toBeDefined();
  });

  it("returns 400 when projectId is not a valid UUID", async () => {
    const res = await request(app)
      .post("/tasks")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ title: "Build login page", projectId: "not-a-uuid" })
      .expect(400);

    expect(res.body.error.message).toBe("Validation failed");
  });

  it("returns 400 when dueDate is in the past", async () => {
    const res = await request(app)
      .post("/tasks")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        title: "Build login page",
        projectId: PROJECT_ID,
        dueDate: "2020-01-01T00:00:00.000Z",
      })
      .expect(400);

    expect(res.body.error.message).toBe("Validation failed");
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/tasks")
      .send({ title: "Build login page", projectId: PROJECT_ID })
      .expect(401);

    expect(res.body.error.message).toBeDefined();
  });

  it("returns 404 when project does not exist", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post("/tasks")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ title: "Build login page", projectId: PROJECT_ID })
      .expect(404);

    expect(res.body.error.message).toBe("Project not found");
  });

  it("returns 403 when user is not a workspace admin or member", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(mockProject);
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/tasks")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ title: "Build login page", projectId: PROJECT_ID })
      .expect(403);

    expect(res.body.error.message).toContain("permission");
  });

  it("returns 422 when assigneeId is not a workspace member", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(mockProject);
    mockPrisma.workspaceMember.findFirst
      .mockResolvedValueOnce(mockMembership)
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/tasks")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ title: "Build login page", projectId: PROJECT_ID, assigneeId: ASSIGNEE_ID })
      .expect(422);

    expect(res.body.error.message).toBe("Assignee is not a member of this workspace");
  });

  it("sets priority to medium by default when not provided", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(mockProject);
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(mockMembership);
    mockPrisma.task.create.mockResolvedValue(mockCreatedTask);

    await request(app)
      .post("/tasks")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ title: "Build login page", projectId: PROJECT_ID })
      .expect(201);

    const createCall = mockPrisma.task.create.mock.calls[0][0];
    expect(createCall.data.priority).toBe("medium");
    expect(createCall.data.status).toBe("todo");
  });

  it("accepts a valid future dueDate", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(mockProject);
    mockPrisma.workspaceMember.findFirst.mockResolvedValue(mockMembership);
    mockPrisma.task.create.mockResolvedValue({ ...mockCreatedTask, dueDate: new Date(FUTURE_DATE) });

    const res = await request(app)
      .post("/tasks")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ title: "Build login page", projectId: PROJECT_ID, dueDate: FUTURE_DATE })
      .expect(201);

    expect(res.body.task).toHaveProperty("dueDate");
  });
});
