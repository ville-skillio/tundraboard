import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { prisma } from "../utils/prisma.js";

export const labelRouter = Router();

// Create label
labelRouter.post("/", authenticate, async (req, res, next) => {
  try {
    const { name, colour, workspaceId } = req.body as {
      name: string;
      colour?: string;
      workspaceId: string;
    };

    const membership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: req.user!.id, workspaceId } },
    });
    if (!membership) {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    const label = await prisma.label.create({
      data: { workspaceId, name, colour: colour ?? "#6B7280" },
    });
    res.status(201).json({ data: label });
  } catch (error) {
    next(error);
  }
});

// List labels for a workspace
labelRouter.get("/", authenticate, async (req, res, next) => {
  try {
    const workspaceId = String(req.query.workspaceId);

    const membership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: req.user!.id, workspaceId } },
    });
    if (!membership) {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    const labels = await prisma.label.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
    });
    res.json({ data: labels });
  } catch (error) {
    next(error);
  }
});

// Update label
labelRouter.patch("/:id", authenticate, async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.label.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: { message: "Label not found" } });
      return;
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: req.user!.id,
          workspaceId: existing.workspaceId,
        },
      },
    });
    if (!membership || membership.role === "viewer") {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    const { name, colour } = req.body as { name?: string; colour?: string };
    const label = await prisma.label.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(colour !== undefined && { colour }),
      },
    });
    res.json({ data: label });
  } catch (error) {
    next(error);
  }
});

// Delete label
labelRouter.delete("/:id", authenticate, async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.label.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: { message: "Label not found" } });
      return;
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: req.user!.id,
          workspaceId: existing.workspaceId,
        },
      },
    });
    if (!membership || membership.role === "viewer") {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    await prisma.label.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Apply label to task
labelRouter.post("/:id/tasks/:taskId", authenticate, async (req, res, next) => {
  try {
    const labelId = req.params.id as string;
    const taskId = req.params.taskId as string;

    const taskLabel = await prisma.taskLabel.create({
      data: { taskId, labelId },
    });
    res.status(201).json({ data: taskLabel });
  } catch (error) {
    next(error);
  }
});

// Remove label from task
labelRouter.delete("/:id/tasks/:taskId", authenticate, async (req, res, next) => {
  try {
    const labelId = req.params.id as string;
    const taskId = req.params.taskId as string;

    await prisma.taskLabel.delete({
      where: { taskId_labelId: { taskId, labelId } },
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
