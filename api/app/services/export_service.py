from __future__ import annotations

# =============================================================================
# export_service.py — Battery LCA Tool
# =============================================================================
# Generates a VUB-template-compatible .xlsx workbook for a given revision.
#
# Public API
# ──────────
#   async def generate_export_xlsx(
#       revision_id:        str,
#       partner_responsible: str,
#       db:                 AsyncSession,
#   ) -> bytes
#
# Output workbook layout
# ──────────────────────
#   • One sheet per process_instance, named after the process.
#     Each sheet follows the exact 62-row VUB template structure so that
#     import_service.py can round-trip the file without modification.
#   • A "Version History" sheet with revision metadata.
#   • A "Parameters" sheet with all model_parameter rows for the revision.
#
# Exchange classification
# ───────────────────────
#   Input exchanges  → placed in the INPUTS or TRANSPORT section.
#   Output exchanges → placed in the OUTPUTS section.
#   Transport heuristic: exchange_direction='input' AND (unit contains transport
#   keywords OR raw_name contains transport keywords) → TRANSPORT section.
#
# Unmappable exchanges
# ────────────────────
#   Exchanges with mapping_status = 'unmappable' are styled with grey
#   background + strikethrough text so reviewers can spot them at a glance.
#   They still occupy the same slot positions as normal exchanges.
#
# Overflow
# ────────
#   When a category has more exchanges than pre-defined template slots, extra
#   rows are appended immediately after the last slot row in that section.
#   Overflow labels follow the pattern E6, E7 … / M11, M12 … etc.
# =============================================================================

import io
from decimal import Decimal
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# ---------------------------------------------------------------------------
# Styling helpers
# ---------------------------------------------------------------------------

_GREY_FILL = PatternFill(fill_type="solid", fgColor="FFD9D9D9")
_GREY_FONT = Font(color="FF888888", strikethrough=True)
_BOLD_FONT = Font(bold=True)
_HEADER_FILL = PatternFill(fill_type="solid", fgColor="FFD0E4FF")
_SECTION_FILL = PatternFill(fill_type="solid", fgColor="FFBDD7EE")

# ---------------------------------------------------------------------------
# Template slot definitions
# ---------------------------------------------------------------------------

# Input section category → slot labels
_INPUT_SLOTS: dict[str, list[str]] = {
    "Energy":         [f"E{i}" for i in range(1, 6)],
    "Material":       [f"M{i}" for i in range(1, 11)],
    "Water":          [f"W{i}" for i in range(1, 4)],
    "Service":        [f"S{i}" for i in range(1, 4)],
    "Infrastructure": [f"I{i}" for i in range(1, 3)],
}
_INPUT_PREFIX: dict[str, str] = {
    "Energy": "E", "Material": "M", "Water": "W",
    "Service": "S", "Infrastructure": "I",
}
_INPUT_CATEGORIES = list(_INPUT_SLOTS.keys())

_TRANSPORT_SLOTS: list[str] = [f"T{i}" for i in range(1, 6)]

# Output section category → slot labels
_OUTPUT_SLOTS: dict[str, list[str]] = {
    "Waste":    [f"WO{i}" for i in range(1, 6)],
    "Emission": [f"EM{i}" for i in range(1, 6)],
}
_OUTPUT_PREFIX: dict[str, str] = {"Waste": "WO", "Emission": "EM"}
_OUTPUT_CATEGORIES = list(_OUTPUT_SLOTS.keys())

# ---------------------------------------------------------------------------
# Transport heuristic
# ---------------------------------------------------------------------------

_TRANSPORT_UNITS = frozenset({
    "km", "tkm", "t·km", "t km", "tonne-km", "vehicle-km", "ton-km",
    "pkm", "person-km",
})
_TRANSPORT_KEYWORDS = frozenset({
    "transport", "delivery", "lorry", "truck", "shipping",
    "freight", "cargo", "haulage", "logistics",
})


