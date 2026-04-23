# Exercise 10 — Multi-Model Strategy for TundraBoard

> **Pricing note:** All figures use approximate rates from training data (cutoff August 2025).
> Verify current prices at anthropic.com/pricing and openai.com/pricing before using these
> numbers in budget decisions.

---

## 1. Pipeline Map — AI Stages and Model Assignments

### Reference: Model Tiers

| Tier | Anthropic | OpenAI | Characteristics |
|------|-----------|--------|----------------|
| Quick | Claude Haiku 4.5 | GPT-4o-mini | Sub-100ms, low cost, structured output |
| Generation | Claude Sonnet 4.6 | GPT-4o | Balanced quality/cost, code-capable |
| Reasoning | Claude Opus 4.7 | o1 | Deep analysis, complex trade-offs |

---

### Stage-by-Stage Map

#### Stage 1 — Inline Code Completions
| Field | Value |
|-------|-------|
| **Tier** | Quick (Haiku / GPT-4o-mini) |
| **Why** | Latency is the constraint, not quality. Needs <100ms. Completions are short and contextually bounded — Haiku handles them accurately. Sonnet would add cost with no perceptible quality gain. |
| **Tokens/interaction** | ~200 input, ~50 output |
| **Frequency** | ~100 per developer per day |
| **Daily tokens/dev** | 20,000 in / 5,000 out |

---

#### Stage 2 — Code Q&A and Explanation
| Field | Value |
|-------|-------|
| **Tier** | Generation (Sonnet / GPT-4o) |
| **Why** | Requires understanding of code semantics, framework conventions, and project context. Haiku produces shallow explanations on complex code. Reasoning tier is overkill for explanations. |
| **Tokens/interaction** | ~500 input, ~300 output |
| **Frequency** | ~20 per developer per day |
| **Daily tokens/dev** | 10,000 in / 6,000 out |

---

#### Stage 3 — Interactive Code Review (developer-triggered)
| Field | Value |
|-------|-------|
| **Tier** | Generation (Sonnet / GPT-4o) |
| **Why** | Needs to understand diffs, identify logic errors, spot security issues. More demanding than Q&A. Reasoning tier would add latency without proportional benefit for routine review. |
| **Tokens/interaction** | ~1,000 input, ~500 output |
| **Frequency** | ~10 per developer per day |
| **Daily tokens/dev** | 10,000 in / 5,000 out |

---

#### Stage 4 — Bug Diagnosis
| Field | Value |
|-------|-------|
| **Tier** | Generation (Sonnet / GPT-4o) |
| **Why** | Requires reading stack traces, correlating error with code paths, suggesting fixes. Occasionally reasoning-tier work, but Sonnet handles the majority well. Reserve Opus for escalation only (see guardrails). |
| **Tokens/interaction** | ~2,000 input, ~1,000 output |
| **Frequency** | ~5 per developer per day |
| **Daily tokens/dev** | 10,000 in / 5,000 out |

---

#### Stage 5 — Test Generation
| Field | Value |
|-------|-------|
| **Tier** | Generation (Sonnet / GPT-4o) |
| **Why** | Needs to understand function contracts and edge cases to write meaningful assertions. Haiku produces syntactically correct but semantically shallow tests. |
| **Tokens/interaction** | ~1,500 input, ~1,000 output |
| **Frequency** | ~5 per developer per day |
| **Daily tokens/dev** | 7,500 in / 5,000 out |

---

#### Stage 6 — Commit Message Generation
| Field | Value |
|-------|-------|
| **Tier** | Quick (Haiku / GPT-4o-mini) |
| **Why** | Highly structured, short output. Pattern follows a well-defined template (conventional commits). Haiku performs at ceiling on this task — there is no quality gap vs. Sonnet. |
| **Tokens/interaction** | ~500 input (staged diff summary), ~100 output |
| **Frequency** | ~10 per developer per day |
| **Daily tokens/dev** | 5,000 in / 1,000 out |

---

#### Stage 7 — Architecture and Design Decisions
| Field | Value |
|-------|-------|
| **Tier** | Reasoning (Opus / o1) |
| **Why** | Trade-off analysis across multiple dimensions (scalability, security, maintainability, cost). Decisions have long-lived consequences. This is exactly the task reasoning models are built for. The low frequency makes the per-token premium acceptable. |
| **Tokens/interaction** | ~5,000 input, ~2,000 output |
| **Frequency** | ~2 per developer per day |
| **Daily tokens/dev** | 10,000 in / 4,000 out |

