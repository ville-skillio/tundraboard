#!/usr/bin/env bash
# Pre-commit verification pipeline for TundraBoard.
# Runs every check in fail-fast order: the first failure stops the pipeline
# immediately so developers get the fastest possible signal.
#
# Usage:
#   chmod +x scripts/pre-commit.sh
#   ./scripts/pre-commit.sh
#
# To wire as a Git hook:
#   ln -s ../../scripts/pre-commit.sh .git/hooks/pre-commit

set -euo pipefail

# ---------------------------------------------------------------------------
# Colour helpers (fall back gracefully when tput is unavailable)
# ---------------------------------------------------------------------------
if command -v tput &>/dev/null && tput colors &>/dev/null; then
  BOLD=$(tput bold)
  GREEN=$(tput setaf 2)
  RED=$(tput setaf 1)
  YELLOW=$(tput setaf 3)
  CYAN=$(tput setaf 6)
  RESET=$(tput sgr0)
else
  BOLD="" GREEN="" RED="" YELLOW="" CYAN="" RESET=""
fi

pass()  { echo "${GREEN}${BOLD}  ✓ PASS${RESET}  $1"; }
fail()  { echo "${RED}${BOLD}  ✗ FAIL${RESET}  $1"; exit 1; }
step()  { echo; echo "${CYAN}${BOLD}▶ $1${RESET}"; }
banner(){ echo; echo "${YELLOW}${BOLD}══════════════════════════════════════${RESET}"; echo "${YELLOW}${BOLD}  TundraBoard Pre-commit Pipeline${RESET}"; echo "${YELLOW}${BOLD}══════════════════════════════════════${RESET}"; }

banner

# ---------------------------------------------------------------------------
# Stage 1 — Type check
# Catches type errors, missing imports, and incompatible API calls before
# anything runs. Fails fast: a type error means the code is broken.
# ---------------------------------------------------------------------------
step "Stage 1 / 5 — Type check (tsc --noEmit)"
npm run typecheck && pass "Type check" || fail "Type check failed — fix TypeScript errors before committing"

# ---------------------------------------------------------------------------
# Stage 2 — Lint
# Catches code style issues, unused variables, and banned patterns (e.g.
# explicit `any`, unsafe usage).
# ---------------------------------------------------------------------------
step "Stage 2 / 5 — Lint (eslint)"
npm run lint && pass "Lint" || fail "Lint failed — run 'npm run lint:fix' to auto-fix where possible"

# ---------------------------------------------------------------------------
# Stage 3 — Format check
# Ensures consistent formatting. Fail = commit would introduce style drift.
# Run 'npm run format' to auto-fix.
# ---------------------------------------------------------------------------
step "Stage 3 / 5 — Format check (prettier)"
npm run format:check && pass "Format check" || fail "Format check failed — run 'npm run format' to fix formatting"

# ---------------------------------------------------------------------------
# Stage 4 — Tests + coverage gate
# Runs the full test suite and enforces the coverage thresholds defined in
# vitest.config.ts. New files have a higher per-file bar (see config).
# ---------------------------------------------------------------------------
step "Stage 4 / 5 — Tests + coverage (vitest)"
npm run test:coverage && pass "Tests + coverage" || fail "Tests failed or coverage dropped below threshold"

# ---------------------------------------------------------------------------
# Stage 5 — Dependency audit
# Flags high-severity or critical vulnerabilities in installed packages.
# AI-generated code often suggests packages that may be outdated or
# compromised — catch them here.
# ---------------------------------------------------------------------------
step "Stage 5 / 5 — Dependency audit (npm audit)"
npm audit --audit-level=high && pass "Dependency audit" || fail "Dependency audit found high/critical vulnerabilities — run 'npm audit' for details"

# ---------------------------------------------------------------------------
# All clear
# ---------------------------------------------------------------------------
echo
echo "${GREEN}${BOLD}══════════════════════════════════════${RESET}"
echo "${GREEN}${BOLD}  All checks passed — safe to commit  ${RESET}"
echo "${GREEN}${BOLD}══════════════════════════════════════${RESET}"
echo
