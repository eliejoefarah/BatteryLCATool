from fastapi import APIRouter

from app.routers import import_router

router = APIRouter()

router.include_router(import_router.router, prefix="/api/v1")
