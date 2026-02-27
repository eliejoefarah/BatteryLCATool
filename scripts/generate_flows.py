#!/usr/bin/env python3
"""
generate_flows.py — Seed flow_catalog + flow_allowed_unit from ecoinvent MasterData XMLs.

Usage:
    python scripts/generate_flows.py \
        --elementary  MasterData/ElementaryExchanges.xml \
        --intermediate MasterData/IntermediateExchanges.xml \
        > supabase/migrations/007_flows.sql

Writes INSERT statements to stdout; progress/warnings to stderr.

Design decisions:
  - Elementary canonical_name: "{name} [{compartment}/{subcompartment}]"
    This prevents UNIQUE(catalog_set_id, canonical_name, kind) collisions for the
    same substance emitted to different environmental compartments.
  - Intermediate canonical_name: plain name (no compartment context).
  - flow_id: ecoinvent UUID reused directly (stable, deterministic, maps 1-to-1 with
    ecoinvent identifiers across tool versions).
  - Duplicate (canonical_name, kind) pairs within a file are resolved by keeping
    the first occurrence; subsequent hits are logged to stderr and skipped.  This
    prevents FK violations on flow_allowed_unit for uninserted flow_catalog rows.
  - Units not in SYMBOL_TO_UNIT_ID get NULL dimension and no flow_allowed_unit row.
  - catalog_set_id: '00000000-0000-0000-0001-000000000001'  (DEFAULT catalog set).
"""

import argparse
import sys
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CATALOG_SET_ID = "00000000-0000-0000-0001-000000000001"

_XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"

# Maps ecoinvent unitName (as it appears in XML) → unit_catalog unit_id (u-001…u-021).
SYMBOL_TO_UNIT_ID: dict[str, str] = {
    "kg":            "u-001",
    "unit":          "u-002",
    "kWh":           "u-003",
    "m3":            "u-004",
    "MJ":            "u-005",
    "metric ton*km": "u-006",
    "m2":            "u-007",
    "m2*year":       "u-008",
    "ha":            "u-009",
    "km":            "u-010",
    "m":             "u-011",
    "kBq":           "u-012",
    "hour":          "u-013",
    "m*year":        "u-014",
    "m3*year":       "u-015",
    "Sm3":           "u-016",
    "l":             "u-017",
    "kg*day":        "u-018",
    "person*km":     "u-019",
    "km*year":       "u-020",
    "guest night":   "u-021",
}

