# Exercise 9 — MCP Server Integration for TundraBoard

---

## 1. CLI Warm-up (Baseline)

Before setting up MCP, the database was queried directly using `psql`:

```bash
psql "postgresql://postgres:postgres@localhost:5432/tundraboard_dev" \
  -c "SELECT id, title, status FROM tasks LIMIT 5;"
```

**Result:**

```
                  id                  |                  title                   |   status
--------------------------------------+------------------------------------------+-------------
 6696f716-4d9d-4e84-9f1d-e55ac64993df | Implement user authentication endpoints  | in_progress
 106d7ee4-9f4d-4a75-8e15-62331fd5d099 | Add input validation to task endpoints   | todo
 ad30b5a5-dc84-41cb-9aae-94158975297b | Set up rate limiting on auth endpoints   | todo
 52882fed-6bd0-494a-af64-2f1d77bff5a8 | Add workspace-level authorisation checks | todo
 82f248d3-a481-4d27-ae36-034b4048301e | Design task board component              | in_progress
(5 rows)
```

**What worked:** Fast, zero setup, returns data immediately.

**What was clunky:**
- Had to know the exact table name and column names upfront — no discovery
- Output is plain text; multi-table joins require writing full SQL manually
- Flag syntax (`-c`, connection string format) must be remembered or looked up
- No structured output — piping to `jq` or `awk` needed for programmatic use
- Connection string with credentials appears in shell history

---

## 2. MCP Server Setup

### Installation

The `@modelcontextprotocol/server-postgres` package was added as a project-scoped MCP server using the Claude Code CLI:

```bash
claude mcp add --scope project postgres -- \
  npx -y @modelcontextprotocol/server-postgres \
  postgresql://postgres:postgres@localhost:5432/tundraboard_dev
```

### Configuration file (`.mcp.json`) — credentials redacted

```json
{
  "mcpServers": {
    "postgres": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://<user>:<password>@localhost:5432/tundraboard_dev"
      ],
      "env": {}
    }
  }
}
```

The file lives at `.mcp.json` in the project root and is **project-scoped** — it only activates when Claude Code is running inside this directory, not globally.

### Tools and resources exposed by the server

| Tool | Description |
|------|-------------|
| `query` | Execute a SQL SELECT and return structured results |
| `list_tables` | List all tables in the connected database |
| `describe_table` | Return column names, types, and constraints for a given table |

The server does not expose `INSERT`, `UPDATE`, `DELETE`, or DDL — it is read-only by the MCP server's design.

### Permissions granted and why

| Permission | Granted | Reason |
|------------|---------|--------|
| `SELECT` on all tables | Yes | Required to query tasks, users, projects, and workspace membership |
| `INSERT / UPDATE / DELETE` | No | Not exposed by the MCP server implementation |
| Schema modification (DDL) | No | Not exposed by the MCP server implementation |
| Cross-database access | No | Connection string scoped to `tundraboard_dev` only |

### Security measures applied

- **Project scope:** Config lives in `.mcp.json` inside the project directory, not in `~/.claude/`. The server is unavailable in other Claude Code sessions.
- **Read-only by design:** `@modelcontextprotocol/server-postgres` exposes `SELECT` only. Mutations are structurally impossible through MCP, not just by convention.
- **Localhost only:** `localhost:5432` — the MCP server cannot reach any remote database.
- **`.mcp.json` should be in `.gitignore`** when using real credentials to prevent accidental credential commit.

**Recommended hardening for team/production use** — create a dedicated read-only Postgres role instead of connecting as the superuser:

```sql
CREATE ROLE mcp_readonly WITH LOGIN PASSWORD '<strong-password>' CONNECTION LIMIT 5;
GRANT CONNECT ON DATABASE tundraboard_dev TO mcp_readonly;
GRANT USAGE ON SCHEMA public TO mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_readonly;
```

This gives two independent layers of protection: the MCP server is read-only by design, and the Postgres role cannot mutate data even if the server were somehow bypassed.

### Connection health check

```
$ claude mcp list | grep postgres
postgres: npx -y @modelcontextprotocol/server-postgres postgresql://... - ✓ Connected
```

---

## 3. Task Completed via MCP

**Task given to the agent:**

> Check the database for tasks with no assignee and suggest which team member should be assigned based on the project they belong to and each team member's current workload.

### Tool call sequence (evidence of MCP integration)

The agent issued 7 MCP tool calls in sequence — discovering the schema before writing any queries:

1. `list_tables` → discovered all 13 tables without being told their names
2. `describe_table("tasks")` → inspected columns and foreign keys
3. `describe_table("users")` → mapped user fields
4. `describe_table("workspace_members")` → understood role structure
5. `describe_table("projects")` → mapped project-workspace relationship
6. `query` → unassigned tasks joined with project names
7. `query` → workload per user (task counts by status and assignee)

