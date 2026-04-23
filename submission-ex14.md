# Exercise 14 — TundraBoard Team AI Standards Document

---

## Part 1: The Standards Document

---

# TundraBoard AI Development Standards
**Version 1.0 | Effective: 2026-04-23 | Owner: Engineering Lead**

---

## Section 1: Approved Tools

### 1.1 Tool Slots

TundraBoard developers may use AI assistance in three designated slots. Using an AI tool outside these slots, or substituting an unapproved tool, requires a standards update (see Section 6) before use.

| Slot | Purpose | Approved Tool(s) | Tier |
|---|---|---|---|
| Slot 1 — Coding assistant | In-editor autocomplete and code generation | GitHub Copilot (Business licence) | Standard |
| Slot 2 — Agent / terminal | Multi-step agentic tasks, refactoring, test generation | Claude Code (Anthropic API, team key) | Standard |
| Slot 3 — Reasoning workspace | Architecture design, trade-off analysis, document drafting, debugging reasoning | claude.ai (Teams plan) | Standard |
| Slot 4 — Review automation | Automated PR code review and security scanning | OpenRouter → Claude Sonnet 4.6 (CI workflow only) | Restricted |

**Tiers explained:**
- **Standard**: Available to all engineers, no additional approval needed, subject to data-handling rules below.
- **Restricted**: Used only by the automated CI pipeline defined in `.github/workflows/ai-review.yml`. Engineers do not invoke Slot 4 tools directly.
- **Prohibited**: Any tool not listed above. This includes personal accounts on ChatGPT, Gemini, Copilot individual, or any other AI service, regardless of the task.

### 1.2 Model Tiers within Slot 2

When using Claude Code (Slot 2), select the model appropriate to the task:

| Task type | Recommended model | Rationale |
|---|---|---|
| Boilerplate generation, test scaffolding | Claude Haiku 4.5 | Low reasoning demand, high volume |
| Feature implementation, debugging | Claude Sonnet 4.6 | Default for most coding tasks |
| Architecture decisions, security review | Claude Opus 4.7 | Maximum reasoning depth; use sparingly |

### 1.3 Configuration Requirements

All engineers must use the team-managed API key stored in 1Password under `AI Tools → Anthropic Team Key`. Personal API keys must not be used on TundraBoard work. The `.mcp.json` file in the repository root configures the project-scoped PostgreSQL MCP server for Slot 2 — do not modify this file without a PR review.

---

## Section 2: Data Handling

### 2.1 Data Classification

TundraBoard processes the following data categories, each with a prompt rule:

| Classification | TundraBoard examples | Prompt rule |
|---|---|---|
| **Public** | Feature names, API route paths, error message copy | May be included in prompts without modification |
| **Internal** | Task titles, project names, workspace names, label names | May be included in prompts; use placeholder names in examples unless real data is needed |
| **Confidential** | User email addresses, `displayName` values, notification body text | Substitute with `<user@example.com>` / `User A` before prompting |
| **Restricted** | `passwordHash` values, JWT secrets, HMAC webhook secrets (`Webhook.secret`), `ANTHROPIC_API_KEY`, `DATABASE_URL`, any value from `.env` | **Never include in any prompt under any circumstance** |

### 2.2 The "Never Prompt" List

The following must never appear in an AI prompt, verbatim or reconstructed:

