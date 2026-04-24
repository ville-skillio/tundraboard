import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate.js";
import { prisma } from "../utils/prisma.js";
import {
  createTask,
  getTask,
  updateTask,
  deleteTask,
  searchTasks,
} from "../services/taskService.js";

export const taskRouter = Router();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const STATUS_VALUES = ["todo", "in_progress", "done", "cancelled"] as const;
const PRIORITY_VALUES = ["low", "medium", "high", "urgent"] as const;

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  assigneeId: z.string().uuid().optional(),
  dueDate: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .transform((v) => {
      if (v === null) return null;
      if (v === undefined) return undefined;
      return new Date(v);
    }),
});

// Query params: Express may deliver a repeated param as string[] already;
// coerce single string to array so callers can always use array form.
function toArray<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]),
    z.array(schema).optional(),
  );
}

const searchSchema = z.object({
  workspaceId: z.string().uuid(),
  q: z.string().min(1).max(200).optional(),
  projectId: z.string().uuid().optional(),
  status: toArray(z.enum(STATUS_VALUES)),
  priority: toArray(z.enum(PRIORITY_VALUES)),
  assigneeId: z.string().uuid().optional(),
  labelIds: toArray(z.string().uuid()),
  dueBefore: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  dueAfter: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  sortBy: z.enum(["createdAt", "updatedAt", "dueDate", "priority"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

async function getMembership(userId: string, workspaceId: string) {
  return prisma.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
}

// ---------------------------------------------------------------------------
// POST /tasks — create a task
// ---------------------------------------------------------------------------

taskRouter.post("/", authenticate, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: { message: "Validation failed", issues: parsed.error.issues } });
      return;
    }
    const { projectId, title, description, priority, assigneeId, dueDate } = parsed.data;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      res.status(422).json({ error: { message: "Project not found" } });
      return;
    }

    const membership = await getMembership(req.user!.id, project.workspaceId);
    if (!membership || membership.role === "viewer") {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    const task = await createTask({
      projectId,
      title,
      description,
      priority,
      assigneeId,
      dueDate,
      createdById: req.user!.id,
    });
    res.status(201).json({ data: task });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /tasks — advanced search
// ---------------------------------------------------------------------------

taskRouter.get("/", authenticate, async (req, res, next) => {
  try {
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: { message: "Validation failed", issues: parsed.error.issues } });
      return;
    }
    const params = parsed.data;

    const membership = await getMembership(req.user!.id, params.workspaceId);
    if (!membership) {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    const result = await searchTasks(params);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /tasks/:id — task detail with comments
// ---------------------------------------------------------------------------

taskRouter.get("/:id", authenticate, async (req, res, next) => {
  try {
    const task = await getTask(req.params.id as string);
    if (!task) {
      res.status(404).json({ error: { message: "Task not found" } });
      return;
    }

    // Verify workspace membership via the task's project
    const project = await prisma.project.findUnique({ where: { id: task.projectId } });
    if (!project) {
      res.status(404).json({ error: { message: "Task not found" } });
      return;
    }

    const membership = await getMembership(req.user!.id, project.workspaceId);
    if (!membership) {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    res.json({ data: task });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PATCH /tasks/:id — partial update
// ---------------------------------------------------------------------------

taskRouter.patch("/:id", authenticate, async (req, res, next) => {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: { message: "Validation failed", issues: parsed.error.issues } });
      return;
    }

    const existing = await getTask(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: { message: "Task not found" } });
      return;
    }

    const project = await prisma.project.findUnique({ where: { id: existing.projectId } });
    if (!project) {
      res.status(404).json({ error: { message: "Task not found" } });
      return;
    }

    const membership = await getMembership(req.user!.id, project.workspaceId);
    if (!membership || membership.role === "viewer") {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    const task = await updateTask(req.params.id as string, parsed.data);
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /tasks/:id
// ---------------------------------------------------------------------------

taskRouter.delete("/:id", authenticate, async (req, res, next) => {
  try {
    const existing = await getTask(req.params.id as string);
    if (!existing) {
      res.status(404).json({ error: { message: "Task not found" } });
      return;
    }

    const project = await prisma.project.findUnique({ where: { id: existing.projectId } });
    if (!project) {
      res.status(404).json({ error: { message: "Task not found" } });
      return;
    }

    const membership = await getMembership(req.user!.id, project.workspaceId);
    if (!membership || membership.role === "viewer") {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    await deleteTask(req.params.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
