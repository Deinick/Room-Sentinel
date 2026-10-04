"""Live endpoints, included in the team API (src/main.py)."""

from fastapi import APIRouter

from src.sentinel.live import LIVE

router=APIRouter(tags=["sentinel"])


@router.get("/latest",summary="Newest reading per device")
def get_latest() -> dict:
    latest=LIVE.latest()
    if not latest:
        return {"error":"no data yet"}
    return latest


@router.get("/issues",summary="Problems open right now, with advice")
def get_issues() -> list[dict]:
    return LIVE.issues()
