# Workflow 03 — Authorization & Security Audit (Code Review / Analysis)

## Trigger

A route implementation PR is ready for review, OR you have just finished implementing
a route and want to self-audit before committing. This workflow surfaces auth gaps,
IDOR vulnerabilities, mass-assignment risks, and RBAC holes — the class of bugs
most common in multi-tenant APIs.

---

## Prerequisites / Context

| Item | Where to find it |
|------|-----------------|
| The route file to audit | `src/routes/<name>.ts` |
| Authorization model summary | See below — copy once, reuse forever |
| Prisma schema for models touched | `prisma/schema.prisma` |
| Middleware wiring | `src/app.ts` — check which routes use `authenticate` |

**TundraBoard authorization model (paste into every audit prompt):**

```
Multi-tenant model:
- Every resource (Project, Task, Comment, Label) belongs to a Workspace.
- Users access resources only through WorkspaceMember rows.
- WorkspaceMember.role is one of: admin | member | viewer
  · viewer  → read-only (GET)
  · member  → read + create + update tasks/comments they own
  · admin   → full CRUD including delete and workspace settings

Security invariants:
1. An authenticated user must have a WorkspaceMember row for the workspace that
   owns the resource — otherwise return 403.
2. The resource's workspaceId (or its parent's) must match the workspace the user
   is a member of — otherwise an attacker can access cross-tenant data (IDOR).
3. Viewer role may not call POST / PATCH / DELETE on tasks, projects, comments,
   labels, or webhooks.
4. Prisma update/create calls must use an explicit field allowlist, never
   req.body spread.
5. authenticate middleware must be applied before any handler that reads req.user.
```

---

## Prompt Sequence

### Prompt 1 — Role-Setting + Structured Audit

**Slot:** Single prompt (this workflow is one focused pass)  
**Pattern:** Role-setting + structured output

```
You are a backend security reviewer specializing in Node.js REST APIs.
Audit the following Express route file for TundraBoard.

TundraBoard authorization model:
[PASTE THE MODEL FROM ABOVE]

For each finding, report:
- Line number (or "file-level" if structural)
- Severity: CRITICAL · HIGH · MEDIUM · LOW
- Category: missing-auth · idor · mass-assignment · rbac · input-validation · other
- One-sentence description of the vulnerability
- Concrete fix (code snippet or instruction)

After all findings, give a summary verdict: PASS (no critical/high issues) or
FAIL (one or more critical/high issues found).

Route file to audit:
[PASTE src/routes/<name>.ts]

app.ts router wiring (for context):
[PASTE the relevant app.use lines from src/app.ts]
```

---

### Prompt 2 — Fix Application (if FAIL)

**Slot:** Follow-up if findings exist  
**Pattern:** Constrained generation

```
Apply all CRITICAL and HIGH severity fixes to the route file.
Output the complete corrected file — no partial diffs.
Do not change behavior for MEDIUM/LOW findings; list those separately for
the developer to decide.
```

---

### Prompt 3 — Regression Check (Optional)

**Slot:** After applying fixes  
**Pattern:** Critique

```
Here is the corrected route file. Re-run the same audit checklist and confirm
that all previously reported CRITICAL and HIGH findings are resolved.
Report any new issues introduced by the fixes.

Corrected file:
[PASTE UPDATED ROUTE FILE]
```

---

## Verification Checklist

- [ ] `authenticate` middleware applied to every non-public route
- [ ] Every GET/PATCH/DELETE handler verifies the resource's workspace matches a
      workspace where `req.user.id` has a `WorkspaceMember` row
- [ ] PATCH/POST/DELETE handlers reject `viewer` role with 403
- [ ] No `prisma.model.update({ data: req.body })` or equivalent spread
- [ ] UUID path parameters (`req.params.id`) validated with `z.string().uuid()`
      before hitting the database
- [ ] 404 returned for non-existent resources (not 403, which leaks existence)
- [ ] Audit verdict from Prompt 1 is PASS, or all CRITICAL/HIGH items resolved
