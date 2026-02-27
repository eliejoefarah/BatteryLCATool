from __future__ import annotations

import os
from collections.abc import AsyncGenerator

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from supabase import Client, create_client

load_dotenv()

# ---------------------------------------------------------------------------
# PostgreSQL — SQLAlchemy async engine
# ---------------------------------------------------------------------------
DATABASE_URL: str = os.environ["DATABASE_URL"]

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


# ---------------------------------------------------------------------------
# Supabase Python client — service-role (bypasses RLS)
# ---------------------------------------------------------------------------
SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def get_service_role_client() -> Client:
    """Return a Supabase client initialised with the service-role key.

    Use this only after performing your own auth/authz checks, since it
    bypasses Row-Level Security entirely.
    """
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
