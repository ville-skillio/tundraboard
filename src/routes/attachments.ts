import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { prisma } from "../utils/prisma.js";

export const attachmentRouter = Router();

// BUG #3 (PLANTED): IDOR vulnerability — the endpoint returns any attachment
// by ID without checking whether the requesting user has access to the
// workspace that contains the task the attachment belongs to.
// An attacker can enumerate attachment IDs to access files from
// other workspaces.
attachmentRouter.get("/:id", authenticate, async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.findUnique({
      where: { id: req.params.id },
    });

    if (!attachment) {
      res.status(404).json({ error: { message: "Attachment not found" } });
      return;
    }

    // Should check: does req.user have access to the workspace
    // that contains the task this attachment belongs to?
    // Missing: workspace membership verification

    res.json({ data: attachment });
  } catch (error) {
    next(error);
  }
});

// Upload attachment
attachmentRouter.post("/tasks/:taskId", authenticate, async (req, res, next) => {
  try {
    const attachment = await prisma.attachment.create({
      data: {
        taskId: req.params.taskId,
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
