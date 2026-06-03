#!/usr/bin/env python3
"""
UHP Pre-MLP Static Analysis Harness  v2
========================================
Runs mechanical checks on any UHP repo before an MLP review.
Every check has a configurable severity: STOP | WARNING | IGNORE.
Severities are read from .pre-mlp.config.json at the repo root,
then merged with the built-in defaults shown below.

Checks run by this script:
  STOP    ferpa_gate        -- RLS disabled on FERPA tables -> exit 1
  STOP    secrets           -- hardcoded keys / .env committed to git
  WARNING unprotected_routes -- route.ts with no auth reference
  WARNING mock_count         -- TODO/FIXME/mock/stub count vs threshold
  WARNING as_any_count       -- TypeScript `as any` / `: any` vs threshold
  WARNING client_fetch       -- fetch() inside "use client" components
  IGNORE  console_log        -- console.log count (informational)
  IGNORE  route_count        -- API route count (informational)

CI-only checks (run by GitHub Actions, listed here for config override):
  STOP    tsc       -- TypeScript compile  (npx tsc --noEmit)
  STOP    gitleaks  -- Secret history scan (gitleaks CLI)
  WARNING lint      -- ESLint             (npm run lint)
  WARNING test      -- Test suite         (npm run test)

Usage:
  python3 scripts/pre-mlp-check.py [--json] [--score] [--repo-root /path/to/repo]

Exit codes:
  0  All STOP-level checks passed (or were set to IGNORE)
  1  One or more STOP-level checks failed
"""

import copy
import dataclasses
import os
import re
import sys
import json
import argparse
import subprocess
from pathlib import Path
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# FERPA / PII constants
# ---------------------------------------------------------------------------

FERPA_TABLES = {
    "sis_students", "sis_enrollments", "sis_attendance",
    "sis_milestones", "sis_coaching_hours", "sis_milestone_templates",
    "students", "onboarding_documents", "student_intake", "student_notes",
}

PII_REVIEW_TABLES = {
    "prospects", "applications", "cohorts", "user_profiles", "staff_directory",
}

# ---------------------------------------------------------------------------
# Per-repo area maps
# ---------------------------------------------------------------------------

FOCUS_AREAS = {
    "Morgan", "Teams", "PreArrival", "Room & Board", "Notifications",
    "Work Orders + QR", "Admissions", "Scheduling + ClockIn", "SIS",
    "Student App", "Field Execution PWA",
}

REPO_AREA_MAPS: dict = {
    "UHP-OPS-Agent": {
        "Morgan":               ["app/api/morgan", "app/api/chat"],
        "Teams":                ["app/api/teams", "app/api/squads"],
        "PreArrival":           ["app/api/intake", "app/api/onboarding"],
        "Room & Board":         ["app/api/rooms", "app/api/reservations",
                                 "app/api/locations"],
        "Notifications":        ["app/api/notifications", "app/api/cron"],
        "Work Orders + QR":     ["app/api/work-orders", "app/api/approvals",
                                 "app/api/requests", "app/api/my-requests"],
        "Admissions":           ["app/api/admissions", "app/api/hubspot",
                                 "app/api/import"],
        "Scheduling + ClockIn": ["app/api/scheduling", "app/api/clock",
                                 "app/api/checkins"],
        "SIS":                  ["app/api/sis", "app/api/students",
                                 "app/api/student"],
        "Auth / Identity":      ["app/api/auth", "app/api/badges",
                                 "app/api/user", "app/api/users", "app/api/me"],
        "Tech / Process":       ["app/api/process", "app/api/discovery",
                                 "app/api/systems", "app/api/dev",
                                 "app/api/operative"],
        "Culinary":             ["app/api/kitchen"],
        "Health":               ["app/api/health"],
        "Staff / Admin":        ["app/api/admin", "app/api/staff-directory"],
        "Infrastructure":       ["app/api/export", "app/api/upload",
                                 "app/api/graduation", "app/api/webhooks",
                                 "app/api/dashboard"],
    },
    "uhp-student-app-1": {
        "Morgan":               ["app/api/student/morgan",
                                 "app/api/student/daily-message"],
        "PreArrival":           ["app/api/student/pre-arrival",
                                 "app/api/student/bunk"],
        "Notifications":        ["app/api/student/notifications",
                                 "app/api/push", "app/api/cron"],
        "Work Orders + QR":     ["app/api/student/tasks"],
        "Scheduling + ClockIn": ["app/api/student/schedule",
                                 "app/api/student/check-in",
                                 "app/api/student/notify-schedule-change"],
        "SIS":                  ["app/api/student/milestones",
                                 "app/api/student/cohort",
                                 "app/api/student/report",
                                 "app/api/student/notes"],
        "Field Execution PWA":  ["app/api/student/field"],
        "LMS":                  ["app/api/student/lms"],
        "Auth / Identity":      ["app/api/auth", "app/api/student/me"],
    },
    "uhp-field-execution": {
        "Field Execution PWA":  ["app/api/executions", "app/api/procedures",
                                 "app/api/my-work", "app/api/scan",
                                 "app/api/admin/issues",
                                 "app/api/admin/executions",
                                 "app/api/admin/procedures"],
        "Work Orders + QR":     ["app/api/admin/qr"],
        "Morgan":               ["app/api/morgan"],
        "SIS":                  ["app/api/students"],
    },
}

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

