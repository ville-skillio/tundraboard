'use strict';

// Characterisation tests for labelService.ts (T3 — extracted from taskService.js)
//
// PROMPT used (Slot 1, few-shot):
// "Using the same characterisation test pattern as the existing
//  taskService tests (jest.mock the db, mockResolvedValueOnce / mockRejectedValueOnce
//  for async functions), write tests for the five label functions that were
//  extracted into labelService.ts.
//
//  Functions to cover:
//    createLabel, getLabelsByWorkspace, getLabelsByTaskId,
//    addLabelToTask, removeLabelFromTask
//
//  For each function test: success path, and at least one error path.
//  Here is the labelService.ts file: [pasted]"

jest.mock('../src/db');
const db = require('../src/db');
const labelService = require('../src/services/labelService');

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createLabel
// ---------------------------------------------------------------------------

describe('createLabel', () => {
  it('inserts a label and returns the created row', async () => {
    const created = { id: 'label-1', workspace_id: 'ws-1', name: 'backend', colour: '#6B7280' };
    db.query.mockResolvedValueOnce({ rows: [created] });

    const label = await labelService.createLabel('ws-1', 'backend');
    expect(label).toEqual(created);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO labels');
    expect(sql).toContain('#6B7280'); // default colour applied
  });

  it('uses the provided colour when given', async () => {
    const created = { id: 'label-1', workspace_id: 'ws-1', name: 'bug', colour: '#EF4444' };
    db.query.mockResolvedValueOnce({ rows: [created] });

    await labelService.createLabel('ws-1', 'bug', '#EF4444');
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('#EF4444');
  });

  it('propagates a database error', async () => {
    db.query.mockRejectedValueOnce(new Error('insert failed'));
    await expect(labelService.createLabel('ws-1', 'backend')).rejects.toThrow('insert failed');
  });
});

// ---------------------------------------------------------------------------
// getLabelsByWorkspace
// ---------------------------------------------------------------------------

describe('getLabelsByWorkspace', () => {
  it('returns all labels for the workspace ordered by name', async () => {
    const labels = [
      { id: 'l-1', name: 'backend' },
      { id: 'l-2', name: 'frontend' },
    ];
    db.query.mockResolvedValueOnce({ rows: labels });

    const result = await labelService.getLabelsByWorkspace('ws-1');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('backend');
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain("workspace_id = 'ws-1'");
    expect(sql).toContain('ORDER BY name');
  });

  it('returns an empty array when the workspace has no labels', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await labelService.getLabelsByWorkspace('ws-1');
    expect(result).toHaveLength(0);
  });

  it('propagates a database error', async () => {
    db.query.mockRejectedValueOnce(new Error('query failed'));
    await expect(labelService.getLabelsByWorkspace('ws-1')).rejects.toThrow('query failed');
  });
});

// ---------------------------------------------------------------------------
// getLabelsByTaskId
// ---------------------------------------------------------------------------

describe('getLabelsByTaskId', () => {
  it('returns labels joined through task_labels for the given task', async () => {
    const labels = [{ id: 'l-1', name: 'backend' }];
    db.query.mockResolvedValueOnce({ rows: labels });

    const result = await labelService.getLabelsByTaskId('task-1');
    expect(result).toHaveLength(1);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('task_labels');
    expect(sql).toContain("task_id = 'task-1'");
  });

  it('returns an empty array when the task has no labels', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await labelService.getLabelsByTaskId('task-1');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addLabelToTask
// ---------------------------------------------------------------------------

describe('addLabelToTask', () => {
  it('inserts a task_labels row and resolves', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(labelService.addLabelToTask('task-1', 'label-1')).resolves.toBeUndefined();
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('INSERT INTO task_labels');
    expect(sql).toContain("task_id = 'task-1'");
    expect(sql).toContain("label_id = 'label-1'");
  });

  it('propagates a database error (e.g. duplicate label)', async () => {
    db.query.mockRejectedValueOnce(new Error('duplicate key'));
    await expect(labelService.addLabelToTask('task-1', 'label-1')).rejects.toThrow('duplicate key');
  });
});

// ---------------------------------------------------------------------------
// removeLabelFromTask
// ---------------------------------------------------------------------------

describe('removeLabelFromTask', () => {
  it('deletes the task_labels row and resolves', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await expect(labelService.removeLabelFromTask('task-1', 'label-1')).resolves.toBeUndefined();
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('DELETE FROM task_labels');
    expect(sql).toContain("task_id = 'task-1'");
    expect(sql).toContain("label_id = 'label-1'");
  });

  it('propagates a database error', async () => {
    db.query.mockRejectedValueOnce(new Error('delete failed'));
    await expect(labelService.removeLabelFromTask('task-1', 'label-1')).rejects.toThrow('delete failed');
  });
});
