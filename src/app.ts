import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { workspaceRouter } from "./routes/workspaces.js";
import { projectRouter } from "./routes/projects.js";
import { taskRouter } from "./routes/tasks.js";
import { commentRouter } from "./routes/comments.js";
import { labelRouter } from "./routes/labels.js";
import { notificationRouter } from "./routes/notifications.js";
import { webhookRouter } from "./routes/webhooks.js";
import { attachmentRouter } from "./routes/attachments.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  }),
);
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/workspaces", workspaceRouter);
app.use("/projects", projectRouter);
app.use("/tasks", taskRouter);
app.use("/comments", commentRouter);
app.use("/labels", labelRouter);
app.use("/notifications", notificationRouter);
app.use("/webhooks", webhookRouter);
app.use("/attachments", attachmentRouter);

// ---------------------------------------------------------------------------
// Error handling (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);
