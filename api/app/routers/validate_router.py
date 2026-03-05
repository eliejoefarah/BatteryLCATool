from __future__ import annotations

# =============================================================================
# validate_router.py — Battery LCA Tool
# =============================================================================
# POST /validate
#
# Runs the LCA validation engine for a revision:
#   1. Creates a validation_run row (status='running')
#   2. Fetches all processes + exchanges for the revision
#   3. Applies validation rules → generates validation_issue rows
#   4. Updates validation_run (status='completed', issue_count)
#
# Called by the trigger_validation Supabase Edge Function, which handles
# authentication and forwards { revision_id, triggered_by }.
# =============================================================================

import logging
import uuid
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db

log = logging.getLogger(__name__)

router = APIRouter(tags=["validate"])

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class ValidateRequest(BaseModel):
    revision_id: str
    triggered_by: str


class ValidateResponse(BaseModel):
    validation_id: str
    revision_id: str
    status: str
    issue_count: int


# ---------------------------------------------------------------------------
# Validation rules
# ---------------------------------------------------------------------------

def _check_no_processes(
    revision_id: UUID,
    processes: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    validation_id: UUID,
) -> None:
    """Revision-level: no processes at all."""
    if not processes:
        issues.append({
            "issue_id": str(uuid.uuid4()),
            "validation_id": str(validation_id),
            "severity": "info",
            "code": "NO_PROCESSES",
            "message": "This revision has no processes.",
            "process_id": None,
            "exchange_id": None,
            "suggestion": "Import or create processes before running a full validation.",
        })


def _check_process_rules(
    process: dict[str, Any],
    exchanges: list[dict[str, Any]],
    issues: list[dict[str, Any]],
    validation_id: UUID,
) -> None:
    """Per-process rules."""
    pid = process["process_id"]
    proc_exchanges = [e for e in exchanges if e["process_id"] == pid]

    # EMPTY_PROCESS — no exchanges
    if not proc_exchanges:
        issues.append({
            "issue_id": str(uuid.uuid4()),
            "validation_id": str(validation_id),
            "severity": "warning",
            "code": "EMPTY_PROCESS",
            "message": f"Process \"{process['name']}\" has no exchanges.",
            "process_id": pid,
            "exchange_id": None,
            "suggestion": "Add at least one reference output and any input exchanges.",
        })
        return

    # MISSING_REF_FLOW — no output exchange with output_type = 'reference'
    has_ref = any(
        e["exchange_direction"] == "output" and e.get("output_type") == "reference"
        for e in proc_exchanges
    )
    if not has_ref:
        issues.append({
            "issue_id": str(uuid.uuid4()),
            "validation_id": str(validation_id),
            "severity": "error",
            "code": "MISSING_REF_FLOW",
            "message": f"Process \"{process['name']}\" has no reference output flow.",
            "process_id": pid,
            "exchange_id": None,
            "suggestion": "Mark one output exchange as the reference product.",
        })

    # Per-exchange rules
    for exc in proc_exchanges:
        eid = exc["exchange_id"]

        # MISSING_QUANTITY — both quantity_user and formula_user are NULL
        if exc.get("quantity_user") is None and not exc.get("formula_user"):
            issues.append({
                "issue_id": str(uuid.uuid4()),
                "validation_id": str(validation_id),
                "severity": "error",
                "code": "MISSING_QUANTITY",
                "message": (
                    f"Exchange \"{exc.get('raw_name') or exc.get('flow_id') or eid}\" "
                    f"in process \"{process['name']}\" has no quantity or formula."
                ),
                "process_id": pid,
                "exchange_id": eid,
                "suggestion": "Enter a numeric amount or a formula expression.",
            })

        # UNLINKED_FLOW — no flow_id (not matched to catalog)
        if not exc.get("flow_id"):
            issues.append({
                "issue_id": str(uuid.uuid4()),
                "validation_id": str(validation_id),
                "severity": "warning",
                "code": "UNLINKED_FLOW",
                "message": (
                    f"Exchange \"{exc.get('raw_name') or eid}\" "
                    f"in process \"{process['name']}\" is not linked to the flow catalog."
                ),
                "process_id": pid,
                "exchange_id": eid,
                "suggestion": "Search for and select a matching flow from the catalog.",
            })


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.post("/validate", response_model=ValidateResponse)
async def run_validation(
    body: ValidateRequest,
    db: AsyncSession = Depends(get_db),
) -> ValidateResponse:
    try:
        revision_id = UUID(body.revision_id)
        triggered_by = UUID(body.triggered_by)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid UUID: {exc}") from exc

    validation_id = uuid.uuid4()

    # ── 1. Create validation_run row (status = 'running') ─────────────────
    await db.execute(
        text("""
            INSERT INTO validation_run
              (validation_id, revision_id, triggered_by, status, issue_count)
            VALUES
              (:vid, :rid, :uid, 'running', 0)
        """),
        {
            "vid": str(validation_id),
            "rid": str(revision_id),
            "uid": str(triggered_by),
        },
    )
    await db.commit()

    try:
        # ── 2. Load processes ─────────────────────────────────────────────
        proc_rows = (await db.execute(
            text("""
                SELECT process_id, name, system_boundary
                FROM process_instance
                WHERE revision_id = :rid
                ORDER BY name
            """),
            {"rid": str(revision_id)},
        )).mappings().all()

        processes = [dict(r) for r in proc_rows]

        # ── 3. Load exchanges ─────────────────────────────────────────────
        exc_rows = (await db.execute(
            text("""
                SELECT exchange_id, process_id, flow_id, raw_name,
                       quantity_user, formula_user,
                       exchange_direction, output_type
                FROM process_exchange
                WHERE process_id IN (
                    SELECT process_id FROM process_instance WHERE revision_id = :rid
                )
            """),
            {"rid": str(revision_id)},
        )).mappings().all()

        exchanges = [dict(r) for r in exc_rows]

        # ── 4. Run rules ──────────────────────────────────────────────────
        issues: list[dict[str, Any]] = []

        _check_no_processes(revision_id, processes, issues, validation_id)

        for process in processes:
            # Only validate foreground processes
            if process.get("system_boundary") == "background":
                continue
            _check_process_rules(process, exchanges, issues, validation_id)

        # ── 5. Insert issues ──────────────────────────────────────────────
        for issue in issues:
            await db.execute(
                text("""
                    INSERT INTO validation_issue
                      (issue_id, validation_id, severity, code, message,
                       process_id, exchange_id, suggestion)
                    VALUES
                      (:issue_id, :validation_id, :severity, :code, :message,
                       :process_id, :exchange_id, :suggestion)
                """),
                issue,
            )

        # ── 6. Mark run completed ─────────────────────────────────────────
        await db.execute(
            text("""
                UPDATE validation_run
                SET status      = 'completed',
                    issue_count = :cnt
                WHERE validation_id = :vid
            """),
            {"cnt": len(issues), "vid": str(validation_id)},
        )
        await db.commit()

        log.info(
            "validate: revision=%s validation=%s issues=%d",
            revision_id, validation_id, len(issues),
        )

        return ValidateResponse(
            validation_id=str(validation_id),
            revision_id=str(revision_id),
            status="completed",
            issue_count=len(issues),
        )

    except Exception as exc:
        log.exception("validate: failed for revision %s: %s", revision_id, exc)
        # Mark run as failed
        try:
            await db.execute(
                text("""
                    UPDATE validation_run
                    SET status = 'failed'
                    WHERE validation_id = :vid
                """),
                {"vid": str(validation_id)},
            )
            await db.commit()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Validation failed: {exc}") from exc
