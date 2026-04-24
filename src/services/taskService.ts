// Task Service — modernised from taskService.js
//
// T1: createTask converted from callback to async/await.
//     Notification call wrapped in an awaited Promise so the function only
//     returns after the notification attempt — same observable timing as
//     the original callback path.
//
// T2: TypeScript types added to all functions.
//     updateTask converted from callback to async/await.
//     var → const/let throughout.
//     TaskFilters interface introduced for listTasks.
//
// T3: Label operations extracted to labelService.ts and re-exported here
//     for backwards compatibility with existing callers.

import type { Task, Comment, CreateTaskInput } from '../types/task';
import { createNotification, getNotifications, markNotificationRead } from './notificationService';
import {
  createLabel,
  getLabelsByWorkspace,
  getLabelsByTaskId,
  addLabelToTask,
  removeLabelFromTask,
} from './labelService';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../db') as { query: (sql: string, ...args: unknown[]) => Promise<{ rows: unknown[] }> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto') as { randomUUID: () => string };

// ============================================================
// TYPES (added in T2)
// ============================================================

// NOTE: updates is typed broadly here. A future improvement is a stricter
// TaskUpdateInput that excludes immutable fields (id, created_at, created_by_id).
interface TaskFilters {
  status?: string;
  priority?: string;
  assigneeId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

// ============================================================
// TASKS
// ============================================================

// T1: converted from callback to async/await.
// T2: TypeScript types added.
async function createTask(taskData: CreateTaskInput): Promise<Task> {
  const {
    title,
    description = '',
    projectId,
    priority = 'medium',
    assigneeId = null,
    createdById,
  } = taskData;

  const id = crypto.randomUUID();
  const query =
    "INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, created_by_id, created_at, updated_at) VALUES ('" +
    id + "', '" + projectId + "', '" + title + "', '" + description +
    "', 'todo', '" + priority + "', " +
    (assigneeId ? "'" + assigneeId + "'" : 'NULL') +
    ", '" + createdById + "', NOW(), NOW()) RETURNING *";

  const result = await db.query(query) as { rows: Task[] };
  const task = result.rows[0];

  if (assigneeId) {
    // Notification is best-effort: failure must not fail task creation.
    // Awaited (not fire-and-forget) to preserve the original timing: the
    // function resolves only after the notification attempt completes.
    await new Promise<void>((resolve) => {
      createNotification(
        assigneeId,
        'task_assigned',
        'You have been assigned a new task: ' + title,
        { taskId: id },
        (notifErr) => {
          if (notifErr) console.log('Failed to create notification:', notifErr);
          resolve();
        },
      );
    });
  }

  return task;
}

async function getTask(taskId: string): Promise<Task> {
  const result = await db.query("SELECT * FROM tasks WHERE id = '" + taskId + "'") as { rows: Task[] };
  if (result.rows.length === 0) throw new Error('Task not found');
  const task = result.rows[0];
  task.comments = await getCommentsByTaskId(taskId);
  task.labels = await getLabelsByTaskId(taskId);
  return task;
}

// T2: converted from callback to async/await; TypeScript types added.
async function updateTask(taskId: string, updates: Record<string, unknown>): Promise<Task> {
  const setClauses: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(value === null ? `${key} = NULL` : `${key} = '${value}'`);
  }
  setClauses.push('updated_at = NOW()');

  const query =
    'UPDATE tasks SET ' + setClauses.join(', ') + " WHERE id = '" + taskId + "' RETURNING *";

  const result = await db.query(query) as { rows: Task[] };
  if (result.rows.length === 0) throw new Error('Task not found');
  return result.rows[0];
}

function deleteTask(
  taskId: string,
  callback: (err: Error | null, result?: unknown) => void,
): void {
  db.query("DELETE FROM tasks WHERE id = '" + taskId + "'", function(err: Error | null) {
    if (err) { callback(err); return; }
    callback(null, { deleted: true });
  });
}

function listTasks(
  projectId: string,
  filters: TaskFilters,
  callback: (err: Error | null, tasks: unknown[] | null) => void,
): void {
  let query = "SELECT * FROM tasks WHERE project_id = '" + projectId + "'";
  if (filters.status) query += " AND status = '" + filters.status + "'";
  if (filters.priority) query += " AND priority = '" + filters.priority + "'";
  if (filters.assigneeId) query += " AND assignee_id = '" + filters.assigneeId + "'";
  if (filters.search) query += " AND (title LIKE '%" + filters.search + "%' OR description LIKE '%" + filters.search + "%')";

  const page = filters.page || 1;
  const limit = filters.limit || 20;
  query += ' ORDER BY created_at DESC LIMIT ' + limit + ' OFFSET ' + ((page - 1) * limit);

  db.query(query, function(err: Error | null, result: { rows: unknown[] }) {
    if (err) { callback(err, null); return; }
    callback(null, result.rows);
  });
}

// ============================================================
// COMMENTS
// ============================================================

