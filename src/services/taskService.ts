import { prisma } from "../utils/prisma.js";

export async function createTask(data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: string;
  assigneeId?: string;
  createdById: string;
  estimatedHours?: number;
}) {
  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description ?? undefined,
      projectId: data.projectId,
      priority: data.priority || "medium",
      assigneeId: data.assigneeId || null,
      createdById: data.createdById,
      estimatedHours: data.estimatedHours ?? null,
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
  estimatedHours?: number | null;
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
      ...(data.estimatedHours !== undefined && { estimatedHours: data.estimatedHours }),
      updatedAt: new Date(),
    },
  });

  return task;
}

export async function deleteTask(id: string) {
  await prisma.task.delete({ where: { id } });
}

type SearchFilters = {
  status?: string;
  priority?: string;
  assigneeId?: string;
  minEstimatedHours?: number;
  maxEstimatedHours?: number;
};

// Phase-1: use tsvector @@ plainto_tsquery for ranked ID retrieval.
// Phase-2: fetch full records (with relations) via Prisma ORM.
// The two-phase approach keeps the raw SQL surface minimal — only IDs
// are returned from $queryRaw; all relation loading stays in Prisma.
async function searchTasksFullText(
  projectId: string,
  searchTerm: string,
  filters: SearchFilters,
  page: number,
  pageSize: number,
  sortBy: "createdAt" | "estimatedHours",
) {
  const offset = (page - 1) * pageSize;

  // Parameterised tagged-template literals: safe against SQL injection.
  const ranked =
    sortBy === "estimatedHours"
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM tasks
          WHERE project_id = ${projectId}::uuid
            AND search_vector @@ plainto_tsquery('english', ${searchTerm})
          ORDER BY estimated_hours ASC NULLS LAST, id ASC
          LIMIT ${pageSize} OFFSET ${offset}
        `
      : await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM tasks
          WHERE project_id = ${projectId}::uuid
            AND search_vector @@ plainto_tsquery('english', ${searchTerm})
          ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${searchTerm})) DESC,
                   created_at DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `;

  if (ranked.length === 0) return [];

  const ids = ranked.map((r) => r.id);

  // Phase-2: apply any additional filters and load relations.
  // Note: filters are applied here, after pagination in phase-1.
  // This means the effective page size may be smaller than requested when
  // filters eliminate some tsvector matches — an accepted trade-off to
  // avoid dynamic $queryRaw filter construction.
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: ids },
      ...(filters.status && { status: filters.status }),
      ...(filters.priority && { priority: filters.priority }),
      ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
      ...((filters.minEstimatedHours !== undefined || filters.maxEstimatedHours !== undefined) && {
        estimatedHours: {
          ...(filters.minEstimatedHours !== undefined && { gte: filters.minEstimatedHours }),
          ...(filters.maxEstimatedHours !== undefined && { lte: filters.maxEstimatedHours }),
        },
      }),
    },
    include: { project: true },
  });

  // Restore tsvector rank order — findMany does not guarantee insertion order.
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  return ids.map((id) => taskMap.get(id)).filter((t): t is NonNullable<typeof t> => t != null);
}

export async function searchTasks(
  projectId: string,
  searchTerm: string,
  filters: SearchFilters,
  page: number = 1,
  pageSize: number = 20,
  sortBy: "createdAt" | "estimatedHours" = "createdAt",
) {
  const trimmed = searchTerm.trim();

  if (trimmed.length > 0) {
    return searchTasksFullText(projectId, trimmed, filters, page, pageSize, sortBy);
  }

  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      ...(filters.status && { status: filters.status }),
      ...(filters.priority && { priority: filters.priority }),
      ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
      ...((filters.minEstimatedHours !== undefined || filters.maxEstimatedHours !== undefined) && {
        estimatedHours: {
          ...(filters.minEstimatedHours !== undefined && { gte: filters.minEstimatedHours }),
          ...(filters.maxEstimatedHours !== undefined && { lte: filters.maxEstimatedHours }),
        },
      }),
    },
    include: { project: true },
    orderBy:
      sortBy === "estimatedHours"
        ? [{ estimatedHours: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return tasks;
}
