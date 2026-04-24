'use strict';

// Characterisation tests for taskService.js / taskService.ts
//
// PROMPT used to generate (Slot 1, few-shot):
// "I am writing characterisation tests to lock in the observable behaviour
//  of a legacy Node.js service before modernising it. Here is an example of
//  the pattern I want to use (from a simpler function):
//
//  describe('deleteTask', () => {
//    it('calls back with { deleted: true } on success', (done) => {
//      db.query.mockImplementationOnce((_sql, cb) => cb(null, {}));
//      taskService.deleteTask('task-1', (err, result) => {
//        expect(err).toBeNull();
//        expect(result).toEqual({ deleted: true });
//        done();
//      });
//    });
//  });
//
//  Write characterisation tests for createTask, getTask, and updateTask
//  following this pattern. Cover: success path, DB error, not-found, and
//  any side-effect (e.g. notification) that the original code performs.
//
//  Here is the legacy file: [taskService.js pasted in full]"
//
// AI response note: the AI generated correct callback tests but used
// `.mockReturnValueOnce` for async functions — replaced with
// `.mockResolvedValueOnce`. Tests for createTask and updateTask were originally
// written in done() callback style; after T1 and T2 respectively they were
// updated to async/await. Observable behaviour is identical in all cases.

jest.mock('../src/db');
const db = require('../src/db');
const taskService = require('../src/services/taskService');

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getTask — async/await (was already async in the original legacy file)
// ---------------------------------------------------------------------------

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

  it('propagates a database error from the task query', async () => {
    db.query.mockRejectedValueOnce(new Error('connection refused'));
    await expect(taskService.getTask('task-1')).rejects.toThrow('connection refused');
  });

  it('returns empty arrays when the task has no comments or labels', async () => {
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
// createTask — updated to async/await in T1
// Original legacy signature: createTask(taskData, callback)
// Modern signature:          createTask(taskData): Promise<Task>
// Behaviour is identical: task is returned after the notification attempt.
// ---------------------------------------------------------------------------

describe('createTask', () => {
  it('inserts the task and returns the created row', async () => {
    const created = { id: 'new-task', title: 'New task', status: 'todo' };
    db.query.mockResolvedValueOnce({ rows: [created] });

    const task = await taskService.createTask({
      title: 'New task', projectId: 'proj-1', createdById: 'user-1',
    });
    expect(task).toEqual(created);
  });

  it('fires a notification when an assignee is provided', async () => {
    const created = { id: 'new-task', title: 'Assigned task', status: 'todo' };
    db.query
      .mockResolvedValueOnce({ rows: [created] })              // INSERT task (promise-based)
      .mockImplementationOnce((_sql, cb) => cb(null, {}));     // INSERT notification (callback-based)

    const task = await taskService.createTask({
      title: 'Assigned task', projectId: 'proj-1', createdById: 'user-1', assigneeId: 'user-2',
    });
    expect(task).toEqual(created);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('still returns the task when the notification insert fails', async () => {
    const created = { id: 'new-task', title: 'Assigned task', status: 'todo' };
    db.query
      .mockResolvedValueOnce({ rows: [created] })
      .mockImplementationOnce((_sql, cb) => cb(new Error('notification failed'), null));

    const task = await taskService.createTask({
      title: 'Assigned task', projectId: 'proj-1', createdById: 'user-1', assigneeId: 'user-2',
    });
    expect(task).toEqual(created);
  });

  it('propagates a database error from the task insert', async () => {
    db.query.mockRejectedValueOnce(new Error('insert failed'));
    await expect(
      taskService.createTask({ title: 'Bad task', projectId: 'proj-1', createdById: 'user-1' }),
    ).rejects.toThrow('insert failed');
  });

  it('embeds default priority and status in the SQL', async () => {
    const created = { id: 'new-task', title: 'Task', status: 'todo', priority: 'medium' };
    db.query.mockResolvedValueOnce({ rows: [created] });

    await taskService.createTask({ title: 'Task', projectId: 'proj-1', createdById: 'user-1' });

    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain("'todo'");
    expect(sql).toContain("'medium'");
  });
});

// ---------------------------------------------------------------------------
// updateTask — updated to async/await in T2
// Original legacy signature: updateTask(taskId, updates, callback)
// Modern signature:          updateTask(taskId, updates): Promise<Task>
// Behaviour is identical: throws Error('Task not found') on empty result.
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  it('returns the updated task row on success', async () => {
    const updated = { id: 'task-1', title: 'Updated title', status: 'in_progress' };
    db.query.mockResolvedValueOnce({ rows: [updated] });

    const task = await taskService.updateTask('task-1', { title: 'Updated title', status: 'in_progress' });
    expect(task).toEqual(updated);
  });

  it('throws when the task does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(taskService.updateTask('nonexistent', { title: 'x' })).rejects.toThrow('Task not found');
  });

  it('propagates a database error', async () => {
    db.query.mockRejectedValueOnce(new Error('update failed'));
    await expect(taskService.updateTask('task-1', { title: 'x' })).rejects.toThrow('update failed');
  });

  it('sets a field to NULL (not the string "null") when value is null', async () => {
    const updated = { id: 'task-1', title: 'task', assignee_id: null };
    db.query.mockResolvedValueOnce({ rows: [updated] });

    const task = await taskService.updateTask('task-1', { assignee_id: null });
    expect(task.assignee_id).toBeNull();
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('assignee_id = NULL');
    expect(sql).not.toContain("assignee_id = 'null'");
  });
});

// ---------------------------------------------------------------------------
// createNotification — still callback-based; behaviour captured
// (accessible via taskService re-export from notificationService)
// ---------------------------------------------------------------------------

describe('createNotification', () => {
  it('inserts a notification row and calls back with no error', (done) => {
    db.query.mockImplementationOnce((_sql, cb) => cb(null, {}));

    taskService.createNotification(
      'user-1', 'task_assigned', 'You were assigned a task', { taskId: 'task-1' },
      (err) => {
        expect(err).toBeNull();
        const sql = db.query.mock.calls[0][0];
        expect(sql).toContain('INSERT INTO notifications');
        done();
      },
    );
  });

  it('calls back with error when the insert fails', (done) => {
    db.query.mockImplementationOnce((_sql, cb) => cb(new Error('db error'), null));

    taskService.createNotification('user-1', 'task_assigned', 'msg', {}, (err) => {
      expect(err).toBeInstanceOf(Error);
      done();
    });
  });
});