def _is_transport(exc: dict[str, Any]) -> bool:
    """Return True if this input exchange looks like a transport flow."""
    unit = (exc.get("user_unit") or "").lower().strip()
    name = (exc.get("raw_name") or "").lower()
    kind = (exc.get("flow_kind") or "").lower()
    if kind == "transport":
        return True
    if unit in _TRANSPORT_UNITS:
        return True
    return any(kw in name for kw in _TRANSPORT_KEYWORDS)


# ---------------------------------------------------------------------------
# Exchange classification
# ---------------------------------------------------------------------------

# flow_kind → input category (fallback: Material)
_KIND_TO_INPUT_CAT: dict[str, str] = {
    "energy":         "Energy",
    "electricity":    "Energy",
    "heat":           "Energy",
    "material":       "Material",
    "water":          "Water",
    "service":        "Service",
    "infrastructure": "Infrastructure",
    "transport":      "Material",  # overridden by _is_transport
    "waste":          "Material",
    "emission":       "Material",
}

# flow_kind → output category (fallback: Waste)
_KIND_TO_OUTPUT_CAT: dict[str, str] = {
    "waste":    "Waste",
    "emission": "Emission",
    "material": "Waste",
    "energy":   "Waste",
    "water":    "Waste",
}

_SENTINEL_TRANSPORT = "_transport"


def _classify_input(exc: dict[str, Any]) -> str:
    """Return input category name or _SENTINEL_TRANSPORT."""
    if _is_transport(exc):
        return _SENTINEL_TRANSPORT
    kind = (exc.get("flow_kind") or "").lower()
    return _KIND_TO_INPUT_CAT.get(kind, "Material")


def _classify_output(exc: dict[str, Any]) -> str:
    """Return output category name."""
    kind = (exc.get("flow_kind") or "").lower()
    return _KIND_TO_OUTPUT_CAT.get(kind, "Waste")


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _safe_sheet_name(raw: str, used: set[str]) -> str:
    """Return a valid, unique Excel sheet name (max 31 chars)."""
    # Strip illegal chars
    illegal = r'\/:*?[]'
    cleaned = "".join(c for c in raw if c not in illegal).strip() or "Sheet"
    name = cleaned[:31]
    if name not in used:
        used.add(name)
        return name
    # Deduplicate with numeric suffix
    for i in range(2, 1000):
        suffix = f"_{i}"
        candidate = cleaned[: 31 - len(suffix)] + suffix
        if candidate not in used:
            used.add(candidate)
            return candidate
    return cleaned[:31]