FERPA_DISABLE_RE = re.compile(
    r'ALTER\s+TABLE\s+(?:\w+\.)?(\w+)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY',
    re.IGNORECASE,
)

MOCK_RE = re.compile(
    r'\b(TODO|FIXME|HACK|mockData|mock_data|isMock|isStub|placeholder|hardcoded)\b',
    re.IGNORECASE,
)

CONSOLE_LOG_RE = re.compile(r'\bconsole\.log\s*\(')
AS_ANY_RE      = re.compile(r'\bas\s+any\b|:\s*any\b')
USE_CLIENT_RE  = re.compile(r'"use client"|\'use client\'')
FETCH_RE       = re.compile(r'\bfetch\s*\(')

AUTH_RE = re.compile(
    r'(createClient|getSession|verifyAuth|CRON_SECRET|withAuth|requireAuth'
    r'|supabaseAdmin|auth\.getUser|createServerClient|getServerSession)',
    re.IGNORECASE,
)

SECRET_PATTERNS = [
    ("hubspot_token",
     re.compile(r'pat-[a-z]{2}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}')),
    ("supabase_jwt",
     re.compile(r'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9._-]{50,}')),
    ("openai_key",
     re.compile(r'sk-[a-zA-Z0-9]{32,}')),
    ("generic_password",
     re.compile(r'(?i)(?:password|passwd)\s*[:=]\s*["\'][^"\']{8,}["\']')),
    ("generic_apikey",
     re.compile(r'(?i)api[_-]?key\s*[:=]\s*["\'][^"\']{16,}["\']')),
    ("supabase_url_fallback",
     re.compile(r'process\.env\.\w+\s*(?:\?\?|\|\|)\s*["\']https://[a-z0-9]+\.supabase\.co')),
]

SKIP_PARTS = frozenset({".git", "node_modules", ".next", "__pycache__", ".turbo"})

# Weights used for the --score mechanical readiness percentage.
# Only these 6 checks are scored. CI-only checks (tsc, gitleaks, lint, test)
# and informational checks (route_count, console_log) are excluded.
# IGNORE-severity checks are excluded from the denominator so they don't
# penalise repos that legitimately skip them (e.g. no SQL migrations).
SCORE_WEIGHTS = {
    "ferpa_gate":         30,
    "secrets":            20,
    "mock_count":         15,
    "as_any_count":       15,
    "unprotected_routes": 10,
    "client_fetch":       10,
}

# ---------------------------------------------------------------------------
# Default configuration
# ---------------------------------------------------------------------------

DEFAULT_CONFIG = {
    "checks": {
        "ferpa_gate":         "STOP",
        "secrets":            "STOP",
        "unprotected_routes": "WARNING",
        "mock_count":         "WARNING",
        "as_any_count":       "WARNING",
        "client_fetch":       "WARNING",
        "console_log":        "IGNORE",
        "route_count":        "IGNORE",
        # CI-only (listed so they can be overridden in .pre-mlp.config.json)
        "tsc":      "STOP",
        "gitleaks": "STOP",
        "lint":     "WARNING",
        "test":     "WARNING",
    },
    "thresholds": {
        "mock_count_warn":   10,
        "as_any_count_warn": 20,
        "console_log_warn":  50,
    },
}