function createComment(
  taskId: string,
  authorId: string,
  content: string,
  callback: (err: Error | null, comment?: unknown) => void,
): void {
  const id = crypto.randomUUID();
  const query =
    "INSERT INTO comments (id, task_id, author_id, content, created_at, updated_at) VALUES ('" +
    id + "', '" + taskId + "', '" + authorId + "', '" + content + "', NOW(), NOW()) RETURNING *";

  db.query(query, function(err: Error | null, result: { rows: unknown[] }) {
    if (err) { callback(err); return; }
    const comment = result.rows[0];

    db.query("SELECT * FROM tasks WHERE id = '" + taskId + "'", function(
      taskErr: Error | null,
      taskResult: { rows: Record<string, string>[] },
    ) {
      if (taskErr) { callback(null, comment); return; }
      if (taskResult.rows.length > 0) {
        const task = taskResult.rows[0];
        if (task.created_by_id !== authorId) {
          createNotification(task.created_by_id, 'comment_added',
            authorId + ' commented on your task: ' + task.title,
            { taskId, commentId: id }, function() {});
        }
        if (task.assignee_id && task.assignee_id !== authorId && task.assignee_id !== task.created_by_id) {
          createNotification(task.assignee_id, 'comment_added',
            authorId + ' commented on task: ' + task.title,
            { taskId, commentId: id }, function() {});
        }
      }
      callback(null, comment);
    });
  });
}

async function getCommentsByTaskId(taskId: string): Promise<Comment[]> {
  const result = await db.query(
    "SELECT * FROM comments WHERE task_id = '" + taskId + "' ORDER BY created_at ASC",
  ) as { rows: Comment[] };
  return result.rows;
}

function updateComment(
  commentId: string,
  content: string,
  _userId: string,
  callback: (err: Error | null, comment?: unknown) => void,
): void {
  const query =
    "UPDATE comments SET content = '" + content + "', updated_at = NOW() WHERE id = '" + commentId + "' RETURNING *";
  db.query(query, function(err: Error | null, result: { rows: unknown[] }) {
    if (err) { callback(err); return; }
    if (result.rows.length === 0) { callback(new Error('Comment not found')); return; }
    callback(null, result.rows[0]);
  });
}

function deleteComment(
  commentId: string,
  callback: (err: Error | null, result?: unknown) => void,
): void {
  db.query("DELETE FROM comments WHERE id = '" + commentId + "'", function(err: Error | null) {
    if (err) { callback(err); return; }
    callback(null, { deleted: true });
  });
}

// ============================================================
// WEBHOOKS
// ============================================================

function triggerWebhooks(workspaceId: string, event: string, payload: unknown): void {
  db.query(
    "SELECT * FROM webhooks WHERE workspace_id = '" + workspaceId + "' AND active = true",
    function(err: Error | null, result: { rows: { url: string; events: string[] }[] }) {
      if (err) { console.log('webhook query error:', err); return; }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const http = require('http');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const url = require('url');
      for (const webhook of result.rows) {
        if (webhook.events.indexOf(event) !== -1) {
          const parsed = url.parse(webhook.url);
          const data = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
          try {
            const req = http.request({
              hostname: parsed.hostname, port: parsed.port, path: parsed.path,
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
            });
            req.write(data);
            req.end();
          } catch(e) {
            console.log('webhook delivery failed:', e);
          }
        }
      }
    },
  );
}

// ============================================================
// AUDIT LOG
// ============================================================

function logAudit(
  workspaceId: string,
  userId: string,
  action: string,
  resource: string,
  resourceId: string,
  metadata?: unknown,
): void {
  const id = crypto.randomUUID();
  const metadataStr = metadata ? JSON.stringify(metadata) : '{}';
  db.query(
    "INSERT INTO audit_logs (id, workspace_id, user_id, action, resource, resource_id, metadata, created_at) VALUES ('" +
    id + "', '" + workspaceId + "', '" + userId + "', '" + action + "', '" + resource +
    "', '" + resourceId + "', '" + metadataStr + "', NOW())",
    function(err: Error | null) {
      if (err) console.log('audit log error:', err);
    },
  );
}

// ============================================================
// USER HELPERS
// ============================================================

function getUserByEmail(
  email: string,
  callback: (err: Error | null, user?: unknown) => void,
): void {
  db.query("SELECT * FROM users WHERE email = '" + email + "'", function(
    err: Error | null,
    result: { rows: unknown[] },
  ) {
    if (err) { callback(err); return; }
    callback(null, result.rows.length > 0 ? result.rows[0] : null);
  });
}

function createUser(
  email: string,
  displayName: string,
  passwordHash: string,
  callback: (err: Error | null, user?: unknown) => void,
): void {
  const id = crypto.randomUUID();
  db.query(
    "INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES ('" +
    id + "', '" + email + "', '" + displayName + "', '" + passwordHash + "', NOW(), NOW()) RETURNING *",
    function(err: Error | null, result: { rows: unknown[] }) {
      if (err) { callback(err); return; }
      callback(null, result.rows[0]);
    },
  );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  createTask,
  getTask,
  updateTask,
  deleteTask,
  listTasks,
  createComment,
  getCommentsByTaskId,
  updateComment,
  deleteComment,
  // T3: label operations live in labelService.ts; re-exported here so
  // existing callers that require('./taskService') continue to work.
  createLabel,
  getLabelsByWorkspace,
  getLabelsByTaskId,
  addLabelToTask,
  removeLabelFromTask,
  // Notification operations — pre-existing extraction in notificationService.ts
  createNotification,
  getNotifications,
  markNotificationRead,
  triggerWebhooks,
  logAudit,
  getUserByEmail,
  createUser,
};
