#!/usr/bin/env python3
"""
Planner-Executor-Critic orchestrator for the TundraBoard full-text search task.

Topology: sequential pipeline
  Planner  (reads full codebase → produces ImplementationPlan)
      ↓
  Executor (receives plan + target files → produces ExecutorReport)
      ↓
  Critic   (receives plan + report → produces CriticVerdict)

Usage:
    pip install anthropic
    export ANTHROPIC_API_KEY=sk-ant-...
    python agents/multi_agent/orchestrator.py

Transcripts are written to agents/multi_agent/transcripts/<agent>.md
Token counts and wall-clock times are printed to stdout and written
to agents/multi_agent/transcripts/summary.json
"""

import json
import os
import time
import anthropic
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
AGENT_DIR = Path(__file__).parent
TRANSCRIPT_DIR = AGENT_DIR / "transcripts"
TRANSCRIPT_DIR.mkdir(exist_ok=True)

MODEL = "claude-sonnet-4-6"

PLANNER_CONTEXT_FILES = [
    "prisma/schema.prisma",
    "src/services/taskService.ts",
    "src/routes/tasks.ts",
    "tests/tasks.test.ts",
]

# Executor only receives the files it needs to modify — smaller context.
EXECUTOR_CONTEXT_FILES = [
    "src/services/taskService.ts",
    "tests/tasks.test.ts",
    "prisma/schema.prisma",
]


def read_file(rel_path: str) -> str:
    path = REPO_ROOT / rel_path
    return f"### {rel_path}\n```\n{path.read_text()}\n```\n"


def call_agent(
    client: anthropic.Anthropic,
    agent_name: str,
    system_prompt: str,
    user_message: str,
) -> tuple[str, dict]:
    """Call the API, write transcript, return (response_text, token_info)."""
    start = time.time()

    response = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    elapsed = time.time() - start
    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens

    token_info = {
        "agent": agent_name,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "wall_clock_seconds": round(elapsed, 1),
    }

    response_text = response.content[0].text

    # Write transcript
    transcript = f"""---
agent: {agent_name}
model: {MODEL}
input_tokens: {input_tokens}
output_tokens: {output_tokens}
total_tokens: {input_tokens + output_tokens}
wall_clock_seconds: {elapsed:.1f}
---

## Input

{user_message}

## Output

{response_text}
"""
    (TRANSCRIPT_DIR / f"{agent_name}.md").write_text(transcript, encoding="utf-8")

    print(f"[{agent_name}] in={input_tokens:,} out={output_tokens:,} "
          f"total={input_tokens+output_tokens:,} time={elapsed:.1f}s")

    return response_text, token_info


def run_planner(client: anthropic.Anthropic) -> tuple[str, dict]:
    system_prompt = (AGENT_DIR / "planner_system_prompt.md").read_text()

    user_message = (
        "Here are the TundraBoard source files to analyse:\n\n"
        + "\n".join(read_file(f) for f in PLANNER_CONTEXT_FILES)
        + "\n\nProduce the ImplementationPlan JSON."
    )

    return call_agent(client, "planner", system_prompt, user_message)


def run_executor(client: anthropic.Anthropic, plan_json: str) -> tuple[str, dict]:
    system_prompt = (AGENT_DIR / "executor_system_prompt.md").read_text()

    user_message = (
        "## ImplementationPlan\n\n"
        + plan_json
        + "\n\n## Files to modify\n\n"
        + "\n".join(read_file(f) for f in EXECUTOR_CONTEXT_FILES)
        + "\n\nProduce the ExecutorReport JSON."
    )

    return call_agent(client, "executor", system_prompt, user_message)


def run_critic(client: anthropic.Anthropic, plan_json: str, report_json: str) -> tuple[str, dict]:
    system_prompt = (AGENT_DIR / "critic_system_prompt.md").read_text()

    user_message = (
        "## ImplementationPlan\n\n"
        + plan_json
        + "\n\n## ExecutorReport\n\n"
        + report_json
        + "\n\nProduce the CriticVerdict JSON."
    )

    return call_agent(client, "critic", system_prompt, user_message)


def main() -> None:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    print(f"Model: {MODEL}")
    print("=" * 60)

    wall_start = time.time()

    plan_text, plan_tokens   = run_planner(client)
    report_text, exec_tokens = run_executor(client, plan_text)
    verdict_text, crit_tokens = run_critic(client, plan_text, report_text)

    total_wall = time.time() - wall_start

    all_tokens = [plan_tokens, exec_tokens, crit_tokens]
    grand_total = sum(t["total_tokens"] for t in all_tokens)

    print("=" * 60)
    print(f"Total tokens : {grand_total:,}")
    print(f"Total wall   : {total_wall:.1f}s")

    summary = {
        "agents": all_tokens,
        "grand_total_tokens": grand_total,
        "total_wall_clock_seconds": round(total_wall, 1),
    }

    summary_path = TRANSCRIPT_DIR / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Summary written to {summary_path}")


if __name__ == "__main__":
    main()
