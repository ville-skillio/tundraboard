# Exercise 17: RAG-Powered Code Search Tool for TundraBoard

---

## Part 1: Use Cases — Developer Questions a RAG System Could Answer

These are questions the TundraBoard development team realistically asks multiple times per week, where the answer requires reading across several files or remembering a convention that is not written in a README.

1. **"How do I add workspace permission checks to a new endpoint?"**  
   Requires knowing the `WorkspaceMember` lookup pattern, the `userId_workspaceId` composite key, where `req.user` comes from, and which role values block write operations. This pattern lives in `src/routes/labels.ts` and the auth model doc, not in any single obvious place.

2. **"What is the full pattern for implementing a new Express route (auth, validation, error handling)?"**  
   A developer needs to know: import `Router` and `authenticate`, use a Zod schema, wrap handler body in try/catch, call `next(error)`, and mount the router in `app.ts`. This is documented in `docs/workflows/01-route-implementation.md` but easy to forget.

3. **"How does full-text search work for tasks, and how do I add it to another model?"**  
   The answer spans `prisma/sql/add_full_text_search.sql` (the trigger), `prisma/schema.prisma` (the `searchVector` tsvector column and GIN index), and `src/services/taskService.ts` (the two-phase SQL + Prisma query). No single file tells the full story.

4. **"What audit/logging should I add when implementing a destructive operation?"**  
   The `AuditLog` model exists in the schema with `action`, `resource`, `resourceId`, and `metadata` fields, and the authorization audit workflow references it — but there is no working example of creating an AuditLog entry in the codebase yet, so a developer needs to infer the convention from the schema and the audit doc.

5. **"How does webhook HMAC verification work, and where is the signing secret stored?"**  
   The logic lives in `src/services/webhookService.ts` (HMAC-SHA256 with timing-safe comparison), the secret is on the `Webhook` model in `prisma/schema.prisma`, and the encryption utility for storing it is in `src/services/cryptoUtils.ts`. A developer asking about security for webhooks needs all three pieces.

6. **"What should my Zod validation schema look like for a new POST endpoint?"**  
   Examples exist in `src/routes/auth.ts` (registerSchema) and `src/routes/tasks.ts`, but the style differs slightly between them. A RAG system could retrieve both and let the developer see the established pattern.

7. **"Which fields are safe to expose in an API response, and which should be omitted?"**  
   `passwordHash` must never appear; `storageKey` on attachments is internal. These invariants are implicit in existing `select` clauses scattered across route files — a RAG system could surface all of them together.

---

## Part 2: System Architecture

### 2.1 Documents to Index

| Source | Format | Why |
|---|---|---|
| `src/routes/*.ts` | TypeScript | Defines every endpoint, validation schema, and auth pattern |
| `src/services/*.ts` | TypeScript | Business logic, query patterns, error conventions |
| `src/middleware/*.ts` | TypeScript | Auth and error handling contracts |
| `prisma/schema.prisma` | Prisma SDL | Canonical source of truth for all models, fields, indexes, relations |
| `prisma/sql/*.sql` | SQL | Full-text search trigger, any stored procedures |
| `prisma/migrations/*/migration.sql` | SQL | Actual DDL run against the database |
| `docs/workflows/*.md` | Markdown | Explicit developer workflow guides and authorization model |
| `docs/*.md` | Markdown | Context management guide, general architecture notes |
| `tests/*.test.ts` | TypeScript | Shows correct usage patterns and expected behaviour |
| `README.md` | Markdown | Project overview, setup, and branch descriptions |

**Chunking strategy:** chunk by logical unit, not by line count. For TypeScript files, one chunk per exported function or route handler (roughly 20–80 lines each). For Prisma schema, one chunk per model block. For Markdown, one chunk per `##` section. Overlap each chunk with the first 3 lines of the previous chunk to preserve context across boundaries.

**Metadata to store with each chunk:**
- `file_path` — enables "show me the source" link
- `language` — TypeScript | SQL | Prisma | Markdown
- `chunk_type` — route | service | middleware | model | doc | test
- `last_modified` — for freshness filtering
- `symbol_name` — exported function or route path if applicable

---

### 2.2 Embedding Model and Vector Database

