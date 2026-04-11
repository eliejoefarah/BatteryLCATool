from __future__ import annotations

# =============================================================================
# bw_mapping_router.py — Battery LCA Tool
# =============================================================================
# Exposes two routers, both registered at /api/v1 in routers/__init__.py:
#
#   search_router  — GET  /api/v1/bw-search
#   mapping_router — POST   /api/v1/bw-mapping/confirm
#                    DELETE /api/v1/bw-mapping/confirm
#                    GET    /api/v1/bw-mapping/revision/{revision_id}
#
# Auth
# ────
# bw-search:  any authenticated user (Bearer JWT).
# bw-mapping: admin role only — checked via get_admin_user_id dependency.
#
# Both use the JWKS ES256 + HS256 fallback auth from import_router; the
# get_current_user_id function is imported directly to avoid duplication.
#
# Schema notes (migration 018)
# ────────────────────────────
# bw_mapping_selection now has:
#   • exchange_id  uuid UNIQUE FK → process_exchange  (new upsert key)
#   • flow_id / revision_id are now nullable
# process_exchange now has:
#   • mapping_status mapping_status_enum DEFAULT 'pending'
#
# The "selected_activity / selected_product / selected_location / selected_unit"
# legacy columns referenced in the original task spec do not exist in any
# migration and are therefore not set here.
# =============================================================================

import logging
import os
import uuid as _uuid
from datetime import datetime
from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.routers.import_router import get_current_user_id

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------


async def _update_revision_mapped_status(
    db: AsyncSession, exchange_ids: list[str]
) -> None:
    """Sync battery_model_revision.status for all revisions touched by these exchanges.

    After any mapping change (confirm / delete / skip / unskip) call this helper
    before the final db.commit().  It:
      • sets status = 'mapped'   when pending_count == 0 and status was 'unmapped'
      • sets status = 'unmapped' when pending_count  > 0 and status was 'mapped'
    """
    if not exchange_ids:
        return

    rev_rows = (await db.execute(
        text("""
            SELECT DISTINCT pi.revision_id
            FROM process_exchange pe
            JOIN process_instance pi ON pi.process_id = pe.process_id
            WHERE pe.exchange_id::text = ANY(:ids)
        """),
        {"ids": exchange_ids},
    )).fetchall()

    for (rid,) in rev_rows:
        pending_row = (await db.execute(
            text("""
                SELECT COUNT(*)
                FROM process_exchange pe
                JOIN process_instance pi ON pi.process_id = pe.process_id
                WHERE pi.revision_id = :rid
                  AND pe.exchange_direction = 'input'
                  AND pe.mapping_status = 'pending'
            """),
            {"rid": str(rid)},
        )).fetchone()
        pending_count = pending_row[0] if pending_row else 0

        if pending_count == 0:
            await db.execute(
                text("""
                    UPDATE battery_model_revision
                    SET status = 'mapped'
                    WHERE revision_id = :rid AND status = 'unmapped'
                """),
                {"rid": str(rid)},
            )
        else:
            await db.execute(
                text("""
                    UPDATE battery_model_revision
                    SET status = 'unmapped'
                    WHERE revision_id = :rid AND status = 'mapped'
                """),
                {"rid": str(rid)},
            )


async def get_admin_user_id(
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
) -> UUID:
    """Return user_id only when the caller holds the 'admin' role."""
    row = (await db.execute(
        text("SELECT role FROM app_user WHERE user_id = :uid"),
        {"uid": str(user_id)},
    )).fetchone()
    if not row or row[0] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user_id


# =============================================================================
# ROUTER 1 — bw-search
# =============================================================================

search_router = APIRouter(prefix="/bw-search", tags=["bw-mapping"])

# ---------------------------------------------------------------------------
# Response models (search)
# ---------------------------------------------------------------------------


class BwActivityResult(BaseModel):
    id: UUID
    activity_name: str
    reference_product: str | None
    location: str | None
    unit: str | None
    category: str | None
    ecoinvent_version: str
    system_model: str
    similarity_score: float


class BwSearchResponse(BaseModel):
    results: list[BwActivityResult]
    total_in_catalog: int
    catalog_seeded: bool


# ---------------------------------------------------------------------------
# Search constants
# ---------------------------------------------------------------------------

_SIMILARITY_THRESHOLD = 0.05
_DEFAULT_LIMIT = 10
_MAX_LIMIT = 25

# Combined-text expression — must match the GIN index in migration 016.
_COMBINED = (
    "activity_name || ' ' || coalesce(reference_product, '') || ' ' || coalesce(location, '')"
)


# ---------------------------------------------------------------------------
# GET /api/v1/bw-search
# ---------------------------------------------------------------------------


