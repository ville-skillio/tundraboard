// Task Service — handles tasks, comments, labels, and notifications
// T2: TypeScript types added to getTask and createTask.
//     All other functions retain their original signatures for now.

import type { Task, Comment, Label, CreateTaskInput } from '../types/task';
import { createNotification, getNotifications, markNotificationRead } from './notificationService';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../db') as { query: (sql: string, ...args: unknown[]) => Promise<{ rows: unknown[] }> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto') as { randomUUID: () => string };

// ============================================================
// TASKS
// ============================================================

function createTask(taskData: CreateTaskInput, callback: (err: Error | null, task: Task | null) => void): void {
  const title = taskData.title;
  const description = taskData.description || '';
  const projectId = taskData.projectId;
  const priority = taskData.priority || 'medium';
  const assigneeId = taskData.assigneeId || null;
  const createdById = taskData.createdById;

  const id = crypto.randomUUID();
  const query = "INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, created_by_id, created_at, updated_at) VALUES ('" + id + "', '" + projectId + "', '" + title + "', '" + description + "', 'todo', '" + priority + "', " + (assigneeId ? "'" + assigneeId + "'" : "NULL") + ", '" + createdById + "', NOW(), NOW()) RETURNING *";

  db.query(query, function(err: Error | null, result: { rows: Task[] }) {
    if (err) {
      callback(err, null);
      return;
    }
    const task = result.rows[0];

    if (assigneeId) {
      createNotification(assigneeId, 'task_assigned', 'You have been assigned a new task: ' + title, { taskId: id }, function(notifErr: Error | null) {
        if (notifErr) {
          console.log('Failed to create notification:', notifErr);
        }
        callback(null, task);
      });
    } else {
      callback(null, task);
    }
  });
}

async function getTask(taskId: string): Promise<Task> {
  const result = await db.query("SELECT * FROM tasks WHERE id = '" + taskId + "'") as { rows: Task[] };
  if (result.rows.length === 0) {
    throw new Error('Task not found');
  }
  const task = result.rows[0];
  task.comments = await getCommentsByTaskId(taskId);
  task.labels = await getLabelsByTaskId(taskId);
  return task;
}

function updateTask(taskId: string, updates: Record<string, unknown>, callback: (err: Error | null, task: unknown) => void): void {
  const setClauses: string[] = [];
  const keys = Object.keys(updates);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = updates[key];
    if (value === null) {
      setClauses.push(key + " = NULL");
    } else {
      setClauses.push(key + " = '" + value + "'");
    }
  }
  setClauses.push("updated_at = NOW()");

  const query = "UPDATE tasks SET " + setClauses.join(', ') + " WHERE id = '" + taskId + "' RETURNING *";

  db.query(query, function(err: Error | null, result: { rows: unknown[] }) {
    if (err) {
      callback(err, null);
      return;
    }
    if (result.rows.length === 0) {
      callback(new Error('Task not found'), null);
      return;
    }
    callback(null, result.rows[0]);
  });
}

function deleteTask(taskId: string, callback: (err: Error | null, result?: unknown) => void): void {
  db.query("DELETE FROM tasks WHERE id = '" + taskId + "'", function(err: Error | null) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, { deleted: true });
  });
}

function listTasks(projectId: string, filters: Record<string, unknown>, callback: (err: Error | null, tasks: unknown[] | null) => void): void {
  let query = "SELECT * FROM tasks WHERE project_id = '" + projectId + "'";

  if (filters.status) query += " AND status = '" + filters.status + "'";
  if (filters.priority) query += " AND priority = '" + filters.priority + "'";
  if (filters.assigneeId) query += " AND assignee_id = '" + filters.assigneeId + "'";
  if (filters.search) query += " AND (title LIKE '%" + filters.search + "%' OR description LIKE '%" + filters.search + "%')";

  const page = (filters.page as number) || 1;
  const limit = (filters.limit as number) || 20;
  const offset = (page - 1) * limit;
  query += " ORDER BY created_at DESC LIMIT " + limit + " OFFSET " + offset;

  db.query(query, function(err: Error | null, result: { rows: unknown[] }) {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, result.rows);
  });
}

// ============================================================
// COMMENTS
// ============================================================

function createComment(taskId: string, authorId: string, content: string, callback: (err: Error | null, comment?: unknown) => void): void {
  const id = crypto.randomUUID();
  const query = "INSERT INTO comments (id, task_id, author_id, content, created_at, updated_at) VALUES ('" + id + "', '" + taskId + "', '" + authorId + "', '" + content + "', NOW(), NOW()) RETURNING *";

  db.query(query, function(err: Error | null, result: { rows: unknown[] }) {
    if (err) {
      callback(err);
      return;
    }
    const comment = result.rows[0];

    db.query("SELECT * FROM tasks WHERE id = '" + taskId + "'", function(taskErr: Error | null, taskResult: { rows: Record<string, string>[] }) {
      if (taskErr) {
        callback(null, comment);
        return;
      }
      if (taskResult.rows.length > 0) {
        const task = taskResult.rows[0];
        if (task.created_by_id !== authorId) {
          createNotification(task.created_by_id, 'comment_added', authorId + ' commented on your task: ' + task.title, { taskId, commentId: id }, function() {});
        }
        if (task.assignee_id && task.assignee_id !== authorId && task.assignee_id !== task.created_by_id) {
          createNotification(task.assignee_id, 'comment_added', authorId + ' commented on task: ' + task.title, { taskId, commentId: id }, function() {});
        }
      }
      callback(null, comment);
    });
  });
}

