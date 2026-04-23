# Exercise 16 — AI Governance Framework for TundraBoard

**Assumed toolset:** Claude Code (Anthropic) and Antigravity (hypothetical AI-assisted development platform) as primary development tools, alongside the existing TundraBoard AI stack.

---

## Part 1: AI Tool Inventory

### Tool 1 — Claude Code

| Field | Detail |
|---|---|
| **Purpose** | Primary agentic coding assistant: multi-step code generation, refactoring, test writing, codebase analysis, terminal agent tasks |
| **Vendor** | Anthropic PBC (San Francisco, CA, USA) |
| **Enterprise agreement** | Anthropic API — requires a signed Data Processing Agreement (DPA) for GDPR compliance; available under Anthropic's enterprise tier |
| **Data flow** | Prompts and context sent over HTTPS to `api.anthropic.com` (hosted on AWS US-East). Responses streamed back. No data leaves the HTTPS connection to third parties. Conversation history stored locally in `.claude/` directory on developer machine |
| **Storage** | Anthropic retains inputs/outputs up to 30 days for trust & safety review under the standard API tier. Under the enterprise zero-retention DPA, inputs/outputs are not stored beyond the request lifecycle |
| **Training use** | API inputs are **not** used to train models by default. Enterprise DPA explicitly excludes customer data from training |
| **EU AI Act classification** | General Purpose AI (GPAI) system — Claude is a foundation model under Article 3(63). As a GPAI with "systemic risk" capability (>10²⁵ FLOPs training compute), Anthropic has additional transparency and evaluation obligations under Article 51 |
| **DPA status** | Available; must be signed before processing any personal data. TundraBoard must execute this before using Claude Code on code that handles user PII |
| **Data residency** | USA (AWS US-East). Not EU-resident. GDPR transfer mechanism: Standard Contractual Clauses (SCCs) via Anthropic's DPA |

---

### Tool 2 — Antigravity

| Field | Detail |
|---|---|
| **Purpose** | AI-assisted development platform: IDE-integrated code completion, automated code review suggestions, architecture diagram generation from code, natural-language-to-code generation. Positioned as a GitHub Copilot alternative with additional agentic capabilities |
| **Vendor** | Antigravity Technologies Ltd (hypothetical; assumed UK-registered) |
| **Enterprise agreement** | Enterprise licence available; includes SLA, audit logs, and SSO. Requires DPA. Free/Team tiers explicitly exclude enterprise data protections — **only Enterprise tier is permissible for TundraBoard work** |
| **Data flow** | Code context (open files, cursor position, recent edits) sent to Antigravity's inference API (`api.antigravity.dev`). Prompts may include file contents up to 100KB per request. Results returned synchronously. Antigravity routes to one of several underlying foundation models (undisclosed by default — Enterprise customers can pin to a specific model) |
| **Storage** | Standard tier: 90-day retention for model improvement. Enterprise tier: zero retention, inputs deleted after response is served |
| **Training use** | Standard/Team tiers: code snippets may be used for fine-tuning. **Enterprise tier: explicitly excluded from training under DPA.** This distinction is critical — non-enterprise use is prohibited for TundraBoard code |
| **EU AI Act classification** | GPAI system (foundation model downstream user). Antigravity is a deployer under Article 3(4); the underlying model provider is the GPAI provider. As deployer, Antigravity has obligations under Article 28: must not use the system contrary to the provider's usage policies, must implement human oversight where required, must maintain logs |
| **DPA status** | Required before use; available from Antigravity's legal portal. TundraBoard must execute before any code containing personal data is processed |
| **Data residency** | EU (assumed AWS eu-west-1 for Enterprise tier). Verify with Antigravity legal before signing |
| **IP risk** | Antigravity's completion engine may reproduce verbatim code from its training corpus. Enterprise licence includes an IP indemnity clause covering outputs that infringe third-party copyright — but only if the developer did not deliberately prompt for reproduction of a specific work |

---

### Tool 3 — claude.ai Teams

