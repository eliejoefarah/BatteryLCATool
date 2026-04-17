from __future__ import annotations

# =============================================================================
# export_router.py — Battery LCA Tool
# =============================================================================
# POST /api/v1/export/{revision_id}
#   Generate a VUB-template xlsx for the given revision, upload it to Supabase
#   Storage, persist the export_job record, and return a signed download URL.
#
# GET /api/v1/export/{revision_id}
#   List all export_job rows for the revision (most recent first), each with a
#   fresh signed URL when the status is 'completed'.
#
# Auth
# ────
# Both endpoints require a valid Supabase Bearer JWT whose sub maps to an
# app_user row with role = 'admin'.  Uses the same JWKS + HS256 fallback
# verification strategy as import_router.py.
#
# Storage
# ───────
# Files are uploaded to the "exports" bucket at:
#   exports/{revision_id}/{export_job_id}.xlsx
# Signed URLs have a 3600-second TTL and are generated fresh on every response
# so callers never get a stale link.
# =============================================================================

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db, get_service_role_client
from app.services.export_service import generate_export_xlsx

log = logging.getLogger(__name__)

router = APIRouter(prefix="/export", tags=["export"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_HS256_SECRET: str | None = os.environ.get("SUPABASE_JWT_SECRET") or None

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


_STORAGE_BUCKET = "exports"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_SIGNED_URL_TTL = 3600  # seconds

# ---------------------------------------------------------------------------
# Auth dependency — admin only
# ---------------------------------------------------------------------------


async def get_admin_user_id(
    authorization: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> UUID:
    """Decode the Supabase Bearer JWT and verify the caller is an admin.

    Returns the caller's user_id (UUID) on success.
    Raises HTTP 401 for invalid/missing tokens and HTTP 403 for non-admins.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header.")
    token = authorization.removeprefix("Bearer ")

    try:
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
            if not _HS256_SECRET:
                raise HTTPException(status_code=401, detail="Unauthorized.")
            payload = jwt.decode(
                token,
                _HS256_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
        user_id = UUID(payload["sub"])
    except HTTPException:
        raise
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Unauthorized.")

    # Check admin role
    role_row = (await db.execute(
        text("SELECT role FROM app_user WHERE user_id = :uid"),
        {"uid": str(user_id)},
    )).fetchone()

    if role_row is None or role_row[0] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")

    return user_id


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ExportRequest(BaseModel):
    partner_responsible: str


class ExportJobOut(BaseModel):
    export_job_id: UUID
    status: str
    partner_responsible: str | None
    completed_at: datetime | None
    file_size_bytes: int | None
    download_url: str | None


class ExportResponse(BaseModel):
    export_job_id: UUID
    download_url: str
    already_existed: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_signed_url(storage_path: str) -> str | None:
    """Generate a fresh signed URL for an object in the exports bucket.

    Returns None if the Storage call fails (e.g. object not yet uploaded,
    bucket missing in local dev), so callers can degrade gracefully.
    """
    try:
        sb = get_service_role_client()
        result = sb.storage.from_(_STORAGE_BUCKET).create_signed_url(
            storage_path, _SIGNED_URL_TTL
        )
        # supabase-py v1 returns {"signedURL": "..."} and v2 returns {"signedUrl": "..."}
        return result.get("signedUrl") or result.get("signedURL")
    except Exception as exc:
        log.warning("Failed to generate signed URL for %s: %s", storage_path, exc)
        return None


# ---------------------------------------------------------------------------
# POST /api/v1/export/{revision_id}
# ---------------------------------------------------------------------------


@router.post("/{revision_id}", response_model=ExportResponse)
async def trigger_export(
    revision_id: UUID,
    body: ExportRequest,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    admin_id: UUID = Depends(get_admin_user_id),
) -> ExportResponse:
    """Generate (or retrieve) the xlsx export for a frozen, fully-mapped revision.

    Steps
    ─────
    1. Verify the revision exists and is frozen.
    2. Verify ready_for_export (no pending input exchanges).
    3. If a completed export_job already exists, regenerate a signed URL and
       return it immediately without re-generating the file.
    4. Create an export_job row with status='running'.
    5. Call generate_export_xlsx() to build the workbook in memory.
    6. Upload the bytes to Supabase Storage.
    7. Update the export_job row to status='completed'.
    8. Return a signed download URL.
    """
    rid = str(revision_id)

    # ── 1. Verify revision exists and is fully mapped ────────────────────
    rev_row = (await db.execute(
        text("""
            SELECT status
            FROM battery_model_revision
            WHERE revision_id = :rid
        """),
        {"rid": rid},
    )).fetchone()

    if rev_row is None:
        raise HTTPException(status_code=404, detail="Revision not found.")

    if rev_row[0] != "mapped":
        raise HTTPException(
            status_code=422,
            detail="Revision is not ready for export. It must have status 'mapped'.",
        )

    # ── 2. Check ready_for_export (pending_count == 0) ────────────────────
    pending_row = (await db.execute(
        text("""
            SELECT COUNT(*)
            FROM process_exchange pe
            JOIN process_instance pi ON pi.process_id = pe.process_id
            WHERE pi.revision_id = :rid
              AND pe.exchange_direction = 'input'
              AND pe.mapping_status = 'pending'
        """),
        {"rid": rid},
    )).fetchone()
    pending_count = pending_row[0] if pending_row else 0

    if pending_count > 0:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Revision has {pending_count} unmapped flow(s). "
                "Complete mapping before exporting."
            ),
        )

    # ── 3. Check for an existing completed export_job (skip when force=True) ──
    if not force:
        existing_row = (await db.execute(
            text("""
                SELECT export_id, file_path
                FROM export_job
                WHERE revision_id = :rid
                  AND status = 'completed'
                ORDER BY completed_at DESC
                LIMIT 1
            """),
            {"rid": rid},
        )).fetchone()

        if existing_row is not None:
            existing_job_id = existing_row[0]
            existing_path = existing_row[1]
            download_url = _make_signed_url(existing_path) if existing_path else None
            if download_url is None:
                # Storage unavailable in local dev — fall through to regenerate
                log.info(
                    "Existing export_job %s has no signed URL; regenerating.",
                    existing_job_id,
                )
            else:
                return ExportResponse(
                    export_job_id=UUID(str(existing_job_id)),
                    download_url=download_url,
                    already_existed=True,
                )

    # ── 4. Create export_job row (status='running') ───────────────────────
    job_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO export_job
              (export_id, revision_id, status, partner_responsible,
               exported_by, format)
            VALUES
              (:jid, :rid, 'running', :partner, :uid, 'vub_xlsx')
        """),
        {
            "jid":     str(job_id),
            "rid":     rid,
            "partner": body.partner_responsible,
            "uid":     str(admin_id),
        },
    )
    await db.commit()

    # ── 5. Generate xlsx in memory ────────────────────────────────────────
    try:
        xlsx_bytes = await generate_export_xlsx(
            revision_id=rid,
            partner_responsible=body.partner_responsible,
            db=db,
        )
    except Exception as exc:
        err_msg = str(exc)
        log.exception("Export generation failed for revision %s: %s", rid, err_msg)
        await db.execute(
            text("""
                UPDATE export_job
                SET status = 'failed',
                    error_message = :err,
                    completed_at = NOW()
                WHERE export_id = :jid
            """),
            {"err": err_msg, "jid": str(job_id)},
        )
        await db.commit()
        raise HTTPException(
            status_code=500,
            detail=f"Export generation failed: {err_msg}",
        )

    # ── 6. Upload to Supabase Storage ─────────────────────────────────────
    storage_path = f"exports/{rid}/{job_id}.xlsx"
    upload_ok = False
    try:
        sb = get_service_role_client()
        sb.storage.from_(_STORAGE_BUCKET).upload(
            path=storage_path,
            file=xlsx_bytes,
            file_options={"content-type": _XLSX_MIME},
        )
        upload_ok = True
        log.info("Uploaded export to %s (%d bytes)", storage_path, len(xlsx_bytes))
    except Exception as exc:
        log.exception("Storage upload failed for export job %s: %s", job_id, exc)
        # Mark failed — don't leave it in 'running' state
        await db.execute(
            text("""
                UPDATE export_job
                SET status = 'failed',
                    error_message = :err,
                    completed_at = NOW()
                WHERE export_id = :jid
            """),
            {"err": f"Storage upload failed: {exc}", "jid": str(job_id)},
        )
        await db.commit()
        raise HTTPException(
            status_code=502,
            detail="Failed to upload the generated export file. Please retry.",
        )

    # ── 7. Update export_job → completed ─────────────────────────────────
    await db.execute(
        text("""
            UPDATE export_job
            SET status          = 'completed',
                file_path       = :path,
                file_size_bytes = :size,
                completed_at    = NOW()
            WHERE export_id = :jid
        """),
        {
            "path": storage_path,
            "size": len(xlsx_bytes),
            "jid":  str(job_id),
        },
    )
    await db.commit()

    # ── 8. Generate signed URL ────────────────────────────────────────────
    download_url = _make_signed_url(storage_path)
    if download_url is None:
        # Local dev without Storage — return a placeholder so callers don't break
        download_url = f"__local__/{storage_path}"

    return ExportResponse(
        export_job_id=job_id,
        download_url=download_url,
        already_existed=False,
    )


# ---------------------------------------------------------------------------
# GET /api/v1/export/{revision_id}
# ---------------------------------------------------------------------------


@router.get("/{revision_id}", response_model=list[ExportJobOut])
async def list_exports(
    revision_id: UUID,
    db: AsyncSession = Depends(get_db),
    _admin_id: UUID = Depends(get_admin_user_id),
) -> list[ExportJobOut]:
    """Return all export_job rows for the revision, newest first.

    Each completed row includes a freshly generated signed download URL.
    """
    rid = str(revision_id)

    # Verify the revision exists
    exists = (await db.execute(
        text("SELECT 1 FROM battery_model_revision WHERE revision_id = :rid"),
        {"rid": rid},
    )).fetchone()
    if exists is None:
        raise HTTPException(status_code=404, detail="Revision not found.")

    rows = (await db.execute(
        text("""
            SELECT
                export_id,
                status,
                partner_responsible,
                completed_at,
                file_size_bytes,
                file_path
            FROM export_job
            WHERE revision_id = :rid
            ORDER BY created_at DESC
        """),
        {"rid": rid},
    )).fetchall()

    result: list[ExportJobOut] = []
    for row in rows:
        job_id, status, partner, completed_at, file_size, file_path = row
        download_url: str | None = None
        if status == "completed" and file_path:
            download_url = _make_signed_url(file_path)

        result.append(ExportJobOut(
            export_job_id=UUID(str(job_id)),
            status=status,
            partner_responsible=partner,
            completed_at=completed_at,
            file_size_bytes=file_size,
            download_url=download_url,
        ))

    return result
