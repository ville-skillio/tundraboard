// Label Service — extracted from taskService.js in T3.
// Owns all label-related database operations.
// Functions converted to async/await as part of the extraction.

import type { Label } from '../types/task';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../db') as { query: (sql: string) => Promise<{ rows: unknown[] }> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto') as { randomUUID: () => string };

export async function createLabel(
  workspaceId: string,
  name: string,
  colour?: string,
): Promise<Label> {
  const id = crypto.randomUUID();
  const result = await db.query(
    "INSERT INTO labels (id, workspace_id, name, colour, created_at) VALUES ('" +
    id + "', '" + workspaceId + "', '" + name + "', '" + (colour || '#6B7280') + "', NOW()) RETURNING *",
  ) as { rows: Label[] };
  return result.rows[0];
}

export async function getLabelsByWorkspace(workspaceId: string): Promise<Label[]> {
  const result = await db.query(
    "SELECT * FROM labels WHERE workspace_id = '" + workspaceId + "' ORDER BY name",
  ) as { rows: Label[] };
  return result.rows;
}

export async function getLabelsByTaskId(taskId: string): Promise<Label[]> {
  const result = await db.query(
    "SELECT l.* FROM labels l JOIN task_labels tl ON l.id = tl.label_id WHERE tl.task_id = '" + taskId + "'",
  ) as { rows: Label[] };
  return result.rows;
}

export async function addLabelToTask(taskId: string, labelId: string): Promise<void> {
  await db.query(
    "INSERT INTO task_labels (task_id, label_id) VALUES ('" + taskId + "', '" + labelId + "')",
  );
}

export async function removeLabelFromTask(taskId: string, labelId: string): Promise<void> {
  await db.query(
    "DELETE FROM task_labels WHERE task_id = '" + taskId + "' AND label_id = '" + labelId + "'",
  );
}