**Embedding model: `text-embedding-3-small` (OpenAI)**  
- 1536-dimension vectors, strong at code + prose mixed content  
- Cost: ~$0.02 per million tokens — the entire TundraBoard codebase fits in roughly 100k tokens, so full re-indexing costs under $0.01  
- Alternative: `voyage-code-2` (Voyage AI) if code retrieval precision needs to improve; benchmarks better on code-specific tasks but adds a vendor dependency  

**Vector database: pgvector (PostgreSQL extension)**  
- TundraBoard already runs PostgreSQL; adding pgvector keeps the stack to one database  
- Supports HNSW indexes for sub-millisecond ANN search at this data size  
- No additional infrastructure to operate or secure  
- At TundraBoard's scale (< 5,000 chunks), pgvector HNSW with `lists=100` gives excellent recall  
- Alternative: Qdrant (self-hosted or cloud) if the team later needs multi-tenant isolation or filtering at scale; overkill now  

---

### 2.3 Retrieval Pipeline

```
Developer query (natural language)
        │
        ▼
  [Query expansion]
  Optionally rewrite with file-path hints if query contains
  known symbols (e.g. "WorkspaceMember" → boost schema chunks)
        │
        ▼
  [Embedding] text-embedding-3-small → 1536-dim vector
        │
        ▼
  [Vector search] pgvector HNSW, top-8 chunks by cosine similarity
        │
        ▼
  [Metadata filter] Optionally restrict to chunk_type=route|service|doc
  based on query classification
        │
        ▼
  [Keyword re-rank] BM25 on raw text (using pg_bm25 / ParadeDB, or simple
  trigram) to boost chunks containing exact symbol names from the query
        │
        ▼
  [Deduplication] Remove chunks from the same file if they overlap > 80%
        │
        ▼
  Top-5 ranked chunks → Generation pipeline
```

**Latency budget:** embedding ~100ms, vector search ~20ms, re-rank ~30ms → total retrieval under 200ms, well within interactive use.

---

### 2.4 Generation Pipeline

```
System prompt
  "You are a code assistant for TundraBoard. Answer only using
   the provided context. If the answer is not in the context,
   say so. Include file paths and line numbers when citing code."

User message
  <developer question>

Retrieved context (top-5 chunks, labelled with file path + chunk type)
  [src/routes/labels.ts — route]
  ...
  [prisma/schema.prisma — model]
  ...

        │
        ▼
  Claude claude-sonnet-4-6 (or claude-haiku-4-5 for cost savings)
        │
        ▼
  Answer with citations
  "The membership check at src/routes/labels.ts:16–22 shows the pattern..."
```

**Prompt caching:** the system prompt and indexed context for common queries should use Anthropic prompt caching (cache_control: ephemeral breakpoint) — the codebase changes infrequently so cache hit rates will be high, reducing cost ~90% for repeated queries.

**Fallback:** if the top-ranked chunk similarity score is below 0.65, respond "I could not find a confident match — try rephrasing or check docs/ directly" rather than hallucinating.

---

### 2.5 Infrastructure Requirements

| Component | Choice | Notes |
|---|---|---|
| Vector store | pgvector on existing PostgreSQL | Zero new infra; add `CREATE EXTENSION vector` |
| Embedding service | OpenAI Embeddings API | Called at index time and query time |
| LLM | Anthropic Claude API | Already used in TundraBoard agents/ |
| Indexer | Node.js script (TypeScript) | Runs on git post-commit hook or CI step |
| API layer | Express endpoint or VS Code extension | Thin wrapper around retrieval + generation |
| Re-indexing trigger | GitHub Actions on push to main | Incremental: only re-embed changed files |
| Auth | Reuse TundraBoard JWT | Same `authenticate` middleware |

**Estimated ongoing cost:** at 50 queries/day (5 developers × 10 queries), roughly 500k tokens/month through the LLM → ~$1.50/month at Haiku pricing, ~$7.50/month at Sonnet pricing. Embedding costs are negligible.

---

## Part 3: Build vs Buy Evaluation

### The Question
Should TundraBoard build a custom RAG code search tool or use a commercial product?

### Commercial Alternatives

| Product | What it does | Monthly cost (est.) |
|---|---|---|
| GitHub Copilot Enterprise | Codebase-aware chat + code completion | $39/user → ~$195/mo for 5 devs |
| Sourcegraph Cody Enterprise | Repository-aware AI assistant | ~$19/user → ~$95/mo for 5 devs |
| Cursor (Teams) | IDE with codebase context | $40/user → ~$200/mo for 5 devs |
| Greptile | RAG API over GitHub repos, SaaS | ~$100–200/mo at this scale |