@search_router.get("", response_model=BwSearchResponse)
async def bw_search(
    q: str = Query(..., min_length=2, description="Free-text search query"),
    version: str | None = Query(
        default=None,
        description="Filter by ecoinvent_version (e.g. '3.10')",
    ),
    model: str | None = Query(
        default=None,
        description="Filter by system_model (e.g. 'cutoff')",
    ),
    limit: int = Query(
        default=_DEFAULT_LIMIT,
        ge=1,
        le=_MAX_LIMIT,
        description=f"Maximum results to return (1–{_MAX_LIMIT})",
    ),
    db: AsyncSession = Depends(get_db),
    _user_id: UUID = Depends(get_current_user_id),
) -> BwSearchResponse:
    # ── 1. Catalog size check (drives catalog_seeded flag) ────────────────
    count_row = (await db.execute(text("SELECT COUNT(*) FROM bw_activity_catalog"))).fetchone()
    total_in_catalog: int = count_row[0] if count_row else 0

    if total_in_catalog == 0:
        return BwSearchResponse(
            results=[],
            total_in_catalog=0,
            catalog_seeded=False,
        )

    # ── 2. Similarity search ──────────────────────────────────────────────
    filters: list[str] = [f"similarity({_COMBINED}, :q) > :threshold"]
    params: dict = {"q": q, "threshold": _SIMILARITY_THRESHOLD, "limit": limit}

    if version is not None:
        filters.append("ecoinvent_version = :version")
        params["version"] = version

    if model is not None:
        filters.append("system_model = :model")
        params["model"] = model

    where_clause = " AND ".join(filters)

    try:
        rows = (await db.execute(
            text(f"""
                SELECT
                    id,
                    activity_name,
                    reference_product,
                    location,
                    unit,
                    category,
                    ecoinvent_version,
                    system_model,
                    similarity({_COMBINED}, :q) AS similarity_score
                FROM bw_activity_catalog
                WHERE {where_clause}
                ORDER BY similarity_score DESC
                LIMIT :limit
            """),
            params,
        )).mappings().all()
    except Exception as exc:
        log.exception("bw_search: similarity query failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Catalog search failed. Ensure the pg_trgm extension is enabled.",
        ) from exc

    results = [
        BwActivityResult(
            id=row["id"],
            activity_name=row["activity_name"],
            reference_product=row["reference_product"],
            location=row["location"],
            unit=row["unit"],
            category=row["category"],
            ecoinvent_version=row["ecoinvent_version"],
            system_model=row["system_model"],
            similarity_score=float(row["similarity_score"]),
        )
        for row in rows
    ]

    return BwSearchResponse(
        results=results,
        total_in_catalog=total_in_catalog,
        catalog_seeded=True,
    )


# =============================================================================
# ROUTER 2 — bw-mapping  (admin only)
# =============================================================================

mapping_router = APIRouter(prefix="/bw-mapping", tags=["bw-mapping"])

# ---------------------------------------------------------------------------
# Shared models
# ---------------------------------------------------------------------------


class MappingRow(BaseModel):
    mapping_id: UUID
    exchange_id: UUID | None
    bw_catalog_id: UUID | None
    confirmed_activity_name: str | None
    confirmed_reference_product: str | None
    confirmed_location: str | None
    confirmed_unit: str | None
    confirmed_ecoinvent_version: str | None
    confirmed_system_model: str | None
    confirmed_by: UUID
    confirmed_at: datetime
    mapping_notes: str | None
    mapping_status: str


# ---------------------------------------------------------------------------
# Endpoint 3 — POST /api/v1/bw-mapping/confirm
# ---------------------------------------------------------------------------


class ManualOverride(BaseModel):
    activity_name: str
    reference_product: str | None = None
    location: str | None = None
    unit: str | None = None
    ecoinvent_version: str | None = None
    system_model: str | None = None


class ConfirmMappingRequest(BaseModel):
    revision_id: UUID
    raw_name: str
    unit: str | None = None
    direction: str | None = None
    catalog_id: UUID | None = None
    manual_override: ManualOverride | None = None
    mapping_notes: str | None = None
    scope: Literal["all", "revision"] = "all"

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "ConfirmMappingRequest":
        has_catalog = self.catalog_id is not None
        has_manual = self.manual_override is not None
        if has_catalog == has_manual:  # both set or neither set
            raise ValueError(
                "Exactly one of 'catalog_id' or 'manual_override' must be provided."
            )
        return self


class ConfirmMappingResponse(BaseModel):
    exchanges_updated: int
    scope: str
    mapping: MappingRow


