/*
 * ============================================================================
 * PHASE 1 — Requirements (Slot 3 + chain-of-thought prompt)
 * ============================================================================
 *
 * PROMPT:
 * Let me think step by step about the requirements for POST /tasks in
 * TundraBoard before writing any code.
 *
 * TundraBoard is a multi-tenant task management API. Tasks belong to projects,
 * projects belong to workspaces, and workspace membership is role-based:
 * admin, member, viewer. Walk me through:
 *
 * 1. What fields does the request body need, which are required vs optional,
 *    and what are their validation rules?
 * 2. What authorisation checks are needed before creating a task?
 * 3. What are all the error cases and which HTTP status codes should each
 *    return?
 * 4. What should the success response look like?
 *
 * RESPONSE — requirements document:
 *
 * REQUEST BODY:
 *   title        string, required, 1–200 chars
 *   description  string, optional
 *   projectId    UUID, required — which project the task belongs to
 *   assigneeId   UUID, optional — must be a member of the same workspace
 *   priority     "low"|"medium"|"high"|"urgent", optional, default "medium"
 *   dueDate      ISO 8601 datetime string, optional, must be in the future
 *
 * Fields NOT accepted at creation time:
 *   status      — always starts as "todo"
 *   createdById — set from the authenticated JWT
 *   id, createdAt, updatedAt — server-generated
 *
 * AUTHORISATION RULES:
 *   1. Valid Bearer JWT required → 401 if missing or invalid
 *   2. Project identified by projectId must exist → 404 if not
 *   3. Caller must be workspace admin or member (not viewer) → 403 if not
 *   4. If assigneeId is provided, assignee must be a workspace member → 422
 *
 * ERROR CASES:
 *   400 — Zod validation fails (missing title, invalid UUID, bad priority,
 *          malformed dueDate, dueDate in the past)
 *   401 — Missing or invalid/expired JWT
 *   403 — Caller is not a workspace admin or member
 *   404 — projectId does not match any project
 *   422 — assigneeId provided but not a workspace member
 *   500 — Unexpected database or server error
 *
 * SUCCESS RESPONSE: 201 Created
 *   { "task": { id, title, description, status, priority, projectId,
 *               assigneeId, createdById, dueDate, createdAt, updatedAt } }
 * ============================================================================
 */

import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { createTask } from "../services/task.service.js";
import { createTaskSchema } from "../validation/task.schema.js";

export const taskRouter = Router();

/*
 * ============================================================================
 * PHASE 4 — Validation (Slot 1 + chain-of-thought prompt)
 * ============================================================================
 *
 * PROMPT:
 * Think through every failure mode for POST /tasks. For each one tell me:
 * - What triggers it?
 * - Which layer catches it (Zod, auth middleware, service, DB)?
 * - What HTTP status code should it return?
 * - Is there any case where a failure could be silently swallowed?
 *
 * Here is the Zod schema: [createTaskSchema pasted]
 * Here is the service: [task.service.ts pasted]
 *
 * RESPONSE — failure modes:
 *
 *  1. Missing/malformed Authorization header → authenticate → 401. Handled.
 *  2. Expired or tampered JWT → authenticate → 401. Handled.
 *  3. Missing title → Zod (min(1)) → 400 with issues array.
 *  4. title > 200 chars → Zod (max(200)) → 400.
 *  5. Missing projectId → Zod (required UUID) → 400.
 *  6. projectId is not a valid UUID format → Zod (z.string().uuid()) → 400.
 *  7. assigneeId present but not a valid UUID → Zod → 400. Correctly skipped
 *     when assigneeId is absent because the field is optional.
 *  8. priority outside the enum → Zod → 400.
 *  9. dueDate present but not ISO 8601 → Zod (.datetime()) → 400.
 * 10. dueDate in the past → Zod (.refine()) → 400.
 * 11. projectId valid UUID but no matching project → service 404 → errorHandler.
 * 12. User not a workspace member or is viewer → service 403 → errorHandler.
 * 13. assigneeId not a workspace member → service 422 → errorHandler.
 * 14. Prisma FK or constraint violation → unhandled Error, no .status →
 *     errorHandler returns 500. Acceptable for now; a future improvement
 *     would map Prisma P2002/P2003 codes to 409/422.
 * 15. Silent swallow check: empty/missing body → express.json() sets
 *     req.body to undefined; safeParse(undefined) fails for required fields
 *     → 400. No silent swallow.
 *
 * Failure modes covered: 400, 401, 403, 404, 422, 500.
 * ============================================================================
 */

taskRouter.post("/", authenticate, async (req, res, next) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: { message: "Validation failed", issues: parsed.error.issues } });
    return;
  }

  try {
    const task = await createTask(parsed.data, req.user!.id);
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

/*
 * ============================================================================
 * PHASE 6 — Self-review (Slot 3 + Role prompt)
 * ============================================================================
 *
 * PROMPT:
 * You are a senior API designer doing a pre-merge review focused on API
 * ergonomics, error-shape consistency, and edge-case completeness.
 * This is NOT a security audit — that happens in Module 3.
 *
 * Review this POST /tasks implementation: [tasks.ts + task.service.ts pasted]
 *
 * Identify at least two concrete findings and how you addressed each.
 *
 * FINDINGS:
 *
 * Finding 1 — dueDate in the past was silently accepted.
 * The first Zod schema draft validated datetime format but not whether the
 * date is in the future. A caller could create a task already overdue.
 * This may be intentional for data imports, but for a UI-driven API it is
 * almost certainly a mistake.
 * Resolution applied: added .refine() to reject past dates with the message
 * "dueDate must be in the future". If bulk-import is ever needed, a separate
 * admin endpoint can bypass this check.
 *
 * Finding 2 — 404 vs 403 ordering is intentional but not obvious.
 * The service returns 404 ("Project not found") before checking workspace
 * membership. A 403 at that point would confirm the project exists, which
 * leaks information to non-members. The current order is correct — a
 * non-member sees the same 404 as a genuinely missing project. Documented
 * here so the next reader does not "fix" the ordering.
 *
 * Finding 3 — Non-JSON body produces an unhelpful 400.
 * If a caller sends a form-encoded body, express.json() sets req.body to {}
 * and Zod returns 400 for missing required fields rather than a clearer
 * "expected JSON" message. This matches how auth.ts behaves, so leaving it
 * as-is for convention consistency, but noting it as a future improvement.
 * ============================================================================
 */

taskRouter.get("/", authenticate, (_req, res) => {
  res.status(501).json({ error: { message: "Not implemented" } });
});

taskRouter.get("/:id", authenticate, (_req, res) => {
  res.status(501).json({ error: { message: "Not implemented" } });
});

taskRouter.patch("/:id", authenticate, (_req, res) => {
  res.status(501).json({ error: { message: "Not implemented" } });
});

taskRouter.delete("/:id", authenticate, (_req, res) => {
  res.status(501).json({ error: { message: "Not implemented" } });
});
