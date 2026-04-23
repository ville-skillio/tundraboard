#!/usr/bin/env python3
"""
Single-agent runner for the TundraBoard full-text search task.

Usage:
    pip install anthropic
    export ANTHROPIC_API_KEY=sk-ant-...
    python agents/single_agent/runner.py

Writes the agent response to agents/single_agent/transcript.md and
prints per-turn token counts to stdout.
"""

import os
import time
import anthropic
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent.parent
AGENT_DIR = Path(__file__).parent

CONTEXT_FILES = [
    "prisma/schema.prisma",
    "src/services/taskService.ts",
    "src/routes/tasks.ts",
    "tests/tasks.test.ts",
]

MODEL = "claude-sonnet-4-6"


def read_file(rel_path: str) -> str:
    path = REPO_ROOT / rel_path
    return f"### {rel_path}\n```\n{path.read_text()}\n```\n"


def build_user_message() -> str:
    parts = ["Here are the relevant TundraBoard source files:\n"]
    for f in CONTEXT_FILES:
        parts.append(read_file(f))
    parts.append(
        "\nImplement the full-text search feature as described in your system prompt."
    )
    return "\n".join(parts)


def main() -> None:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    system_prompt = (AGENT_DIR / "system_prompt.md").read_text()

    user_message = build_user_message()

    print(f"Input context size: {len(user_message):,} chars (~{len(user_message)//4:,} tokens)")
    print(f"Model: {MODEL}")

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
    total_tokens = input_tokens + output_tokens

    print(f"\n--- Token usage ---")
    print(f"  Input tokens : {input_tokens:,}")
    print(f"  Output tokens: {output_tokens:,}")
    print(f"  Total        : {total_tokens:,}")
    print(f"  Wall clock   : {elapsed:.1f}s")
    print(f"  Stop reason  : {response.stop_reason}")

    # Write transcript
    transcript = f"""---
agent: single_agent
model: {MODEL}
input_tokens: {input_tokens}
output_tokens: {output_tokens}
total_tokens: {total_tokens}
wall_clock_seconds: {elapsed:.1f}
---

## Input

{user_message}

## Output

{response.content[0].text}
"""

    transcript_path = AGENT_DIR / "transcript.md"
    transcript_path.write_text(transcript, encoding="utf-8")
    print(f"\nTranscript written to {transcript_path}")


if __name__ == "__main__":
    main()