@mapping_router.post("/confirm", response_model=ConfirmMappingResponse)
async def confirm_mapping(
    body: ConfirmMappingRequest,
    db: AsyncSession = Depends(get_db),
    admin_id: UUID = Depends(get_admin_user_id),
) -> ConfirmMappingResponse:
    # ── 1. Resolve confirmed_* values from catalog or manual override ─────
    if body.catalog_id is not None:
        cat_row = (await db.execute(
            text("""
                SELECT activity_name, reference_product, location, unit,
                       ecoinvent_version, system_model
                FROM bw_activity_catalog
                WHERE id = :cid
            """),
            {"cid": str(body.catalog_id)},
        )).mappings().fetchone()
        if cat_row is None:
            raise HTTPException(
                status_code=404,
                detail=f"bw_activity_catalog entry not found: {body.catalog_id}",
            )
        c_activity   = cat_row["activity_name"]
        c_product    = cat_row["reference_product"]
        c_location   = cat_row["location"]
        c_unit       = cat_row["unit"]
        c_version    = cat_row["ecoinvent_version"]
        c_model      = cat_row["system_model"]
        bw_catalog_id = str(body.catalog_id)
    else:
        ov = body.manual_override  # type: ignore[union-attr]
        c_activity   = ov.activity_name
        c_product    = ov.reference_product
        c_location   = ov.location
        c_unit       = ov.unit
        c_version    = ov.ecoinvent_version
        c_model      = ov.system_model
        bw_catalog_id = None

    # ── 2. Find matching exchanges — scope controls which revisions ──────────
    exc_filters = ["lower(pe.raw_name) = lower(:raw_name)"]
    exc_params: dict = {"raw_name": body.raw_name}

    if body.unit is not None:
        exc_filters.append("lower(pe.user_unit) = lower(:unit)")
        exc_params["unit"] = body.unit

    if body.direction is not None:
        exc_filters.append("pe.exchange_direction = :direction")
        exc_params["direction"] = body.direction

    if body.scope == "revision":
        exc_filters.append("pi.revision_id = :revision_id")
        exc_params["revision_id"] = str(body.revision_id)

    where_exc = " AND ".join(exc_filters)

    exc_rows = (await db.execute(
        text(f"""
            SELECT pe.exchange_id, pe.flow_id, pi.revision_id
            FROM process_exchange pe
            JOIN process_instance pi ON pi.process_id = pe.process_id
            WHERE {where_exc}
        """),
        exc_params,
    )).mappings().all()

    if not exc_rows:
        raise HTTPException(
            status_code=404,
            detail="No matching exchanges found for the given raw_name / unit / direction.",
        )

    # ── 3. Upsert one bw_mapping_selection row per exchange ───────────────
    first_mapping_id: str | None = None

    for exc in exc_rows:
        mid = str(_uuid.uuid4())
        if first_mapping_id is None:
            first_mapping_id = mid

        await db.execute(
            text("""
                INSERT INTO bw_mapping_selection (
                    mapping_id,
                    exchange_id,
                    flow_id,
                    revision_id,
                    bw_catalog_id,
                    confirmed_activity_name,
                    confirmed_reference_product,
                    confirmed_location,
                    confirmed_unit,
                    confirmed_ecoinvent_version,
                    confirmed_system_model,
                    confirmed_by,
                    confirmed_at,
                    mapping_notes,
                    mapping_status,
                    candidate_id
                )
                VALUES (
                    :mapping_id,
                    :exchange_id,
                    :flow_id,
                    :revision_id,
                    :bw_catalog_id,
                    :activity_name,
                    :reference_product,
                    :location,
                    :unit,
                    :ecoinvent_version,
                    :system_model,
                    :confirmed_by,
                    now(),
                    :mapping_notes,
                    'mapped',
                    NULL
                )
                ON CONFLICT (exchange_id) WHERE exchange_id IS NOT NULL DO UPDATE SET
                    bw_catalog_id              = EXCLUDED.bw_catalog_id,
                    confirmed_activity_name    = EXCLUDED.confirmed_activity_name,
                    confirmed_reference_product= EXCLUDED.confirmed_reference_product,
                    confirmed_location         = EXCLUDED.confirmed_location,
                    confirmed_unit             = EXCLUDED.confirmed_unit,
                    confirmed_ecoinvent_version= EXCLUDED.confirmed_ecoinvent_version,
                    confirmed_system_model     = EXCLUDED.confirmed_system_model,
                    confirmed_by               = EXCLUDED.confirmed_by,
                    confirmed_at               = EXCLUDED.confirmed_at,
                    mapping_notes              = EXCLUDED.mapping_notes,
                    mapping_status             = 'mapped'
            """),
            {
                "mapping_id":        mid,
                "exchange_id":       str(exc["exchange_id"]),
                "flow_id":           str(exc["flow_id"]) if exc["flow_id"] else None,
                "revision_id":       str(exc["revision_id"]),
                "bw_catalog_id":     bw_catalog_id,
                "activity_name":     c_activity,
                "reference_product": c_product,
                "location":          c_location,
                "unit":              c_unit,
                "ecoinvent_version": c_version,
                "system_model":      c_model,
                "confirmed_by":      str(admin_id),
                "mapping_notes":     body.mapping_notes,
            },
        )

    # ── 4. Update process_exchange.mapping_status ─────────────────────────
    exchange_ids = [str(r["exchange_id"]) for r in exc_rows]
    await db.execute(
        text("""
            UPDATE process_exchange
            SET mapping_status = 'mapped'
            WHERE exchange_id::text = ANY(:ids)
        """),
        {"ids": exchange_ids},
    )

    # ── 4b. Sync revision status (unmapped → mapped if all resolved) ───────
    await _update_revision_mapped_status(db, exchange_ids)

    await db.commit()

    # ── 5. Fetch the saved mapping row to return ──────────────────────────
    saved = (await db.execute(
        text("""
            SELECT mapping_id, exchange_id, bw_catalog_id,
                   confirmed_activity_name, confirmed_reference_product,
                   confirmed_location, confirmed_unit,
                   confirmed_ecoinvent_version, confirmed_system_model,
                   confirmed_by, confirmed_at, mapping_notes, mapping_status
            FROM bw_mapping_selection
            WHERE exchange_id = :eid
        """),
        {"eid": str(exc_rows[0]["exchange_id"])},
    )).mappings().fetchone()

    if saved is None:
        raise HTTPException(status_code=500, detail="Mapping upsert succeeded but row not found.")

    return ConfirmMappingResponse(
        exchanges_updated=len(exc_rows),
        scope=body.scope,
        mapping=MappingRow(
            mapping_id=saved["mapping_id"],
            exchange_id=saved["exchange_id"],
            bw_catalog_id=saved["bw_catalog_id"],
            confirmed_activity_name=saved["confirmed_activity_name"],
            confirmed_reference_product=saved["confirmed_reference_product"],
            confirmed_location=saved["confirmed_location"],
            confirmed_unit=saved["confirmed_unit"],
            confirmed_ecoinvent_version=saved["confirmed_ecoinvent_version"],
            confirmed_system_model=saved["confirmed_system_model"],
            confirmed_by=saved["confirmed_by"],
            confirmed_at=saved["confirmed_at"],
            mapping_notes=saved["mapping_notes"],
            mapping_status=saved["mapping_status"],
        ),
    )