---

#### Stage 8 — PR Description Generation (pipeline)
| Field | Value |
|-------|-------|
| **Tier** | Quick (Haiku / GPT-4o-mini) |
| **Why** | Structured template output (title, summary, test plan). The diff is the input; the format is fixed. Haiku produces accurate PR descriptions when given a well-structured prompt. Lower tier justified by high frequency (5 PRs/dev/day). |
| **Tokens/interaction** | ~3,000 input (diff), ~500 output |
| **Frequency** | 5 per developer per day |
| **Daily tokens/dev** | 15,000 in / 2,500 out |

---

#### Stage 9 — Automated Code Review (CI)
| Field | Value |
|-------|-------|
| **Tier** | Generation (Sonnet / GPT-4o) |
| **Why** | CI review must catch security issues, logic errors, and style violations with low false-positive rate. Haiku misses subtle bugs. Reasoning tier is cost-prohibitive at 5 PRs/dev/day frequency. |
| **Tokens/interaction** | ~5,000 input (diff + system prompt + code standards), ~1,000 output |
| **Frequency** | 5 per developer per day |
| **Daily tokens/dev** | 25,000 in / 5,000 out |

---

#### Stage 10 — Task Description Generation (TundraBoard pipeline, existing)
| Field | Value |
|-------|-------|
| **Tier** | Quick (Haiku / GPT-4o-mini) |
| **Why** | Currently uses Sonnet 4.6 (existing implementation). Structured JSON output with fixed schema. Based on the eval harness results (100% pass rate on v1), this is a task where Haiku can achieve the same quality at 73% lower cost. Recommended downgrade. |
| **Tokens/interaction** | ~200 input, ~400 output |
| **Frequency** | ~10 per developer per day |
| **Daily tokens/dev** | 2,000 in / 4,000 out |

---

### Token Summary (per developer per day)

| Stage | Tier | In tokens | Out tokens |
|-------|------|-----------|------------|
| Inline completions | Quick | 20,000 | 5,000 |
| Code Q&A | Generation | 10,000 | 6,000 |
| Interactive review | Generation | 10,000 | 5,000 |
| Bug diagnosis | Generation | 10,000 | 5,000 |
| Test generation | Generation | 7,500 | 5,000 |
| Commit messages | Quick | 5,000 | 1,000 |
| Architecture decisions | Reasoning | 10,000 | 4,000 |
| PR description (pipeline) | Quick | 15,000 | 2,500 |
| Automated CI review (pipeline) | Generation | 25,000 | 5,000 |
| Task description gen (pipeline) | Quick | 2,000 | 4,000 |
| **Total** | | **114,500** | **42,500** |

---

## 2. Cost Calculations

### Pricing Reference

**Anthropic:**
| Model | Input ($/MTok) | Output ($/MTok) |
|-------|---------------|----------------|
| Claude Haiku 4.5 | $0.80 | $4.00 |
| Claude Sonnet 4.6 | $3.00 | $15.00 |
| Claude Opus 4.7 | $15.00 | $75.00 |

**OpenAI:**
| Model | Input ($/MTok) | Output ($/MTok) |
|-------|---------------|----------------|
| GPT-4o-mini | $0.15 | $0.60 |
| GPT-4o | $2.50 | $10.00 |
| o1 | $15.00 | $60.00 |

*Assumptions: 22 working days/month, 10 developers, 5 PRs/developer/day.*

---

### Mixed Strategy — Daily Cost per Developer (Anthropic)

**Quick tier (Haiku):**
| Stage | Input cost | Output cost | Daily total |
|-------|-----------|-------------|-------------|
| Inline completions | 20,000 × $0.80/MTok = $0.016 | 5,000 × $4.00/MTok = $0.020 | $0.036 |
| Commit messages | 5,000 × $0.80/MTok = $0.004 | 1,000 × $4.00/MTok = $0.004 | $0.008 |
| PR description | 15,000 × $0.80/MTok = $0.012 | 2,500 × $4.00/MTok = $0.010 | $0.022 |
| Task description | 2,000 × $0.80/MTok = $0.002 | 4,000 × $4.00/MTok = $0.016 | $0.018 |
| **Haiku subtotal** | | | **$0.084** |

