import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { prisma } from "../utils/prisma.js";

export const attachmentRouter = Router();

attachmentRouter.get("/:id", authenticate, async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id as string },
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
});

// Upload attachment
attachmentRouter.post("/tasks/:taskId", authenticate, async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.create({
      data: {
        taskId: req.params.taskId as string,
        fileName: req.body.fileName,
        fileSize: req.body.fileSize,
        mimeType: req.body.mimeType,
        storageKey: req.body.storageKey,
        uploadedBy: req.user!.id,
      },
    });
    res.status(201).json({ data: attachment });
  } catch (error) {
    next(error);
  }
});
