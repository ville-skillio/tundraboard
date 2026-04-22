// Extracted from taskService.ts in T3.
// Owns all notification-related database operations.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require('../db') as { query: (sql: string, ...args: unknown[]) => Promise<{ rows: unknown[] }> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require('crypto') as { randomUUID: () => string };

export function createNotification(
  userId: string,
  type: string,
  body: string,
  metadata: Record<string, unknown>,
  callback?: (err: Error | null) => void,
): void {
  const id = crypto.randomUUID();
  const metadataStr = JSON.stringify(metadata);
  db.query(
    "INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at) VALUES ('" + id + "', '" + userId + "', '" + type + "', '" + type + "', '" + body + "', '" + metadataStr + "', NOW())",
    function(err: Error | null) {
      if (err) {
        if (callback) callback(err);
        return;
      }
      if (callback) callback(null);
    },
  );
}

export function getNotifications(
  userId: string,
  callback: (err: Error | null, notifications?: unknown[]) => void,
): void {
  db.query(
    "SELECT * FROM notifications WHERE user_id = '" + userId + "' ORDER BY created_at DESC LIMIT 50",
    function(err: Error | null, result: { rows: unknown[] }) {
      if (err) {
        callback(err);
        return;
      }
      callback(null, result.rows);
    },
  );
}

export function markNotificationRead(
  notificationId: string,
  callback: (err: Error | null) => void,
): void {
  db.query(
    "UPDATE notifications SET read = true WHERE id = '" + notificationId + "'",
    function(err: Error | null) {
      callback(err);
    },
  );
}