def load_config(repo_root):
    """Read .pre-mlp.config.json and merge with built-in defaults."""
    config = copy.deepcopy(DEFAULT_CONFIG)
    config_path = repo_root / ".pre-mlp.config.json"
    if config_path.exists():
        try:
            user = json.loads(config_path.read_text())
            config["checks"].update(user.get("checks", {}))
            config["thresholds"].update(user.get("thresholds", {}))
        except (json.JSONDecodeError, KeyError) as exc:
            print(f"  WARNING: malformed .pre-mlp.config.json -- {exc}", file=sys.stderr)
    return config


# ---------------------------------------------------------------------------
# CheckResult dataclass
# ---------------------------------------------------------------------------

@dataclasses.dataclass
class CheckResult:
    name: str
    label: str
    severity: str   # "STOP", "WARNING", or "IGNORE"
    passed: bool
    detail: str = ""
    items: list = dataclasses.field(default_factory=list)

    @property
    def skipped(self):
        return self.severity == "IGNORE"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def resolve_repo_root(override):
    if override:
        return Path(override).resolve()
    return Path(__file__).resolve().parent.parent


def git_info(repo_root):
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=repo_root, stderr=subprocess.DEVNULL, text=True,
        ).strip()
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=repo_root, stderr=subprocess.DEVNULL, text=True,
        ).strip()
        return commit, branch
    except Exception:
        return "unknown", "unknown"


def _iter_source_files(repo_root, *subdirs):
    """Yield .ts and .tsx files under subdirs, skipping build/vendor dirs."""
    for subdir in subdirs:
        d = repo_root / subdir
        if not d.exists():
            continue
        for f in sorted(d.rglob("*.ts")):
            if not SKIP_PARTS.intersection(f.parts):
                yield f
        for f in sorted(d.rglob("*.tsx")):
            if not SKIP_PARTS.intersection(f.parts):
                yield f


# ---------------------------------------------------------------------------
# Check: FERPA gate
# ---------------------------------------------------------------------------

def check_ferpa_gate(repo_root, config):
    severity = config["checks"]["ferpa_gate"]
    violations = []
    pii_notices = []

    supabase_dir = repo_root / "supabase"
    if supabase_dir.exists():
        for sql_file in sorted(supabase_dir.glob("*.sql")):
            text = sql_file.read_text(errors="replace")
            for lineno, line in enumerate(text.splitlines(), 1):
                m = FERPA_DISABLE_RE.search(line)
                if not m:
                    continue
                tname = m.group(1).lower()
                entry = {"file": sql_file.name, "line": lineno, "table": tname}
                if tname in FERPA_TABLES:
                    violations.append(entry)
                elif tname in PII_REVIEW_TABLES:
                    pii_notices.append(entry)

    passed = len(violations) == 0
    detail = (
        f"{len(violations)} FERPA table(s) with RLS disabled" if violations
        else "No FERPA tables with RLS disabled"
    )
    result = CheckResult("ferpa_gate", "FERPA Gate", severity, passed, detail)
    result.items = violations + [{"pii": True, **n} for n in pii_notices]
    return result


# ---------------------------------------------------------------------------
# Check: Secrets / credentials
# ---------------------------------------------------------------------------

def check_secrets(repo_root, config):
    severity = config["checks"]["secrets"]
    hits = []

    for src_file in _iter_source_files(repo_root, "app", "lib", "components", "hooks"):
        text = src_file.read_text(errors="replace")
        for lineno, line in enumerate(text.splitlines(), 1):
            for pattern_name, pattern in SECRET_PATTERNS:
                if pattern.search(line):
                    hits.append({
                        "file": str(src_file.relative_to(repo_root)),
                        "line": lineno,
                        "pattern": pattern_name,
                        "text": line.strip()[:120],
                    })

    # .env files committed to git
    try:
        tracked = subprocess.check_output(
            ["git", "ls-files", "--",
             ".env", ".env.local", ".env.production", ".env.staging", ".env.development"],
            cwd=repo_root, stderr=subprocess.DEVNULL, text=True,
        ).strip()
        for leaked in tracked.splitlines():
            hits.append({
                "file": leaked,
                "line": 0,
                "pattern": "env_committed_to_git",
                "text": f"{leaked} is tracked by git",
            })
    except Exception:
        pass

    passed = len(hits) == 0
    detail = f"{len(hits)} secret(s) detected" if hits else "No secrets detected"
    result = CheckResult("secrets", "Secrets / Credentials", severity, passed, detail)
    result.items = hits
    return result