# ---------------------------------------------------------------------------
# Endpoint 4 — DELETE /api/v1/bw-mapping/confirm
# ---------------------------------------------------------------------------


class DeleteMappingRequest(BaseModel):
    raw_name: str
    unit: str | None = None
    direction: str | None = None


class DeleteMappingResponse(BaseModel):
    exchanges_updated: int


@mapping_router.delete("/confirm", response_model=DeleteMappingResponse)
async def delete_mapping(
    body: DeleteMappingRequest = Body(...),
    db: AsyncSession = Depends(get_db),
    _admin_id: UUID = Depends(get_admin_user_id),
) -> DeleteMappingResponse:
    # ── 1. Find all matching exchanges (system-wide) ──────────────────────
    exc_filters = ["lower(pe.raw_name) = lower(:raw_name)"]
    exc_params: dict = {"raw_name": body.raw_name}

    if body.unit is not None:
        exc_filters.append("lower(pe.user_unit) = lower(:unit)")
        exc_params["unit"] = body.unit

    if body.direction is not None:
        exc_filters.append("pe.exchange_direction = :direction")
        exc_params["direction"] = body.direction

    where_exc = " AND ".join(exc_filters)

    exc_rows = (await db.execute(
        text(f"""
            SELECT pe.exchange_id
            FROM process_exchange pe
            WHERE {where_exc}
        """),
        exc_params,
    )).fetchall()

    if not exc_rows:
        return DeleteMappingResponse(exchanges_updated=0)

    exchange_ids = [str(r[0]) for r in exc_rows]

    # ── 2. Delete mapping selection rows ─────────────────────────────────
    await db.execute(
        text("""
            DELETE FROM bw_mapping_selection
            WHERE exchange_id::text = ANY(:ids)
        """),
        {"ids": exchange_ids},
    )

    # ── 3. Reset process_exchange.mapping_status to 'pending' ─────────────
    await db.execute(
        text("""
            UPDATE process_exchange
            SET mapping_status = 'pending'
            WHERE exchange_id::text = ANY(:ids)
        """),
        {"ids": exchange_ids},
    )

    # ── 3b. Sync revision status (mapped → unmapped if no longer all resolved)
    await _update_revision_mapped_status(db, exchange_ids)

    await db.commit()

    return DeleteMappingResponse(exchanges_updated=len(exchange_ids))


# ---------------------------------------------------------------------------
# Endpoint 5 — GET /api/v1/bw-mapping/revision/{revision_id}
# ---------------------------------------------------------------------------


class FlowMappingGroup(BaseModel):
    raw_name: str | None
    unit: str | None
    direction: str
    exchange_count: int
    mapping_status: str           # 'mapped' | 'pending' | 'skipped'
    mapping: MappingRow | None
    also_mapped_in_other_revisions: bool