### Agent output

**Unassigned tasks found: 2**

| Task | Project | Priority | Due Date |
|------|---------|----------|----------|
| Set up rate limiting on auth endpoints | API Development | medium | — |
| Add search and filtering to task list | Frontend | low | 2026-04-21 (overdue) |

**Team workload:**

| Member | Workspace role | in_progress | todo | Total active |
|--------|---------------|-------------|------|-------------|
| Alice Lindström | admin | 1 | 1 (urgent) | 2 |
| Bob Virtanen | member | 1 | 1 (high) | 2 |
| Charlie Eriksson | viewer | 0 | 0 | 0 |

**Assignment suggestions:**

| Task | Suggested assignee | Reasoning |
|------|--------------------|-----------|
| Set up rate limiting on auth endpoints | **Bob Virtanen** | Alice already owns two API Development tasks including an urgent one. Distributing the API load to Bob balances delivery risk and keeps Alice focused on the urgent auth work. |
| Add search and filtering to task list | **Alice Lindström** | Bob owns the primary in-progress Frontend task. Assigning the related search feature to Bob creates a single-point-of-failure on Frontend delivery. Alice has no current Frontend tasks and, as workspace admin, can escalate the overdue status quickly if needed. |

**Additional finding flagged by agent:** Charlie Eriksson (viewer role) has zero assigned tasks. The viewer role indicates read-only workspace access. A role upgrade to `member` should be considered before assigning any work to Charlie.

---

## 4. CLI vs MCP Evaluation

### Schema discovery

**CLI:** Requires knowing table names before writing any query. Running `\dt` and `\d tasks` are separate manual steps with no integration into the task at hand.

**MCP:** The agent called `list_tables` first, then `describe_table` on the relevant tables — no prior knowledge of the schema was needed. This is the single largest practical difference: the agent can orient itself in an unfamiliar database without human guidance.

### Multi-table reasoning

**CLI:** Each query is a discrete shell command. Cross-table analysis requires writing a multi-join SQL statement upfront or issuing several queries and manually combining results.

**MCP:** The agent issued 7 targeted queries and synthesised results into a structured recommendation. The iterative pattern (discover → inspect → query → refine) mirrors how a developer actually explores an unfamiliar schema.

### Output structure

**CLI:** Plain text rows — useful for spot checks, awkward for downstream reasoning.

**MCP:** Results returned as structured data that the agent used directly in its analysis. No text parsing required.

### Permission scoping

**CLI:** `psql` connects with the full `postgres` superuser. Any command including `DROP TABLE` is available. Restricting access requires OS-level controls or a separately configured Postgres role — independent of the CLI invocation itself.

**MCP:** The server is read-only by design. A dedicated read-only role at the connection string level adds a second independent protection layer. Scoping is enforced structurally, not by convention.

### Security implications summary

| Concern | CLI (psql) | MCP (postgres server) |
|---------|------------|----------------------|
| Credential exposure | Connection string in shell history | Stored in `.mcp.json` (keep out of git) |
| Mutation risk | Full superuser — DROP, INSERT possible | Read-only by server design |
| Scope | Global — works in any shell session | Project-scoped — active only in this directory |
| Auditability | Shell history only | MCP tool calls logged in Claude Code session |
| Access control | Role-level only, set at invocation | Two layers: server design + Postgres role |

### When CLI is still the right tool

- Quick one-off spot checks where you already know the schema
- Mutations (seed scripts, migrations) — MCP is intentionally read-only
- CI/CD pipeline scripts where MCP is not available
- Situations requiring `psql` meta-commands (`\copy`, `\timing`, etc.)

### When MCP is better

- Exploratory analysis of an unfamiliar or evolving schema
- Tasks that require cross-table reasoning and structured output
- Any scenario where an agent or team member should have read access but not write access
- Workflows where auditable, reproducible tool calls are preferable to raw shell commands
- Shared team configuration — `.mcp.json` committed to the repo (with a read-only role) distributes access consistently

---

## 5. Summary

Setting up the PostgreSQL MCP server took under two minutes. The immediate practical difference from the CLI baseline was **schema discovery**: the agent found the relevant tables, inspected their structure, and composed multi-table queries without being told any table or column names. The same task via CLI would have required writing four or five manual joins and post-processing plain-text output.

The security posture is also strictly better than the CLI baseline: read-only by structural design rather than by convention, project-scoped rather than globally available, and upgradeable to a dedicated Postgres role without changing any application code. The main remaining risk is credential storage in `.mcp.json` — mitigated by keeping the file out of version control and using a read-only role in any shared or production-adjacent environment.