| Field | Detail |
|---|---|
| **Purpose** | Reasoning workspace (Slot 3): architecture analysis, trade-off documents, standards drafting, debugging reasoning |
| **Vendor** | Anthropic PBC |
| **Enterprise agreement** | Teams plan; zero-retention; DPA available |
| **Data flow** | Browser to `claude.ai` over HTTPS. No local storage of conversation beyond browser session unless user exports |
| **Storage** | Zero retention on Teams plan |
| **Training use** | No on Teams plan |
| **EU AI Act classification** | GPAI (same as Claude Code — same underlying model) |
| **DPA status** | Covered by the same Anthropic DPA as Claude Code |

---

### Tool 4 — OpenRouter (AI Review Workflow)

| Field | Detail |
|---|---|
| **Purpose** | API gateway routing CI pipeline calls to Claude Haiku for automated PR code review and security scanning |
| **Vendor** | OpenRouter Inc (San Francisco, CA, USA) |
| **Enterprise agreement** | No enterprise tier currently available; operates on a pay-per-token basis |
| **Data flow** | GitHub Actions sends PR diff to `openrouter.ai/api/v1` → routed to Anthropic's API. OpenRouter logs request metadata (model, tokens, timestamp) but not prompt content under their privacy policy |
| **Storage** | OpenRouter: metadata only (no prompt content). Anthropic: subject to Anthropic's standard API terms |
| **Training use** | Not by default (Anthropic API terms apply end-to-end) |
| **EU AI Act classification** | OpenRouter is an intermediary/deployer. The CI review workflow it enables is limited-risk (transparency obligations apply — the AI review must be disclosed as AI-generated, which the workflow already does via PR comment) |
| **DPA status** | No formal DPA available from OpenRouter. **Consequence: PR diffs sent through this pipeline must not contain personal data (user emails, names, PII).** Code diffs containing only logic and test fixtures are acceptable |

---

### Tool 5 — GitHub Copilot (Business)

| Field | Detail |
|---|---|
| **Purpose** | IDE in-editor autocomplete (Slot 1) |
| **Vendor** | GitHub Inc / Microsoft |
| **Enterprise agreement** | Copilot Business licence; Microsoft DPA applies |
| **Data flow** | Code context sent to GitHub's API (`copilot-proxy.githubusercontent.com`). Business plan: prompts not retained, not used for training |
| **Storage** | Not retained under Business plan |
| **Training use** | Not used for training under Business plan |
| **EU AI Act classification** | GPAI downstream deployer (GitHub is the deployer; OpenAI/Codex is the GPAI provider). Limited risk — transparency obligation: developers should be aware suggestions are AI-generated |
| **DPA status** | Microsoft DPA covers GitHub Copilot Business; already in place for most organisations using Microsoft 365 |

---

## Part 2: IP Policy for AI-Generated Code

### 2.1 Ownership and Accountability

**Principle:** All code committed to TundraBoard repositories is owned by the organisation (or by the client, per the applicable services agreement), regardless of whether it was written by a human or generated by an AI tool.

AI tools are instruments, not authors. The engineer who reviews, accepts, and commits AI-generated code takes full professional and legal responsibility for it, as if they had written it themselves. "The AI wrote it" is not a defence for a defect, a security vulnerability, or a licence violation.

**Specific rules:**
- The developer who commits AI-generated code is the accountable party for its correctness, security, and licence compliance.
- No code may be committed without human review, regardless of source. The AI standards document (Section 4.2) defines the minimum review bar; this IP policy adds the licence compliance check below.
- If AI-generated code is later found to infringe a third-party licence, the organisation bears the remediation burden. Engineers are expected to follow the licence compliance process (Section 2.3) to prevent this.

### 2.2 Disclosure Requirements

**In PRs:**
All PRs containing AI-generated code must carry the `ai-generated` label (per the AI standards document). The PR description must additionally note which tool generated which files.