class RevisionMappingResponse(BaseModel):
    revision_id: UUID
    total_input_flows: int
    mapped_flows: int
    skipped_flows: int
    pending_flows: int
    ready_for_export: bool
    flows: list[FlowMappingGroup]


@mapping_router.get("/revision/{revision_id}", response_model=RevisionMappingResponse)
async def get_revision_mapping(
    revision_id: UUID,
    db: AsyncSession = Depends(get_db),
    _admin_id: UUID = Depends(get_admin_user_id),
) -> RevisionMappingResponse:
    try:
        return await _get_revision_mapping_inner(revision_id, db)
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("get_revision_mapping failed for %s: %s", revision_id, exc)
        raise HTTPException(status_code=500, detail=f"Revision mapping failed: {exc!r}") from exc


async def _get_revision_mapping_inner(
    revision_id: UUID,
    db: AsyncSession,
) -> RevisionMappingResponse:
    # ── 1. Verify revision exists ─────────────────────────────────────────
    rev_row = (await db.execute(
        text("SELECT 1 FROM battery_model_revision WHERE revision_id = :rid"),
        {"rid": str(revision_id)},
    )).fetchone()
    if rev_row is None:
        raise HTTPException(status_code=404, detail="Revision not found.")

    # ── 2. Aggregate input flow groups for this revision ──────────────────
    # BOOL_AND(mapping_status = 'mapped') is true only when every exchange in
    # the group has already been confirmed. MIN(exchange_id) gives a stable
    # representative to join against bw_mapping_selection.
    group_rows = (await db.execute(
        text("""
            SELECT
                pe.raw_name,
                pe.user_unit                                       AS unit,
                pe.exchange_direction                              AS direction,
                COUNT(*)                                           AS exchange_count,
                BOOL_AND(pe.mapping_status IN ('mapped', 'unmappable')) AS all_resolved,
                BOOL_AND(pe.mapping_status = 'unmappable')        AS all_skipped,
                MIN(pe.exchange_id::text)                         AS sample_exchange_id
            FROM process_exchange pe
            JOIN process_instance pi ON pi.process_id = pe.process_id
            WHERE pi.revision_id = :rid
              AND pe.exchange_direction = 'input'
            GROUP BY pe.raw_name, pe.user_unit, pe.exchange_direction
            ORDER BY all_resolved ASC, pe.raw_name
        """),
        {"rid": str(revision_id)},
    )).mappings().all()

    if not group_rows:
        return RevisionMappingResponse(
            revision_id=revision_id,
            total_input_flows=0,
            mapped_flows=0,
            skipped_flows=0,
            pending_flows=0,
            ready_for_export=True,
            flows=[],
        )

    # ── 3. Bulk-fetch mapping rows for all sample exchange IDs ────────────
    sample_ids = [str(r["sample_exchange_id"]) for r in group_rows if r["sample_exchange_id"]]
    mapping_by_exchange: dict[str, dict] = {}

    if sample_ids:
        m_rows = (await db.execute(
            text("""
                SELECT mapping_id, exchange_id, bw_catalog_id,
                       confirmed_activity_name, confirmed_reference_product,
                       confirmed_location, confirmed_unit,
                       confirmed_ecoinvent_version, confirmed_system_model,
                       confirmed_by, confirmed_at, mapping_notes, mapping_status
                FROM bw_mapping_selection
                WHERE exchange_id::text = ANY(:ids)
            """),
            {"ids": sample_ids},
        )).mappings().all()
        mapping_by_exchange = {str(r["exchange_id"]): dict(r) for r in m_rows}

    # ── 4. Collect raw_names for cross-revision check ─────────────────────
    # One query: for each distinct raw_name, does a confirmed mapping exist
    # in any OTHER revision?
    raw_names = list({r["raw_name"] for r in group_rows if r["raw_name"]})
    also_mapped_elsewhere: set[str] = set()

    if raw_names:
        other_rows = (await db.execute(
            text("""
                SELECT DISTINCT pe.raw_name
                FROM process_exchange pe
                JOIN process_instance pi ON pi.process_id = pe.process_id
                JOIN bw_mapping_selection bms ON bms.exchange_id = pe.exchange_id
                WHERE lower(pe.raw_name) = ANY(:names)
                  AND pi.revision_id != :rid
                  AND bms.mapping_status = 'mapped'
            """),
            {
                "names": [n.lower() for n in raw_names],
                "rid":   str(revision_id),
            },
        )).fetchall()
        also_mapped_elsewhere = {r[0].lower() for r in other_rows if r[0]}

    # ── 5. Assemble response ──────────────────────────────────────────────
    flows: list[FlowMappingGroup] = []
    mapped_count = 0
    skipped_count = 0
    pending_count = 0

    for row in group_rows:
        if row["all_skipped"]:
            group_status = "skipped"
            skipped_count += 1
        elif row["all_resolved"]:
            group_status = "mapped"
            mapped_count += 1
        else:
            group_status = "pending"
            pending_count += 1

        sample_id = str(row["sample_exchange_id"]) if row["sample_exchange_id"] else None
        m_data = mapping_by_exchange.get(sample_id) if sample_id else None

        mapping_model: MappingRow | None = None
        if m_data:
            mapping_model = MappingRow(
                mapping_id=m_data["mapping_id"],
                exchange_id=m_data["exchange_id"],
                bw_catalog_id=m_data["bw_catalog_id"],
                confirmed_activity_name=m_data["confirmed_activity_name"],
                confirmed_reference_product=m_data["confirmed_reference_product"],
                confirmed_location=m_data["confirmed_location"],
                confirmed_unit=m_data["confirmed_unit"],
                confirmed_ecoinvent_version=m_data["confirmed_ecoinvent_version"],
                confirmed_system_model=m_data["confirmed_system_model"],
                confirmed_by=m_data["confirmed_by"],
                confirmed_at=m_data["confirmed_at"],
                mapping_notes=m_data["mapping_notes"],
                mapping_status=m_data["mapping_status"],
            )

        raw = row["raw_name"] or ""
        flows.append(FlowMappingGroup(
            raw_name=row["raw_name"],
            unit=row["unit"],
            direction=row["direction"],
            exchange_count=int(row["exchange_count"]),
            mapping_status=group_status,
            mapping=mapping_model,
            also_mapped_in_other_revisions=(raw.lower() in also_mapped_elsewhere),
        ))

    total = len(flows)
    return RevisionMappingResponse(
        revision_id=revision_id,
        total_input_flows=total,
        mapped_flows=mapped_count,
        skipped_flows=skipped_count,
        pending_flows=pending_count,
        ready_for_export=(pending_count == 0),
        flows=flows,
    )