async function getCommentsByTaskId(taskId: string): Promise<Comment[]> {
  const result = await db.query("SELECT * FROM comments WHERE task_id = '" + taskId + "' ORDER BY created_at ASC") as { rows: Comment[] };
  return result.rows;
}

function updateComment(commentId: string, content: string, _userId: string, callback: (err: Error | null, comment?: unknown) => void): void {
  const query = "UPDATE comments SET content = '" + content + "', updated_at = NOW() WHERE id = '" + commentId + "' RETURNING *";

  db.query(query, function(err: Error | null, result: { rows: unknown[] }) {
    if (err) {
      callback(err);
      return;
    }
    if (result.rows.length === 0) {
      callback(new Error('Comment not found'));
      return;
    }
    callback(null, result.rows[0]);
  });
}

function deleteComment(commentId: string, callback: (err: Error | null, result?: unknown) => void): void {
  db.query("DELETE FROM comments WHERE id = '" + commentId + "'", function(err: Error | null) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, { deleted: true });
  });
}

// ============================================================
// LABELS
// ============================================================

function createLabel(workspaceId: string, name: string, colour: string, callback: (err: Error | null, label?: unknown) => void): void {
  const id = crypto.randomUUID();
  db.query("INSERT INTO labels (id, workspace_id, name, colour, created_at) VALUES ('" + id + "', '" + workspaceId + "', '" + name + "', '" + (colour || '#6B7280') + "', NOW()) RETURNING *", function(err: Error | null, result: { rows: unknown[] }) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, result.rows[0]);
  });
}

function getLabelsByWorkspace(workspaceId: string, callback: (err: Error | null, labels?: unknown[]) => void): void {
  db.query("SELECT * FROM labels WHERE workspace_id = '" + workspaceId + "' ORDER BY name", function(err: Error | null, result: { rows: unknown[] }) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, result.rows);
  });
}

async function getLabelsByTaskId(taskId: string): Promise<Label[]> {
  const result = await db.query("SELECT l.* FROM labels l JOIN task_labels tl ON l.id = tl.label_id WHERE tl.task_id = '" + taskId + "'") as { rows: Label[] };
  return result.rows;
}

function addLabelToTask(taskId: string, labelId: string, callback: (err: Error | null) => void): void {
  db.query("INSERT INTO task_labels (task_id, label_id) VALUES ('" + taskId + "', '" + labelId + "')", function(err: Error | null) {
    callback(err);
  });
}

function removeLabelFromTask(taskId: string, labelId: string, callback: (err: Error | null) => void): void {
  db.query("DELETE FROM task_labels WHERE task_id = '" + taskId + "' AND label_id = '" + labelId + "'", function(err: Error | null) {
    callback(err);
  });
}

// ============================================================
// WEBHOOKS
// ============================================================

function triggerWebhooks(workspaceId: string, event: string, payload: unknown): void {
  db.query("SELECT * FROM webhooks WHERE workspace_id = '" + workspaceId + "' AND active = true", function(err: Error | null, result: { rows: { url: string; secret: string; events: string[] }[] }) {
    if (err) {
      console.log('webhook query error:', err);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require('http');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const url = require('url');
    for (let i = 0; i < result.rows.length; i++) {
      const webhook = result.rows[i];
      if (webhook.events.indexOf(event) !== -1) {
        const parsed = url.parse(webhook.url);
        const data = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
        const options = {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        };
        try {
          const req = http.request(options);
          req.write(data);
          req.end();
        } catch(e) {
          console.log('webhook delivery failed:', e);
        }
      }
    }
  });
}

// ============================================================
// AUDIT LOG
// ============================================================

function logAudit(workspaceId: string, userId: string, action: string, resource: string, resourceId: string, metadata?: unknown): void {
  const id = crypto.randomUUID();
  const metadataStr = metadata ? JSON.stringify(metadata) : '{}';
  db.query("INSERT INTO audit_logs (id, workspace_id, user_id, action, resource, resource_id, metadata, created_at) VALUES ('" + id + "', '" + workspaceId + "', '" + userId + "', '" + action + "', '" + resource + "', '" + resourceId + "', '" + metadataStr + "', NOW())", function(err: Error | null) {
    if (err) {
      console.log('audit log error:', err);
    }
  });
}

// ============================================================
// USER HELPERS
// ============================================================

function getUserByEmail(email: string, callback: (err: Error | null, user?: unknown) => void): void {
  db.query("SELECT * FROM users WHERE email = '" + email + "'", function(err: Error | null, result: { rows: unknown[] }) {
    if (err) {
      callback(err);
      return;
    }
    if (result.rows.length === 0) {
      callback(null, null);
      return;
    }
    callback(null, result.rows[0]);
  });
}

function createUser(email: string, displayName: string, passwordHash: string, callback: (err: Error | null, user?: unknown) => void): void {
  const id = crypto.randomUUID();
  db.query("INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES ('" + id + "', '" + email + "', '" + displayName + "', '" + passwordHash + "', NOW(), NOW()) RETURNING *", function(err: Error | null, result: { rows: unknown[] }) {
    if (err) {
      callback(err);
      return;
    }
    callback(null, result.rows[0]);
  });
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
  createLabel,
  getLabelsByWorkspace,
  getLabelsByTaskId,
  addLabelToTask,
  removeLabelFromTask,
  createNotification,
  getNotifications,
  markNotificationRead,
  triggerWebhooks,
  logAudit,
  getUserByEmail,
  createUser,
};