# ---------------------------------------------------------------------------
# Check: Unprotected API routes
# ---------------------------------------------------------------------------

def check_unprotected_routes(repo_root, config):
    severity = config["checks"]["unprotected_routes"]
    unprotected = []

    api_dir = repo_root / "app" / "api"
    if api_dir.exists():
        for route_file in sorted(api_dir.rglob("route.ts")):
            if SKIP_PARTS.intersection(route_file.parts):
                continue
            text = route_file.read_text(errors="replace")
            if not AUTH_RE.search(text):
                unprotected.append(str(route_file.relative_to(repo_root)))

    count = len(unprotected)
    passed = count == 0
    detail = (
        f"{count} route(s) with no auth reference" if count
        else "All routes have an auth reference"
    )
    result = CheckResult("unprotected_routes", "Unprotected Routes", severity, passed, detail)
    result.items = unprotected
    return result


# ---------------------------------------------------------------------------
# Check: Mock / stub count  +  Route count  (via area inventory)
# ---------------------------------------------------------------------------

def _scan_area(repo_root, area_dirs):
    mock_count = 0
    route_count = 0
    mock_detail = []
    for rel_dir in area_dirs:
        full_dir = repo_root / rel_dir
        if not full_dir.exists():
            continue
        for ts_file in full_dir.rglob("*.ts"):
            if SKIP_PARTS.intersection(ts_file.parts):
                continue
            text = ts_file.read_text(errors="replace")
            matches = MOCK_RE.findall(text)
            if matches:
                mock_count += len(matches)
                mock_detail.append(f"{ts_file.relative_to(repo_root)} ({len(matches)})")
            if ts_file.name == "route.ts":
                route_count += 1
    return {"mock_count": mock_count, "route_count": route_count, "mock_detail": mock_detail}


def inventory_areas(repo_root, config):
    repo_name = repo_root.name
    area_map = REPO_AREA_MAPS.get(repo_name, REPO_AREA_MAPS["UHP-OPS-Agent"])
    areas = {area: _scan_area(repo_root, dirs) for area, dirs in area_map.items()}

    # Uncategorized bucket
    all_named = set()
    for dirs in area_map.values():
        for rel_dir in dirs:
            d = repo_root / rel_dir
            if d.exists():
                all_named.update(d.rglob("route.ts"))

    api_dir = repo_root / "app" / "api"
    all_routes = set(api_dir.rglob("route.ts")) if api_dir.exists() else set()
    uncategorized = all_routes - all_named
    if uncategorized:
        areas["Uncategorized"] = {
            "route_count": len(uncategorized),
            "mock_count": 0,
            "mock_detail": [str(f.relative_to(repo_root)) for f in sorted(uncategorized)],
        }

    total_mocks  = sum(a["mock_count"]  for a in areas.values())
    total_routes = sum(a["route_count"] for a in areas.values())

    threshold_mocks = config["thresholds"]["mock_count_warn"]
    mock_check = CheckResult(
        "mock_count", "Mock / Stub Count",
        config["checks"]["mock_count"],
        total_mocks < threshold_mocks,
        f"{total_mocks} match(es) (threshold: {threshold_mocks})",
    )
    all_mock_detail = []
    for a_data in areas.values():
        all_mock_detail.extend(a_data["mock_detail"])
    mock_check.items = all_mock_detail

    route_check = CheckResult(
        "route_count", "Route Count",
        config["checks"]["route_count"],
        True,
        f"{total_routes} routes across {len(areas)} area(s)",
    )
    return areas, mock_check, route_check


# ---------------------------------------------------------------------------
# Check: console.log count
# ---------------------------------------------------------------------------

def check_console_logs(repo_root, config):
    total = 0
    for f in _iter_source_files(repo_root, "app", "lib", "components", "hooks"):
        total += len(CONSOLE_LOG_RE.findall(f.read_text(errors="replace")))
    threshold = config["thresholds"]["console_log_warn"]
    passed = total < threshold
    return CheckResult(
        "console_log", "Console.log Count",
        config["checks"]["console_log"],
        passed,
        f"{total} total (threshold: {threshold})",
    )


# ---------------------------------------------------------------------------
# Check: TypeScript `as any`
# ---------------------------------------------------------------------------