### Framework Evaluation

**Number of developers:** 5 (small team)  
**Frequency of use:** Daily — every time a developer implements a new route, writes a test, or audits auth patterns  
**Maintenance requirement:** The codebase is under active development; index must stay fresh

| Factor | Build | Buy |
|---|---|---|
| **Upfront cost** | 2–3 days of engineering time | Zero |
| **Ongoing cost** | ~$10/mo (API calls) | $95–200/mo |
| **TundraBoard-specific context** | Full control — index ADRs, workflow docs, seeds, test patterns | Partial — Copilot/Cody index code but not internal Markdown docs well |
| **Integration with auth/workspace model** | Can enforce workspace-scoped queries | Generic; no workspace awareness |
| **Maintenance burden** | Re-indexing pipeline + prompt tuning | Zero maintenance |
| **Time to first value** | 3–5 days | Same day |
| **Privacy** | Code stays on-prem (pgvector) | Code sent to vendor |

### Recommendation: **Hybrid — Buy for now, plan to build**

At 5 developers, the fastest path to value is **GitHub Copilot Enterprise or Cursor** today. Both index the repository automatically, provide IDE-native UX, and are operational within an hour. The $200/month cost is justified by daily use across the team.

However, TundraBoard has a concrete gap that commercial tools do not fill: the internal Markdown workflow docs (`docs/workflows/`, `docs/context-management-guide.md`) and the Prisma schema together form an authoritative reference that LLMs without this context consistently get wrong. A targeted custom RAG layer — built in a 2-day sprint using pgvector + the existing PostgreSQL instance — would complement a commercial tool by handling these "deep TundraBoard" queries specifically.

**Decision:** Deploy Copilot Enterprise immediately. Build the custom pgvector RAG layer in Month 2, scoped only to the internal docs and schema, and surface it as a Slack bot or VS Code command rather than a full IDE replacement.

---

## Part 4: Simulated RAG Query

### Query
> "How do I add workspace permission checks to a new endpoint in TundraBoard?"

---

### 4a: Answer WITHOUT RAG Context (no codebase retrieved)

**Prompt:** "How do I add workspace permission checks to a new endpoint in TundraBoard? TundraBoard is a TypeScript/Express project with Prisma and PostgreSQL."

**Simulated LLM response (no context):**

> You can add workspace permission checks by creating a middleware function that verifies the user's role for the given workspace. Typically you would:
> 1. Extract `workspaceId` from the request (params or body)
> 2. Query a `WorkspaceMember` or similar join table for the user's role
> 3. Return 403 if the user is not a member or does not have the required role
> 4. Call `next()` to continue
>
> Something like:
> ```typescript
> async function requireWorkspaceMember(req, res, next) {
>   const { workspaceId } = req.params;
>   const member = await db.workspaceMember.findOne({
>     userId: req.user.id, workspaceId
>   });
>   if (!member) return res.status(403).json({ error: "Forbidden" });
>   next();
> }
> ```
> Attach this middleware after your auth middleware on protected routes.

**Problems with this answer:**
- `findOne` does not exist in Prisma — it's `findUnique`
- The `where` clause format is wrong — Prisma uses a composite unique index argument: `{ userId_workspaceId: { userId, workspaceId } }`
- The response shape `{ error: "Forbidden" }` doesn't match TundraBoard's actual convention: `{ error: { message: "..." } }`
- Does not mention the `viewer` role restriction for write operations
- Does not show where the membership check happens relative to the route handler (inline, not middleware)
- Does not reference `req.user!.id` (TypeScript non-null assertion) which is the actual pattern

---

### 4b: Retrieved Context (what RAG would surface)

**Retrieved chunk 1** — `src/routes/labels.ts:8–31` (chunk_type: route, similarity: 0.91)

```typescript
// Create label
labelRouter.post("/", authenticate, async (req, res, next) => {
  try {
    const { name, colour, workspaceId } = req.body as {
      name: string;
      colour?: string;
      workspaceId: string;
    };

    const membership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: req.user!.id, workspaceId } },
    });
    if (!membership) {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }

    const label = await prisma.label.create({
      data: { workspaceId, name, colour: colour ?? "#6B7280" },
    });
    res.status(201).json({ data: label });
  } catch (error) {
    next(error);
  }
});
```