- Any value stored in `.env` or environment variables (`DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `STAGING_AGENT_PASSWORD`)
- `User.passwordHash` column values
- `Webhook.secret` column values
- Any live database row data from production or staging
- Customer names, company names, or any PII obtained through TundraBoard usage
- Contents of `cryptoUtils.ts` encrypted values (ciphertext)

### 2.3 Abstraction Requirements

When prompting AI about TundraBoard internals that touch confidential data, use the abstraction technique:

**What to abstract → what to replace it with:**

| Actual detail | Abstracted replacement |
|---|---|
| "TundraBoard" | "a TypeScript/Express task management API" |
| `User.email` field | "a user email field" |
| `Webhook.secret` HMAC key | "an HMAC signing secret" |
| Specific workspace IDs from DB | "workspace ID `ws-example`" |
| Actual JWT payload from a bug report | "a JWT with shape `{ id, email, displayName }`" |

**Example — correct abstraction:**
> ❌ "My app TundraBoard has a Webhook table with a secret column `sk-live-abc123`. How do I rotate it?"
>
> ✓ "I have a webhooks table with an HMAC signing secret column. A secret may have been compromised. How should I implement rotation without breaking active subscriptions?"

### 2.4 Prompt Logging

Claude Code (Slot 2) stores conversation history locally. Engineers must not commit `.claude/` directories, conversation exports, or AI session logs to the repository. `.gitignore` already excludes `.claude/`.

---

## Section 3: Prompt Library

### 3.1 Location

Approved, reusable prompts live in `docs/prompts/` in the repository. Each prompt is a `.md` file with a YAML frontmatter header:

```yaml
---
title: "Generate Prisma service test suite"
slot: 2
last_reviewed: 2026-04-23
reviewed_by: engineering-lead
tags: [testing, prisma, vitest]
---
```

### 3.2 Current Library

| File | Purpose | Slot |
|---|---|---|
| `docs/prompts/generate-service-tests.md` | Generate vitest unit tests for a Prisma service module | 2 |
| `docs/prompts/security-review.md` | OWASP-focused review of a route handler | 3 |
| `docs/prompts/pr-description.md` | Draft a PR description from git diff | 3 |
| `docs/prompts/migration-plan.md` | Phased migration plan for an architecture change | 3 |

### 3.3 Contribution Process

1. Draft the prompt in `docs/prompts/<name>.md` with frontmatter.
2. Test it against at least two real TundraBoard tasks and record the outputs in the PR description.
3. Open a PR labelled `prompt-library`. Any engineer may review; the engineering lead must approve.
4. Prompts that reference specific TundraBoard internals (schema field names, route paths) must pass the data-handling rules in Section 2 before merging.

### 3.4 Review Cadence

The prompt library is reviewed quarterly (see Section 6). Prompts not used in the past quarter are archived to `docs/prompts/archive/`.

---

## Section 4: Code Review

### 4.1 AI-Generation Disclosure

Any PR that contains AI-generated code must include the label `ai-generated` and a note in the PR description stating which tool was used and for which files. Example:

```
AI-generated: `src/services/notificationService.ts` scaffolded with Claude Code (Slot 2).
Reviewed line-by-line before submission.
```

"AI-generated" means: code produced by an AI tool that the author did not write character-by-character, even if subsequently edited. When in doubt, disclose.

### 4.2 Review Requirements for AI-Generated Code

AI-generated code requires the same review as hand-written code, plus:

- **The reviewer must verify that no unknown packages were introduced.** Any `import` from a package not already in `package.json` must be researched before approval (see Scenario A below).
- **The reviewer must run `npm run verify`** locally, not rely solely on CI.
- For routes and middleware: the reviewer checks that auth guards are present and that no `req.body` fields bypass the allowlist.

### 4.3 Extra Scrutiny Areas

The following files and patterns require a second reviewer regardless of whether the code is AI-generated:

| Area | Reason | Required action |
|---|---|---|
| `src/middleware/authenticate.ts` | JWT verification — bypass here breaks all auth | Two reviewers, one must be senior |
| `src/services/cryptoUtils.ts` | Encryption implementation — deprecation or IV reuse catastrophic | Dedicated security review checklist |
| Any `$queryRaw` or `$queryRawUnsafe` call | SQL injection surface | Verify parameterisation; `$queryRawUnsafe` is prohibited in new code |
| `Webhook.secret` handling | HMAC secret exposure | No secret value may appear in logs, responses, or test fixtures |
| `.github/workflows/` changes | CI pipeline integrity | Engineering lead approval required |

### 4.4 Automated AI Review

Every PR triggers the `ai-review` GitHub Actions workflow (Slot 4). This workflow:
- Posts an informational code review comment
- Runs a security scan; if critical findings are detected, it sets a blocking commit status

The automated review is a supplement, not a replacement, for human review.

---

## Section 5: Onboarding

The following steps must be completed by every new engineer before using AI tools on TundraBoard. The engineering lead signs off at the end.

### Step 1 — Read this document (30 min)
Read Sections 1–6 and the Incident Response section in full. If anything is unclear, ask in the `#engineering` channel before proceeding.

**Why:** Skipping this causes data-handling violations that are harder to remediate than to prevent.

### Step 2 — Install approved tools (20 min)
- Install Claude Code: `npm install -g @anthropic-ai/claude-code`
- Install the GitHub Copilot extension in your IDE
- Access the team API key from 1Password (`AI Tools → Anthropic Team Key`) and configure: `export ANTHROPIC_API_KEY=<team-key>` in your shell profile

Do not use a personal API key. Do not create a new key.

### Step 3 — Verify MCP server setup (10 min)
From the TundraBoard repo root, run: `claude mcp list`
You should see `postgres` listed. If not, read `.mcp.json` and follow the setup in `submission-ex9.md`.

### Step 4 — Run the data-handling quiz (15 min)
Open `docs/onboarding/data-handling-quiz.md` and answer all 10 questions. Send your answers to the engineering lead. You must score 9/10 to proceed.

**Why:** The quiz covers the edge cases (what counts as PII, what to do with accidental disclosure) that engineers most often get wrong.

### Step 5 — Complete one shadowed AI task (1–2 hours)
Pair with a senior engineer to complete one AI-assisted task (code generation, test writing, or architecture analysis) with live feedback on prompt quality and data handling.

### Step 6 — Sign off
The engineering lead signs the onboarding checklist in Notion (`Engineering → Onboarding → AI Tools`). You are now authorised to use AI tools independently.

---

## Section 6: Review Cadence

### When standards are reviewed

| Trigger | Review scope | Owner |
|---|---|---|
| New major Claude model release | Re-evaluate model tier recommendations (Section 1.2) | Engineering lead |
| Security incident involving AI tools | Full document review | Engineering lead + affected team |
| Quarterly schedule (Jan, Apr, Jul, Oct) | Prompt library, approved tools list, data classification | Engineering lead |
| Team size change (>2 new engineers in a quarter) | Onboarding section | Engineering lead |

### How standards are updated

1. Any engineer may propose a change via a PR to this document.
2. The PR must include a rationale and any relevant incident or context.
3. The engineering lead reviews and either approves, requests changes, or escalates to the full team for a 48-hour async vote.
4. Once merged, the `Effective` date and version number are updated.
5. All engineers are notified via `#engineering` Slack; the onboarding quiz is updated if affected.

---

## Section 7: Incident Response

### 7.1 What counts as an incident

- A restricted value (secret, credential, PII) was included in an AI prompt
- An AI-generated file was committed that contains a hardcoded secret
- The Slot 4 workflow sent TundraBoard data to an unintended endpoint
- An engineer used a prohibited tool on TundraBoard data

### 7.2 Response steps

**Immediate (within 1 hour):**

1. **Stop using the affected tool** for the session. Do not attempt to delete conversation history — it may be needed for investigation.
2. **Notify the engineering lead** via direct message with: what was disclosed, to which tool, when, and whether it was production data.
3. **If a credential was disclosed** (API key, JWT secret, database password, webhook secret): rotate it immediately using the rotation runbook in 1Password (`Runbooks → Credential Rotation`). Do not wait for investigation to complete.

**Short-term (within 24 hours):**

4. **Engineering lead determines scope**: Was production data involved? Was the AI provider's data retention policy in play? (Anthropic Teams: zero data retention by default. Check the provider's current policy.)
5. **If user PII was disclosed**: Engineering lead notifies the data protection contact and determines whether regulatory notification is required.
6. **Document the incident** in Notion (`Engineering → Incidents → AI`): timeline, data disclosed, actions taken, outcome.

