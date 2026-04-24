/*
 * ============================================================================
 * PHASE 2 — Architecture (Slot 3 + Role prompt)
 * ============================================================================
 *
 * PROMPT:
 * You are a senior TypeScript backend engineer with several years of
 * experience on Express/Prisma APIs. I am implementing POST /tasks for
 * TundraBoard.
 *
 * Here is the Prisma schema: [schema pasted]
 * Here is how auth.service.ts is structured: [auth.service.ts pasted]
 *
 * Recommend a file structure and pattern for this endpoint. Should business
 * logic live in the route handler or in a service layer? Where should Zod
 * validation happen — middleware or inline? How should I surface errors to
 * the global error handler?
 *
 * RESPONSE (key recommendations):
 * 1. Put business logic in a separate task.service.ts — keeps the route
 *    handler thin and makes the service independently unit-testable.
 * 2. Do inline Zod validation with safeParse in the route handler, consistent
 *    with auth.ts — not separate middleware.
 * 3. Service functions throw errors with an `.status` property; errorHandler
 *    already reads err.status so no extra wiring needed.
 * 4. Use an explicit select clause in prisma.task.create to avoid returning
 *    internal or sensitive fields.
 *
 * DECISION LOG:
 * - Accepted: service layer separation. Route file stays thin and readable.
 * - Accepted: inline safeParse — matches the existing auth.ts convention.
 * - Accepted: Object.assign error throwing — matches errorHandler.ts exactly.
 * - Rejected: express-validator middleware. Zod is already a dep and auth.ts
 *   sets the inline-safeParse precedent; no reason to introduce a second
 *   validation library.
 * ============================================================================
 *
 * PHASE 3 — Implementation (Slot 1 + few-shot prompt)
 * ============================================================================
 *
 * PROMPT:
 * Here is an existing service as a pattern example:
 * [auth.service.ts pasted]
 *
 * Following exactly the same style (prisma import from utils/prisma.js,
 * Object.assign for status errors, explicit select clauses), implement a
 * createTask function that:
 * - Verifies the project exists and reads its workspaceId
 * - Verifies the caller is an admin or member (not viewer) of that workspace
 * - If assigneeId is provided, verifies the assignee is a workspace member
 * - Creates the task with an explicit field allowlist
 *
 * RESPONSE:
 * The AI produced a correct first draft. Two adjustments made after review:
 * 1. Added `role: { in: ["admin", "member"] }` to the membership lookup — the
 *    first draft only checked membership existence, which would allow viewers
 *    to create tasks.
 * 2. Removed a redundant `?? "medium"` fallback on priority — the Zod schema
 *    already applies the "medium" default before the service sees the value.
 * ============================================================================
 */

import { prisma } from "../utils/prisma.js";
import type { CreateTaskInput } from "../validation/task.schema.js";

export type CreatedTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  projectId: string;
  assigneeId: string | null;
  createdById: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function createTask(
  input: CreateTaskInput,
  createdById: string,
): Promise<CreatedTask> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, workspaceId: true },
  });

  if (!project) {
    throw Object.assign(new Error("Project not found"), { status: 404 });
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: {
      workspaceId: project.workspaceId,
      userId: createdById,
      role: { in: ["admin", "member"] },
    },
  });

  if (!membership) {
    throw Object.assign(
      new Error("You do not have permission to create tasks in this workspace"),
      { status: 403 },
    );
  }

  if (input.assigneeId) {
    const assigneeMembership = await prisma.workspaceMember.findFirst({
      where: { workspaceId: project.workspaceId, userId: input.assigneeId },
    });

    if (!assigneeMembership) {
      throw Object.assign(new Error("Assignee is not a member of this workspace"), {
        status: 422,
      });
    }
  }

  return prisma.task.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      projectId: input.projectId,
      assigneeId: input.assigneeId ?? null,
      priority: input.priority,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      createdById,
      status: "todo",
    },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      projectId: true,
      assigneeId: true,
      createdById: true,
      dueDate: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