**Retrieved chunk 2** — `src/routes/labels.ts:57–92` (chunk_type: route, similarity: 0.88)

```typescript
// Update label
labelRouter.patch("/:id", authenticate, async (req, res, next) => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.label.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: { message: "Label not found" } });
      return;
    }

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: req.user!.id,
          workspaceId: existing.workspaceId,
        },
      },
    });
    if (!membership || membership.role === "viewer") {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }
    // ... update logic
  } catch (error) {
    next(error);
  }
});
```

**Retrieved chunk 3** — `src/middleware/authenticate.ts:1–28` (chunk_type: middleware, similarity: 0.82)

```typescript
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: { message: "Authorization header missing or malformed" } });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "...") as {
      id: string; email: string; displayName: string;
    };
    req.user = { id: payload.id, email: payload.email, displayName: payload.displayName };
    next();
  } catch {
    res.status(401).json({ error: { message: "Invalid or expired token" } });
  }
}
```

**Retrieved chunk 4** — `docs/workflows/03-authorization-audit.md` (chunk_type: doc, similarity: 0.79)

> Roles: `admin` | `member` | `viewer`  
> Viewers can only perform GET operations. All POST/PATCH/DELETE routes must check `membership.role === "viewer"` and return 403.  
> Cross-tenant check: always verify the resource's `workspaceId` matches the workspace the user is a member of — never trust `workspaceId` from the request body alone for ownership checks.

---

### 4c: Answer WITH RAG Context

**Prompt (with retrieved chunks above included as context):**

> Based on the retrieved TundraBoard code, here is the exact pattern used in this codebase:

**Step 1 — Apply `authenticate` middleware inline on the route:**
```typescript
yourRouter.post("/", authenticate, async (req, res, next) => {
```
`authenticate` populates `req.user` — you access the user ID as `req.user!.id`.

**Step 2 — Fetch workspace membership using Prisma's composite key:**
```typescript
const membership = await prisma.workspaceMember.findUnique({
  where: { userId_workspaceId: { userId: req.user!.id, workspaceId } },
});
if (!membership) {
  res.status(403).json({ error: { message: "Access denied" } });
  return;
}
```
(`src/routes/labels.ts:16–22`)

**Step 3 — For write operations (POST/PATCH/DELETE), also block viewers:**
```typescript
if (!membership || membership.role === "viewer") {
  res.status(403).json({ error: { message: "Access denied" } });
  return;
}
```
(`src/routes/labels.ts:75–78`)

**Step 4 — For endpoints that operate on a resource (not the workspace directly), resolve the resource's `workspaceId` first, then check membership against that — never trust the workspaceId from `req.body` for ownership.**
```typescript
const existing = await prisma.yourModel.findUnique({ where: { id } });
// then use existing.workspaceId for the membership check
```
(`src/routes/labels.ts:57–73`)

**The full pattern for a write endpoint looks like this:**
```typescript
yourRouter.patch("/:id", authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.yourModel.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: { message: "Not found" } });
      return;
    }
    const membership = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: req.user!.id, workspaceId: existing.workspaceId } },
    });
    if (!membership || membership.role === "viewer") {
      res.status(403).json({ error: { message: "Access denied" } });
      return;
    }
    // your update logic here
  } catch (error) {
    next(error);
  }
});
```

---

### 4d: Quality Comparison

| Dimension | Without RAG | With RAG |
|---|---|---|
| **Prisma API correctness** | Wrong (`findOne`, wrong where clause) | Exact (`findUnique` with composite key) |
| **Response shape** | Inconsistent with codebase | Matches `{ error: { message } }` convention |
| **Role handling** | Not mentioned | Explicitly shows viewer check and why |
| **Cross-tenant safety** | Not mentioned | Explains resource-then-workspace pattern |
| **Actionability** | Developer must still discover real code | Developer can paste and adapt directly |
| **Citation** | None | Every snippet traced to file:line |
| **Hallucination risk** | High (invented API) | Low (bounded by retrieved code) |

**Conclusion:** The RAG answer is unambiguously better for an onboarding developer or one implementing a new route from memory. The without-RAG answer would compile but produce a runtime error on the first Prisma call, and would miss the viewer role check — a security gap. The RAG answer is correct, safe, and immediately usable. The quality gap would widen further for less-common patterns (webhooks, full-text search triggers) where the LLM has less training signal to draw from.