def check_as_any(repo_root, config):
    total = 0
    by_dir = {}
    for subdir in ("app", "lib", "components", "hooks"):
        count = sum(
            len(AS_ANY_RE.findall(f.read_text(errors="replace")))
            for f in _iter_source_files(repo_root, subdir)
        )
        if count:
            by_dir[subdir] = count
            total += count
    threshold = config["thresholds"]["as_any_count_warn"]
    passed = total < threshold
    breakdown = "  ".join(f"{k}: {v}" for k, v in by_dir.items()) if by_dir else "none"
    return CheckResult(
        "as_any_count", "TypeScript `as any`",
        config["checks"]["as_any_count"],
        passed,
        f"{total} occurrence(s) (threshold: {threshold}) -- {breakdown}",
    )


# ---------------------------------------------------------------------------
# Check: client-side fetch() in "use client" components
# ---------------------------------------------------------------------------

def check_client_fetch(repo_root, config):
    hits = []
    for f in _iter_source_files(repo_root, "app", "components"):
        text = f.read_text(errors="replace")
        if not USE_CLIENT_RE.search(text):
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            if FETCH_RE.search(line):
                hits.append(f"{f.relative_to(repo_root)}:{lineno}: {line.strip()[:80]}")
    passed = len(hits) == 0
    return CheckResult(
        "client_fetch", "Client fetch() in use-client",
        config["checks"]["client_fetch"],
        passed,
        f"{len(hits)} occurrence(s) in 'use client' components",
        items=hits,
    )


# ---------------------------------------------------------------------------
# Report formatting
# ---------------------------------------------------------------------------

SEP  = "=" * 70
THIN = "-" * 50


def _flag(severity):
    return f"[{severity}]"


def _status_prefix(result):
    if result.skipped:
        return "  - INFO "
    if result.passed:
        return "  + PASS "
    if result.severity == "STOP":
        return "  X FAIL "
    return "  ! WARN "


def _print_check(result, show_items_limit=10):
    flag_str = f"{_flag(result.severity):<10}"
    print(f"\n  {result.label:<38} {flag_str}")
    print(f"  {THIN[:48]}")
    print(f"{_status_prefix(result)} {result.detail}")

    if not result.passed and not result.skipped and result.items:
        for item in result.items[:show_items_limit]:
            if isinstance(item, dict):
                if item.get("pii"):
                    print(f"        PII  {item['file']}:{item['line']}  {item['table']}")
                elif item.get("pattern"):
                    print(f"        {item['file']}:{item.get('line', '')}  [{item['pattern']}]")
                else:
                    print(f"        {item.get('file', '')}:{item.get('line', '')}  {item.get('table', '')}")
            else:
                print(f"        {item}")
        remaining = len(result.items) - show_items_limit
        if remaining > 0:
            print(f"        ... and {remaining} more")