**In commit messages:**
Co-author attribution is used for significant AI-generated contributions:
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```
This is disclosure, not legal authorship — it provides an audit trail without implying the AI holds copyright.

**In client deliverables:**
If TundraBoard is delivered as a product or service to clients, the client contract must disclose that AI tools were used in development. The specific tools used are not required to be disclosed, but the fact of AI assistance is. This is consistent with emerging EU AI Act transparency requirements and is good practice regardless of jurisdiction.

**What does not require separate disclosure:**
- GitHub Copilot autocomplete for boilerplate (closing brackets, obvious variable names) — treated as IDE assistance equivalent to syntax highlighting
- AI-assisted documentation or comments — disclose only if the client contract specifically requires

### 2.3 Licence Compliance Checking Process

AI models are trained on public code repositories. They can and do reproduce fragments of code that carry licences (GPL, LGPL, AGPL, CC-BY-SA) that impose conditions on derivative works, including copyleft obligations that would require TundraBoard's source to be open-sourced if triggered.

**Mandatory checks before merging AI-generated code:**

1. **Run a licence scanner on new dependencies.** Any new `import` or `require` not previously in `package.json` must be checked with:
   ```bash
   npx license-checker --production --onlyAllow "MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause"
   ```
   PRs introducing packages with GPL, LGPL, AGPL, or unknown licences require engineering lead review before merge.

2. **Check for verbatim code reproduction.** For any substantial function (>20 lines) that appears to be AI-generated and is not obvious boilerplate, run it through a code search tool (GitHub Code Search, Sourcegraph) to verify it is not a verbatim copy of a third-party repository. This is especially important for algorithms, utility functions, and data structure implementations.

3. **Use IP-indemnified tools where available.** Antigravity Enterprise and GitHub Copilot Business both include IP indemnity clauses. Claude Code does not currently offer a code-specific IP indemnity. For high-stakes output (core business logic, security-sensitive code), prefer tools with indemnity.

4. **Document the check.** The PR description field `Licence check: ___` (in the PR template) must be completed for PRs with the `ai-generated` label.

### 2.4 Training Data Concerns and Mitigations

**Risk:** AI models trained on public code may have memorised and may reproduce:
- Code under copyleft licences (GPL and variants)
- Code containing embedded credentials or secrets (if present in training data)
- Code containing proprietary algorithms from private repositories that were inadvertently made public

**Mitigations:**

| Risk | Mitigation |
|---|---|
| Copyleft reproduction | Licence scanner (Section 2.3), IP indemnity via Antigravity Enterprise |
| Credential reproduction | Pre-commit hook scans outputs for credential patterns; never prompt with real credentials |
| Proprietary algorithm reproduction | Verbatim check for substantial non-trivial functions (Section 2.3 step 2) |
| TundraBoard code used for training | Enterprise DPA with both Anthropic and Antigravity explicitly excludes customer code from training. Verify DPA is signed before use |

**GPAI provider obligations (EU AI Act Article 53):** Anthropic and Antigravity (as GPAI providers) are required to publish summaries of training data used. TundraBoard should review these summaries when available to understand what corpus the model was trained on, particularly regarding open-source licence coverage.

---

## Part 3: EU AI Act Compliance Assessment

The EU AI Act (Regulation 2024/1689) entered into force 1 August 2024. GPAI obligations apply from August 2025; high-risk system requirements apply from August 2026.

### Use Case 1 — AI-Assisted Code Generation (Development-Facing)

**Description:** Developers use Claude Code and Antigravity to generate TypeScript/Express code for TundraBoard features, which is then reviewed and committed by a human engineer.

**Risk Classification:** Minimal risk (with GPAI provider obligations applying separately)

**Justification:**
- The output is code that a human reviews before deployment. No automated decision affecting a natural person is made by the AI.
- The use case does not fall into any Annex III high-risk category (not a biometric system, not critical infrastructure, not an employment decision system, not an education system, not essential services).
- The AI Act's risk classification applies to the *use case* (code generation for a task management app), not to the underlying model capability.
- The underlying models (Claude, Antigravity) are GPAI systems — the GPAI rules apply to Anthropic/Antigravity as providers, not directly to TundraBoard as a deployer for this use case.

**Applicable compliance requirements:**
- As a downstream deployer of a GPAI system, TundraBoard must not use the system contrary to the provider's usage policies (Article 28(1)(b))
- Must maintain logs sufficient to identify if an incident arose from AI use (Article 28(1)(d)) — satisfied by the `ai-generated` label and PR audit trail
- Transparency to users of TundraBoard's software: not directly required for internal tooling, but good practice

**Specific actions needed:**
1. Ensure Anthropic DPA and Antigravity Enterprise DPA are signed — required to demonstrate lawful processing
2. Maintain the PR labelling system (`ai-generated`) as an audit log
3. Include AI tool usage disclosure in client contracts where TundraBoard is delivered as software
4. Monitor GPAI provider's Article 53 transparency documentation (training data summary, capabilities, limitations) — review annually

---

### Use Case 2 — Automated AI PR Security Scanner (Development-Facing)

**Description:** The GitHub Actions workflow (`ai-review.yml`) automatically posts a security scan of every PR using Claude Haiku via OpenRouter. If critical findings are detected, it sets a blocking commit status that prevents merge.

**Risk Classification:** Limited risk — transparency obligations apply

**Justification:**
- The system makes an automated determination ("critical security finding") that has a consequential effect on a developer's work (blocking a PR merge).
- This is not high-risk under Annex III — it does not affect employment decisions, access to essential services, or safety-critical systems.
- However, it interacts with humans in a way that could influence decisions, and the "human" interacting with it (the developer whose PR is blocked) may not be aware they are interacting with an AI system.
- Article 50(1) of the EU AI Act: systems intended to interact with natural persons must disclose that the person is interacting with an AI system.

**Applicable compliance requirements:**
- **Transparency obligation (Article 50(1)):** The PR comment must clearly disclose that the review is AI-generated. *Currently satisfied* — the workflow posts "🤖 AI Code Review" with explicit AI attribution.
- **Human oversight:** A blocking security finding must be overridable by a human. *Currently satisfied* — the `ai-dismiss` label allows engineers to skip the check. This override mechanism should be logged.
- **Accuracy and reliability:** If the system makes incorrect security claims (see Incident Response, Scenario 3), the organisation must be able to investigate and correct. Logs of AI security findings should be retained for 6 months.
- **No consequential decisions without human review:** The blocking status is a gate, not a final decision — a human must still merge or override. This is compliant.

**Specific actions needed:**
1. Retain AI security scan outputs (PR comments + commit status payloads) for 6 months — add log retention to the CI workflow
2. Document the override mechanism (`ai-dismiss` label) in the AI standards document, including who is authorised to use it
3. Add a quarterly review of false positive/negative rate for security findings — if false positive rate exceeds 20%, retune the prompt
4. Ensure the PR template notes that AI security review is supplementary, not a substitute for human review

---

### Use Case 3 — Hypothetical User-Facing: AI Task Prioritisation Assistant

**Description:** A hypothetical future TundraBoard feature: an AI assistant that analyses a user's task backlog and recommends priority order based on due dates, historical completion rates, and stated team goals. The recommendations are shown in the UI; the user can accept or override them.

**Risk Classification:** Limited risk (approaching the boundary of high risk — requires monitoring)

**Justification:**
- The system provides recommendations affecting how a person organises their work. This is not an employment decision in a legal sense (it doesn't determine hiring, firing, or promotion), but it influences productivity and workload distribution in a professional context.
- If TundraBoard is sold to enterprises and the AI prioritisation affects task assignment to specific employees (e.g., "assign this task to User A because they have capacity"), it moves toward Annex III category 4 (employment-related AI systems) — **high risk**.
- In its basic form (personal backlog suggestions to the user who owns them), it is limited risk.
- The boundary condition: does the AI recommend which *person* should do a task, or only how a person should order their own tasks? The former is high risk; the latter is limited risk.

**Applicable compliance requirements (limited risk path):**
- **Transparency (Article 50(3)):** Users must be informed that prioritisation suggestions are AI-generated. A label ("AI suggested") on recommended tasks satisfies this.
- **Human override:** Users must be able to reorder tasks freely, ignoring AI suggestions. Required; must be prominent in UI.
- **No deceptive design:** The AI must not be designed to create a false impression of necessity ("you must do this task today") — recommendations must be framed as suggestions.

**If the feature expands to cross-user task assignment (high risk path):**
- **Conformity assessment** required before deployment (Article 43)
- **Register in EU database** of high-risk AI systems (Article 71)
- **Fundamental rights impact assessment** — does automated task assignment discriminate based on protected characteristics?
- **Human oversight mechanism** — a designated person (manager or admin) must be able to review and override all AI-generated assignments
- **Logging:** All AI assignment recommendations and human overrides must be logged for 5 years
- **Post-market monitoring:** Must track whether the system produces discriminatory patterns over time

**Specific actions needed (before building this feature):**
1. Define clearly in the product specification whether the AI recommends tasks for *self* or for *others* — this determines the risk tier and compliance cost before a line of code is written
2. If cross-user assignment is in scope: budget for a conformity assessment (estimated €15,000–€50,000 for a third-party audit) before EU launch
3. Add "AI suggested" badge to any prioritisation UI from day one — retrofitting transparency is harder than building it in
4. Document the decision rationale for the limited-risk classification and retain it — the AI Act requires deployers to be able to demonstrate compliance

---

## Part 4: Incident Response Plan

### Scenario 1 — AI-Generated Code Infringes a Licence

**Trigger:** A developer, during code review or post-merge audit, identifies that a function in TundraBoard appears to be a verbatim copy of code from a GPL-licensed repository. The function was generated by Antigravity or Claude Code.

**Immediate response (within 2 hours):**

1. **Quarantine the code.** If not yet merged: block the PR immediately. If already merged: open a `security` priority issue and create a remediation branch. Do not deploy the affected version to production or staging.

2. **Preserve evidence.** Screenshot or export the AI tool session that produced the code. Record the exact tool, model, prompt, and date. This is needed for the IP indemnity claim (Antigravity Enterprise) and for any legal assessment.

3. **Notify the engineering lead.** The engineering lead determines whether legal counsel is required based on the licence involved:
   - **MIT, Apache 2.0, BSD:** Attribution required; remediation is adding a notice — low urgency
   - **LGPL:** May be acceptable with dynamic linking; legal review recommended
   - **GPL/AGPL:** Copyleft trigger; legal review required immediately before any distribution

**Short-term (within 24 hours):**

4. **Replace the code.** Rewrite the infringing function from scratch (without AI assistance for this specific function, to avoid re-generating the same output). Have the rewrite reviewed by a second engineer.

5. **File an IP indemnity claim with Antigravity** (if Antigravity generated the code). Antigravity Enterprise's IP indemnity covers defence costs and damages if the claim proceeds. Provide the evidence package from step 2.

6. **Audit for recurrence.** Run the licence scanner and code search check (Section 2.3) across all AI-generated code committed in the past 30 days. If the same function appears elsewhere, treat each instance as a separate finding.

**Follow-up (within 1 week):**

7. **Update the PR template** to make the licence compliance check field mandatory (not optional) for PRs with the `ai-generated` label.

8. **Post-mortem:** Was the licence check missed because the process was unclear, because it was skipped under time pressure, or because the tool generated the code without the developer recognising the similarity? Address the root cause.

---

### Scenario 2 — Confidential Client Data Accidentally Sent to a Personal-Tier AI Tool

**Trigger:** A developer used their personal ChatGPT account (or personal-tier Antigravity) to debug a function. The code they pasted included a hardcoded customer email address from a test fixture, or a database dump excerpt from staging.

**Immediate response (within 1 hour):**

1. **Stop using the tool for this session.** Do not delete conversation history — it may be needed for investigation. Do not attempt to use the tool's "delete conversation" feature until the scope is confirmed.

2. **Notify the engineering lead immediately** via direct message: what data was included, which tool, when, whether the data was production or staging.

3. **Identify the data subject.** Was it a real customer's email/data, or synthetic test data? If synthetic (e.g., `test@example.com`, generated UUIDs): this is a near-miss, not a notifiable incident. If real PII: proceed to step 4.

4. **Assess the tool's data policy.** For ChatGPT personal tier: OpenAI retains conversation data for 30 days by default and may use it for training unless the user has opted out. The data has left TundraBoard's control.

**Short-term (within 24 hours):**

5. **If real PII was disclosed:**
   - Engineering lead notifies the Data Protection Officer (or designated data protection contact)
   - DPO assesses whether GDPR Article 33 breach notification to the supervisory authority (ICO/DPA) is required (threshold: risk to individuals' rights and freedoms)
   - GDPR Article 33 notification must be filed within 72 hours of becoming aware of the breach if the threshold is met
   - If the affected data subjects can be identified, consider Article 34 notification to them

6. **Request deletion from the tool provider.** Submit a deletion request to OpenAI (or the relevant provider) for the conversation. Document the request and any response. This does not guarantee deletion within the 30-day window but demonstrates reasonable steps were taken.

7. **Rotate any credentials** that were included in the disclosure. If a connection string, API key, or JWT secret was included: rotate immediately without waiting for investigation to complete.

**Follow-up (within 1 week):**

8. **Blameless post-mortem.** Root cause is typically one of: (a) unclear onboarding — developer did not know personal tools were prohibited; (b) time pressure — developer took a shortcut; (c) unclear data classification — developer did not recognise the test fixture contained real data.

9. **Update onboarding** to include an explicit example of this scenario in the data-handling quiz.

10. **Add a pre-commit hook** that scans staged files for patterns resembling email addresses, UUIDs matching known customer ID formats, and connection strings — flag for review before commit.

---

### Scenario 3 — AI PR Review Bot Makes Incorrect Security Claims Delaying a Critical Release

**Trigger:** The `ai-review.yml` workflow posts a blocking security finding on a critical hotfix PR — for example, flagging a parameterised `$queryRaw` call as a "SQL injection vulnerability" when it is not. The release is time-sensitive (e.g., a production incident fix). The team is unsure whether to trust the AI finding or override it.

**Immediate response (within 30 minutes):**

1. **Human review takes precedence.** A senior engineer reviews the specific flagged code immediately. The AI finding is a hypothesis, not a verdict. The engineer answers: is this actually a SQL injection risk?

2. **If the finding is incorrect:**
   - Apply the `ai-dismiss` label to skip the AI blocking status
   - Document the false positive in the PR description: "AI review flagged `$queryRaw` call as SQL injection. Reviewed by [engineer]: all parameters are passed via tagged template literals, not string interpolation. False positive."
   - Proceed with the release

3. **If the finding is ambiguous (engineer is unsure):**
   - Do not merge until a second senior engineer reviews
   - If no senior engineer is available within 1 hour and the production incident is severe: escalate to the engineering lead to make the merge/hold decision with full visibility of the risk

**Short-term (within 24 hours):**

4. **Log the false positive.** Add an entry to `metrics/ai-review-findings.jsonl`:
   ```json
   {"date": "2026-04-23", "pr": 42, "type": "false_positive",
    "claim": "SQL injection in $queryRaw", "resolution": "dismissed",
    "reviewer": "engineer-name"}
   ```

5. **Review the AI review prompt.** False positives on parameterised `$queryRaw` suggest the security prompt does not distinguish between `$queryRaw` (safe, prepared statement) and `$queryRawUnsafe` (unsafe, string interpolation). Update the prompt to include this distinction explicitly.

6. **Assess whether the bot's blocking behaviour is appropriate** for the team's current maturity. Options:
   - Downgrade from blocking to informational (removes the merge gate; AI findings become advisory only)
   - Narrow the blocking criteria (only block on a defined list of finding types, not on free-text "critical" classification)
   - Add a human-confirmation step: AI flags → engineer confirms before status is set to blocking

**Follow-up (within 1 week):**

7. **Establish a false positive rate target.** If >20% of AI security findings are false positives in a given month, the prompt must be revised before the next release cycle.

8. **Document the override process** in the AI standards document (Section 4.4) so engineers know the `ai-dismiss` label exists and when it is appropriate to use it — this should not require escalation in a time-sensitive situation.

9. **Post-mortem question:** Did the incident delay occur because the engineer didn't know they could override the block, because the AI finding was convincing enough to cause genuine doubt, or because the process required escalation that shouldn't have been necessary? Each root cause has a different fix.

---

*Submitted for Exercise 16. Covers: AI tool inventory (5 tools with vendor, data flow, EU AI Act classification, DPA status), IP policy (ownership, disclosure, licence compliance process, training data mitigations), EU AI Act assessment (3 use cases: minimal/limited/limited-to-high risk), incident response (3 scenarios: licence infringement, personal-tier data exposure, false positive security block).*
