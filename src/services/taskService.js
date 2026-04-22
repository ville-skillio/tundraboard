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

// ============================================================
// COMMENTS
// ============================================================

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

// ============================================================
// LABELS
// ============================================================

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

// ============================================================
// NOTIFICATIONS
// ============================================================

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

// ============================================================
// WEBHOOKS
// ============================================================

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

// ============================================================
// AUDIT LOG
// ============================================================

function logAudit(workspaceId, userId, action, resource, resourceId, metadata) {
  var id = crypto.randomUUID();
  var metadataStr = metadata ? JSON.stringify(metadata) : '{}';
  db.query("INSERT INTO audit_logs (id, workspace_id, user_id, action, resource, resource_id, metadata, created_at) VALUES ('" + id + "', '" + workspaceId + "', '" + userId + "', '" + action + "', '" + resource + "', '" + resourceId + "', '" + metadataStr + "', NOW())", function(err) {
    if (err) {
      console.log('audit log error:', err);
    }
  });
}

// ============================================================
// USER HELPERS
// ============================================================

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