def print_report(repo_root, commit, branch, results, areas, config):
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"\n{SEP}")
    print(f"  UHP Pre-MLP Static Analysis  v2")
    print(f"  Repo:    {repo_root.name}")
    print(f"  Branch:  {branch}   Commit: {commit}")
    print(f"  Run:     {timestamp}")
    print(SEP)

    ci_names = {"tsc", "gitleaks", "lint", "test"}
    script_results = [r for r in results if r.name not in ci_names]

    stop_results    = [r for r in script_results if r.severity == "STOP"]
    warning_results = [r for r in script_results if r.severity == "WARNING"]
    ignore_results  = [r for r in script_results if r.severity == "IGNORE"]

    inv_names = {"mock_count", "route_count"}
    warning_non_inv = [r for r in warning_results if r.name not in inv_names]
    ignore_non_inv  = [r for r in ignore_results  if r.name not in inv_names]
    warning_inv     = [r for r in warning_results if r.name in inv_names]
    ignore_inv      = [r for r in ignore_results  if r.name in inv_names]
    inventory_rows  = warning_inv + ignore_inv

    # STOP checks
    print(f"\n  -- STOP CHECKS {'-' * 54}")
    for r in stop_results:
        _print_check(r)

    # WARNING checks
    print(f"\n  -- WARNING CHECKS {'-' * 51}")
    for r in warning_non_inv:
        _print_check(r)

    # Mini-app inventory
    print(f"\n  -- MINI-APP INVENTORY {'-' * 47}")
    for r in inventory_rows:
        _print_check(r)
    print()
    print(f"  {'Area':<24}  {'Routes':>6}  {'Mocks':>6}  Status")
    print(f"  {'-'*24}  {'-'*6}  {'-'*6}  {'-'*12}")
    for area, data in areas.items():
        marker = " *" if area in FOCUS_AREAS else "  "
        status = "CLEAN" if data["mock_count"] == 0 else "NEEDS REVIEW"
        print(f"{marker} {area:<24}  {data['route_count']:>6}  {data['mock_count']:>6}  {status}")
    total_routes = sum(d["route_count"] for d in areas.values())
    total_mocks  = sum(d["mock_count"]  for d in areas.values())
    print(f"   {'TOTAL':<24}  {total_routes:>6}  {total_mocks:>6}")
    print(f"   (* = focus mini-app)")

    # Informational (IGNORE, non-inventory)
    if ignore_non_inv:
        print(f"\n  -- INFORMATIONAL (IGNORE) {'-' * 43}")
        for r in ignore_non_inv:
            _print_check(r)

    # CI-only note
    print(f"\n  -- CI-ONLY (GitHub Actions) {'-' * 41}")
    for name in ("tsc", "gitleaks", "lint", "test"):
        sev = config["checks"].get(name, "?")
        print(f"  {name:<20} {_flag(sev)}")

    # Overall gate
    stop_failures    = [r for r in stop_results    if not r.passed and not r.skipped]
    warnings_flagged = [r for r in warning_results if not r.passed and not r.skipped]
    print(f"\n{SEP}")
    print(f"  OVERALL GATE")
    print(f"  {THIN}")
    print(f"  STOP checks:    "
          f"{len(stop_results) - len(stop_failures)} passed, "
          f"{len(stop_failures)} failed")
    print(f"  WARNING checks: "
          f"{len(warning_results) - len(warnings_flagged)} passed, "
          f"{len(warnings_flagged)} flagged")
    print(f"  IGNORE checks:  {len(ignore_results)} skipped (informational only)")
    if stop_failures:
        names = ", ".join(r.name for r in stop_failures)
        print(f"\n  X  Gate FAILED -- fix STOP-level issues before merging: {names}")
    else:
        print(f"\n  +  Gate CLEAR -- proceed to human MLP assessment.")
        print(f"     Run VS Code prompt: uhp-pre-mlp-assessment to score.")
    print(f"\n{SEP}\n")


# ---------------------------------------------------------------------------
# JSON output
# ---------------------------------------------------------------------------

def build_json_report(repo_root, commit, branch, results, areas):
    gate_passed = not any(
        not r.passed and r.severity == "STOP" and not r.skipped
        for r in results
    )
    return {
        "schema": "uhp-pre-mlp-v2",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "repo": repo_root.name,
        "branch": branch,
        "commit": commit,
        "gate_passed": gate_passed,
        "checks": {
            r.name: {
                "severity": r.severity,
                "passed": r.passed,
                "skipped": r.skipped,
                "detail": r.detail,
            }
            for r in results
        },
        "areas": {
            area: {"routes": d["route_count"], "mock_count": d["mock_count"]}
            for area, d in areas.items()
        },
    }


# ---------------------------------------------------------------------------
# Mechanical readiness score
# ---------------------------------------------------------------------------

def compute_mechanical_score(results):
    """Return (score_pct, breakdown, possible_pts, blocked).

    Only the 6 checks in SCORE_WEIGHTS are scored.
    IGNORE-severity checks are excluded from the denominator.
    blocked=True means at least one STOP check failed.
    """
    earned = 0
    possible = 0
    breakdown = {}
    blocked = False

    for r in results:
        if r.name not in SCORE_WEIGHTS:
            continue
        w = SCORE_WEIGHTS[r.name]
        if r.skipped:
            breakdown[r.name] = {
                "weight": w, "earned": 0, "possible": 0,
                "severity": r.severity, "skipped": True,
            }
            continue
        possible += w
        pts = w if r.passed else 0
        earned += pts
        if not r.passed and r.severity == "STOP":
            blocked = True
        breakdown[r.name] = {
            "weight": w, "earned": pts, "possible": w,
            "passed": r.passed, "severity": r.severity, "skipped": False,
        }

    score = round((earned / possible) * 100) if possible > 0 else 0
    return score, breakdown, possible, blocked


