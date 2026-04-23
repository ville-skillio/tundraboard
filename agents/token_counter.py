#!/usr/bin/env python3
"""
Token counter for single-agent and multi-agent transcripts.

Reads YAML frontmatter from transcript files to extract recorded token counts.
Falls back to character-based estimation (len / 4) for files without frontmatter.

Usage:
    python agents/token_counter.py

Prints a table of per-agent token counts and totals.
"""

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
SINGLE_TRANSCRIPT = REPO_ROOT / "agents/single_agent/transcript.md"
MULTI_TRANSCRIPTS = [
    REPO_ROOT / "agents/multi_agent/transcripts/planner.md",
    REPO_ROOT / "agents/multi_agent/transcripts/executor.md",
    REPO_ROOT / "agents/multi_agent/transcripts/critic.md",
]

FRONTMATTER_PATTERN = re.compile(r"^---\n(.*?)\n---", re.DOTALL)
FIELD_PATTERN = re.compile(r"^(\w+):\s*(.+)$", re.MULTILINE)


def parse_frontmatter(content: str) -> dict:
    """Extract key:value pairs from YAML frontmatter."""
    m = FRONTMATTER_PATTERN.match(content)
    if not m:
        return {}
    fields = {}
    for match in FIELD_PATTERN.finditer(m.group(1)):
        key, val = match.group(1), match.group(2).strip()
        try:
            fields[key] = int(val)
        except ValueError:
            try:
                fields[key] = float(val)
            except ValueError:
                fields[key] = val
    return fields


def estimate_tokens(text: str) -> int:
    """Character-based fallback: ~4 chars per token for English/code."""
    return max(1, len(text) // 4)


def count_file(path: Path) -> dict:
    if not path.exists():
        return {"agent": path.stem, "input_tokens": 0, "output_tokens": 0,
                "total_tokens": 0, "wall_clock_seconds": 0.0, "source": "missing"}

    content = path.read_text(encoding="utf-8")
    fm = parse_frontmatter(content)

    if "input_tokens" in fm and "output_tokens" in fm:
        return {
            "agent": fm.get("agent", path.stem),
            "input_tokens": fm["input_tokens"],
            "output_tokens": fm["output_tokens"],
            "total_tokens": fm["total_tokens"],
            "wall_clock_seconds": fm.get("wall_clock_seconds", 0.0),
            "source": "frontmatter",
        }

    # Fallback: estimate from section sizes
    parts = re.split(r"^## (Input|Output)", content, flags=re.MULTILINE)
    input_chars = output_chars = 0
    i = 0
    while i < len(parts):
        if i + 1 < len(parts) and parts[i].strip() == "Input":
            input_chars = len(parts[i + 1])
            i += 2
        elif i + 1 < len(parts) and parts[i].strip() == "Output":
            output_chars = len(parts[i + 1])
            i += 2
        else:
            i += 1

    return {
        "agent": path.stem,
        "input_tokens": estimate_tokens(input_chars * " "),
        "output_tokens": estimate_tokens(output_chars * " "),
        "total_tokens": estimate_tokens((input_chars + output_chars) * " "),
        "wall_clock_seconds": 0.0,
        "source": "estimated",
    }


def print_table(rows: list[dict], title: str) -> int:
    print(f"\n{'=' * 64}")
    print(f"  {title}")
    print(f"{'=' * 64}")
    print(f"  {'Agent':<18} {'Input':>8} {'Output':>8} {'Total':>8} {'Time':>8}  Source")
    print(f"  {'-'*18} {'-'*8} {'-'*8} {'-'*8} {'-'*8}")
    grand_total = 0
    for r in rows:
        print(f"  {r['agent']:<18} {r['input_tokens']:>8,} {r['output_tokens']:>8,} "
              f"{r['total_tokens']:>8,} {r['wall_clock_seconds']:>7.1f}s  {r['source']}")
        grand_total += r["total_tokens"]
    print(f"  {'TOTAL':<18} {'':>8} {'':>8} {grand_total:>8,}")
    return grand_total


def main() -> None:
    single_row = count_file(SINGLE_TRANSCRIPT)
    multi_rows = [count_file(p) for p in MULTI_TRANSCRIPTS]

    single_total = print_table([single_row], "Single-Agent Run")
    multi_total = print_table(multi_rows, "Multi-Agent Run (Planner → Executor → Critic)")

    single_wall = single_row["wall_clock_seconds"]
    multi_wall = sum(r["wall_clock_seconds"] for r in multi_rows)

    print(f"\n{'=' * 64}")
    print("  Comparison")
    print(f"{'=' * 64}")
    print(f"  Token cost ratio  (multi / single): {multi_total / max(1, single_total):.2f}x")
    print(f"  Wall-clock ratio  (multi / single): {multi_wall / max(1, single_wall):.2f}x")
    print(f"{'=' * 64}\n")

    # Machine-readable output
    result = {
        "single_agent": {"total_tokens": single_total, "wall_clock_seconds": single_wall},
        "multi_agent": {
            "total_tokens": multi_total,
            "wall_clock_seconds": multi_wall,
            "agents": multi_rows,
        },
        "token_cost_ratio": round(multi_total / max(1, single_total), 2),
        "wall_clock_ratio": round(multi_wall / max(1, single_wall), 2),
    }
    out_path = Path(__file__).parent / "token_counts.json"
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"  JSON saved to {out_path}")


if __name__ == "__main__":
    main()