# ---------------------------------------------------------------------------
# Endpoint 6 — POST /api/v1/bw-mapping/skip
# ---------------------------------------------------------------------------


class SkipFlowRequest(BaseModel):
    revision_id: UUID
    raw_name: str
    unit: str | None = None
    direction: str | None = None
    scope: Literal["all", "revision"] = "all"


class SkipFlowResponse(BaseModel):
    exchanges_updated: int
    scope: str


@mapping_router.post("/skip", response_model=SkipFlowResponse)
async def skip_flow(
    body: SkipFlowRequest,
    db: AsyncSession = Depends(get_db),
    _admin_id: UUID = Depends(get_admin_user_id),
) -> SkipFlowResponse:
    """Mark all matching input exchanges as 'unmappable' so they are included
    in the export as-is (manufacturer value) without a Brightway activity link.
    They count as resolved for the purpose of ready_for_export."""
    exc_filters = ["lower(pe.raw_name) = lower(:raw_name)"]
    exc_params: dict = {"raw_name": body.raw_name}

    if body.unit is not None:
        exc_filters.append("lower(pe.user_unit) = lower(:unit)")
        exc_params["unit"] = body.unit

    if body.direction is not None:
        exc_filters.append("pe.exchange_direction = :direction")
        exc_params["direction"] = body.direction

    if body.scope == "revision":
        exc_filters.append("pi.revision_id = :revision_id")
        exc_params["revision_id"] = str(body.revision_id)

    where_exc = " AND ".join(exc_filters)

    exc_rows = (await db.execute(
        text(f"""
            SELECT pe.exchange_id
            FROM process_exchange pe
            JOIN process_instance pi ON pi.process_id = pe.process_id
            WHERE {where_exc}
        """),
        exc_params,
    )).fetchall()

    if not exc_rows:
        raise HTTPException(
            status_code=404,
            detail="No matching exchanges found.",
        )

    exchange_ids = [str(r[0]) for r in exc_rows]

    # Remove any existing bw_mapping_selection rows so the flow is cleanly skipped
    await db.execute(
        text("DELETE FROM bw_mapping_selection WHERE exchange_id::text = ANY(:ids)"),
        {"ids": exchange_ids},
    )

    await db.execute(
        text("""
            UPDATE process_exchange
            SET mapping_status = 'unmappable'
            WHERE exchange_id::text = ANY(:ids)
        """),
        {"ids": exchange_ids},
    )

    # Sync revision status (unmapped → mapped if all resolved)
    await _update_revision_mapped_status(db, exchange_ids)

    await db.commit()

    return SkipFlowResponse(exchanges_updated=len(exchange_ids), scope=body.scope)


# ---------------------------------------------------------------------------
# Endpoint 7 — DELETE /api/v1/bw-mapping/skip  (un-skip → reset to pending)
# ---------------------------------------------------------------------------


