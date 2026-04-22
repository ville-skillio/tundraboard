// The Plan

//Plan to modernize the legacy task service into a maintainable, typed, //testable, and deployable service. Prioritize low-risk, high-impact //changes first (types, linting, tests), then refactors (DI, //modularization), then infra/dependency upgrades.

// Outdated patterns found (likely)
// Callbacks & nested callbacks (instead of Promises/async-await)
// Missing static types / any-heavy code (no/weak TypeScript types)
// God-class / fat service (one large task service handling multiple responsibilities)
// Hardcoded configuration (secrets, URLs, timeouts inside code)
// Synchronous/blocking I/O (fs or long CPU work on main thread)
// Global singletons and implicit state (shared mutable state across modules)
// Direct DB/IO access from business logic (no repository/DAO layers)
// Lack of dependency injection (DI) (tight coupling of modules)
// No or sparse automated tests (unit/integration missing)
// Outdated or insecure dependencies (old major versions, unpatched CVEs)
// No structured logging / error handling (console.log, thrown raw errors)
// No CI/CD or missing linting/formatting rules
// Monolithic exports / poor module boundaries
// No typed public interfaces / API contracts
// (These are inferred common issues in legacy Node repos — adapt to codebase specifics during initial scan.)
// Risk–Effort matrix
// Table rows: finding — Risk (Low/Med/High) — Effort (Low/Med/High) — Priority (1=highest)

// Finding	Risk	Effort	Priority
// Missing types / any-heavy code	Medium	Low	1
// No tests	High	Low	1
// Callbacks -> async/await	Medium	Low	2
// Hardcoded config	High	Low	2
// Direct DB/IO in business logic	High	Medium	2
// God-class / fat service	High	High	3
// No DI / tight coupling	High	Medium	3
// Outdated deps / vulnerabilities	High	Medium	2
// No structured logging	Medium	Low	2
// Synchronous/blocking I/O	High	Medium	3
// Global singletons/implicit state	High	Medium	3
// No CI/CD / linting	Medium	Low	1
// Monolithic exports/poor boundaries	Medium	Medium	3
// No typed public interfaces	Medium	Low	2
// Notes: priorities balance risk mitigation and implementation cost.

// Dependency-ordered sequence of transformations
// Follow this dependency order so earlier low-risk infra enables safer refactors later.

