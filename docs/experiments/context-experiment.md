# Context Management Experiment — Auth Service Extraction

## Source Material (the fat route to refactor)

The starting point is `src/routes/auth.ts` with all business logic inline:
bcrypt hashing, JWT signing, Prisma queries, Zod validation — 70 lines, one file.

**Refactoring goal:** Extract business logic into `src/services/auth.service.ts`.
The route should become a thin HTTP adapter; the service should own all domain logic.

---

## Experiment A — Minimal Context

### Prompt A

```
Refactor the auth routes to extract all business logic into
`src/services/auth.service.ts`. The route file should become a thin HTTP
adapter that handles validation and delegates to the service.

Show both the updated route file and the new service file.

Current route file (src/routes/auth.ts):

import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../utils/prisma.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const result = registerSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: { message: "Validation failed", issues: result.error.issues } });
      return;
    }
    const { email, password, displayName } = result.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: { message: "Email already in use" } });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { email, displayName, passwordHash },
      select: { id: true, email: true, displayName: true, createdAt: true },
    });

    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: { message: "Validation failed", issues: result.error.issues } });
      return;
    }
    const { email, password } = result.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: { message: "Invalid credentials" } });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      res.status(401).json({ error: { message: "Invalid credentials" } });
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, displayName: user.displayName },
      process.env.JWT_SECRET ?? "",
      { expiresIn: "7d" },
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
  } catch (err) {
    next(err);
  }
});
```

**Token estimate:** ~560 tokens (60 instruction + 500 route file)

---

### Output A

#### src/services/auth.service.ts

```typescript
import { PrismaClient } from "@prisma/client";  // ❌ bypasses singleton
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();  // ❌ second DB connection pool

export class AuthService {  // ❌ class pattern — no precedent in this codebase
  async register(email: string, password: string, displayName: string) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error("Email already in use");  // ❌ no .status → errorHandler returns 500
    }

    const passwordHash = await bcrypt.hash(password, 12);

    return prisma.user.create({
      data: { email, displayName, passwordHash },
      select: { id: true, email: true, displayName: true, createdAt: true },
    });
  }

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new Error("Invalid credentials");  // ❌ no .status → 500 instead of 401
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new Error("Invalid credentials");  // ❌ no .status → 500 instead of 401
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },  // ❌ wrong key (userId not id), missing displayName
      process.env.JWT_SECRET!,
      { expiresIn: "7d" },
    );

    return { token, user: { id: user.id, email: user.email } };  // ❌ missing displayName
  }
}

export const authService = new AuthService();
```

#### src/routes/auth.ts (after A)

```typescript
import { Router } from "express";
import { z } from "zod";
import { authService } from "../services/auth.service.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const result = registerSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: { message: "Validation failed", issues: result.error.issues } });
      return;
    }
    const { email, password, displayName } = result.data;
    const user = await authService.register(email, password, displayName);
    res.status(201).json({ user });
  } catch (err) {
    next(err);  // ⚠️ err.status is undefined — errorHandler falls back to 500 for 409/401 cases
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const result = loginSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: { message: "Validation failed", issues: result.error.issues } });
      return;
    }
    const { email, password } = result.data;
    const result2 = await authService.login(email, password);
    res.json(result2);
  } catch (err) {
    next(err);  // ⚠️ 401 errors will surface as 500
  }
});
```

**Issues in Output A:**
1. Instantiates a second `PrismaClient` instead of using the `prisma` singleton from `utils/prisma.ts` — not visible from the route file alone
2. Plain `throw new Error()` without `.status` — errorHandler reads `err.status`, so all domain errors (409, 401) silently become 500 in production
3. Class pattern with singleton instance — fine in isolation, but inconsistent with the module-function pattern the rest of the project will use
4. JWT payload uses `userId` key and omits `displayName` — breaks `req.user.id` downstream wherever the authenticate middleware populates it

---

## Experiment B — Full Context

### Prompt B

