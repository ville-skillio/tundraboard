import { prisma } from "../utils/prisma.js";
import type { Prisma } from "@prisma/client";

export async function createTask(data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: string;
  assigneeId?: string;
  createdById: string;
}) {
  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description ?? undefined,
      projectId: data.projectId,
      priority: data.priority || "medium",
      assigneeId: data.assigneeId || null,
      createdById: data.createdById,
    },
  });

  return task;
}

export async function getTask(id: string) {
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      taskLabels: { include: { label: true } },
      project: true,
    },
  });

  return task;
}

export async function updateTask(id: string, data: Prisma.TaskUpdateInput) {
  const task = await prisma.task.update({
    where: { id },
    data: { ...data, updatedAt: new Date() },
  });

  return task;
}

export async function deleteTask(id: string) {
  await prisma.task.delete({ where: { id } });
}

export async function searchTasks(
  projectId: string,
  searchTerm: string,
  filters: { status?: string; priority?: string; assigneeId?: string },
  page: number = 1,
  pageSize: number = 20,
) {
  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      ...(searchTerm && {
        OR: [
          { title: { contains: searchTerm, mode: "insensitive" } },
          { description: { contains: searchTerm, mode: "insensitive" } },
        ],
      }),
      ...(filters.status && { status: filters.status }),
      ...(filters.priority && { priority: filters.priority }),
      ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
    },
    include: { project: true },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return tasks;
}
