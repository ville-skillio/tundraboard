import { prisma } from "../utils/prisma.js";

// BUG #4 (PLANTED): Race condition — two concurrent task updates can both
// read the notification count, both create a notification, resulting in
// duplicate notifications to the same user
export async function notifyTaskAssigned(taskId: string, assigneeId: string, title: string) {
  // Check if a notification already exists for this assignment
  const existing = await prisma.notification.findFirst({
    where: {
      userId: assigneeId,
      type: "task_assigned",
      metadata: {
        path: ["taskId"],
        equals: taskId,
      },
    },
  });

  // Race window: between the findFirst and create, another concurrent
  // request can also pass the check and create a duplicate
  if (!existing) {
    await prisma.notification.create({
      data: {
        userId: assigneeId,
        type: "task_assigned",
        title: "Task assigned",
        body: `You have been assigned: ${title}`,
        metadata: { taskId },
      },
    });
  }
}

export async function getNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function markAsRead(id: string) {
  return prisma.notification.update({
    where: { id },
    data: { read: true },
  });
}