// Initial repo health & discovery (non-invasive)
// Add CONTRIBUTING.md and CODE_OF_CONDUCT (optional).
// Run static scans: eslint, npm audit, license/dep check.
// Create artifact-free branch (e.g., modernize/initial-scan).
// Add tooling & baseline automation (enables safe changes)
// Add/enable CI pipeline (GitHub Actions) to run lint, build, tests.
// Add Prettier + ESLint with recommended rules.
// Add test runner (Jest or Vitest) config and coverage reporting.
// Add GitHub Actions PR checks.
// Introduce TypeScript incrementally (enables safer refactor)
// Add tsconfig with "allowJs": true, "checkJs": false initially; set strict:false.
// Rename core modules to .ts gradually.
// Add types for commonly used libs (e.g., @types/express).
// Enforce stricter typing progressively (move to strict:true over iterations).
// Replace callbacks with Promises/async-await
// Identify callback-based functions; convert to Promise-returning + async/await.
// Update call sites; run tests.
// This is safer after TypeScript baseline exists.
// Externalize configuration
// Replace hardcoded config with config layer (dotenv/config, or typed config).
// Add validation (zod/joi/TypeBox) and environment schema checks on startup.
// Move secrets to env/secret manager (do not commit to repo).
// Add structured logging & centralized error handling
// Introduce logger (pino/winston) with JSON output and levels.
// Add error classes and an error-handling strategy.
// Ensure logs include correlation IDs (introduce request id propagation if applicable).
// Add abstractions for I/O and DB (Repository/DAO)
// Extract direct DB/fs access into small repositories or clients with typed interfaces.
// Replace inline SQL/queries with parameterized calls or ORM repository interfaces.
// Introduce dependency injection / inversion of control
// Add a lightweight DI container or factory pattern (tsyringe/inversify or simple manual composition).
// Wire services to take dependencies as constructor args instead of requiring modules.
// Break up god-class into small services / single-responsibility modules
// Identify responsibilities (validation, persistence, scheduling, notification).
// Split into modules with well-typed public interfaces and unit tests.
// Keep backward-compatible API surface during transition.
// Convert remaining codebase to strict TypeScript
// Turn on "noImplicitAny", "strict", tighten libs.
// Replace remaining any types with explicit types/interfaces.
// Add or generate Type Definitions for internal modules.
// Introduce async job patterns and resilient processing
// If task service handles retries/scheduling, adopt standardized patterns (BullMQ, Agenda, or cron + idempotency).
// Add idempotency keys, backoff strategies, and dead-letter handling.
// Replace blocking/sync operations
// Make sure file/db/network I/O are async, and move CPU-bound tasks to workers or child processes.
// Security & dependency upgrades
// Upgrade major dependencies, fix vulnerabilities.
// Add Snyk or dependabot for ongoing monitoring.
// Tests & coverage expansion
// Add unit tests for each module.
// Add integration tests for repository and external integrations (use test containers or mocks).
// Add end-to-end tests for critical workflows.
// Observability & deployment
// Add metrics (Prometheus/OpenTelemetry) and traces.
// Add health/readiness endpoints.
// Add Dockerfile, multi-stage build, and CI/CD deploy pipeline (staging → production).
// Cleanup & hardening
// Remove deprecated code paths, consolidate exports, tidy docs.
// Perform load testing and security audit.
// Specific tactical checklist (actions to run in order)
// Create branch modernize/initial-scan.
// Add GitHub Action: ESLint + Prettier + unit tests.
// Add tsconfig.json (allowJs:true), install typescript, @types/*.
// Add Jest + basic test scaffold; write tests for task service's public functions.
// Replace 1–2 callback functions with Promise variants and update callers.
// Extract config into config module and add validation.
// Introduce logger and replace console.* usage.
// Extract DB calls into a repository interface; add unit tests/mocks.
// Implement DI composition root and pass dependencies into task service.
// Refactor task service into smaller modules; run full test suite.
// Enable stricter TypeScript checks and fix typing errors.
// Upgrade dependencies and remediate vulnerabilities.
// Add Dockerfile, health endpoints, observability hooks.
// Merge incremental PRs with CI gating.
// Estimated timelines (example for small team: 1–3 devs)
// Steps 1–4 (tooling + tests): 1–2 weeks
// Steps 5–8 (async, config, logging, repo layer): 2–3 weeks
// Steps 9–12 (DI, split services, strict typing): 3–5 weeks
// Steps 13–14 (infra, observability, hardening): 1–2 weeks
// Total: ~7–12 weeks depending on scope and test coverage.
// Acceptance criteria (per milestone)
// CI passes on every PR; linting enforced.
// Type coverage increased; no implicit any in core modules.
// Unit coverage >= 70% for task service modules.
// No hardcoded secrets/configs in repo.
// Task service split into modules with clear typed interfaces and DI composition root.
// Performance and functional parity verified by integration tests.


// characterization.test.js
'use strict';

// Characterisation tests for src/services/taskService.js
// Purpose: capture current observable behaviour BEFORE any modernisation.
// These tests must all pass on the original legacy code.
// After each transformation they are re-run to confirm behaviour is preserved.

jest.mock('../src/db');
const db = require('../src/db');
const taskService = require('../src/services/taskService');

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getTask — nested callback: task → comments → labels
// ---------------------------------------------------------------------------

