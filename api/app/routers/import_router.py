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
#   lca-files/projects/{project_id}/revisions/{revision_id}/imports/{ts}_{filename}
# If the Storage upload fails (e.g. bucket not yet created), the import still
# proceeds and the response will have artifact_id=null and a warning.
#
# Auth
# ────
# Verification strategy (tried in order):
#   1. JWKS — fetched from {SUPABASE_URL}/auth/v1/.well-known/jwks.json and
#      cached per process. Handles ES256 (P-256) keys used by production
#      Supabase projects that have migrated off the legacy shared secret.
#   2. HS256 fallback — uses SUPABASE_JWT_SECRET env var (or the Supabase CLI
#      local-dev default). Covers local development and the transition window
#      while old HS256 tokens are still valid.
# =============================================================================

import hashlib
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError
from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db, get_service_role_client
from app.models.import_models import BatchImportResult
from app.services.import_service import run_import

log = logging.getLogger(__name__)

router = APIRouter(prefix="/import", tags=["import"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# HS256 fallback secret — used when JWKS verification fails (local dev only).
# In production SUPABASE_JWT_SECRET must be set; the fallback is intentionally
# empty so that HS256 verification fails rather than silently accepting tokens
# signed with the publicly-known Supabase CLI development default.
_HS256_SECRET: str | None = os.environ.get("SUPABASE_JWT_SECRET") or None

# JWKS client — lazily initialised, cached for the process lifetime.
# Handles ES256 (P-256) keys used by production Supabase since the HS256 legacy
# secret was deprecated. Cache means the JWKS endpoint is only hit once per start.
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        supabase_url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321")
        _jwks_client = PyJWKClient(
            f"{supabase_url}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
        )
    return _jwks_client


_STORAGE_BUCKET = "lca-files"
_MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

# The single DEFAULT catalog set seeded by 003_seed.sql.
_DEFAULT_CATALOG_ID = UUID("00000000-0000-0000-0001-000000000001")

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------


async def get_current_user_id(
    authorization: Annotated[str | None, Header()] = None,
) -> UUID:
    """Decode the Supabase Bearer JWT and return the caller's user_id (sub).

    Tries JWKS (ES256/RS256) first — required for production Supabase projects
    that have migrated to the new ECC signing keys. Falls back to the legacy
    HS256 shared secret for local development and the transition window.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header.",
        )
    token = authorization.removeprefix("Bearer ")
    try:
        # 1. Try JWKS — production ES256 / RS256 tokens
        try:
            client = _get_jwks_client()
            signing_key = client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                options={"verify_aud": False},
            )
        except (PyJWKClientError, Exception):
            # 2. Fall back to HS256 — local dev only (requires SUPABASE_JWT_SECRET env var)
            if not _HS256_SECRET:
                raise HTTPException(status_code=401, detail="Unauthorized.")
            payload = jwt.decode(
                token,
                _HS256_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
        return UUID(payload["sub"])
    except HTTPException:
        raise
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Unauthorized.")


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
# Route
# ---------------------------------------------------------------------------


@router.delete("/{revision_id}", status_code=204)
async def clear_import_data(
    revision_id: UUID,
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
) -> None:
    """Remove all imported processes, exchanges, and parameters for a revision.

    Called by the frontend when the user chooses 'Undo import' after reviewing
    import issues. Requires the caller to be a project member.
    """
    row = (await db.execute(
        text("""
            SELECT 1
            FROM battery_model_revision r
            JOIN battery_model bm ON bm.model_id = r.model_id
            JOIN project_member pm ON pm.project_id = bm.project_id
            WHERE r.revision_id = :rid AND pm.user_id = :uid
        """),
        {"rid": str(revision_id), "uid": str(user_id)},
    )).fetchone()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Revision not found or you do not have access.",
        )

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
    user_id: UUID = Depends(get_current_user_id),
) -> ImportJobResponse:
    # ── 1. Validate file type and size ────────────────────────────────────
    filename = file.filename or "import.xlsx"
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

    # ── 2. Verify revision exists and caller has project membership ───────
    row = (await db.execute(
        text("""
            SELECT bm.project_id
            FROM battery_model_revision r
            JOIN battery_model bm ON bm.model_id = r.model_id
            JOIN project_member pm ON pm.project_id = bm.project_id
            WHERE r.revision_id = :rid
              AND pm.user_id    = :uid
        """),
        {"rid": str(revision_id), "uid": str(user_id)},
    )).fetchone()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Revision not found or you do not have access to this project.",
        )
    project_id = UUID(str(row[0]))

    # ── 3. Upload xlsx to Supabase Storage ────────────────────────────────
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    storage_path = (
        f"projects/{project_id}/revisions/{revision_id}"
        f"/imports/{timestamp}_{filename}"
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
        artifact_id = uuid.uuid4()
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
