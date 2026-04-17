from fastapi import APIRouter

from app.routers import bw_mapping_router, export_router, import_router

router = APIRouter()

router.include_router(import_router.router, prefix="/api/v1")
router.include_router(bw_mapping_router.search_router, prefix="/api/v1")
router.include_router(bw_mapping_router.mapping_router, prefix="/api/v1")
router.include_router(bw_mapping_router.suggest_router, prefix="/api/v1")
router.include_router(export_router.router, prefix="/api/v1")