**Generation tier (Sonnet):**
| Stage | Input cost | Output cost | Daily total |
|-------|-----------|-------------|-------------|
| Code Q&A | 10,000 × $3.00/MTok = $0.030 | 6,000 × $15.00/MTok = $0.090 | $0.120 |
| Interactive review | 10,000 × $3.00/MTok = $0.030 | 5,000 × $15.00/MTok = $0.075 | $0.105 |
| Bug diagnosis | 10,000 × $3.00/MTok = $0.030 | 5,000 × $15.00/MTok = $0.075 | $0.105 |
| Test generation | 7,500 × $3.00/MTok = $0.023 | 5,000 × $15.00/MTok = $0.075 | $0.098 |
| Automated CI review | 25,000 × $3.00/MTok = $0.075 | 5,000 × $15.00/MTok = $0.075 | $0.150 |
| **Sonnet subtotal** | | | **$0.578** |

**Reasoning tier (Opus):**
| Stage | Input cost | Output cost | Daily total |
|-------|-----------|-------------|-------------|
| Architecture decisions | 10,000 × $15.00/MTok = $0.150 | 4,000 × $75.00/MTok = $0.300 | $0.450 |
| **Opus subtotal** | | | **$0.450** |

**Mixed daily total per dev: $1.112**
**Mixed monthly per dev: $1.112 × 22 = $24.46**
**Mixed monthly for 10 devs: $244.60**

---

### Mixed Strategy — Daily Cost per Developer (OpenAI)

**Quick tier (GPT-4o-mini):**
| Stage | Input cost | Output cost | Daily total |
|-------|-----------|-------------|-------------|
| Inline completions | 20,000 × $0.15/MTok = $0.003 | 5,000 × $0.60/MTok = $0.003 | $0.006 |
| Commit messages | 5,000 × $0.15/MTok = $0.001 | 1,000 × $0.60/MTok = $0.001 | $0.002 |
| PR description | 15,000 × $0.15/MTok = $0.002 | 2,500 × $0.60/MTok = $0.002 | $0.004 |
| Task description | 2,000 × $0.15/MTok = $0.0003 | 4,000 × $0.60/MTok = $0.002 | $0.002 |
| **Mini subtotal** | | | **$0.014** |

**Generation tier (GPT-4o):**
| Stage | Input cost | Output cost | Daily total |
|-------|-----------|-------------|-------------|
| Code Q&A | 10,000 × $2.50/MTok = $0.025 | 6,000 × $10.00/MTok = $0.060 | $0.085 |
| Interactive review | 10,000 × $2.50/MTok = $0.025 | 5,000 × $10.00/MTok = $0.050 | $0.075 |
| Bug diagnosis | 10,000 × $2.50/MTok = $0.025 | 5,000 × $10.00/MTok = $0.050 | $0.075 |
| Test generation | 7,500 × $2.50/MTok = $0.019 | 5,000 × $10.00/MTok = $0.050 | $0.069 |
| Automated CI review | 25,000 × $2.50/MTok = $0.063 | 5,000 × $10.00/MTok = $0.050 | $0.113 |
| **GPT-4o subtotal** | | | **$0.417** |

**Reasoning tier (o1):**
| Stage | Input cost | Output cost | Daily total |
|-------|-----------|-------------|-------------|
| Architecture decisions | 10,000 × $15.00/MTok = $0.150 | 4,000 × $60.00/MTok = $0.240 | $0.390 |
| **o1 subtotal** | | | **$0.390** |

**OpenAI mixed daily total per dev: $0.821**
**OpenAI mixed monthly per dev: $0.821 × 22 = $18.06**
**OpenAI mixed monthly for 10 devs: $180.60**

---

### Strategy Comparison — All Three Approaches

All using same daily token volumes (114,500 in / 42,500 out per developer):

**All-Reasoning:**
| Provider | Daily/dev | Monthly/dev | Monthly/10 devs |
|---------|----------|------------|-----------------|
| Anthropic (Opus) | 114,500×$15/MTok + 42,500×$75/MTok = $4.90 | $107.80 | **$1,078** |
| OpenAI (o1) | 114,500×$15/MTok + 42,500×$60/MTok = $4.27 | $93.94 | **$939** |

**All-Generation:**
| Provider | Daily/dev | Monthly/dev | Monthly/10 devs |
|---------|----------|------------|-----------------|
| Anthropic (Sonnet) | 114,500×$3/MTok + 42,500×$15/MTok = $0.98 | $21.56 | **$216** |
| OpenAI (GPT-4o) | 114,500×$2.50/MTok + 42,500×$10/MTok = $0.71 | $15.62 | **$156** |

