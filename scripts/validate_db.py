#!/usr/bin/env python3
"""
validate_db.py — BatteryLCATool pre-deployment data validation
==============================================================
Connects to the production Supabase DB (via REST API with service_role key),
extracts all project data, and validates it against:
  1. ecoinvent 3 MasterData (ElementaryExchanges.xml, IntermediateExchanges.xml, Units.xml)
  2. Ali 2025 NMC811 parametric LCA reference inventory

Usage:
  export SUPABASE_URL=https://spryklmbxcmqtavcosbn.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=<your service role key from Supabase dashboard>
  python3 scripts/validate_db.py

  # Or pass directly:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/validate_db.py
"""

import json
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from textwrap import indent

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests")
    sys.exit(1)

try:
    import openpyxl
except ImportError:
    print("ERROR: 'openpyxl' not installed. Run: pip install openpyxl")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ROOT = Path(__file__).parent.parent
MASTER_DATA = ROOT / "MasterData"
MORE_DATA = ROOT / "MoreData"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://spryklmbxcmqtavcosbn.supabase.co").rstrip("/")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SERVICE_ROLE_KEY:
    print("ERROR: SUPABASE_SERVICE_ROLE_KEY not set.")
    print("Get it from: Supabase Dashboard → Settings → API → service_role (secret)")
    print("Then run:  SUPABASE_SERVICE_ROLE_KEY=<key> python3 scripts/validate_db.py")
    sys.exit(1)

HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def q(table: str, params: dict | None = None) -> list[dict]:
    """Query a Supabase table via REST API (bypasses RLS with service_role)."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    p = {"select": "*", "limit": "10000"}
    if params:
        p.update(params)
    resp = requests.get(url, headers=HEADERS, params=p, timeout=30)
    resp.raise_for_status()
    return resp.json()


def section(title: str):
    print()
    print("─" * 70)
    print(f"  {title}")
    print("─" * 70)


def ok(msg: str):
    print(f"  ✓  {msg}")


def warn(msg: str):
    print(f"  ⚠  {msg}")


def err(msg: str):
    print(f"  ✗  {msg}")


# ---------------------------------------------------------------------------
# Load ecoinvent reference data
# ---------------------------------------------------------------------------

NS = {"ei": "http://www.EcoInvent.org/EcoSpold02"}


def load_ecoinvent_flows() -> tuple[set[str], set[str], set[str]]:
    """Returns (elem_names, interm_names, valid_units) from MasterData."""
    elem_names: set[str] = set()
    interm_names: set[str] = set()
    valid_units: set[str] = set()
    synonyms: set[str] = set()

    # ElementaryExchanges
    ef = MASTER_DATA / "ElementaryExchanges.xml"
    if ef.exists():
        tree = ET.parse(ef)
        for ex in tree.findall(".//ei:elementaryExchange", NS):
            for n in ex.findall("ei:name", NS):
                elem_names.add(n.text.lower().strip())
            for s in ex.findall("ei:synonym", NS):
                synonyms.add(s.text.lower().strip())
    else:
        print("  WARN: ElementaryExchanges.xml not found")

    # IntermediateExchanges
    inf = MASTER_DATA / "IntermediateExchanges.xml"
    if inf.exists():
        tree = ET.parse(inf)
        for ex in tree.findall(".//ei:intermediateExchange", NS):
            for n in ex.findall("ei:name", NS):
                interm_names.add(n.text.lower().strip())
    else:
        print("  WARN: IntermediateExchanges.xml not found")

    # Units
    uf = MASTER_DATA / "Units.xml"
    if uf.exists():
        tree = ET.parse(uf)
        for u in tree.findall(".//ei:unit", NS):
            for n in u.findall("ei:name", NS):
                valid_units.add(n.text.strip())
    else:
        print("  WARN: Units.xml not found")

    all_names = elem_names | interm_names | synonyms
    return all_names, valid_units


def load_ali2025_lci() -> dict[str, list[dict]]:
    """Returns {activity_name: [exchanges]} from Ali 2025 SI2 LCI sheet."""
    path = MORE_DATA / "Ali_2025_Parametric_LCA_battery_SI2.xlsx"
    if not path.exists():
        return {}
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Life cycle inventory (LCI)"]
    rows = list(ws.iter_rows(values_only=True))

    activities: dict[str, list[dict]] = {}
    current_name = None
    in_exchanges = False

    for r in rows:
        if r[0] == "Activity" and r[1]:
            current_name = str(r[1]).strip()
            activities[current_name] = []
            in_exchanges = False
        elif r[0] == "Exchanges":
            in_exchanges = True
        elif in_exchanges and r[0] == "name":
            pass  # header row
        elif (
            in_exchanges
            and current_name
            and r[0] not in (None, "Activity", "key", "location", "unit", "type",
                             "production amount", "format", "Database", "Exchanges", "name")
            and r[1] is not None
        ):
            try:
                amt = float(str(r[1]).replace("=", "").split("*")[0].split("/")[0])
            except Exception:
                amt = None
            activities[current_name].append({
                "name": str(r[0]).strip(),
                "amount": amt,
                "unit": r[2],
                "ex_type": r[6],
            })

    return activities


# ---------------------------------------------------------------------------
# Fetch DB data
# ---------------------------------------------------------------------------

def fetch_all() -> dict:
    print("\nFetching data from production Supabase …")
    data = {}
    tables = [
        "app_user", "project", "project_member",
        "battery_model", "battery_model_revision",
        "process_instance", "process_exchange",
        "model_parameter", "flow_catalog",
        "validation_run", "validation_issue",
    ]
    for t in tables:
        try:
            rows = q(t)
            data[t] = rows
            print(f"  {t}: {len(rows)} rows")
        except Exception as ex:
            print(f"  {t}: ERROR – {ex}")
            data[t] = []
    return data


# ---------------------------------------------------------------------------
# Validation checks
# ---------------------------------------------------------------------------

def check_structure(data: dict):
    section("1. STRUCTURAL INTEGRITY")

    projects = data["project"]
    models = data["battery_model"]
    revisions = data["battery_model_revision"]
    processes = data["process_instance"]
    exchanges = data["process_exchange"]
    members = data["project_member"]
    params = data["model_parameter"]

    ok(f"{len(projects)} project(s), {len(models)} model(s), {len(revisions)} revision(s)")
    ok(f"{len(processes)} process(es), {len(exchanges)} exchange(s), {len(params)} parameter(s)")

    # Projects with no members
    project_ids_with_members = {m["project_id"] for m in members}
    lonely = [p for p in projects if p["project_id"] not in project_ids_with_members]
    if lonely:
        for p in lonely:
            warn(f"Project '{p['name']}' has no members")
    else:
        ok("All projects have at least one member")

    # Models with no revisions
    model_ids_with_revisions = {r["model_id"] for r in revisions}
    empty_models = [m for m in models if m["model_id"] not in model_ids_with_revisions]
    if empty_models:
        for m in empty_models:
            warn(f"Model '{m['name']}' has no revisions")
    else:
        ok("All models have at least one revision")

    # Revisions with no processes
    rev_ids_with_processes = {p["revision_id"] for p in processes}
    empty_revs = [r for r in revisions if r["revision_id"] not in rev_ids_with_processes]
    if empty_revs:
        for r in empty_revs:
            warn(f"Revision '{r.get('label') or r['revision_number']}' (id={r['revision_id'][:8]}…) has no processes")
    else:
        ok("All revisions have at least one process")

    # Processes with no exchanges
    proc_ids_with_exchanges = {e["process_id"] for e in exchanges}
    empty_procs = [p for p in processes if p["process_id"] not in proc_ids_with_exchanges]
    if empty_procs:
        for p in empty_procs:
            err(f"Process '{p['name']}' has no exchanges")
    else:
        ok("All processes have at least one exchange")

    # Exchanges with no quantity AND no formula
    missing_qty = [
        e for e in exchanges
        if e.get("quantity_user") is None and not e.get("formula_user")
    ]
    if missing_qty:
        err(f"{len(missing_qty)} exchange(s) have no quantity and no formula:")
        for e in missing_qty[:10]:
            print(f"     – '{e.get('raw_name') or e.get('flow_id') or e['exchange_id'][:8]}'")
    else:
        ok("All exchanges have a quantity or formula")

    # Exchanges missing reference output
    for rev in revisions:
        rev_processes = [p for p in processes if p["revision_id"] == rev["revision_id"]]
        for proc in rev_processes:
            proc_exchanges = [e for e in exchanges if e["process_id"] == proc["process_id"]]
            has_ref = any(
                e["exchange_direction"] == "output" and e.get("output_type") == "reference"
                for e in proc_exchanges
            )
            if proc_exchanges and not has_ref:
                err(f"Process '{proc['name']}' has no reference output flow")


def check_flows_against_ecoinvent(data: dict, ecoinvent_names: set[str], valid_units: set[str]):
    section("2. FLOW NAMES vs. ECOINVENT MASTERDATA")

    exchanges = data["process_exchange"]
    flows = data["flow_catalog"]
    flow_map = {f["flow_id"]: f for f in flows}

    matched = 0
    unmatched = []
    for ex in exchanges:
        raw = (ex.get("raw_name") or "").strip().lower()
        flow_id = ex.get("flow_id")
        catalog_name = flow_map.get(flow_id, {}).get("canonical_name", "").lower() if flow_id else ""
        name_to_check = catalog_name or raw
        if not name_to_check:
            continue
        if name_to_check in ecoinvent_names:
            matched += 1
        else:
            unmatched.append((ex.get("raw_name") or "", catalog_name))

    total = matched + len(unmatched)
    pct = matched / total * 100 if total else 0
    ok(f"{matched}/{total} exchange flow names matched ecoinvent ({pct:.0f}%)")

    if unmatched:
        # Deduplicate
        seen = set()
        unique_unmatched = []
        for raw, cat in unmatched:
            key = cat or raw
            if key not in seen:
                seen.add(key)
                unique_unmatched.append((raw, cat))

        warn(f"{len(unique_unmatched)} unique flow names NOT in ecoinvent MasterData:")
        for raw, cat in unique_unmatched[:20]:
            display = cat if cat else raw
            print(f"     – '{display}'")
        if len(unique_unmatched) > 20:
            print(f"     … and {len(unique_unmatched) - 20} more")

    # Unit check
    section("3. UNITS vs. ECOINVENT MASTERDATA")
    bad_units = []
    for ex in exchanges:
        unit = (ex.get("unit") or "").strip()
        if unit and valid_units and unit not in valid_units:
            bad_units.append(unit)

    if not valid_units:
        warn("Units.xml not loaded — unit check skipped")
    elif bad_units:
        unique_bad = sorted(set(bad_units))
        err(f"{len(unique_bad)} unit value(s) not in ecoinvent Units.xml:")
        for u in unique_bad[:15]:
            print(f"     – '{u}'")
    else:
        ok(f"All exchange units are valid ecoinvent units")


def check_against_ali2025(data: dict, ali: dict[str, list[dict]]):
    section("4. PROCESS NAMES vs. ALI 2025 NMC811 LCI REFERENCE")

    if not ali:
        warn("Ali 2025 LCI file not found — skipping reference comparison")
        return

    processes = data["process_instance"]
    exchanges = data["process_exchange"]
    ali_activity_names_lower = {k.lower().strip() for k in ali.keys()}

    matched_processes = []
    unmatched_processes = []
    for p in processes:
        name_lower = p["name"].lower().strip()
        if name_lower in ali_activity_names_lower:
            matched_processes.append(p)
        else:
            unmatched_processes.append(p["name"])

    ok(f"{len(matched_processes)}/{len(processes)} process names match Ali 2025 activities")
    if unmatched_processes:
        warn(f"Process names not in Ali 2025 reference ({len(unmatched_processes)}):")
        for name in sorted(set(unmatched_processes))[:20]:
            print(f"     – '{name}'")

    section("5. EXCHANGE AMOUNTS vs. ALI 2025 REFERENCE (ORDER-OF-MAGNITUDE CHECK)")

    # For matched processes, compare exchange amounts
    issues_found = 0
    for proc in matched_processes:
        proc_name = proc["name"].strip()
        # Find the closest Ali activity name (case-insensitive)
        ali_key = next((k for k in ali if k.lower().strip() == proc_name.lower()), None)
        if not ali_key:
            continue

        ali_exchanges = ali[ali_key]
        db_exchanges = [e for e in exchanges if e["process_id"] == proc["process_id"]]

        for ali_ex in ali_exchanges:
            if ali_ex["amount"] is None or ali_ex["amount"] == 0:
                continue
            # Find matching exchange in DB by name similarity
            ali_name_lower = ali_ex["name"].lower()
            db_match = next(
                (e for e in db_exchanges
                 if (e.get("raw_name") or "").lower() in ali_name_lower
                 or ali_name_lower in (e.get("raw_name") or "").lower()),
                None,
            )
            if db_match is None:
                continue
            db_qty = db_match.get("quantity_user")
            if db_qty is None:
                continue
            ref = abs(ali_ex["amount"])
            db_val = abs(float(db_qty))
            if ref == 0:
                continue
            ratio = db_val / ref if ref else None
            if ratio is not None and (ratio > 100 or ratio < 0.01):
                issues_found += 1
                err(
                    f"[{proc_name}] '{db_match.get('raw_name')}': "
                    f"DB={db_val:.4g} vs Ali2025={ref:.4g} "
                    f"(ratio {ratio:.1f}x — possible unit mismatch or data error)"
                )

    if issues_found == 0:
        ok("No order-of-magnitude mismatches found vs. Ali 2025 reference values")


def check_parameters(data: dict):
    section("6. PARAMETERS")

    params = data["model_parameter"]
    if not params:
        warn("No parameters found in any revision")
        return

    ok(f"{len(params)} parameter(s) across all revisions")

    # Check for params with no value
    no_value = [p for p in params if p.get("value") is None]
    if no_value:
        warn(f"{len(no_value)} parameter(s) have no value set:")
        for p in no_value[:10]:
            print(f"     – '{p['name']}' (revision {p['revision_id'][:8]}…)")
    else:
        ok("All parameters have a value")

    # Check for negative values that might be errors
    negative = [p for p in params if p.get("value") is not None and float(p["value"]) < 0]
    if negative:
        warn(f"{len(negative)} parameter(s) have negative values (verify intentional):")
        for p in negative[:10]:
            print(f"     – '{p['name']}' = {p['value']}")


def check_validation_runs(data: dict):
    section("7. VALIDATION RUN HISTORY")

    runs = data["validation_run"]
    revisions = data["battery_model_revision"]
    issues = data["validation_issue"]

    if not runs:
        warn("No validation runs found — run validation before deploying")
        return

    ok(f"{len(runs)} validation run(s) total")

    # Latest run per revision
    from collections import defaultdict
    runs_by_rev: dict[str, list] = defaultdict(list)
    for r in runs:
        runs_by_rev[r["revision_id"]].append(r)

    never_validated = [r for r in revisions if r["revision_id"] not in runs_by_rev]
    if never_validated:
        warn(f"{len(never_validated)} revision(s) have never been validated:")
        for r in never_validated:
            print(f"     – Rev {r['revision_number']} (id={r['revision_id'][:8]}…)")

    passed = failed = warned = 0
    for rev_id, rev_runs in runs_by_rev.items():
        latest = sorted(rev_runs, key=lambda r: r["run_at"], reverse=True)[0]
        s = latest["status"]
        if s == "pass":
            passed += 1
        elif s in ("fail", "failed"):
            failed += 1
            rev = next((r for r in revisions if r["revision_id"] == rev_id), None)
            rev_label = rev["revision_number"] if rev else rev_id[:8]
            rev_issues = [i for i in issues if i["validation_id"] == latest["validation_id"]]
            err_issues = [i for i in rev_issues if i["severity"] == "error"]
            err(f"Revision {rev_label} FAILED validation with {len(err_issues)} error(s):")
            for i in err_issues[:5]:
                print(f"       [{i['code']}] {i['message']}")
        elif s == "warning":
            warned += 1
        # legacy 'completed' with 0 issues counts as pass
        elif s == "completed" and latest.get("issue_count", 0) == 0:
            passed += 1

    ok(f"Validation summary: {passed} pass, {warned} warning-only, {failed} failed")


def check_deploy_readiness(data: dict):
    section("8. DEPLOYMENT READINESS CHECKLIST")

    projects = data["project"]
    models = data["battery_model"]
    revisions = data["battery_model_revision"]
    processes = data["process_instance"]
    exchanges = data["process_exchange"]
    runs = data["validation_run"]
    users = data["app_user"]

    checks = []

    checks.append(("Has at least one project", len(projects) > 0))
    checks.append(("Has at least one battery model", len(models) > 0))
    checks.append(("Has at least one revision with processes", len(processes) > 0))
    checks.append(("Has at least one exchange", len(exchanges) > 0))
    checks.append(("Has at least one validation run", len(runs) > 0))

    validated_revs = {r["revision_id"] for r in revisions if r.get("status") == "validated"}
    checks.append(("At least one revision is validated", len(validated_revs) > 0))

    admin_users = [u for u in users if u.get("role") == "admin"]
    checks.append(("At least one admin user exists", len(admin_users) > 0))

    mfr_users = [u for u in users if u.get("role") in ("manufacturer", "reviewer")]
    checks.append(("At least one manufacturer/reviewer user exists", len(mfr_users) > 0))

    for label, passed in checks:
        if passed:
            ok(label)
        else:
            err(f"FAIL: {label}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 70)
    print("  BatteryLCATool — Pre-Deployment Data Validation")
    print(f"  Target: {SUPABASE_URL}")
    print("=" * 70)

    # Load reference data
    print("\nLoading ecoinvent MasterData …")
    ecoinvent_names, valid_units = load_ecoinvent_flows()
    print(f"  {len(ecoinvent_names):,} ecoinvent flow names loaded")
    print(f"  {len(valid_units)} ecoinvent units loaded")

    print("\nLoading Ali 2025 LCI reference …")
    ali = load_ali2025_lci()
    print(f"  {len(ali)} reference activities loaded")

    # Fetch DB data
    data = fetch_all()

    # Run checks
    check_structure(data)
    check_flows_against_ecoinvent(data, ecoinvent_names, valid_units)
    check_against_ali2025(data, ali)
    check_parameters(data)
    check_validation_runs(data)
    check_deploy_readiness(data)

    print()
    print("=" * 70)
    print("  Validation complete. Review ✗ errors before deploying.")
    print("=" * 70)
    print()


if __name__ == "__main__":
    main()
