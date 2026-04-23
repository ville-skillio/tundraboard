import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import * as taskService from "../services/taskService.js";

export const taskRouter = Router();

// Create task
taskRouter.post("/", authenticate, async (req, res, next) => {
  try {
    const rawHours = req.body.estimatedHours;
    const task = await taskService.createTask({
      title: req.body.title,
      description: req.body.description,
      projectId: req.body.projectId,
      priority: req.body.priority,
      assigneeId: req.body.assigneeId,
      createdById: req.user!.id,
      estimatedHours: rawHours !== undefined ? Number(rawHours) : undefined,
    });
    res.status(201).json({ data: task });
  } catch (error) {
    next(error);
  }
});

// Search/list tasks
taskRouter.get("/", authenticate, async (req, res, next) => {
  try {
    const minHours = req.query.minEstimatedHours
      ? Number(req.query.minEstimatedHours)
      : undefined;
    const maxHours = req.query.maxEstimatedHours
      ? Number(req.query.maxEstimatedHours)
      : undefined;
    const sortBy = req.query.sortBy === "estimatedHours" ? "estimatedHours" : "createdAt";
    const tasks = await taskService.searchTasks(
      req.query.projectId as string,
      (req.query.search as string) || "",
      {
        status: req.query.status as string,
        priority: req.query.priority as string,
        assigneeId: req.query.assigneeId as string,
        minEstimatedHours: minHours,
        maxEstimatedHours: maxHours,
      },
      parseInt(req.query.page as string) || 1,
      parseInt(req.query.pageSize as string) || 20,
      sortBy,
    );
    res.json({ data: tasks });
  } catch (error) {
    next(error);
  }
});

// Get task by ID
taskRouter.get("/:id", authenticate, async (req, res, next) => {
  try {
    const task = await taskService.getTask(req.params.id as string);
    if (!task) {
      res.status(404).json({ error: { message: "Task not found" } });
      return;
    }
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
});

// Update task
taskRouter.patch("/:id", authenticate, async (req, res, next) => {
  try {
    const task = await taskService.updateTask(req.params.id as string, req.body);
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
});

// Delete task
taskRouter.delete("/:id", authenticate, async (req, res, next) => {
  try {
    await taskService.deleteTask(req.params.id as string);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
