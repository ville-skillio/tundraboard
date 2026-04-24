export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskSortBy = "createdAt" | "updatedAt" | "dueDate" | "priority";
export type SortOrder = "asc" | "desc";

export interface TaskSearchInput {
  workspaceId: string;
  q?: string;
  projectId?: string;
  status?: TaskStatus[];
  priority?: TaskPriority[];
  assigneeId?: string;
  labelIds?: string[];
  dueBefore?: Date;
  dueAfter?: Date;
  sortBy?: TaskSortBy;
  sortOrder?: SortOrder;
  limit?: number;
  cursor?: string;
}

// Opaque cursor encoding the sort position of the last returned item.
export interface SearchCursor {
  id: string;
  createdAt: string;
  updatedAt?: string;
  dueDate?: string | null;
  priorityRank?: number;
}

export interface TaskAssignee {
  id: string;
  displayName: string;
  email: string;
}

export interface TaskLabel {
  id: string;
  name: string;
  colour: string;
}

export interface TaskSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: string | null;
  projectId: string;
  createdById: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignee: TaskAssignee | null;
  labels: TaskLabel[];
}

export interface TaskDetail extends TaskSummary {
  comments: TaskComment[];
}

export interface TaskComment {
  id: string;
  content: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskSearchResult {
  data: TaskSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}
