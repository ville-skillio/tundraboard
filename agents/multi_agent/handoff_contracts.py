"""
Handoff contracts for the Planner → Executor → Critic pipeline.

Each dataclass is the typed interface passed between agents.
The schema is intentionally minimal: it carries ONLY what the
receiving agent needs — no full conversation history, no raw
tool call output.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal


# ---------------------------------------------------------------------------
# Planner → Executor
# ---------------------------------------------------------------------------

@dataclass
class TestScenario:
    name: str
    setup: str        # e.g. "mock $queryRaw to return [{id: 'task-1'}]"
    assertion: str    # e.g. "findMany called with { id: { in: ['task-1'] } }"


@dataclass
class InternalHelper:
    name: str                  # "searchTasksFullText"
    parameters: list[str]
    phase1_description: str    # What the $queryRaw query does
    phase2_description: str    # What the findMany query does
    rank_restoration: str      # How rank order is restored


@dataclass
class ImplementationPlan:
    """
    Output of the Planner. Executor receives this instead of the full
    codebase — context isolation: Executor does not re-read files it
    doesn't need to modify.
    """
    migration_sql: str
    schema_change: str                      # Prisma field line to add
    function_signature: str                 # Updated searchTasks signature
    internal_helper: InternalHelper
    test_scenarios: list[TestScenario]
    files_to_modify: list[str]
    known_trade_offs: list[str]
    safety_invariants: list[str]            # e.g. "$queryRawUnsafe never called"


# ---------------------------------------------------------------------------
# Executor → Critic
# ---------------------------------------------------------------------------

@dataclass
class FileChange:
    path: str
    content: str          # Complete new file content (not a diff)


@dataclass
class ExecutorReport:
    """
    Output of the Executor. Critic receives plan + report — no
    codebase context needed since report contains full file contents.
    """
    files_modified: list[FileChange]
    migration_sql_final: str
    notes: list[str]      # Deviations from plan and reasons


# ---------------------------------------------------------------------------
# Critic → human / CI
# ---------------------------------------------------------------------------

@dataclass
class ChecklistItem:
    status: Literal["pass", "fail", "not_checked"]
    note: str = ""


@dataclass
class Issue:
    severity: Literal["blocking", "warning", "suggestion"]
    location: str         # e.g. "taskService.ts:searchTasksFullText"
    description: str
    fix: str


@dataclass
class CriticVerdict:
    """
    Output of the Critic. Final artefact consumed by CI or a human reviewer.
    Contains no raw transcript — only structured findings.
    """
    passed: bool
    checklist: dict[str, ChecklistItem]
    issues: list[Issue]
    recommendation: Literal["approve", "revise", "reject"]