def print_score(score, breakdown, possible, blocked):
    print(f"\n{SEP}")
    print(f"  MECHANICAL READINESS SCORE")
    print(f"  {THIN}")
    if possible == 0:
        print("  No scored checks active (all set to IGNORE).")
        print(f"\n{SEP}\n")
        return

    earned_total = sum(d["earned"] for d in breakdown.values() if not d["skipped"])
    if blocked:
        status = "BLOCKED  -- resolve STOP-level failures before human MLP scoring"
    else:
        status = "CLEAR    -- proceed to human MLP assessment"

    print(f"  Score:  {score:>3}%  ({earned_total}/{possible} pts)")
    print(f"  Status: {status}")
    print()
    print(f"  {'Check':<22}  {'Sev':<8}  {'Result':<6}  Pts")
    print(f"  {'-'*22}  {'-'*8}  {'-'*6}  {'-'*8}")
    for name, d in breakdown.items():
        if d["skipped"]:
            print(f"  {name:<22}  {d['severity']:<8}  {'--':<6}  skipped")
        else:
            result_str = "PASS" if d["passed"] else "FAIL"
            print(f"  {name:<22}  {d['severity']:<8}  {result_str:<6}  {d['earned']}/{d['possible']}")

    if possible < 100:
        excluded = 100 - possible
        print(f"\n  (IGNORE checks excluded {excluded} pts from denominator)")
    print(f"\n{SEP}\n")


# ---------------------------------------------------------------------------
# GitHub Actions integration
# ---------------------------------------------------------------------------

def _in_gha():
    """True when running inside GitHub Actions."""
    return os.environ.get("GITHUB_ACTIONS") == "true"


_CLIENT_FETCH_LINE_RE = re.compile(r'^(.+):(\d+):')


def emit_annotations(results):
    """Emit ::error / ::warning workflow commands for inline PR annotations.

    These appear as red/yellow markers on the Files Changed tab of a pull
    request.  No-op outside GitHub Actions.
    """
    if not _in_gha():
        return

    for r in results:
        if r.skipped or r.passed:
            continue
        level = "error" if r.severity == "STOP" else "warning"

        if r.name == "secrets":
            for item in r.items:
                f   = item.get("file", "")
                ln  = item.get("line") or 1
                pat = item.get("pattern", "secret")
                print(f"::{level} file={f},line={ln},title=Pre-MLP Secrets::hardcoded credential [{pat}]")

        elif r.name == "ferpa_gate":
            for item in r.items:
                if item.get("pii"):
                    continue
                f   = f"supabase/{item.get('file', '')}"
                ln  = item.get("line") or 1
                tbl = item.get("table", "")
                print(f"::{level} file={f},line={ln},title=Pre-MLP FERPA::RLS disabled on FERPA table '{tbl}'")

        elif r.name == "unprotected_routes":
            for item in r.items:
                print(f"::{level} file={item},line=1,title=Pre-MLP Route::no auth reference in route handler")

        elif r.name == "client_fetch":
            for item in r.items:
                m = _CLIENT_FETCH_LINE_RE.match(item)
                if m:
                    print(f"::{level} file={m.group(1)},line={m.group(2)},title=Pre-MLP Client Fetch::fetch() in 'use client' component")
                else:
                    print(f"::{level} title=Pre-MLP Client Fetch::{item}")