```
Refactor the auth routes to extract all business logic into
`src/services/auth.service.ts`. The route file should become a thin HTTP
adapter that handles validation and delegates to the service.

Show both the updated route file and the new service file.

--- src/routes/auth.ts ---
[same 70-line fat route as above]

--- src/middleware/authenticate.ts ---
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: { message: "Authorization header missing or malformed" } });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? "") as {
      id: string; email: string; displayName: string;
    };
    req.user = { id: payload.id, email: payload.email, displayName: payload.displayName };
    next();
  } catch {
    res.status(401).json({ error: { message: "Invalid or expired token" } });
  }
}

--- src/middleware/errorHandler.ts ---
import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err.status ?? err.statusCode ?? 500;
  const message = err.message ?? "Internal server error";
  if (process.env.NODE_ENV !== "test") {
    console.error(`[${status}] ${message}`, err.stack);
  }
  res.status(status).json({
    error: {
      message,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    },
  });
};

--- src/utils/prisma.ts ---
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
});

--- src/app.ts ---
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { workspaceRouter } from "./routes/workspaces.js";
import { projectRouter } from "./routes/projects.js";
import { taskRouter } from "./routes/tasks.js";
import { commentRouter } from "./routes/comments.js";
import { labelRouter } from "./routes/labels.js";
import { notificationRouter } from "./routes/notifications.js";
import { webhookRouter } from "./routes/webhooks.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();
app.use(helmet()); app.use(cors({...})); app.use(morgan("dev")); app.use(express.json({ limit: "1mb" }));
app.use("/health", healthRouter); app.use("/auth", authRouter);
app.use("/workspaces", workspaceRouter); app.use("/projects", projectRouter);
app.use("/tasks", taskRouter); app.use("/comments", commentRouter);
app.use("/labels", labelRouter); app.use("/notifications", notificationRouter);
app.use("/webhooks", webhookRouter);
app.use(errorHandler);

--- prisma/schema.prisma (full — all 11 models) ---
[217 lines — User, Workspace, WorkspaceMember, Project, Task, Comment,
 Label, TaskLabel, Notification, Webhook, AuditLog, Attachment]
```

**Token estimate:** ~3,800 tokens (60 instruction + 500 auth.ts + 250 authenticate.ts
+ 120 errorHandler.ts + 50 prisma.ts + 200 app.ts + 1,400 full schema + 200 tsconfig
+ 1,000 remaining package.json/other context)

---

### Output B

#### src/services/auth.service.ts

```typescript
import { prisma } from "../utils/prisma.js";  // ✅ singleton
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export async function registerUser(
  email: string,
  password: string,
  displayName: string,
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err = new Error("Email already in use") as Error & { status: number };
    err.status = 409;  // ✅ errorHandler will use this
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { email, displayName, passwordHash },
    select: { id: true, email: true, displayName: true, createdAt: true },
  });

  // ⚠️ AI saw AuditLog model in full schema and added unrequested logging
  // ❌ workspaceId is required on AuditLog but there is no workspace at registration
  await prisma.auditLog.create({
    data: {
      workspaceId: user.id,  // ❌ wrong field — user.id is not a workspaceId
      action: "create",
      resource: "user",
      resourceId: user.id,
    },
  });

  return user;
}

export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const err = new Error("Invalid credentials") as Error & { status: number };
    err.status = 401;  // ✅
    throw err;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const err = new Error("Invalid credentials") as Error & { status: number };
    err.status = 401;  // ✅
    throw err;
  }

  // ✅ Correct payload — AI saw authenticate.ts and matched the shape
  const token = jwt.sign(
    { id: user.id, email: user.email, displayName: user.displayName },
    process.env.JWT_SECRET ?? "",
    { expiresIn: "7d" },
  );

  return {
    token,
    user: { id: user.id, email: user.email, displayName: user.displayName },
  };
}
```

#### src/routes/auth.ts (after B)

```typescript
import { Router } from "express";
import { z } from "zod";
import { registerUser, loginUser } from "../services/auth.service.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/register", async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "Validation failed", issues: parsed.error.issues } });
    return;
  }
  try {
    const user = await registerUser(parsed.data.email, parsed.data.password, parsed.data.displayName);
    res.status(201).json({ user });
  } catch (err) {
    next(err);  // ✅ err.status 409 flows correctly
  }
});

authRouter.post("/login", async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "Validation failed", issues: parsed.error.issues } });
    return;
  }
  try {
    const result = await loginUser(parsed.data.email, parsed.data.password);
    res.json(result);
  } catch (err) {
    next(err);  // ✅ err.status 401 flows correctly
  }
});
```

**Issues in Output B:**
1. Unrequested `auditLog.create` call with a type-incorrect `workspaceId` — AI saw the AuditLog model in the full schema and hallucinated a requirement. This is a runtime error (Prisma will reject the UUID type mismatch) that TypeScript won't catch at compile time.
2. Route file is correct and clean — full context gave the AI everything it needed to get the structure right.
3. Error handling and JWT payload are correct because authenticate.ts and errorHandler.ts were both included.