@mapping_router.delete("/skip", response_model=DeleteMappingResponse)
async def unskip_flow(
    body: DeleteMappingRequest = Body(...),
    db: AsyncSession = Depends(get_db),
    _admin_id: UUID = Depends(get_admin_user_id),
) -> DeleteMappingResponse:
    exc_filters = ["lower(pe.raw_name) = lower(:raw_name)"]
    exc_params: dict = {"raw_name": body.raw_name}

    if body.unit is not None:
        exc_filters.append("lower(pe.user_unit) = lower(:unit)")
        exc_params["unit"] = body.unit

    if body.direction is not None:
        exc_filters.append("pe.exchange_direction = :direction")
        exc_params["direction"] = body.direction

    where_exc = " AND ".join(exc_filters)

    exc_rows = (await db.execute(
        text(f"""
            SELECT pe.exchange_id FROM process_exchange pe
            WHERE {where_exc}
        """),
        exc_params,
    )).fetchall()

    if not exc_rows:
        return DeleteMappingResponse(exchanges_updated=0)

    exchange_ids = [str(r[0]) for r in exc_rows]

    await db.execute(
        text("""
            UPDATE process_exchange
            SET mapping_status = 'pending'
            WHERE exchange_id::text = ANY(:ids)
        """),
        {"ids": exchange_ids},
    )

    # Sync revision status (mapped → unmapped if no longer all resolved)
    await _update_revision_mapped_status(db, exchange_ids)

    await db.commit()
    return DeleteMappingResponse(exchanges_updated=len(exchange_ids))


# ---------------------------------------------------------------------------
# Endpoint 8 — GET /api/v1/bw-mapping/bulk-summary
# ---------------------------------------------------------------------------


class RevisionMappingSummary(BaseModel):
    revision_id: UUID
    total_input_flows: int
    mapped_flows: int
    skipped_flows: int
    pending_flows: int
    ready_for_export: bool


@mapping_router.get("/bulk-summary", response_model=list[RevisionMappingSummary])
async def bulk_mapping_summary(
    revision_ids: str = Query(..., description="Comma-separated revision UUIDs"),
    db: AsyncSession = Depends(get_db),
    _admin_id: UUID = Depends(get_admin_user_id),
) -> list[RevisionMappingSummary]:
    """Return per-revision mapping progress counts for a list of revisions.
    Used by the FlowMappingPage to show Begin / Continue / Double Check state."""
    ids = [r.strip() for r in revision_ids.split(",") if r.strip()]
    if not ids:
        return []

    rows = (await db.execute(
        text("""
            SELECT
                pi.revision_id,
                COUNT(DISTINCT (pe.raw_name, pe.user_unit, pe.exchange_direction)) AS total_groups,
                COUNT(DISTINCT CASE
                    WHEN pe.mapping_status = 'mapped'
                    THEN (pe.raw_name, pe.user_unit, pe.exchange_direction)
                END) AS mapped_groups,
                COUNT(DISTINCT CASE
                    WHEN pe.mapping_status = 'unmappable'
                    THEN (pe.raw_name, pe.user_unit, pe.exchange_direction)
                END) AS skipped_groups,
                COUNT(DISTINCT CASE
                    WHEN pe.mapping_status = 'pending'
                    THEN (pe.raw_name, pe.user_unit, pe.exchange_direction)
                END) AS pending_groups
            FROM process_exchange pe
            JOIN process_instance pi ON pi.process_id = pe.process_id
            WHERE pi.revision_id::text = ANY(:ids)
              AND pe.exchange_direction = 'input'
            GROUP BY pi.revision_id
        """),
        {"ids": ids},
    )).mappings().all()

    by_rev = {str(r["revision_id"]): r for r in rows}

    result = []
    for rid in ids:
        r = by_rev.get(rid)
        if r is None:
            result.append(RevisionMappingSummary(
                revision_id=UUID(rid),
                total_input_flows=0,
                mapped_flows=0,
                skipped_flows=0,
                pending_flows=0,
                ready_for_export=True,
            ))
        else:
            pending = int(r["pending_groups"])
            result.append(RevisionMappingSummary(
                revision_id=UUID(rid),
                total_input_flows=int(r["total_groups"]),
                mapped_flows=int(r["mapped_groups"]),
                skipped_flows=int(r["skipped_groups"]),
                pending_flows=pending,
                ready_for_export=(pending == 0),
            ))
    return result


# =============================================================================
# ROUTER 3 — bw-suggest  (admin only, requires ANTHROPIC_API_KEY)
# =============================================================================

suggest_router = APIRouter(prefix="/bw-suggest", tags=["bw-mapping"])

_ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
_SUGGEST_CATALOG_LIMIT = 20


class BwSuggestRequest(BaseModel):
    raw_name: str
    unit: str | None = None
    direction: str | None = None
    revision_id: str | None = None


class BwSuggestResponse(BaseModel):
    results: list[BwActivityResult]
    suggested_queries: list[str] | None = None


