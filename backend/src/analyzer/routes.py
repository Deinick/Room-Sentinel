"""Analyzer routes: expose the newest reading per device."""

from fastapi import APIRouter

from .services import latest

router = APIRouter(tags=["analyzer"])


@router.get("/latest", summary="Newest reading per device")
def get_latest() -> dict:
    if not latest:
        return {"error": "no data yet"}
    return latest