---

## Experiment C — Targeted Context

### Prompt C

```
Refactor the auth routes to extract all business logic into
`src/services/auth.service.ts`. The route file should become a thin HTTP
adapter: Zod validation stays in the route, everything else moves to the service.

Output spec — the service must export exactly these two functions:

  registerUser(email: string, password: string, displayName: string)
    → Promise<{ id: string; email: string; displayName: string; createdAt: Date }>
    → throws { message: "Email already in use", status: 409 } if duplicate

  loginUser(email: string, password: string)
    → Promise<{ token: string; user: { id: string; email: string; displayName: string } }>
    → throws { message: "Invalid credentials", status: 401 } if not found or wrong password

Show both the updated route file and the new service file.

--- src/routes/auth.ts (file to refactor) ---
[same 70-line fat route]

--- prisma/schema.prisma (User model only) ---
model User {
  id           String   @id @default(uuid()) @db.Uuid
  email        String   @unique @db.VarChar(255)
  displayName  String   @map("display_name") @db.VarChar(100)
  passwordHash String   @map("password_hash") @db.VarChar(255)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz
  workspaceMembers WorkspaceMember[]
  createdTasks     Task[]           @relation("TaskCreator")
  assignedTasks    Task[]           @relation("TaskAssignee")
  comments         Comment[]
  auditLogs        AuditLog[]
  @@map("users")
}

--- src/middleware/authenticate.ts (signature only) ---
// Verifies Bearer JWT. Payload shape: { id: string; email: string; displayName: string }
// Populates req.user with that shape on success, returns 401 on failure.
export function authenticate(req: Request, res: Response, next: NextFunction): void

--- src/middleware/errorHandler.ts (contract) ---
// Reads err.status ?? err.statusCode ?? 500 for the response status code.
// Service-layer errors should attach a .status number to be returned correctly.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => { ... }

--- src/utils/prisma.ts ---
import { PrismaClient } from "@prisma/client";
export const prisma = new PrismaClient({ ... });
```

**Token estimate:** ~865 tokens (100 instruction + output spec + 500 auth.ts
+ 125 User model + 40 authenticate.ts signature + 60 errorHandler contract + 40 prisma.ts)

---

### Output C

#### src/services/auth.service.ts

```typescript
import { prisma } from "../utils/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export async function registerUser(
  email: string,
  password: string,
  displayName: string,
): Promise<{ id: string; email: string; displayName: string; createdAt: Date }> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw Object.assign(new Error("Email already in use"), { status: 409 });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.create({
    data: { email, displayName, passwordHash },
    select: { id: true, email: true, displayName: true, createdAt: true },
  });
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ token: string; user: { id: string; email: string; displayName: string } }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw Object.assign(new Error("Invalid credentials"), { status: 401 });
  }
  const token = jwt.sign(
    { id: user.id, email: user.email, displayName: user.displayName },
    process.env.JWT_SECRET ?? "",
    { expiresIn: "7d" },
  );
  return { token, user: { id: user.id, email: user.email, displayName: user.displayName } };
}
```

#### src/routes/auth.ts (after C)

