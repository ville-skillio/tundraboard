import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import type {
  TaskSearchInput,
  TaskSearchResult,
  TaskSummary,
  TaskDetail,
  SearchCursor,
} from "../types/search.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const TASK_INCLUDE = {
  assignee: { select: { id: true, displayName: true, email: true } },
  taskLabels: { include: { label: { select: { id: true, name: true, colour: true } } } },
} as const;

const TASK_DETAIL_INCLUDE = {
  ...TASK_INCLUDE,
  comments: {
    select: { id: true, content: true, authorId: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers: cursor encoding / decoding
// ---------------------------------------------------------------------------

function encodeCursor(task: TaskSummary, sortBy: string): string {
  const base: SearchCursor = { id: task.id, createdAt: task.createdAt.toISOString() };
  let cursor: SearchCursor;
  switch (sortBy) {
    case "updatedAt":
      cursor = { ...base, updatedAt: task.updatedAt.toISOString() };
      break;
    case "dueDate":
      cursor = { ...base, dueDate: task.dueDate?.toISOString() ?? null };
      break;
    case "priority":
      cursor = { ...base, priorityRank: PRIORITY_RANK[task.priority] ?? 0 };
      break;
    default:
      cursor = base;
  }
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string): SearchCursor {
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SearchCursor;
  } catch {
    throw Object.assign(new Error("Invalid pagination cursor"), { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// Helpers: dynamic SQL fragments
// ---------------------------------------------------------------------------

// All values passed here come from validated enums — safe to use Prisma.raw.
function buildOrderBySql(sortBy: string, sortOrder: string): Prisma.Sql {
  const dir = Prisma.raw(sortOrder === "asc" ? "ASC" : "DESC");
  switch (sortBy) {
    case "updatedAt":
      return Prisma.sql`t.updated_at ${dir}, t.id ${dir}`;
    case "dueDate":
      // Nulls always sorted last regardless of direction.
      return sortOrder === "asc"
        ? Prisma.sql`t.due_date ASC NULLS LAST, t.id ASC`
        : Prisma.sql`t.due_date DESC NULLS LAST, t.id DESC`;
    case "priority":
      return Prisma.sql`
        CASE t.priority
          WHEN 'urgent' THEN 4
          WHEN 'high'   THEN 3
          WHEN 'medium' THEN 2
          WHEN 'low'    THEN 1
          ELSE 0
        END ${dir}, t.created_at DESC, t.id DESC`;
    default: // createdAt
      return Prisma.sql`t.created_at ${dir}, t.id ${dir}`;
  }
}

function buildCursorSql(cursor: SearchCursor, sortBy: string, sortOrder: string): Prisma.Sql {
  // "after" = we're paginating forward (want items that come later in the sorted order)
  const fwd = sortOrder === "asc";

  switch (sortBy) {
    case "updatedAt": {
      const val = new Date(cursor.updatedAt!);
      return fwd
        ? Prisma.sql`(t.updated_at > ${val} OR (t.updated_at = ${val} AND t.id > ${cursor.id}::uuid))`
        : Prisma.sql`(t.updated_at < ${val} OR (t.updated_at = ${val} AND t.id < ${cursor.id}::uuid))`;
    }

    case "dueDate": {
      const isNull = cursor.dueDate === null || cursor.dueDate === undefined;
      if (isNull) {
        // Cursor sits in the NULL bucket.  ASC NULLS LAST → more nulls with higher id.
        // DESC NULLS LAST → nulls are the final bucket, nothing follows.
        return fwd
          ? Prisma.sql`(t.due_date IS NULL AND t.id > ${cursor.id}::uuid)`
          : Prisma.sql`FALSE`;
      }
      const val = new Date(cursor.dueDate!);
      return fwd
        ? Prisma.sql`(
            (t.due_date IS NOT NULL AND t.due_date > ${val})
            OR (t.due_date = ${val} AND t.id > ${cursor.id}::uuid)
            OR t.due_date IS NULL
          )`
        : Prisma.sql`(
            (t.due_date IS NOT NULL AND t.due_date < ${val})
            OR (t.due_date = ${val} AND t.id < ${cursor.id}::uuid)
          )`;
    }

    case "priority": {
      const rank = cursor.priorityRank ?? 0;
      const ca = new Date(cursor.createdAt);
      const rankExpr = Prisma.raw(
        `CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`,
      );
      return fwd
        ? Prisma.sql`(
            ${rankExpr} > ${rank}
            OR (${rankExpr} = ${rank} AND t.created_at > ${ca})
            OR (${rankExpr} = ${rank} AND t.created_at = ${ca} AND t.id > ${cursor.id}::uuid)
          )`
        : Prisma.sql`(
            ${rankExpr} < ${rank}
            OR (${rankExpr} = ${rank} AND t.created_at < ${ca})
            OR (${rankExpr} = ${rank} AND t.created_at = ${ca} AND t.id < ${cursor.id}::uuid)
          )`;
    }

    default: {
      // createdAt
      const val = new Date(cursor.createdAt);
      return fwd
        ? Prisma.sql`(t.created_at > ${val} OR (t.created_at = ${val} AND t.id > ${cursor.id}::uuid))`
        : Prisma.sql`(t.created_at < ${val} OR (t.created_at = ${val} AND t.id < ${cursor.id}::uuid))`;
    }
  }
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

type PrismaTaskWithIncludes = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;
type PrismaTaskWithDetail = Prisma.TaskGetPayload<{ include: typeof TASK_DETAIL_INCLUDE }>;

function toSummary(t: PrismaTaskWithIncludes): TaskSummary {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assigneeId,
    projectId: t.projectId,
    createdById: t.createdById,
    dueDate: t.dueDate,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    assignee: t.assignee,
    labels: t.taskLabels.map((tl) => tl.label),
  };
}

function toDetail(t: PrismaTaskWithDetail): TaskDetail {
  return {
    ...toSummary(t),
    comments: t.comments,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createTask(data: {
  projectId: string;
  title: string;
  description?: string;
  priority?: string;
  assigneeId?: string;
  dueDate?: Date;
  createdById: string;
}): Promise<TaskDetail> {
  const task = await prisma.task.create({
    data: {
      projectId: data.projectId,
      title: data.title,
      description: data.description,
      priority: data.priority ?? "medium",
      assigneeId: data.assigneeId ?? null,
      dueDate: data.dueDate ?? null,
      createdById: data.createdById,
    },
    include: TASK_DETAIL_INCLUDE,
  });
  return toDetail(task);
}

export async function getTask(id: string): Promise<TaskDetail | null> {
  const task = await prisma.task.findUnique({
    where: { id },
    include: TASK_DETAIL_INCLUDE,
  });
  return task ? toDetail(task) : null;
}

export async function updateTask(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    status?: string;
    priority?: string;
    assigneeId?: string | null;
    dueDate?: Date | null;
  },
): Promise<TaskDetail> {
  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.priority !== undefined && { priority: data.priority }),
      ...("assigneeId" in data && { assigneeId: data.assigneeId }),
      ...("dueDate" in data && { dueDate: data.dueDate }),
    },
    include: TASK_DETAIL_INCLUDE,
  });
  return toDetail(task);
}

export async function deleteTask(id: string): Promise<void> {
  await prisma.task.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Advanced search with cursor-based pagination
// ---------------------------------------------------------------------------

export async function searchTasks(input: TaskSearchInput): Promise<TaskSearchResult> {
  const { workspaceId, q, projectId, status, priority, assigneeId, labelIds, dueBefore, dueAfter } =
    input;

  const sortBy = input.sortBy ?? "createdAt";
  const sortOrder =
    input.sortOrder ?? (sortBy === "dueDate" || sortBy === "priority" ? "asc" : "desc");
  const limit = Math.min(input.limit ?? 20, 100);
  const fetchLimit = limit + 1; // fetch one extra to determine hasMore

  // Decode cursor
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;

  // --- Phase 1: raw SQL → ordered list of IDs ---------------------------------
  const conditions: Prisma.Sql[] = [Prisma.sql`p.workspace_id = ${workspaceId}::uuid`];

  if (q) {
    conditions.push(Prisma.sql`t.search_vector @@ plainto_tsquery('english', ${q})`);
  }
  if (projectId) {
    conditions.push(Prisma.sql`t.project_id = ${projectId}::uuid`);
  }
  if (status?.length) {
    conditions.push(Prisma.sql`t.status = ANY(${status}::text[])`);
  }
  if (priority?.length) {
    conditions.push(Prisma.sql`t.priority = ANY(${priority}::text[])`);
  }
  if (assigneeId) {
    conditions.push(Prisma.sql`t.assignee_id = ${assigneeId}::uuid`);
  }
  if (labelIds?.length) {
    conditions.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM task_labels tl
        WHERE tl.task_id = t.id AND tl.label_id = ANY(${labelIds}::uuid[])
      )`,
    );
  }
  if (dueBefore) {
    conditions.push(Prisma.sql`t.due_date <= ${dueBefore}`);
  }
  if (dueAfter) {
    conditions.push(Prisma.sql`t.due_date >= ${dueAfter}`);
  }
  if (cursor) {
    conditions.push(buildCursorSql(cursor, sortBy, sortOrder));
  }

  const orderBy = buildOrderBySql(sortBy, sortOrder);
  const whereClause = Prisma.join(conditions, " AND ");

  const rawRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT t.id
    FROM tasks t
    INNER JOIN projects p ON p.id = t.project_id
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${fetchLimit}
  `);

  const hasMore = rawRows.length > limit;
  const ids = rawRows.slice(0, limit).map((r) => r.id);

  if (ids.length === 0) {
    return { data: [], nextCursor: null, hasMore: false };
  }

  // --- Phase 2: Prisma → full objects with relations ---------------------------
  const tasks = await prisma.task.findMany({
    where: { id: { in: ids } },
    include: TASK_INCLUDE,
  });

  // Restore SQL ordering (findMany does not guarantee it).
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const ordered = ids.map((id) => taskMap.get(id)).filter((t): t is PrismaTaskWithIncludes => !!t);
  const data: TaskSummary[] = ordered.map(toSummary);

  const nextCursor =
    hasMore && data.length > 0 ? encodeCursor(data[data.length - 1], sortBy) : null;

  return { data, nextCursor, hasMore };
}
