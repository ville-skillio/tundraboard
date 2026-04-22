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

// ---------------------------------------------------------------------------
// updateTask — builds SET clause dynamically and updates a single task row
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  it('returns the updated task row on success', (done) => {
    const updated = { id: 'task-1', title: 'Updated title', status: 'in_progress' };
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(null, { rows: [updated] })
    );

    taskService.updateTask('task-1', { title: 'Updated title', status: 'in_progress' }, (err, task) => {
      expect(err).toBeNull();
      expect(task).toEqual(updated);
      done();
    });
  });

  it('returns an error when the task does not exist', (done) => {
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(null, { rows: [] })
    );

    taskService.updateTask('nonexistent', { title: 'x' }, (err, task) => {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Task not found');
      expect(task).toBeNull();
      done();
    });
  });

  it('propagates a database error', (done) => {
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(new Error('update failed'), null)
    );

    taskService.updateTask('task-1', { title: 'x' }, (err, task) => {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('update failed');
      expect(task).toBeNull();
      done();
    });
  });

  it('sets a field to NULL when the update value is null', (done) => {
    const updated = { id: 'task-1', title: 'task', assignee_id: null };
    db.query.mockImplementationOnce((_sql, cb) =>
      cb(null, { rows: [updated] })
    );

    taskService.updateTask('task-1', { assignee_id: null }, (err, task) => {
      expect(err).toBeNull();
      expect(task.assignee_id).toBeNull();
      done();
    });
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
