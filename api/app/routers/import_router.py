from __future__ import annotations

# =============================================================================
# import_router.py — Battery LCA Tool
# =============================================================================
# POST /import/{revision_id}
#
# Accepts a multipart xlsx upload, verifies the caller's Supabase JWT,
# uploads the file to Supabase Storage, creates an artifact row, then runs
# the import pipeline (import_service.run_import).
#
# Double-import guard
# ───────────────────
# If the revision already has process data, the endpoint returns HTTP 409.
# The caller can re-POST with ?force=true to delete the previous data and
# re-import.
#
# Storage
# ───────
# Files are stored at:
#   lca-files/projects/{project_id}/revisions/{revision_id}/imports/{ts}_{artifact_id}.xlsx
# The key is generated server-side: the client's filename is only kept as a
# sanitized display name (artifact.filename), never used in the path.
# If the Storage upload fails (e.g. bucket not yet created), the import still
# proceeds and the response will have artifact_id=null and a warning.
#
# Auth
# ────
# app.auth.get_active_user_id: valid Supabase JWT and an active account.
# =============================================================================

import hashlib
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_active_user_id
from app.db import get_db, get_service_role_client
from app.models.import_models import BatchImportResult
from app.services.import_service import run_import

log = logging.getLogger(__name__)

router = APIRouter(prefix="/import", tags=["import"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_STORAGE_BUCKET = "lca-files"
_MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

# The single DEFAULT catalog set seeded by 003_seed.sql.
_DEFAULT_CATALOG_ID = UUID("00000000-0000-0000-0001-000000000001")

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# ---------------------------------------------------------------------------
# Response model
# ---------------------------------------------------------------------------


class ImportJobResponse(BaseModel):
    """Returned by POST /import/{revision_id} on success (HTTP 200)."""

    import_id: UUID | None
    revision_id: UUID
    status: str                  # 'completed' | 'failed'
    activities_created: int
    exchanges_created: int
    parameters_created: int
    warnings_count: int
    errors_count: int
    warnings: list[str]
    errors: list[str]
    artifact_id: UUID | None = None
    storage_path: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_display_name(name: str | None) -> str:
    """Reduce a client-supplied upload filename to a harmless display label.

    Keeps only the final path component (so '../../x.xlsx' or 'a\\b.xlsx'
    can't smuggle path segments), replaces anything outside a conservative
    character set, and caps the length. Never used to build a storage path.
    """
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    # \w is Unicode-aware, so accented names (é, ë, ...) survive; control
    # characters, quotes, <>, etc. become "_".
    base = re.sub(r"[^\w.() -]", "_", base).strip(" .")
    if len(base) > 120:
        stem, ext = os.path.splitext(base)
        base = stem[: 120 - len(ext)] + ext
    return base or "import.xlsx"


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


async def _authorize_revision_write(
    db: AsyncSession, revision_id: UUID, user_id: UUID
) -> tuple[UUID, bool]:
    """Allow writing a revision's process data on the same terms as RLS.

    This router connects as the table owner, so RLS doesn't apply and the
    rule from 008_revision_owner_rls.sql is enforced here instead: admins may
    write any revision; otherwise the caller must be a project member, the
    revision's creator, and the revision must not be frozen.

    Locks the revision row (FOR UPDATE) for the rest of the transaction, so a
    concurrent freeze can't land between this check and the writes.
    Returns (project_id, caller_is_admin).
    """
    row = (await db.execute(
        text("""
            SELECT bm.project_id, r.created_by, r.frozen_at,
                   (SELECT role FROM app_user WHERE user_id = :uid) AS role,
                   EXISTS (
                       SELECT 1 FROM project_member pm
                       WHERE pm.project_id = bm.project_id AND pm.user_id = :uid
                   ) AS is_member
            FROM battery_model_revision r
            JOIN battery_model bm ON bm.model_id = r.model_id
            WHERE r.revision_id = :rid
            FOR UPDATE OF r
        """),
        {"rid": str(revision_id), "uid": str(user_id)},
    )).fetchone()

    if row is None or not (row.is_member or row.role == "admin"):
        raise HTTPException(
            status_code=404,
            detail="Revision not found or you do not have access to this project.",
        )
    if row.role != "admin":
        if row.frozen_at is not None:
            # 423, not 409: the frontend treats 409 as "already imported,
            # offer to overwrite", which would be wrong here.
            raise HTTPException(
                status_code=423,
                detail="This revision is frozen and can no longer be changed.",
            )
        if str(row.created_by) != str(user_id):
            raise HTTPException(
                status_code=403,
                detail="Only the revision's creator can change its data.",
            )
    return UUID(str(row.project_id)), row.role == "admin"


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@router.delete("/{revision_id}", status_code=204)
async def clear_import_data(
    revision_id: UUID,
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_active_user_id),
) -> None:
    """Remove all imported processes, exchanges, and parameters for a revision.

    Called by the frontend when the user chooses 'Undo import' after reviewing
    import issues. Same access rule as RLS: see _authorize_revision_write.
    """
    await _authorize_revision_write(db, revision_id, user_id)

    # Delete validation data first (FK: validation_issue.exchange_id → process_exchange)
    await db.execute(
        text("""
            DELETE FROM validation_issue
            WHERE exchange_id IN (
                SELECT exchange_id FROM process_exchange
                WHERE process_id IN (
                    SELECT process_id FROM process_instance WHERE revision_id = :rid
                )
            )
        """),
        {"rid": str(revision_id)},
    )
    await db.execute(
        text("""
            DELETE FROM validation_issue
            WHERE validation_id IN (
                SELECT validation_id FROM validation_run WHERE revision_id = :rid
            )
        """),
        {"rid": str(revision_id)},
    )
    await db.execute(
        text("DELETE FROM validation_run WHERE revision_id = :rid"),
        {"rid": str(revision_id)},
    )
    await db.execute(
        text("""
            DELETE FROM process_exchange
            WHERE process_id IN (
                SELECT process_id FROM process_instance WHERE revision_id = :rid
            )
        """),
        {"rid": str(revision_id)},
    )
    await db.execute(
        text("DELETE FROM process_instance WHERE revision_id = :rid"),
        {"rid": str(revision_id)},
    )
    await db.execute(
        text("DELETE FROM model_parameter WHERE revision_id = :rid"),
        {"rid": str(revision_id)},
    )
    await db.commit()


@router.post("/{revision_id}", response_model=ImportJobResponse)
async def upload_and_import(
    revision_id: UUID,
    file: UploadFile = File(..., description="xlsx file to import (max 50 MB)"),
    force: bool = Query(
        default=False,
        description="If true, delete existing process data and re-import.",
    ),
    catalog_set_id: UUID = Query(
        default=_DEFAULT_CATALOG_ID,
        description="Flow catalog set to use for this import.",
    ),
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_active_user_id),
) -> ImportJobResponse:
    # ── 1. Validate file type and size ────────────────────────────────────
    filename = _safe_display_name(file.filename)
    content_type = file.content_type or ""
    if content_type not in (_XLSX_MIME, "application/octet-stream") and not filename.endswith(".xlsx"):
        raise HTTPException(
            status_code=415,
            detail="Only .xlsx files are accepted.",
        )

    content = await file.read()
    if len(content) > _MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large — maximum size is {_MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    # ── 2. Verify the caller may write this revision (same rule as RLS) ───
    project_id, is_admin = await _authorize_revision_write(db, revision_id, user_id)

    # ── 3. Upload xlsx to Supabase Storage ────────────────────────────────
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    new_artifact_id = uuid.uuid4()
    storage_path = (
        f"projects/{project_id}/revisions/{revision_id}"
        f"/imports/{timestamp}_{new_artifact_id}.xlsx"
    )
    artifact_id: UUID | None = None
    upload_ok = False

    try:
        sb = get_service_role_client()
        sb.storage.from_(_STORAGE_BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"content-type": _XLSX_MIME},
        )
        upload_ok = True
        log.info("Uploaded %s to storage at %s", filename, storage_path)
    except Exception as exc:
        log.warning(
            "Storage upload failed for revision %s (import will proceed): %s",
            revision_id, exc,
        )
        storage_path = None

    # ── 4. Insert artifact row (only if storage upload succeeded) ─────────
    if upload_ok:
        artifact_id = new_artifact_id
        sha256 = hashlib.sha256(content).hexdigest()
        await db.execute(
            text("""
                INSERT INTO artifact
                  (artifact_id, revision_id, artifact_type, filename,
                   storage_path, mime_type, size_bytes, checksum_sha256)
                VALUES
                  (:aid, :rid, 'import', :fname,
                   :path, :mime, :sz, :sha)
            """),
            {
                "aid":   str(artifact_id),
                "rid":   str(revision_id),
                "fname": filename,
                "path":  storage_path,
                "mime":  _XLSX_MIME,
                "sz":    len(content),
                "sha":   sha256,
            },
        )
        await db.commit()

    # ── 5. Run import pipeline ────────────────────────────────────────────
    # import_service creates and manages the import_job row internally.
    result: BatchImportResult = await run_import(
        db=db,
        content=content,
        revision_id=revision_id,
        catalog_set_id=catalog_set_id,
        imported_by=user_id,
        filename=filename,
        force=force,
        allow_frozen=is_admin,
    )

    # ── 6. Handle double-import conflict ──────────────────────────────────
    if result.already_has_data:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Revision already contains {result.existing_activities_count} "
                "activities. Re-submit with ?force=true to overwrite."
            ),
        )

    # ── 7. Return import summary ──────────────────────────────────────────
    return ImportJobResponse(
        import_id=result.import_job_id,
        revision_id=revision_id,
        status="completed" if result.ok else "failed",
        activities_created=result.activities_created,
        exchanges_created=result.exchanges_created,
        parameters_created=result.parameters_created,
        warnings_count=len(result.warnings),
        errors_count=len(result.errors),
        warnings=result.warnings,
        errors=result.errors,
        artifact_id=artifact_id,
        storage_path=storage_path,
    )