**Mixed (recommended):**
| Provider | Daily/dev | Monthly/dev | Monthly/10 devs |
|---------|----------|------------|-----------------|
| Anthropic | $1.112 | $24.46 | **$245** |
| OpenAI | $0.821 | $18.06 | **$181** |

**Summary comparison (Anthropic):**

| Strategy | Monthly / 10 devs | vs Mixed |
|----------|------------------|---------|
| All-reasoning | $1,078 | +340% |
| Mixed | $245 | baseline |
| All-generation | $216 | −12% |

**Key insight:** All-reasoning costs 4.4× more than mixed for marginal quality improvement on simple tasks. All-generation saves only 12% vs. mixed but uses Sonnet for architecture decisions where Opus produces meaningfully better output. Mixed is the right balance. Note that the Opus premium for architecture ($0.450/day) accounts for 40% of the mixed strategy's daily cost — this is where the biggest single lever for cost reduction exists.

---

## 3. Budget Guardrail Design

### Per-Developer Daily Caps (Interactive AI)

```
Daily budget: $3.00 per developer
├── 75% threshold ($2.25): Slack alert to developer
│     "You've used 75% of today's AI budget. Consider batching requests."
├── 90% threshold ($2.70): Auto-downgrade tier
│     Reasoning → Generation (Sonnet replaces Opus for architecture requests)
│     Generation → Generation (no change — maintained for code quality)
└── 100% threshold ($3.00): Quick tier only for remainder of day
      Sonnet → Haiku (inline, Q&A, review still work — lower quality)
      Exception: critical bug flag bypasses cap with manager approval token
```

### Per-Developer Daily Caps (CI/CD Pipeline)

```
Pipeline budget: $2.00 per developer per day (5 PRs × $0.40/PR)

Per-PR budget: $0.40
├── Automated CI review (Sonnet): ~$0.150 target
├── PR description (Haiku): ~$0.022 target
├── Task description (Haiku): ~$0.018 target
└── Buffer: ~$0.210

If single PR exceeds $0.40:
  → Log warning to PR comment: "AI review was truncated (context limit)"
  → Fall back to Haiku for remainder of that PR's review
```

### Team-Level Monthly Budget

```
Monthly team budget: $400 (Anthropic mixed strategy, with buffer)
├── Alert at $300 (75%): Engineering lead notified
├── Alert at $360 (90%): Per-developer caps tightened by 20%
└── Hard limit at $400: Pipeline AI disabled; interactive AI Haiku-only
      Recovery: new month or lead approves budget increase
```

### Model Fallback Chains

**Interactive:**
```
Architecture request:
  Opus → [if daily Opus budget exhausted] → Sonnet + "⚠ Using generation model today"

Code Q&A / Review / Bug diagnosis:
  Sonnet → [if daily Sonnet budget exhausted] → Haiku + "⚠ Quality reduced"
  Haiku → [if daily cap hit] → Queue until next day (or exception token)

Commit messages / Completions:
  Haiku → [if unavailable] → Skip (no fallback; non-blocking)
```

**CI/CD Pipeline:**
```
Automated review (Sonnet):
  Sonnet → [if per-PR budget exceeded] → Haiku (abbreviated review)
  Haiku → [if pipeline budget exhausted] → Skip AI review; require human review label

PR description (Haiku):
  Haiku → [if unavailable] → Template stub (non-blocking)
```

### Alert Thresholds Summary

| Threshold | Action |
|-----------|--------|
| Dev at 75% daily budget | Slack DM to developer |
| Dev at 90% daily budget | Auto-downgrade reasoning → generation |
| Dev at 100% daily budget | Haiku-only for rest of day |
| Team at 75% monthly budget | Alert to engineering lead |
| Team at 90% monthly budget | Per-dev caps tightened 20% |
| Team at 100% monthly budget | Pipeline AI disabled |
| Single PR exceeds $0.40 | PR comment warning + Haiku fallback |

---

## 4. Optimisation Plan

### Optimisation 1 — Prompt Caching on Automated CI Review

**What:** The automated code review system prompt (code standards, review instructions, project conventions) is identical across all PRs — approximately 1,500 of the 5,000 input tokens. Anthropic's prompt cache prices cached tokens at $0.30/MTok (90% discount vs. $3.00/MTok).

**Implementation:** Wrap the system prompt in a `cache_control: {"type": "ephemeral"}` block. Cache TTL is 5 minutes; CI reviews triggered close together on the same runner reuse the cache.