def write_step_summary(repo_root, commit, branch, results):
    """Write a Markdown job summary to $GITHUB_STEP_SUMMARY.

    Produces a formatted table visible on the Actions run page.
    No-op when GITHUB_STEP_SUMMARY is not set (i.e. local runs).
    """
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return

    gate_passed = not any(
        not r.passed and r.severity == "STOP" and not r.skipped
        for r in results
    )
    score, breakdown, possible, blocked = compute_mechanical_score(results)
    earned = sum(d["earned"] for d in breakdown.values() if not d.get("skipped"))

    gate_icon  = ":white_check_mark:" if gate_passed else ":x:"
    score_icon = (
        ":green_circle:"  if score >= 80 else
        ":yellow_circle:" if score >= 50 else
        ":red_circle:"
    )

    # Resolve full org/repo name from git remote, fall back to directory name
    try:
        remote_url = subprocess.check_output(
            ["git", "-C", str(repo_root), "remote", "get-url", "origin"],
            text=True, stderr=subprocess.DEVNULL
        ).strip()
        # handles both SSH (git@github.com:org/repo.git) and HTTPS formats
        repo_name = re.sub(r"\.git$", "", re.split(r"[:/]", remote_url)[-2] + "/" + re.split(r"[:/]", remote_url)[-1])
    except Exception:
        repo_name = repo_root.name

    lines = []
    lines.append(f"## {gate_icon} Pre-MLP: **{repo_name}** — `{branch}` @ `{commit}`")
    lines.append("")
    lines.append(
        f"**Gate:** {'CLEAR' if gate_passed else 'FAILED'} &nbsp;|&nbsp; "
        f"**Score:** {score_icon} {score}% ({earned}/{possible} pts)"
        + (" &nbsp;— **BLOCKED**" if blocked else "")
    )
    lines.append("")
    lines.append("| Check | Severity | Result | Pts |")
    lines.append("|-------|----------|--------|-----|")
    for name, d in breakdown.items():
        if d.get("skipped"):
            lines.append(f"| `{name}` | {d['severity']} | _(skipped)_ | — |")
        else:
            icon = (
                ":white_check_mark:" if d["passed"] else
                ":x:"               if d["severity"] == "STOP" else
                ":warning:"
            )
            result_str = "PASS" if d["passed"] else "FAIL"
            lines.append(f"| `{name}` | {d['severity']} | {icon} {result_str} | {d['earned']}/{d['possible']} |")
    lines.append("")

    stop_failures = [r for r in results if r.severity == "STOP" and not r.passed and not r.skipped]
    if stop_failures:
        lines.append("### :x: STOP failures — must fix before merge")
        lines.append("")
        for r in stop_failures:
            lines.append(f"**{r.label}:** {r.detail}")
            lines.append("")
            if r.items:
                for item in r.items[:15]:
                    if isinstance(item, dict):
                        f   = item.get("file", "")
                        ln  = item.get("line", "")
                        pat = item.get("pattern", item.get("table", ""))
                        lines.append(f"- `{f}:{ln}` — `{pat}`")
                    else:
                        lines.append(f"- `{item}`")
                if len(r.items) > 15:
                    lines.append(f"- _{len(r.items) - 15} more..._")
                lines.append("")

    warn_flagged = [r for r in results if r.severity == "WARNING" and not r.passed and not r.skipped]
    if warn_flagged:
        lines.append("<details><summary>:warning: Warnings</summary>")
        lines.append("")
        for r in warn_flagged:
            lines.append(f"**{r.label}:** {r.detail}")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    with open(summary_path, "a") as fh:
        fh.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="UHP Pre-MLP Static Analysis Harness v2"
    )
    parser.add_argument("--json", action="store_true",
                        help="Append machine-readable JSON after the human report")
    parser.add_argument("--score", action="store_true",
                        help="Print mechanical readiness score after the report")
    parser.add_argument("--repo-root",
                        help="Path to the repo root (default: parent of scripts/)")
    args = parser.parse_args()

    repo_root = resolve_repo_root(args.repo_root)
    config    = load_config(repo_root)
    commit, branch = git_info(repo_root)

    results = []
    results.append(check_ferpa_gate(repo_root, config))
    results.append(check_secrets(repo_root, config))
    results.append(check_unprotected_routes(repo_root, config))

    areas, mock_check, route_check = inventory_areas(repo_root, config)
    results.append(mock_check)
    results.append(route_check)

    results.append(check_console_logs(repo_root, config))
    results.append(check_as_any(repo_root, config))
    results.append(check_client_fetch(repo_root, config))

    # GitHub Actions: inline PR annotations for findings with file/line info
    emit_annotations(results)

    print_report(repo_root, commit, branch, results, areas, config)

    if args.score:
        score, breakdown, possible, blocked = compute_mechanical_score(results)
        print_score(score, breakdown, possible, blocked)

    if args.json:
        report = build_json_report(repo_root, commit, branch, results, areas)
        if args.score:
            score, breakdown, possible, blocked = compute_mechanical_score(results)
            report["mechanical_score"] = {
                "score_pct": score,
                "possible_pts": possible,
                "blocked": blocked,
                "breakdown": breakdown,
            }
        print("--- JSON ---")
        print(json.dumps(report, indent=2))

    # GitHub Actions: rich markdown panel on the Actions run page
    write_step_summary(repo_root, commit, branch, results)

    stop_failures = [
        r for r in results
        if r.severity == "STOP" and not r.passed and not r.skipped
    ]
    return 1 if stop_failures else 0


if __name__ == "__main__":
    sys.exit(main())
