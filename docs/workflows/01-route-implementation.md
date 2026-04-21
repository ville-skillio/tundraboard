# Workflow 01 — Implement an Express Route (Code Generation)

## Trigger

A route file in `src/routes/` contains a `// TODO: Implement` block and needs its full implementation: Zod validation, Prisma queries, auth/authorization checks, and correct HTTP status codes.

---

## Prerequisites / Context

Gather the following before starting the prompt sequence:

| Item | Where to find it |
|------|-----------------|
| The full TODO comment block from the route file | `src/routes/<name>.ts` |
| Prisma models touched by this route | `prisma/schema.prisma` — copy only the relevant models |
| An already-implemented route as a style reference | Use `src/routes/auth.ts` once implemented, or the error handler pattern |
| `req.user` shape | `src/types/express.d.ts` — `{ id, email, displayName }` |
| Authorization rules for this resource | The TODO comment lists them; note admin/member/viewer distinctions |
| Any env vars required | `JWT_SECRET`, `DATABASE_URL` |

---

## Prompt Sequence

### Prompt 1 — Role-Setting (Project Context)

**Slot:** Start of conversation / system prompt  
**Pattern:** Role-setting

```
You are a senior TypeScript/Express developer implementing route handlers for
TundraBoard, a multi-tenant task management REST API.

Stack: Express.js · TypeScript · Prisma (PostgreSQL) · Zod · jsonwebtoken · bcryptjs

Hard project conventions — never deviate:
1. Never pass req.body directly to Prisma. Always use an explicit field allowlist.
2. Validate all inputs with a Zod schema before any database access.
3. HTTP status codes: 201 created · 400 validation error · 401 unauthenticated ·
   403 forbidden · 404 not found · 422 invalid foreign-key reference.
4. req.user is typed as { id: string; email: string; displayName: string } and is
   populated by the authenticate middleware.
5. The global errorHandler middleware catches thrown errors, so you may throw for
   unexpected database failures.
6. No comments in generated code — use well-named identifiers instead.

Relevant Prisma schema:
[PASTE MODELS FROM prisma/schema.prisma — only the models this route touches]
```

---

### Prompt 2 — Chain-of-Thought Analysis

**Slot:** Second message  
**Pattern:** Chain-of-Thought (reason before coding)

```
Before writing any code, reason through the implementation of [ROUTE_FILE_NAME].
Answer each question explicitly:

1. Which Prisma models are involved? What relations need to be included in queries?
2. Trace the authorization path: what workspace membership check runs first?
   Which operations require admin/member role (not viewer)?
3. Design the Zod schema: what fields are required vs optional? What are the
   constraints (min/max length, enum values, UUID format)?
4. List every error case with its HTTP status code and a one-line description.
5. Are there any ordering/cursor-pagination concerns for list endpoints?
6. Are there mass-assignment risks in PATCH endpoints that need a strict allowlist?

Route specification to analyze:
[PASTE THE FULL TODO COMMENT BLOCK FROM THE ROUTE FILE]
```

---

### Prompt 3 — Code Generation

**Slot:** Third message (after reviewing the analysis)  
**Pattern:** Constrained generation

```
Implement the complete [ROUTE_FILE_NAME] file based on your analysis above.

Output requirements:
- Complete TypeScript file, ready to save as src/routes/[name].ts
- Zod schemas defined at module scope (not inline)
- Prisma queries use explicit select/include — no raw req.body spread
- Each route handler is an async function; unhandled errors bubble to errorHandler
- Correct status codes per the project conventions
- No inline comments

Show only the file contents, no explanation.
```

---

## Verification Checklist

After the AI generates the file, check each item before accepting:

- [ ] `npx tsc --noEmit` passes with no errors
- [ ] Every route handler calls `authenticate` middleware (check app.use or route-level)
- [ ] Zod `.parse()` or `.safeParse()` is called before any Prisma access
- [ ] No `req.body` spread directly into a Prisma create/update call
- [ ] Workspace membership is verified before returning any data
- [ ] Role check (`admin`/`member` vs `viewer`) applied to mutating operations
- [ ] Status 201 returned on POST success, not 200
- [ ] List endpoints have pagination (limit + cursor or offset)
- [ ] Delete returns 204 with no body
- [ ] No hardcoded secrets or env vars (use `process.env.X`)