def _dec_to_float(v: Any) -> float | None:
    """Convert Decimal/int/float/str to float, or None."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _style_unmappable(ws, row: int, col_start: int = 1, col_end: int = 10) -> None:
    """Apply grey strikethrough styling to an exchange row."""
    for col in range(col_start, col_end + 1):
        cell = ws.cell(row=row, column=col)
        cell.fill = _GREY_FILL
        cell.font = _GREY_FONT


def _write_cell(ws, row: int, col: int, value: Any, bold: bool = False) -> None:
    cell = ws.cell(row=row, column=col, value=value)
    if bold:
        cell.font = _BOLD_FONT


def _write_section_marker(ws, row: int, label: str) -> None:
    cell = ws.cell(row=row, column=1, value=label)
    cell.font = _BOLD_FONT
    cell.fill = _SECTION_FILL


def _write_header_row(ws, row: int, cols: list[str]) -> None:
    for i, label in enumerate(cols, start=1):
        cell = ws.cell(row=row, column=i, value=label)
        cell.font = _BOLD_FONT
        cell.fill = _HEADER_FILL


# ---------------------------------------------------------------------------
# Exchange row writers
# ---------------------------------------------------------------------------

_INPUT_HEADERS = [
    "Category", "Label", "Flow Name", "Amount", "Unit",
    "Function/use", "Details", "Cost (€/unit)", "Origin", "Observations",
]
_TRANSPORT_HEADERS = [
    "Category", "Label", "Flow Name", "Distance", "Unit",
    "Mode of transport", "Details", "Cost (€/unit)", "Origin", "Observations",
]
_OUTPUT_HEADERS = [
    "Category", "Label", "Flow Name", "Amount", "Unit",
    "Treatment/destination", "Details", "Cost (€/unit)", "Origin", "Observations",
]


def _write_exchange_row(
    ws,
    row: int,
    category: str,
    label: str,
    exc: dict[str, Any] | None,
    is_unmappable: bool = False,
) -> None:
    """Write one exchange data row.  exc=None means an empty template slot."""
    if exc is None:
        ws.cell(row=row, column=1, value=category)
        ws.cell(row=row, column=2, value=label)
        return

    amount = _dec_to_float(exc.get("quantity_user"))
    formula = exc.get("formula_user")
    amount_cell_value = formula if (formula and amount is None) else amount

    ws.cell(row=row, column=1, value=category)
    ws.cell(row=row, column=2, value=label)
    ws.cell(row=row, column=3, value=exc.get("raw_name"))
    ws.cell(row=row, column=4, value=amount_cell_value)
    ws.cell(row=row, column=5, value=exc.get("user_unit"))
    ws.cell(row=row, column=6, value=exc.get("comment"))
    ws.cell(row=row, column=7, value=exc.get("details"))
    ws.cell(row=row, column=8, value=_dec_to_float(exc.get("cost_per_unit")))
    ws.cell(row=row, column=9, value=exc.get("source_database"))
    ws.cell(row=row, column=10, value=exc.get("observations"))

    if is_unmappable:
        _style_unmappable(ws, row)


def _write_category_block(
    ws,
    start_row: int,
    category: str,
    slots: list[str],
    prefix: str,
    exchanges: list[dict[str, Any]],
) -> int:
    """
    Write all slots for a category, plus overflow rows if needed.

    Returns the next available row number after this block.
    """
    row = start_row
    for i, label in enumerate(slots):
        exc = exchanges[i] if i < len(exchanges) else None
        unmappable = exc is not None and exc.get("mapping_status") == "unmappable"
        _write_exchange_row(ws, row, category, label, exc, unmappable)
        row += 1

    # Overflow rows
    for j, exc in enumerate(exchanges[len(slots):], start=len(slots) + 1):
        overflow_label = f"{prefix}{j}"
        unmappable = exc.get("mapping_status") == "unmappable"
        _write_exchange_row(ws, row, category, overflow_label, exc, unmappable)
        row += 1

    return row


# ---------------------------------------------------------------------------
# Process sheet builder (62 base rows + overflow)
# ---------------------------------------------------------------------------

def _build_process_sheet(
    wb: Workbook,
    sheet_name: str,
    proc: dict[str, Any],
    exchanges: list[dict[str, Any]],
) -> None:
    """
    Build one process sheet following the VUB template structure.

    Fixed row layout (matching what import_service.py expects):
      Row  1  — "INVENTORY PROCESS" section marker
      Row  2  — header (skipped by parser's skip_next_non_empty)
      Rows 3-5 — blank
      Row  6  — "Process description:" | comment
      Row  7  — "Productive process"
      Rows 8-11 — blank
      Row 12  — "Material/product produced" | | ref_name | amount | unit | ref_cost
      Row 13  — "Co-product (if any)" | | co_name | co_amount | co_unit
      Rows 14-15 — blank
      Row 16  — "INPUTS"
      Row 17  — inputs header
      Rows 18-22  — Energy E1-E5
      Rows 23-32  — Material M1-M10
      Rows 33-35  — Water W1-W3
      Rows 36-38  — Service S1-S3
      Rows 39-40  — Infrastructure I1-I2
      Row 41  — blank
      Row 42  — "TRANSPORT"
      Row 43  — transport header
      Rows 44-48  — Transport T1-T5
      Row 49  — blank
      Row 50  — "OUTPUTS"
      Row 51  — outputs header
      Rows 52-56  — Waste WO1-WO5
      Rows 57-61  — Emission EM1-EM5
      Row 62  — blank
    """
    ws = wb.create_sheet(title=sheet_name)

    # Classify exchanges
    inputs: dict[str, list[dict]] = {cat: [] for cat in _INPUT_CATEGORIES}
    transport: list[dict] = []
    outputs: dict[str, list[dict]] = {cat: [] for cat in _OUTPUT_CATEGORIES}

    for exc in exchanges:
        direction = (exc.get("exchange_direction") or "input").lower()
        if direction in ("output", "reference_product", "co_product", "waste_output"):
            cat = _classify_output(exc)
            outputs[cat].append(exc)
        else:
            cat = _classify_input(exc)
            if cat == _SENTINEL_TRANSPORT:
                transport.append(exc)
            else:
                inputs[cat].append(exc)

    # ── Row 1: section marker ────────────────────────────────────────────────
    _write_section_marker(ws, 1, "INVENTORY PROCESS")

    # ── Row 2: column header (skipped by parser) ─────────────────────────────
    _write_header_row(ws, 2, [
        "Key", "Sub-key", "Value", "Amount", "Unit",
        "Notes", "Extra", "Cost", "Origin", "Obs",
    ])

    # ── Rows 3-5: blank ───────────────────────────────────────────────────────
    # (nothing to write — cells are already empty)

    # ── Row 6: process description ────────────────────────────────────────────
    ws.cell(row=6, column=1, value="Process description:")
    ws.cell(row=6, column=3, value=proc.get("comment"))

    # ── Row 7: process type label ─────────────────────────────────────────────
    ws.cell(row=7, column=1, value="Productive process")

    # ── Rows 8-11: blank ──────────────────────────────────────────────────────

    # ── Row 12: reference product ─────────────────────────────────────────────
    # Col layout: A="Material/product produced", C=name, D=amount, E=unit, F=ref_cost
    # NOTE: ref_cost goes in col F (index 6) in the metadata row — this is
    # different from exchange rows where cost_per_unit is in col H (index 8).
    ws.cell(row=12, column=1, value="Material/product produced")
    ws.cell(row=12, column=3, value=proc.get("name"))
    ws.cell(row=12, column=4, value=_dec_to_float(proc.get("production_amount")))
    ws.cell(row=12, column=5, value=proc.get("unit"))
    # ref_cost: not a separate field — leave blank unless process has a cost field
    # (kept as None; importers read it from col F of this specific row)

    # ── Row 13: co-product placeholder ────────────────────────────────────────
    ws.cell(row=13, column=1, value="Co-product (if any)")

    # ── Rows 14-15: blank ─────────────────────────────────────────────────────

    # ── Row 16: INPUTS section marker ─────────────────────────────────────────
    _write_section_marker(ws, 16, "INPUTS")

    # ── Row 17: INPUTS header ─────────────────────────────────────────────────
    _write_header_row(ws, 17, _INPUT_HEADERS)

    # ── Rows 18-40: input categories ──────────────────────────────────────────
    _write_category_block(ws, 18, "Energy",         _INPUT_SLOTS["Energy"],         "E",  inputs["Energy"])
    _write_category_block(ws, 23, "Material",       _INPUT_SLOTS["Material"],       "M",  inputs["Material"])
    _write_category_block(ws, 33, "Water",          _INPUT_SLOTS["Water"],          "W",  inputs["Water"])
    _write_category_block(ws, 36, "Service",        _INPUT_SLOTS["Service"],        "S",  inputs["Service"])
    _write_category_block(ws, 39, "Infrastructure", _INPUT_SLOTS["Infrastructure"], "I",  inputs["Infrastructure"])

    # ── Row 41: blank ─────────────────────────────────────────────────────────

    # ── Row 42: TRANSPORT section marker ──────────────────────────────────────
    _write_section_marker(ws, 42, "TRANSPORT")

    # ── Row 43: TRANSPORT header ──────────────────────────────────────────────
    _write_header_row(ws, 43, _TRANSPORT_HEADERS)

    # ── Rows 44-48: transport T1-T5 ───────────────────────────────────────────
    _write_category_block(ws, 44, "Transport", _TRANSPORT_SLOTS, "T", transport)

    # ── Row 49: blank ─────────────────────────────────────────────────────────

    # ── Row 50: OUTPUTS section marker ────────────────────────────────────────
    _write_section_marker(ws, 50, "OUTPUTS")

    # ── Row 51: OUTPUTS header ────────────────────────────────────────────────
    _write_header_row(ws, 51, _OUTPUT_HEADERS)

    # ── Rows 52-61: output categories ─────────────────────────────────────────
    _write_category_block(ws, 52, "Waste",    _OUTPUT_SLOTS["Waste"],    "WO", outputs["Waste"])
    _write_category_block(ws, 57, "Emission", _OUTPUT_SLOTS["Emission"], "EM", outputs["Emission"])

    # ── Row 62: blank (end of template) ───────────────────────────────────────
    # (already empty)


# ---------------------------------------------------------------------------
# Version History sheet
# ---------------------------------------------------------------------------

def _write_version_history(
    wb: Workbook,
    meta: dict[str, Any],
    partner_responsible: str,
) -> None:
    ws = wb.create_sheet(title="Version History")

    headers = [
        "Project", "Model", "Revision", "Label",
        "Chemistry", "Functional Unit", "Partner Responsible",
        "Export Date",
    ]
    _write_header_row(ws, 1, headers)

    from datetime import datetime, timezone

    ws.cell(row=2, column=1, value=meta.get("project_name"))
    ws.cell(row=2, column=2, value=meta.get("model_name"))
    ws.cell(row=2, column=3, value=meta.get("revision_number"))
    ws.cell(row=2, column=4, value=meta.get("label"))
    ws.cell(row=2, column=5, value=meta.get("chemistry"))
    ws.cell(row=2, column=6, value=meta.get("functional_unit"))
    ws.cell(row=2, column=7, value=partner_responsible)
    ws.cell(row=2, column=8, value=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))


# ---------------------------------------------------------------------------
# Parameters sheet
# ---------------------------------------------------------------------------

def _write_parameters_sheet(
    wb: Workbook,
    params: list[dict[str, Any]],
) -> None:
    ws = wb.create_sheet(title="Parameters")

    headers = [
        "Name", "Value", "Distribution",
        "Min", "Max", "Mode", "Description",
    ]
    _write_header_row(ws, 1, headers)

    for i, p in enumerate(params, start=2):
        ws.cell(row=i, column=1, value=p.get("name"))
        ws.cell(row=i, column=2, value=_dec_to_float(p.get("value")))
        ws.cell(row=i, column=3, value=p.get("distribution_type"))
        ws.cell(row=i, column=4, value=_dec_to_float(p.get("min_value")))
        ws.cell(row=i, column=5, value=_dec_to_float(p.get("max_value")))
        ws.cell(row=i, column=6, value=_dec_to_float(p.get("mode_value")))
        ws.cell(row=i, column=7, value=p.get("description"))


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def generate_export_xlsx(
    revision_id: str,
    partner_responsible: str,
    db: AsyncSession,
) -> bytes:
    """
    Generate a VUB-template-compatible .xlsx export for the given revision.

    Parameters
    ----------
    revision_id:
        UUID of the battery_model_revision to export.
    partner_responsible:
        Free-text name recorded in the Version History sheet (e.g. the
        manufacturer company name or the user who triggered the export).
    db:
        Active async SQLAlchemy session (read-only operations only).

    Returns
    -------
    bytes
        Raw .xlsx file content, ready to stream to the client or upload to
        Supabase Storage.

    Raises
    ------
    ValueError
        If the revision_id does not exist in the database.
    """

    # ── 1. Revision metadata ─────────────────────────────────────────────────
    meta_result = await db.execute(
        text("""
            SELECT
                bmr.revision_id,
                bmr.revision_number,
                bmr.label,
                bmr.created_at         AS revision_created_at,
                bm.name                AS model_name,
                bm.chemistry,
                bm.functional_unit,
                p.name                 AS project_name
            FROM battery_model_revision bmr
            JOIN battery_model bm ON bm.model_id = bmr.model_id
            JOIN project       p  ON p.project_id = bm.project_id
            WHERE bmr.revision_id = :rid
        """),
        {"rid": revision_id},
    )
    meta_row = meta_result.fetchone()
    if meta_row is None:
        raise ValueError(f"Revision {revision_id!r} not found.")
    meta: dict[str, Any] = dict(meta_row._mapping)

    # ── 2. Processes ─────────────────────────────────────────────────────────
    proc_result = await db.execute(
        text("""
            SELECT
                process_id,
                name,
                location,
                unit,
                production_amount,
                stage,
                comment
            FROM process_instance
            WHERE revision_id = :rid
            ORDER BY created_at
        """),
        {"rid": revision_id},
    )
    processes: list[dict[str, Any]] = [dict(r._mapping) for r in proc_result.fetchall()]

    # ── 3. Exchanges (all processes in one query) ────────────────────────────
    exc_result = await db.execute(
        text("""
            SELECT
                pe.exchange_id,
                pe.process_id,
                pe.raw_name,
                pe.quantity_user,
                pe.formula_user,
                pe.user_unit,
                pe.exchange_direction,
                pe.output_type,
                pe.source_database,
                pe.source_location,
                pe.comment,
                pe.details,
                pe.cost_per_unit,
                pe.observations,
                pe.mapping_status,
                pe.sort_order,
                fc.kind AS flow_kind
            FROM process_exchange pe
            LEFT JOIN flow_catalog fc ON fc.flow_id = pe.flow_id
            WHERE pe.process_id IN (
                SELECT process_id FROM process_instance WHERE revision_id = :rid
            )
            ORDER BY pe.process_id, pe.sort_order NULLS LAST, pe.created_at
        """),
        {"rid": revision_id},
    )
    all_exchanges: list[dict[str, Any]] = [dict(r._mapping) for r in exc_result.fetchall()]

    # Group exchanges by process_id
    exchanges_by_proc: dict[str, list[dict[str, Any]]] = {}
    for exc in all_exchanges:
        pid = exc["process_id"]
        exchanges_by_proc.setdefault(pid, []).append(exc)

    # ── 4. Parameters ────────────────────────────────────────────────────────
    param_result = await db.execute(
        text("""
            SELECT
                name,
                value,
                distribution_type,
                min_value,
                max_value,
                mode_value,
                description
            FROM model_parameter
            WHERE revision_id = :rid
            ORDER BY name
        """),
        {"rid": revision_id},
    )
    params: list[dict[str, Any]] = [dict(r._mapping) for r in param_result.fetchall()]

    # ── 5. Build workbook ────────────────────────────────────────────────────
    wb = Workbook()
    # Remove the default blank sheet created by openpyxl
    wb.remove(wb.active)

    used_sheet_names: set[str] = set()

    for proc in processes:
        sheet_name = _safe_sheet_name(proc.get("name") or "Process", used_sheet_names)
        proc_exchanges = exchanges_by_proc.get(proc["process_id"], [])
        _build_process_sheet(wb, sheet_name, proc, proc_exchanges)

    _write_version_history(wb, meta, partner_responsible)
    _write_parameters_sheet(wb, params)

    # ── 6. Serialise to bytes ────────────────────────────────────────────────
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
