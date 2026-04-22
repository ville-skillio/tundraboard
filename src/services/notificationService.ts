import { prisma } from "../utils/prisma.js";

export async function notifyTaskAssigned(taskId: string, assigneeId: string, title: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.notification.findFirst({
      where: {
        userId: assigneeId,
        type: "task_assigned",
        metadata: { path: ["taskId"], equals: taskId },
      },
    });

    if (!existing) {
      await tx.notification.create({
        data: {
          userId: assigneeId,
          type: "task_assigned",
          title: "Task assigned",
          body: `You have been assigned: ${title}`,
          metadata: { taskId },
        },
      });
    }
  });
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