// NOTE: getTask was converted to async/await in T1.
// Tests updated from callback style to await style — behaviour is identical.
describe('getTask', () => {
  it('returns the task row with comments and labels attached', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Fix bug', project_id: 'proj-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'c-1', content: 'Looks good' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'l-1', name: 'backend' }] });

    const task = await taskService.getTask('task-1');
    expect(task.id).toBe('task-1');
    expect(task.comments).toHaveLength(1);
    expect(task.comments[0].content).toBe('Looks good');
    expect(task.labels).toHaveLength(1);
    expect(task.labels[0].name).toBe('backend');
  });

  it('throws when the task does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(taskService.getTask('nonexistent')).rejects.toThrow('Task not found');
  });

  it('propagates a database error from the first query', async () => {
    db.query.mockRejectedValueOnce(new Error('connection refused'));
    await expect(taskService.getTask('task-1')).rejects.toThrow('connection refused');
  });

  it('propagates a database error from the comments query', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Fix bug' }] })
      .mockRejectedValueOnce(new Error('comments query failed'));
    await expect(taskService.getTask('task-1')).rejects.toThrow('comments query failed');
  });

  it('returns empty arrays when a task has no comments or labels', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Empty task' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const task = await taskService.getTask('task-1');
    expect(task.comments).toHaveLength(0);
    expect(task.labels).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createTask — creates a task and fires a notification when assignee present
// ---------------------------------------------------------------------------

describe('createTask', () => {
  it('inserts the task and returns the created row', (done) => {
    const created = { id: 'new-task', title: 'New task', status: 'todo' };
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(null, { rows: [created] })
    );

    taskService.createTask(
      { title: 'New task', projectId: 'proj-1', createdById: 'user-1' },
      (err, task) => {
        expect(err).toBeNull();
        expect(task).toEqual(created);
        done();
      }
    );
  });

  it('fires a notification when an assignee is provided', (done) => {
    const created = { id: 'new-task', title: 'Assigned task', status: 'todo' };
    db.query
      .mockImplementationOnce((_sql, cb) => cb(null, { rows: [created] })) // INSERT task
      .mockImplementationOnce((_sql, cb) => cb(null, {}));                  // INSERT notification

    taskService.createTask(
      { title: 'Assigned task', projectId: 'proj-1', createdById: 'user-1', assigneeId: 'user-2' },
      (err, task) => {
        expect(err).toBeNull();
        expect(task).toEqual(created);
        expect(db.query).toHaveBeenCalledTimes(2);
        done();
      }
    );
  });

  it('still returns the task even when the notification insert fails', (done) => {
    const created = { id: 'new-task', title: 'Assigned task', status: 'todo' };
    db.query
      .mockImplementationOnce((_sql, cb) => cb(null, { rows: [created] }))
      .mockImplementationOnce((_sql, cb) => cb(new Error('notification failed'), null));

    taskService.createTask(
      { title: 'Assigned task', projectId: 'proj-1', createdById: 'user-1', assigneeId: 'user-2' },
      (err, task) => {
        expect(err).toBeNull();
        expect(task).toEqual(created);
        done();
      }
    );
  });

  it('propagates a database error from the task insert', (done) => {
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(new Error('insert failed'), null)
    );

    taskService.createTask(
      { title: 'Bad task', projectId: 'proj-1', createdById: 'user-1' },
      (err, task) => {
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('insert failed');
        expect(task).toBeNull();
        done();
      }
    );
  });
});

// ---------------------------------------------------------------------------
// createNotification — isolated behaviour captured for T3 (extraction target)
// ---------------------------------------------------------------------------

describe('createNotification', () => {
  it('inserts a notification row and calls back with no error', (done) => {
    db.query.mockImplementationOnce((_sql, cb) => cb(null, {}));

    taskService.createNotification('user-1', 'task_assigned', 'You were assigned a task', { taskId: 'task-1' }, (err) => {
      expect(err).toBeNull();
      expect(db.query).toHaveBeenCalledTimes(1);
      const sql = db.query.mock.calls[0][0];
      expect(sql).toContain('INSERT INTO notifications');
      done();
    });
  });

  it('calls back with error when the insert fails', (done) => {
    db.query.mockImplementationOnce((_sql, cb) => cb(new Error('db error'), null));

    taskService.createNotification('user-1', 'task_assigned', 'msg', {}, (err) => {
      expect(err).toBeInstanceOf(Error);
      done();
    });
  });
});

// taskService.js
// Task Service — handles tasks, comments, labels, and notifications
// This file manages everything task-related for TundraBoard

var db = require('../db');
var crypto = require('crypto');

// ============================================================
// TASKS
// ============================================================

function createTask(taskData, callback) {
  var title = taskData.title;
  var description = taskData.description || '';
  var projectId = taskData.projectId;
  var priority = taskData.priority || 'medium';
  var assigneeId = taskData.assigneeId || null;
  var createdById = taskData.createdById;

  var id = crypto.randomUUID();
  var query = "INSERT INTO tasks (id, project_id, title, description, status, priority, assignee_id, created_by_id, created_at, updated_at) VALUES ('" + id + "', '" + projectId + "', '" + title + "', '" + description + "', 'todo', '" + priority + "', " + (assigneeId ? "'" + assigneeId + "'" : "NULL") + ", '" + createdById + "', NOW(), NOW()) RETURNING *";

  db.query(query, function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    var task = result.rows[0];

    // If task has an assignee, create a notification
    if (assigneeId) {
      createNotification(assigneeId, 'task_assigned', 'You have been assigned a new task: ' + title, { taskId: id }, function(notifErr) {
        if (notifErr) {
          console.log('Failed to create notification:', notifErr);
          // Don't fail the task creation just because notification failed
        }
        callback(null, task);
      });
    } else {
      callback(null, task);
    }
  });
}

