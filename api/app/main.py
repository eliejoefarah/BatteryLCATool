from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import router
from app.routers.validate_router import router as validate_router

app = FastAPI(title="BatteryLCATool API", version="0.1.0")

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