```typescript
import { Router } from "express";
import { z } from "zod";
import { registerUser, loginUser } from "../services/auth.service.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/register", async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "Validation failed", issues: parsed.error.issues } });
    return;
  }
  try {
    const user = await registerUser(parsed.data.email, parsed.data.password, parsed.data.displayName);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "Validation failed", issues: parsed.error.issues } });
    return;
  }
  try {
    const result = await loginUser(parsed.data.email, parsed.data.password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

No issues. Output matches the spec exactly.

---

## Comparison

### A — Minimal (~560 tokens): ship-blocking bugs

**Correctness:** Fails at runtime. Every domain error (`409 Email already in use`,
`401 Invalid credentials`) returns HTTP 500 instead, because plain `throw new Error()`
has no `.status` property and `errorHandler` falls back to 500. A second `PrismaClient`
instance is also created alongside the singleton, opening a redundant connection pool.

**Convention adherence:** Uses a class pattern (`export class AuthService`) with an
exported singleton instance. No other file in this project uses this pattern — the
mismatch will be visible as soon as someone implements the next service.

**Completeness:** Both operations are extracted, but the JWT payload uses `userId`
instead of `id` and omits `displayName`. Any route that calls `authenticate` and reads
`req.user.id` or `req.user.displayName` will break silently at runtime.

**Root cause:** Not hallucination — rational guesses made with absent data. Without
`utils/prisma.ts` in context, creating a new client is the only option the AI knows.
Without `errorHandler.ts`, attaching `.status` to errors is not an established pattern.

---

### B — Full (~3,800 tokens): one runtime bug, significant token waste

**Correctness:** Fails at runtime in a specific way. The `registerUser` function adds
an unrequested `prisma.auditLog.create` call with `workspaceId: user.id` — a UUID type
mismatch that Prisma will reject. TypeScript does not catch this because `user.id` is
`string` and `workspaceId` is also `string`. The JWT payload and error handling are
otherwise correct.

**Convention adherence:** Gets it right. Module-level exported functions, singleton
import, `.status` on thrown errors — full context provided enough signal on all three.

**Completeness:** Both operations are structurally correct. The only issue is the
unrequested behavior added beyond the scope of the task.

**Root cause:** Not a missing-data problem — a noise problem. Seeing all 11 Prisma
models when only 1 was relevant caused the AI to pattern-match on `AuditLog` and
infer a logging requirement that was never asked for. Full context supplied the answer
but also introduced irrelevant signal that the AI acted on.

---

### C — Targeted (~865 tokens): ready to ship

**Correctness:** Compiles and runs correctly. Error status codes propagate through
`errorHandler` as expected. The `prisma` singleton is used. No second connection pool.

**Convention adherence:** Module-level exported functions matching the pattern the
rest of the project will follow. Error shape (`Object.assign(new Error(...), { status })`)
matches `errorHandler`'s contract exactly.

**Completeness:** Produces exactly what the output spec described — no more, no less.
JWT payload matches `req.user` shape. Both operations handle their respective error
conditions with the correct status codes.

**Root cause of success:** The explicit output spec in the prompt pre-answered the
questions that caused failures in A and B. There was no need to guess payload shape,
error format, or which operations to include.

---

### Key Finding

The performance gap between A and C is not about intelligence — it's about missing
facts. Output A got `err.status` wrong because it had no way to know the errorHandler
contract. It invented a second PrismaClient because it had no way to know a singleton
exists. These are not hallucinations; they are rational guesses with missing data.

The performance gap between B and C is about noise. Output B got `auditLog.create`
wrong not because it lacked information but because it had *too much*. Seeing 11 schema
models when only 1 was relevant caused the AI to pattern-match on the AuditLog model
and add unrequested behavior.

Targeted context (C) spends 4.4× fewer tokens than full context (B) while producing
higher-quality output. The explicit output spec in Prompt C is the single highest-value
line: it pre-answers the "what shape should this return?" question that B had to infer
and A guessed wrong.

---

## Context Management Guide

### Which strategy to reach for

Start with targeted context as the default. Move to full context only when the task
genuinely requires reasoning across the whole system — architecture decisions,
cross-cutting refactors, security audits. Use minimal context only for initial
exploration when you do not yet know which files matter; follow up with targeted
context once the relevant dependencies become clear.

### Identifying what to include

Walk outward from the file you are changing in layers. The file itself always comes
first. Then its direct imports — but only the parts that constrain the task: type
signatures, exported constants, the shape of shared utilities. Stop before you reach
files that are merely adjacent in the directory tree but irrelevant to the specific
change. For this project, three items are almost always worth including regardless
of the task: the `prisma` singleton (so the AI does not create a second client), the
`errorHandler` contract (so thrown errors carry the right `.status`), and the
`req.user` type from `express.d.ts` (so JWT payloads stay consistent).

### Token budgets by task type

A single-function bug fix needs roughly 300–500 tokens: the function, its call site,
and the relevant type. A new route endpoint sits in the 700–1,000 token range: the
TODO spec, the relevant Prisma models, the error contract, and one existing route as
a style reference. A service extraction like this one lands around 800–1,200 tokens
when the output spec is included. A full architecture or security review is the one
case where 3,000–5,000 tokens is justified, because the reasoning genuinely spans the
whole system.

### The output spec

The highest-value addition to any generation prompt is an explicit output spec: the
exact function signatures, return types, and throw conditions expected from the new
code. It costs around 60 tokens and eliminates the guessing that produced the wrong
JWT payload key in Output A and the unrequested audit log in Output B. Write it before
you paste any context — if you cannot write it, the task is not scoped clearly enough
to generate good code.
