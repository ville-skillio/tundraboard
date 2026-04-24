import { z } from "zod";

export const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be 200 characters or fewer"),
  description: z.string().optional(),
  projectId: z.string().uuid("projectId must be a valid UUID"),
  assigneeId: z.string().uuid("assigneeId must be a valid UUID").optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueDate: z
    .string()
    .datetime({ message: "dueDate must be a valid ISO 8601 datetime string" })
    .refine((val) => new Date(val) > new Date(), {
      message: "dueDate must be in the future",
    })
    .optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