@suggest_router.post("", response_model=BwSuggestResponse)
async def bw_suggest(
    body: BwSuggestRequest,
    db: AsyncSession = Depends(get_db),
    _admin_id: UUID = Depends(get_admin_user_id),
) -> BwSuggestResponse:
    """AI-powered mapping suggestions using Claude.
    Returns 503 when ANTHROPIC_API_KEY is not configured so the frontend
    can hide the AI Suggest button gracefully.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI suggestions are not available (ANTHROPIC_API_KEY not configured).",
        )

    # ── 1. Fetch top catalog candidates via similarity search ─────────────
    count_row = (await db.execute(text("SELECT COUNT(*) FROM bw_activity_catalog"))).fetchone()
    total_in_catalog: int = count_row[0] if count_row else 0

    if total_in_catalog == 0:
        raise HTTPException(status_code=503, detail="Brightway activity catalog is not seeded.")

    combined = (
        "activity_name || ' ' || coalesce(reference_product, '') || ' ' || coalesce(location, '')"
    )
    params: dict = {"q": body.raw_name, "threshold": 0.05, "limit": _SUGGEST_CATALOG_LIMIT}

    cand_rows = (await db.execute(
        text(f"""
            SELECT id, activity_name, reference_product, location, unit,
                   category, ecoinvent_version, system_model,
                   similarity({combined}, :q) AS similarity_score
            FROM bw_activity_catalog
            WHERE similarity({combined}, :q) > :threshold
            ORDER BY similarity_score DESC
            LIMIT :limit
        """),
        params,
    )).mappings().all()

    if not cand_rows:
        return BwSuggestResponse(results=[], suggested_queries=None)

    # ── 2. Ask Claude to rank and explain the best matches ────────────────
    catalog_lines = "\n".join(
        f"{i + 1}. [{r['id']}] {r['activity_name']}"
        f"{' | ' + r['reference_product'] if r['reference_product'] else ''}"
        f"{' | ' + r['location'] if r['location'] else ''}"
        f"{' | ' + r['unit'] if r['unit'] else ''}"
        f" (score={r['similarity_score']:.2f})"
        for i, r in enumerate(cand_rows)
    )

    unit_hint = f" measured in {body.unit}" if body.unit else ""
    direction_hint = f" ({body.direction} flow)" if body.direction else ""

    prompt = (
        f"I am mapping foreground LCA flows to Brightway ecoinvent background activities.\n\n"
        f"Flow to map: \"{body.raw_name}\"{unit_hint}{direction_hint}\n\n"
        f"Candidate activities from the catalog (ranked by text similarity):\n"
        f"{catalog_lines}\n\n"
        f"Task:\n"
        f"1. Return the IDs of the top 5 best-matching activities, best first. "
        f"Only include genuinely good matches; fewer is fine if the rest are poor.\n"
        f"2. Suggest up to 3 alternative search queries (short phrases, no explanation) "
        f"that might find better matches if none of the above are ideal.\n\n"
        f"Respond ONLY with valid JSON in this exact shape (no markdown, no extra text):\n"
        f'{{"ranked_ids": ["<uuid>", ...], "suggested_queries": ["...", ...]}}'
    )

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                _ANTHROPIC_API_URL,
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 256,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            claude_body = resp.json()
    except httpx.HTTPStatusError as exc:
        log.exception("Claude API returned %s", exc.response.status_code)
        raise HTTPException(
            status_code=502,
            detail=f"AI service returned an error ({exc.response.status_code}).",
        ) from exc
    except Exception as exc:
        log.exception("Claude API call failed: %s", exc)
        raise HTTPException(status_code=502, detail="AI service unavailable.") from exc

    # ── 3. Parse Claude's response ────────────────────────────────────────
    import json as _json

    raw_text = claude_body.get("content", [{}])[0].get("text", "")
    try:
        parsed = _json.loads(raw_text)
        ranked_ids: list[str] = parsed.get("ranked_ids", [])
        suggested_queries: list[str] = parsed.get("suggested_queries", [])
    except Exception:
        log.warning("bw_suggest: could not parse Claude response: %r", raw_text)
        # Fall back to returning the top similarity results
        ranked_ids = [str(r["id"]) for r in cand_rows[:5]]
        suggested_queries = []

    # ── 4. Return catalog rows in Claude's ranked order ───────────────────
    cand_by_id = {str(r["id"]): r for r in cand_rows}
    results: list[BwActivityResult] = []

    for rid in ranked_ids:
        row = cand_by_id.get(rid)
        if row:
            results.append(
                BwActivityResult(
                    id=row["id"],
                    activity_name=row["activity_name"],
                    reference_product=row["reference_product"],
                    location=row["location"],
                    unit=row["unit"],
                    category=row["category"],
                    ecoinvent_version=row["ecoinvent_version"],
                    system_model=row["system_model"],
                    similarity_score=float(row["similarity_score"]),
                )
            )

    return BwSuggestResponse(
        results=results,
        suggested_queries=suggested_queries if suggested_queries else None,
    )