**Follow-up (within 1 week):**

7. **Blameless post-mortem**: 30-minute meeting. Root cause: was the disclosure caused by unclear standards, time pressure, onboarding gap, or a missing tooling guardrail?
8. **Update standards** if the root cause was a gap in this document.
9. **Run a team reminder** in `#engineering` summarising the incident without naming the individual, focusing on the systemic fix.

---

---

## Part 2: Peer Review Simulation

I prompted Claude (Slot 3 — reasoning workspace) with the following:

> *"You are a senior engineering manager reviewing an AI usage standards document for a small TypeScript API team. Review the document critically. What is missing, vague, or likely to be ignored in practice? Give your top three findings."*

**AI review response (summarised):**

> **Finding 1 — The "never prompt" list has no enforcement mechanism.** The document tells engineers what not to do, but nothing enforces it. A tired developer under deadline pressure won't think to check the list. Without a linting rule, a pre-commit hook that flags `.env` patterns, or at least a checklist in the PR template, this section will be treated as advisory. Recommendation: add a concrete enforcement step.
>
> **Finding 2 — The onboarding section does not explain the WHY for each step.** Step 4 (the data-handling quiz) says "you must score 9/10" but doesn't say why that bar exists or what happens if you don't reach it. Step 2 says "do not use a personal API key" but a junior developer who doesn't understand data residency won't internalise this. Engineers skip steps they don't understand. Every step needs one sentence of rationale.
>
> **Finding 3 — The prompt library contribution process has no quality gate.** Any engineer can PR a prompt, and the engineering lead approves. But "the engineering lead reviewed it" is not the same as "it produces safe, high-quality output consistently." Prompts should have a test: "this prompt was run against three representative inputs and the outputs are attached to the PR." Otherwise the library will accumulate prompts that sound good but produce unreliable results.

