"""Authentication and authorization dependencies shared by all routers.

Verification strategy for the Supabase JWT (tried in order):
  1. JWKS — fetched from {SUPABASE_URL}/auth/v1/.well-known/jwks.json and
     cached per process. Handles ES256/RS256 keys (Supabase Cloud projects
     that moved off the legacy shared secret).
  2. HS256 — SUPABASE_JWT_SECRET (self-hosted GoTrue signs HS256 by default).
     Intentionally no default, so HS256 verification fails rather than
     accepting tokens signed with the public Supabase CLI development secret.

FastAPI connects to Postgres as the table owner, so RLS doesn't apply to it:
every check that RLS makes for browser requests has to be made here instead.

  get_current_user_id  token only (no DB) — used by ApiRequestGuard middleware
  get_active_user_id   token + app_user.is_active — for any endpoint
  get_admin_user_id    token + is_active + role 'admin'
"""

from __future__ import annotations

import os
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, Header, HTTPException
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db

_HS256_SECRET: str | None = os.environ.get("SUPABASE_JWT_SECRET") or None

# Lazily initialised, cached for the process lifetime: the JWKS endpoint is
# only hit once per start.
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


async def get_current_user_id(
    authorization: Annotated[str | None, Header()] = None,
) -> UUID:
    """Verify the Supabase Bearer JWT and return the caller's user_id (sub).

    Checks the token only. Endpoints should depend on get_active_user_id or
    get_admin_user_id, which also check the account in app_user.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header.",
        )
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
        return UUID(payload["sub"])
    except HTTPException:
        raise
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Unauthorized.")


async def _account(db: AsyncSession, user_id: UUID):
    row = (await db.execute(
        text("SELECT role, is_active FROM app_user WHERE user_id = :uid"),
        {"uid": str(user_id)},
    )).fetchone()
    if row is None or not row.is_active:
        # Deactivated (or never provisioned) accounts get no access at all
        raise HTTPException(status_code=403, detail="This account is deactivated.")
    return row


async def get_active_user_id(
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
) -> UUID:
    """Return user_id when the token is valid and the account is active."""
    await _account(db, user_id)
    return user_id


async def get_admin_user_id(
    db: AsyncSession = Depends(get_db),
    user_id: UUID = Depends(get_current_user_id),
) -> UUID:
    """Return user_id when the account is active and holds the 'admin' role."""
    row = await _account(db, user_id)
    if row.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user_id