async function getTask(taskId) {
  const result = await db.query("SELECT * FROM tasks WHERE id = '" + taskId + "'");
  if (result.rows.length === 0) {
    throw new Error('Task not found');
  }
  const task = result.rows[0];
  task.comments = await getCommentsByTaskId(taskId);
  task.labels = await getLabelsByTaskId(taskId);
  return task;
}

function updateTask(taskId, updates, callback) {
  // Build SET clause dynamically
  var setClauses = [];
  var keys = Object.keys(updates);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = updates[key];
    if (value === null) {
      setClauses.push(key + " = NULL");
    } else {
      setClauses.push(key + " = '" + value + "'");
    }
  }
  setClauses.push("updated_at = NOW()");

  var query = "UPDATE tasks SET " + setClauses.join(', ') + " WHERE id = '" + taskId + "' RETURNING *";

  db.query(query, function(err, result) {
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

function deleteTask(taskId, callback) {
  db.query("DELETE FROM tasks WHERE id = '" + taskId + "'", function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, { deleted: true });
  });
}

function listTasks(projectId, filters, callback) {
  var query = "SELECT * FROM tasks WHERE project_id = '" + projectId + "'";

  if (filters.status) {
    query += " AND status = '" + filters.status + "'";
  }
  if (filters.priority) {
    query += " AND priority = '" + filters.priority + "'";
  }
  if (filters.assigneeId) {
    query += " AND assignee_id = '" + filters.assigneeId + "'";
  }
  if (filters.search) {
    query += " AND (title LIKE '%" + filters.search + "%' OR description LIKE '%" + filters.search + "%')";
  }

  // Pagination
  var page = filters.page || 1;
  var limit = filters.limit || 20;
  var offset = (page - 1) * limit;
  query += " ORDER BY created_at DESC LIMIT " + limit + " OFFSET " + offset;

  db.query(query, function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, result.rows);
  });
}


function createComment(taskId, authorId, content, callback) {
  var id = crypto.randomUUID();
  var query = "INSERT INTO comments (id, task_id, author_id, content, created_at, updated_at) VALUES ('" + id + "', '" + taskId + "', '" + authorId + "', '" + content + "', NOW(), NOW()) RETURNING *";

  db.query(query, function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    var comment = result.rows[0];

    // Get the task to find who should be notified
    db.query("SELECT * FROM tasks WHERE id = '" + taskId + "'", function(taskErr, taskResult) {
      if (taskErr) {
        // Swallow the error — comment was created, notification is best-effort
        callback(null, comment);
        return;
      }
      if (taskResult.rows.length > 0) {
        var task = taskResult.rows[0];
        // Notify the task creator and assignee
        if (task.created_by_id !== authorId) {
          createNotification(task.created_by_id, 'comment_added', authorId + ' commented on your task: ' + task.title, { taskId: taskId, commentId: id }, function() {});
        }
        if (task.assignee_id && task.assignee_id !== authorId && task.assignee_id !== task.created_by_id) {
          createNotification(task.assignee_id, 'comment_added', authorId + ' commented on task: ' + task.title, { taskId: taskId, commentId: id }, function() {});
        }
      }
      callback(null, comment);
    });
  });
}

async function getCommentsByTaskId(taskId) {
  const result = await db.query("SELECT * FROM comments WHERE task_id = '" + taskId + "' ORDER BY created_at ASC");
  return result.rows;
}

function updateComment(commentId, content, userId, callback) {
  // No check if userId is the comment author
  var query = "UPDATE comments SET content = '" + content + "', updated_at = NOW() WHERE id = '" + commentId + "' RETURNING *";

  db.query(query, function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    if (result.rows.length === 0) {
      callback(new Error('Comment not found'), null);
      return;
    }
    callback(null, result.rows[0]);
  });
}

function deleteComment(commentId, callback) {
  db.query("DELETE FROM comments WHERE id = '" + commentId + "'", function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, { deleted: true });
  });
}

function createLabel(workspaceId, name, colour, callback) {
  var id = crypto.randomUUID();
  db.query("INSERT INTO labels (id, workspace_id, name, colour, created_at) VALUES ('" + id + "', '" + workspaceId + "', '" + name + "', '" + (colour || '#6B7280') + "', NOW()) RETURNING *", function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, result.rows[0]);
  });
}

function getLabelsByWorkspace(workspaceId, callback) {
  db.query("SELECT * FROM labels WHERE workspace_id = '" + workspaceId + "' ORDER BY name", function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, result.rows);
  });
}