# Maps ecoinvent unitName → flow_dimension_enum.
SYMBOL_TO_DIM: dict[str, str] = {
    "kg":            "mass",
    "unit":          "count",
    "kWh":           "energy",
    "m3":            "volume",
    "MJ":            "energy",
    "metric ton*km": "transport",
    "m2":            "area",
    "m2*year":       "other",
    "ha":            "area",
    "km":            "length",
    "m":             "length",
    "kBq":           "radioactivity",
    "hour":          "time",
    "m*year":        "other",
    "m3*year":       "other",
    "Sm3":           "volume",
    "l":             "volume",
    "kg*day":        "other",
    "person*km":     "transport",
    "km*year":       "other",
    "guest night":   "count",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _local_tag(tag: str) -> str:
    """Strip XML namespace prefix: '{ns}name' → 'name'."""
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _esc(text: str) -> str:
    """Escape single quotes for SQL string literals."""
    return text.replace("'", "''")


def _get_child_text(elem: ET.Element, local_tag_name: str, lang: str = "en") -> str | None:
    """Return text of the first direct child whose local tag and xml:lang match."""
    for child in elem:
        if _local_tag(child.tag) == local_tag_name:
            if lang is None or child.get(_XML_LANG) == lang:
                text = (child.text or "").strip()
                return text if text else None
    return None


def _elementary_kind(compartment: str, unit_sym: str) -> str:
    """Map ecoinvent compartment → flow_kind_enum for elementary flows."""
    comp = compartment.lower().strip()
    if comp == "natural resource":
        if unit_sym in ("kWh", "MJ"):
            return "energy"
        return "material"
    # air, water, soil, land, economic → emission
    return "emission"


def _intermediate_kind(by_product_class: str | None, unit_sym: str) -> str:
    """Map By-product classification → flow_kind_enum for intermediate flows."""
    if by_product_class and by_product_class.strip().lower() == "waste":
        return "waste"
    if unit_sym in ("kWh", "MJ"):
        return "energy"
    return "material"


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------

def parse_elementary(xml_path: str) -> list[dict]:
    """
    Parse ElementaryExchanges.xml.
    Returns list of dicts with keys: flow_id, canonical_name, kind, dimension, unit_id.
    Deduplicates on (canonical_name.lower(), kind): keeps first occurrence.
    """
    try:
        tree = ET.parse(xml_path)
    except FileNotFoundError:
        print(f"error: file not found: {xml_path}", file=sys.stderr)
        sys.exit(1)
    except ET.ParseError as exc:
        print(f"error: XML parse failure in {xml_path}: {exc}", file=sys.stderr)
        sys.exit(1)

    root = tree.getroot()
    flows: list[dict] = []
    seen_canonical_kind: set[tuple[str, str]] = set()
    skipped = 0
    unknown_units: set[str] = set()

    for elem in root.iter():
        if _local_tag(elem.tag) != "elementaryExchange":
            continue

        flow_id = (elem.get("id") or "").strip()
        if not flow_id:
            continue

        name = _get_child_text(elem, "name") or ""
        unit_sym = _get_child_text(elem, "unitName") or ""

        # Compartment is a direct child element containing child <compartment> and <subcompartment>.
        compartment = ""
        subcompartment = ""
        for child in elem:
            if _local_tag(child.tag) == "compartment":
                compartment = _get_child_text(child, "compartment") or ""
                subcompartment = _get_child_text(child, "subcompartment") or ""
                break

        canonical_name = (
            f"{name} [{compartment}/{subcompartment}]" if compartment else name
        )
        kind = _elementary_kind(compartment, unit_sym)

        dedup_key = (canonical_name.lower(), kind)
        if dedup_key in seen_canonical_kind:
            skipped += 1
            print(
                f"  warn: duplicate elementary (canonical_name, kind) skipped: "
                f"'{canonical_name}' / '{kind}' (flow_id={flow_id})",
                file=sys.stderr,
            )
            continue
        seen_canonical_kind.add(dedup_key)

        dim = SYMBOL_TO_DIM.get(unit_sym)
        unit_id = SYMBOL_TO_UNIT_ID.get(unit_sym)
        if not unit_id:
            unknown_units.add(unit_sym)

        flows.append({
            "flow_id": flow_id,
            "canonical_name": canonical_name,
            "kind": kind,
            "dimension": dim,
            "unit_id": unit_id,
            "is_elementary": True,
        })

    if unknown_units:
        print(
            f"  info: {len(unknown_units)} unknown elementary unit symbols "
            f"(no flow_allowed_unit row): {sorted(unknown_units)}",
            file=sys.stderr,
        )
    if skipped:
        print(f"  info: {skipped} duplicate elementary flows skipped.", file=sys.stderr)

    return flows


def parse_intermediate(xml_path: str) -> list[dict]:
    """
    Parse IntermediateExchanges.xml.
    Returns list of dicts with keys: flow_id, canonical_name, kind, dimension, unit_id.
    Deduplicates on (canonical_name.lower(), kind): keeps first occurrence.
    """
    try:
        tree = ET.parse(xml_path)
    except FileNotFoundError:
        print(f"error: file not found: {xml_path}", file=sys.stderr)
        sys.exit(1)
    except ET.ParseError as exc:
        print(f"error: XML parse failure in {xml_path}: {exc}", file=sys.stderr)
        sys.exit(1)

    root = tree.getroot()
    flows: list[dict] = []
    seen_canonical_kind: set[tuple[str, str]] = set()
    skipped = 0
    unknown_units: set[str] = set()

    for elem in root.iter():
        if _local_tag(elem.tag) != "intermediateExchange":
            continue

        flow_id = (elem.get("id") or "").strip()
        if not flow_id:
            continue

        name = _get_child_text(elem, "name") or ""
        unit_sym = _get_child_text(elem, "unitName") or ""

        # Find By-product classification value.
        by_product_class: str | None = None
        for child in elem:
            if _local_tag(child.tag) == "classification":
                sys_text = _get_child_text(child, "classificationSystem") or ""
                if "by-product" in sys_text.lower():
                    by_product_class = _get_child_text(child, "classificationValue") or None
                    break

        canonical_name = name
        kind = _intermediate_kind(by_product_class, unit_sym)

        dedup_key = (canonical_name.lower(), kind)
        if dedup_key in seen_canonical_kind:
            skipped += 1
            print(
                f"  warn: duplicate intermediate (canonical_name, kind) skipped: "
                f"'{canonical_name}' / '{kind}' (flow_id={flow_id})",
                file=sys.stderr,
            )
            continue
        seen_canonical_kind.add(dedup_key)

        dim = SYMBOL_TO_DIM.get(unit_sym)
        unit_id = SYMBOL_TO_UNIT_ID.get(unit_sym)
        if not unit_id:
            unknown_units.add(unit_sym)

        flows.append({
            "flow_id": flow_id,
            "canonical_name": canonical_name,
            "kind": kind,
            "dimension": dim,
            "unit_id": unit_id,
            "is_elementary": False,
        })

    if unknown_units:
        print(
            f"  info: {len(unknown_units)} unknown intermediate unit symbols "
            f"(no flow_allowed_unit row): {sorted(unknown_units)}",
            file=sys.stderr,
        )
    if skipped:
        print(f"  info: {skipped} duplicate intermediate flows skipped.", file=sys.stderr)

    return flows


# ---------------------------------------------------------------------------
# SQL emission
# ---------------------------------------------------------------------------

_HEADER = """\
-- =============================================================================
-- 007_flows.sql  —  Battery LCA Tool
-- flow_catalog + flow_allowed_unit seed
-- Generated by scripts/generate_flows.py from MasterData XMLs.
-- Do NOT edit manually — re-run the script to regenerate.
-- =============================================================================
"""


def emit_sql(elementary_flows: list[dict], intermediate_flows: list[dict]) -> None:
    all_flows = elementary_flows + intermediate_flows
    n_total = len(all_flows)
    n_with_unit = sum(1 for f in all_flows if f["unit_id"])

    print(_HEADER)
    print(
        f"-- {len(elementary_flows)} elementary flows  "
        f"+ {len(intermediate_flows)} intermediate flows  "
        f"= {n_total} total"
    )
    print()

    # ── flow_catalog ──────────────────────────────────────────────────────────
    print("-- ---------------------------------------------------------------------------")
    print("-- flow_catalog inserts")
    print("-- ---------------------------------------------------------------------------")
    print()

    for flow in all_flows:
        fid      = _esc(flow["flow_id"])
        cname    = _esc(flow["canonical_name"])
        kind     = flow["kind"]
        is_elem  = "TRUE" if flow["is_elementary"] else "FALSE"
        dim_sql  = f"'{flow['dimension']}'::flow_dimension_enum" if flow["dimension"] else "NULL"

        print(
            f"INSERT INTO flow_catalog "
            f"(flow_id, catalog_set_id, canonical_name, kind, is_elementary_flow, dimension) VALUES "
            f"('{fid}', '{CATALOG_SET_ID}', '{cname}', '{kind}'::flow_kind_enum, {is_elem}, {dim_sql}) "
            f"ON CONFLICT DO NOTHING;"
        )

    print()

    # ── flow_allowed_unit ─────────────────────────────────────────────────────
    print("-- ---------------------------------------------------------------------------")
    print("-- flow_allowed_unit inserts  (only for flows whose unit is in unit_catalog)")
    print("-- ---------------------------------------------------------------------------")
    print()

    for flow in all_flows:
        if not flow["unit_id"]:
            continue
        fid = _esc(flow["flow_id"])
        uid = flow["unit_id"]
        print(
            f"INSERT INTO flow_allowed_unit (flow_id, unit_id) VALUES "
            f"('{fid}', '{uid}') "
            f"ON CONFLICT DO NOTHING;"
        )

    print()
    print(f"-- {n_total} flow_catalog rows")
    print(f"-- {n_with_unit} flow_allowed_unit rows")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed flow_catalog from ecoinvent MasterData XMLs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Example:\n"
            "  python scripts/generate_flows.py \\\n"
            "      --elementary  MasterData/ElementaryExchanges.xml \\\n"
            "      --intermediate MasterData/IntermediateExchanges.xml \\\n"
            "      > supabase/migrations/007_flows.sql"
        ),
    )
    parser.add_argument(
        "--elementary",
        required=True,
        metavar="XML",
        help="Path to ElementaryExchanges.xml",
    )
    parser.add_argument(
        "--intermediate",
        required=True,
        metavar="XML",
        help="Path to IntermediateExchanges.xml",
    )
    args = parser.parse_args()

    print("Parsing ElementaryExchanges.xml …", file=sys.stderr)
    elementary = parse_elementary(args.elementary)
    print(f"  → {len(elementary)} flows", file=sys.stderr)

    print("Parsing IntermediateExchanges.xml …", file=sys.stderr)
    intermediate = parse_intermediate(args.intermediate)
    print(f"  → {len(intermediate)} flows", file=sys.stderr)

    emit_sql(elementary, intermediate)

    n_with_unit = sum(1 for f in elementary + intermediate if f["unit_id"])
    print(
        f"Done: {len(elementary) + len(intermediate)} flow_catalog rows, "
        f"{n_with_unit} flow_allowed_unit rows written to stdout.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