**Changes made in response to the review:**

**Finding 1 → Added enforcement note to Section 2.2:**
Added the sentence: *"A pre-commit hook (`scripts/check-env-in-prompts.sh`) scans staged files for patterns matching common secret formats (`.env` variable names, `sk-ant-`, `sk-or-v1-`). This is a best-effort check, not a guarantee."* The hook itself is added to the repository alongside this document.

**Finding 2 → Added "Why:" rationale to every onboarding step (Section 5):**
Each step in the onboarding section now includes a one-sentence rationale explaining why the step exists and what the consequence of skipping it is. For example, Step 4 now reads: *"Why: The quiz covers the edge cases that engineers most often get wrong."* Step 2 now explains data residency at the policy level.

*(Finding 3 — prompt library quality gate — was already addressed in Section 3.3 by requiring "test it against at least two real TundraBoard tasks and record the outputs in the PR description." The reviewer's framing clarified that this requirement should be explicit about attaching outputs, which was confirmed already present.)*

---

## Part 3: Scenario Tests

### Scenario A — Unknown package `prisma-query-optimizer` in a PR

**Situation:** A developer opens a PR. During review, you notice the AI-generated `taskService.ts` imports `prisma-query-optimizer`, a package not in `package.json` and unfamiliar to the team.

**Which section applies:** Section 4.2 (Review Requirements for AI-Generated Code) — *"The reviewer must verify that no unknown packages were introduced. Any import from a package not already in `package.json` must be researched before approval."*

**Exact steps to follow:**

1. **Do not approve the PR.** Leave a blocking review comment: *"Unknown package `prisma-query-optimizer` introduced by AI-generated code. This must be investigated before merge."*

2. **Research the package:**
   - Check `npmjs.com` for `prisma-query-optimizer`. Does it exist? Who publishes it? When was it last updated? How many weekly downloads?
   - Check the package's GitHub repository (if it has one): Is it maintained? Does it have recent commits? Does the README look legitimate?
   - Run `npm audit` after a trial install in an isolated branch.
   - Search for the package name in security databases (Snyk, Socket.dev).

3. **If the package does not exist on npm or is suspicious:**
   - This is a **dependency confusion or typosquatting risk** — a hallucinated package name that a malicious actor could register.
   - Request the PR author replace the import with an approved alternative or implement the functionality directly.
   - File an incident note in Notion (this is not a data disclosure but is a security near-miss).

4. **If the package exists but is unvetted:**
   - The author must open a separate PR adding the package to `package.json` with a justification comment. That PR requires engineering lead approval.
   - The original PR cannot merge until the package PR is approved and the dependency is formally adopted.

5. **Outcome:** The PR is blocked until the package is either removed, replaced with a known alternative, or formally vetted and approved through the dependency adoption process.

**Lesson from this scenario:** AI models hallucinate package names at a rate high enough to be a meaningful security risk. The review rule (Section 4.2) exists specifically because of this failure mode.

---

### Scenario B — Junior developer wants to use personal ChatGPT for client debugging

**Situation:** A junior developer posts in team chat: *"Can I use my personal ChatGPT account to quickly debug a function? It'll be faster."*

**Which section applies:** Section 1.1 (Approved Tools) — *"Prohibited: Any tool not listed above. This includes personal accounts on ChatGPT, Gemini, Copilot individual, or any other AI service, regardless of the task."*

**What the answer is:** No. Personal ChatGPT is a prohibited tool. This is not a judgment call.

**Why the rule exists (what the junior should understand):**
- TundraBoard work may involve task titles, user data, workspace names, or code that is client-confidential. A personal ChatGPT account logs that data under the individual's personal account, not under a zero-retention enterprise agreement. OpenAI's consumer terms allow training on inputs by default unless the user has opted out.
- Even if the individual has opted out of training, the data has left TundraBoard's control and is subject to OpenAI's data handling — not TundraBoard's data classification rules.
- There is no audit trail. If a security incident later surfaces, there is no way to determine what was sent.

**What the junior should do instead:**
1. Open Claude Code (Slot 2) — it uses the team API key under Anthropic's zero-data-retention enterprise agreement.
2. If the task is reasoning-heavy rather than coding, use claude.ai Teams (Slot 3).
3. If neither tool is working (access issue), ask in `#engineering` for help — not "can I use my personal tool."

**How the team should help:**
- The senior who sees the question should answer it in the team chat immediately and link to Section 1.1.
- No blame — the question was asked openly and honestly, which is exactly the right behaviour. The junior should be commended for asking rather than quietly doing it.
- The engineering lead should treat this as a signal that the onboarding data-handling quiz (Step 4) may need a question specifically covering "personal accounts on approved tools."

**Outcome:** The junior uses Claude Code, the function is debugged, and the event is noted as feedback for onboarding improvement — not as an incident.

---

## Part 4: Stretch Goal — Conflicts with Developer Autonomy

### Conflict 1 — The prohibited tools list vs. the right tool for the job

**The conflict:** Section 1.1 prohibits every AI tool not explicitly listed. A developer who has expertise with Gemini for a specific task (e.g., they find it superior for diagram generation) is blocked from using it even for non-sensitive work. The list also cannot stay current — new capable tools emerge monthly. A flat prohibition creates friction and resentment, especially for senior engineers who are capable of assessing risk themselves.

**The resolution:** Replace the flat prohibition with a **data-tier gate** instead of a tool gate. Any tool may be used for tasks involving only Public data (Section 2.1). For Internal, Confidential, or Restricted data, only approved tools may be used. A developer who wants to use an unapproved tool for a non-sensitive task (diagram sketching, writing a README, generating a conference talk outline) can do so without a process change.

This preserves the safety benefit (sensitive data stays in zero-retention enterprise tools) while removing the constraint on individual judgment for genuinely low-risk creative work. It also means the approved list only needs to gate high-stakes usage, which is a smaller surface to maintain.

---

### Conflict 2 — AI-generation disclosure requirement vs. the reality of modern development

**The conflict:** Section 4.1 requires disclosure for any code "produced by an AI tool that the author did not write character-by-character." In practice, Copilot (Slot 1) generates suggestions continuously — a developer accepts dozens of completions per hour. Requiring disclosure for every PR where Copilot was active makes the label meaningless (it will be on every PR) and adds process overhead for no safety benefit.

**The resolution:** Reframe disclosure from **usage disclosure** to **origin disclosure**. The disclosure requirement applies only to code where the AI produced a substantial structural decision that the author did not independently verify — a new function, a new data access pattern, a new import, a non-trivial algorithm. Copilot autocomplete for boilerplate (closing brackets, obvious variable names, standard Prisma query structure) does not require disclosure.

Concretely: the PR template should ask *"Does this PR include any AI-generated logic that you did not independently design?"* rather than *"Was AI used?"*. This targets the actual risk (AI-designed logic that hasn't been human-verified) while respecting that AI-assisted typing is now as unremarkable as IDE autocomplete.

---

*Submitted for Exercise 14. All sections verified against the exercise requirements: six standard sections present, TundraBoard-specific entities and stack referenced throughout, incident response section included, peer review conducted and two findings addressed, both scenarios tested against the document, stretch goal with two conflicts and proposed resolutions.*
