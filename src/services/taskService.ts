import { prisma } from "../utils/prisma.js";

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

type TaskUpdateFields = {
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  dueDate?: string | Date | null;
};

export async function updateTask(id: string, data: TaskUpdateFields) {
  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...(data.assigneeId !== undefined && { assigneeId: data.assigneeId }),
      ...(data.dueDate !== undefined && {
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
      }),
      updatedAt: new Date(),
    },
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
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return tasks;
}