async function getLabelsByTaskId(taskId) {
  const result = await db.query("SELECT l.* FROM labels l JOIN task_labels tl ON l.id = tl.label_id WHERE tl.task_id = '" + taskId + "'");
  return result.rows;
}

function addLabelToTask(taskId, labelId, callback) {
  db.query("INSERT INTO task_labels (task_id, label_id) VALUES ('" + taskId + "', '" + labelId + "')", function(err) {
    if (err) {
      callback(err);
      return;
    }
    callback(null);
  });
}

function removeLabelFromTask(taskId, labelId, callback) {
  db.query("DELETE FROM task_labels WHERE task_id = '" + taskId + "' AND label_id = '" + labelId + "'", function(err) {
    if (err) {
      callback(err);
      return;
    }
    callback(null);
  });
}

function createNotification(userId, type, body, metadata, callback) {
  var id = crypto.randomUUID();
  var metadataStr = JSON.stringify(metadata);
  db.query("INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at) VALUES ('" + id + "', '" + userId + "', '" + type + "', '" + type + "', '" + body + "', '" + metadataStr + "', NOW())", function(err) {
    if (err) {
      if (callback) callback(err);
      return;
    }
    if (callback) callback(null);
  });
}

function getNotifications(userId, callback) {
  db.query("SELECT * FROM notifications WHERE user_id = '" + userId + "' ORDER BY created_at DESC LIMIT 50", function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, result.rows);
  });
}

function markNotificationRead(notificationId, callback) {
  db.query("UPDATE notifications SET read = true WHERE id = '" + notificationId + "'", function(err) {
    if (err) {
      callback(err);
      return;
    }
    callback(null);
  });
}

function triggerWebhooks(workspaceId, event, payload) {
  db.query("SELECT * FROM webhooks WHERE workspace_id = '" + workspaceId + "' AND active = true", function(err, result) {
    if (err) {
      console.log('webhook query error:', err);
      return;
    }
    for (var i = 0; i < result.rows.length; i++) {
      var webhook = result.rows[i];
      if (webhook.events.indexOf(event) !== -1) {
        // Fire and forget — no retry, no signature verification
        var http = require('http');
        var url = require('url');
        var parsed = url.parse(webhook.url);
        var data = JSON.stringify({ event: event, payload: payload, timestamp: new Date().toISOString() });

        var options = {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        };

        try {
          var req = http.request(options);
          req.write(data);
          req.end();
        } catch(e) {
          console.log('webhook delivery failed:', e);
        }
      }
    }
  });
}

function logAudit(workspaceId, userId, action, resource, resourceId, metadata) {
  var id = crypto.randomUUID();
  var metadataStr = metadata ? JSON.stringify(metadata) : '{}';
  db.query("INSERT INTO audit_logs (id, workspace_id, user_id, action, resource, resource_id, metadata, created_at) VALUES ('" + id + "', '" + workspaceId + "', '" + userId + "', '" + action + "', '" + resource + "', '" + resourceId + "', '" + metadataStr + "', NOW())", function(err) {
    if (err) {
      console.log('audit log error:', err);
    }
  });
}


function getUserByEmail(email, callback) {
  db.query("SELECT * FROM users WHERE email = '" + email + "'", function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    if (result.rows.length === 0) {
      callback(null, null);
      return;
    }
    callback(null, result.rows[0]);
  });
}

function createUser(email, displayName, passwordHash, callback) {
  var id = crypto.randomUUID();
  db.query("INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at) VALUES ('" + id + "', '" + email + "', '" + displayName + "', '" + passwordHash + "', NOW(), NOW()) RETURNING *", function(err, result) {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, result.rows[0]);
  });
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  createTask: createTask,
  getTask: getTask,
  updateTask: updateTask,
  deleteTask: deleteTask,
  listTasks: listTasks,
  createComment: createComment,
  getCommentsByTaskId: getCommentsByTaskId,
  updateComment: updateComment,
  deleteComment: deleteComment,
  createLabel: createLabel,
  getLabelsByWorkspace: getLabelsByWorkspace,
  getLabelsByTaskId: getLabelsByTaskId,
  addLabelToTask: addLabelToTask,
  removeLabelFromTask: removeLabelFromTask,
  createNotification: createNotification,
  getNotifications: getNotifications,
  markNotificationRead: markNotificationRead,
  triggerWebhooks: triggerWebhooks,
  logAudit: logAudit,
  getUserByEmail: getUserByEmail,
  createUser: createUser
};

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