**Cost reduction:**
```
Cached tokens per PR: 1,500
Savings per token: $3.00 - $0.30 = $2.70/MTok
Savings per PR: 1,500 × $2.70/MTok = $0.004
PRs per month (10 devs × 5/day × 22 days): 1,100
Monthly savings: 1,100 × $0.004 = $4.40
```

Additional: cache the code Q&A system prompt (~500 tokens, reused across a session):
```
500 × $2.70/MTok × 20 interactions × 22 days × 10 devs = $5.94/month
```

**Total estimated saving: ~$10/month (4% of baseline)**

---

### Optimisation 2 — Downgrade Task Description Generator from Sonnet to Haiku

**What:** The existing TundraBoard task description generator uses Sonnet 4.6. The eval harness (Exercise 7) showed 100% pass rate on v1 outputs — meaning the model is over-qualified for this structured JSON generation task. Haiku 4.5 can match this quality on template-driven output.

**Implementation:** Change model ID in the generator from `claude-sonnet-4-6` to `claude-haiku-4-5-20251001`. Run evals to confirm pass rate stays ≥90% before deploying.

**Cost reduction:**
```
Current (Sonnet):  2,000 × $3.00/MTok + 4,000 × $15.00/MTok = $0.066/day/dev
Target (Haiku):    2,000 × $0.80/MTok + 4,000 × $4.00/MTok  = $0.018/day/dev
Daily saving per dev: $0.048
Monthly saving (10 devs × 22 days): $0.048 × 220 = $10.56
```

**Estimated saving: ~$10.56/month (4.3% of baseline)**
**Quality risk: Low** — evals gate catches any regression before production.

---

### Optimisation 3 — Anthropic Batch API for All Pipeline Stages

**What:** All three CI/CD pipeline stages (automated code review, PR description, task description) are asynchronous by nature — the result is needed within minutes, not milliseconds. Anthropic's Batch API offers a 50% discount on both input and output tokens for requests fulfilled within 24 hours.

**Implementation:** Replace synchronous `messages.create()` calls in the CI pipeline with `messages.batches.create()`. Poll for results or use a webhook. Because CI already waits for the pipeline to complete, a 2–5 minute batch turnaround is acceptable.

**Cost reduction:**
```
Current pipeline daily per dev:
  CI review: $0.150
  PR description: $0.022
  Task description: $0.018
  Daily total: $0.190

With 50% batch discount: $0.095/day/dev
Monthly saving: $0.095 × 220 = $20.90
```

**Estimated saving: ~$20.90/month (8.5% of baseline)**
**Latency impact: +2–5 minutes on CI run** — acceptable for async pipeline stages.

---

### Combined Savings Summary

| Optimisation | Monthly Saving | % of Baseline |
|-------------|---------------|---------------|
| Prompt caching (CI review + Q&A) | $10.00 | 4% |
| Task description → Haiku | $10.56 | 4.3% |
| Batch API for pipeline | $20.90 | 8.5% |
| **Total** | **$41.46** | **~17%** |

**Baseline (mixed, Anthropic, 10 devs): $245/month**
**Optimised: $245 − $41 = ~$204/month**

This brings the mixed strategy below the all-generation baseline ($216/month) while maintaining reasoning-tier quality for architecture decisions.

---

### Additional Optimisation (Recommended but not quantified here)

**Conversation summarisation for long Q&A sessions:** After 3 turns in a code Q&A conversation, summarise prior context to ~300 tokens before appending new turns. Without this, a 10-turn session sends ~5× more input tokens than the first turn. Estimated saving: $3–5/month for a team of 10.

**Architect-on-demand instead of Architect-by-default:** Change Opus from automatic (2 uses/dev/day assumed) to developer-initiated with a keyboard shortcut (`/deep`). Most architecture questions are actually design clarifications that Sonnet handles well. If usage drops to 0.5 sessions/dev/day, Opus cost reduces by 75%: saves $0.338/day × 220 = **$74/month** — the single largest lever available.

---

## 5. TundraBoard-Specific Notes

- **Existing pipeline (task description generator):** Currently Sonnet 4.6 — should migrate to Haiku 4.5 after eval validation. The eval harness from Exercise 7 is the correct gate for this change.
- **Existing eval judge (GPT-4o-mini via OpenRouter):** Already on the correct tier for a structured scoring task. No change needed.
- **Evals CI workflow:** Runs only on path changes — correctly avoids charging for every push. This is already cost-optimised.
- **No streaming required for any CI stage:** All pipeline stages can safely move to Batch API.
