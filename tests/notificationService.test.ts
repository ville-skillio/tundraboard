import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "../src/utils/prisma.js";
import {
  notifyTaskAssigned,
  getNotifications,
  markAsRead,
} from "../src/services/notificationService.js";

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const MOCK_NOTIFICATION = {
  id: "n-1",
  userId: "user-1",
  type: "task_assigned",
  title: "Task assigned",
  body: "You have been assigned: Fix bug",
  read: false,
  metadata: { taskId: "task-1" },
  createdAt: new Date(),
};

describe("notificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("notifyTaskAssigned", () => {
    it("creates a notification when none exists for the task+assignee", async () => {
      const mockCreate = vi.fn().mockResolvedValue(MOCK_NOTIFICATION);
      const mockFindFirst = vi.fn().mockResolvedValue(null);

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        return fn({ notification: { findFirst: mockFindFirst, create: mockCreate } });
      });

      await notifyTaskAssigned("task-1", "user-1", "Fix bug");

      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-1", type: "task_assigned" }),
        }),
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            type: "task_assigned",
            body: "You have been assigned: Fix bug",
          }),
        }),
      );
    });

    it("does not create a duplicate notification if one already exists", async () => {
      const mockCreate = vi.fn();
      const mockFindFirst = vi.fn().mockResolvedValue(MOCK_NOTIFICATION);

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => {
        return fn({ notification: { findFirst: mockFindFirst, create: mockCreate } });
      });

      await notifyTaskAssigned("task-1", "user-1", "Fix bug");

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("getNotifications", () => {
    it("returns notifications for the given user ordered by createdAt desc", async () => {
      vi.mocked(prisma.notification.findMany).mockResolvedValue([MOCK_NOTIFICATION]);

      const result = await getNotifications("user-1");

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("id", "n-1");
    });

    it("returns an empty array when the user has no notifications", async () => {
      vi.mocked(prisma.notification.findMany).mockResolvedValue([]);

      const result = await getNotifications("user-2");

      expect(result).toEqual([]);
    });
  });

  describe("markAsRead", () => {
    it("marks a notification as read and returns the updated record", async () => {
      const updated = { ...MOCK_NOTIFICATION, read: true };
      vi.mocked(prisma.notification.update).mockResolvedValue(updated);

      const result = await markAsRead("n-1");

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: "n-1" },
        data: { read: true },
      });
      expect(result.read).toBe(true);
    });
  });
});
