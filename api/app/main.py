from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.middleware import ApiRequestGuard
from app.routers import router
from app.routers.import_router import get_current_user_id
from app.routers.validate_router import router as validate_router

app = FastAPI(title="BatteryLCATool API", version="0.1.0")

# Added before CORS so CORS wraps it: its early 401/413 replies still get
# CORS headers, and preflight requests pass through untouched.
app.add_middleware(ApiRequestGuard, verify_token=get_current_user_id)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(validate_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
