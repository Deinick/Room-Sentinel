"""Live endpoints, included in the team API (src/main.py). Each user sees their own devices plus the demo devices."""

import asyncio
import json
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_user
from src.auth.models import User
from src.database import SessionDep, get_repository
from src.device.services import DeviceService
from src.sentinel.demo import DEMO_DEVICES
from src.sentinel.demo_routes import router as demo_router
from src.sentinel.device_readings.routes import router as device_readings_router
from src.sentinel.history import MAX_MINUTES, DatabaseHistory, RecentHistory
from src.sentinel.live import LIVE, LIVE_SECONDS

STREAM_SECONDS=1.0  # at most one /live frame per second per dashboard

router=APIRouter(tags=["sentinel"])
router.include_router(device_readings_router)
router.include_router(demo_router)


async def _my_device_ids(
    user: Annotated[User, Depends(get_current_user)],
    devices: Annotated[DeviceService, Depends(get_repository(DeviceService))],
) -> dict[str, datetime | None]:
    """device_id -> when the user paired it (None for demo devices, which have no previous owner)."""
    return {**dict.fromkeys(DEMO_DEVICES),**{d.device_id:d.paired_at for d in await devices.list_for_user(user.id)}}


MyDevicesDep=Annotated[dict[str, datetime | None], Depends(_my_device_ids)]


def _latest(devices) -> dict:
    return {device_id:r for device_id,r in LIVE.latest().items() if device_id in devices}


def _issues(devices) -> list[dict]:
    return [i for i in LIVE.issues() if i["device_id"] in devices]


@router.get("/latest",summary="Newest reading per device")
def get_latest(my_devices: MyDevicesDep) -> dict:
    return _latest(my_devices) or {"error":"no data yet"}


@router.get("/issues",summary="Problems open right now, with advice")
def get_issues(my_devices: MyDevicesDep) -> list[dict]:
    return _issues(my_devices)


@router.get("/live",summary="Server-Sent Events: {latest, issues} as in /latest and /issues, on every change",
            response_class=StreamingResponse)
async def stream_live(my_devices: MyDevicesDep) -> StreamingResponse:
    """The first frame is the current state; later frames follow changes, at most one per STREAM_SECONDS.

    A frame also goes out after LIVE_SECONDS without changes, so "live" turns false when a device
    goes quiet and proxies see traffic. Devices paired after connecting appear on reconnect.
    """
    devices=set(my_devices)  # the DB session is already closed (scope="function"); the stream holds none

    async def frames():
        changed=LIVE.watch()
        try:
            while True:
                changed.clear()  # before the snapshot, so a change while sending is not lost
                yield f"data: {json.dumps({'latest':_latest(devices),'issues':_issues(devices)})}\n\n"
                await asyncio.sleep(STREAM_SECONDS)
                try:
                    await asyncio.wait_for(changed.wait(),LIVE_SECONDS-STREAM_SECONDS)
                except TimeoutError:
                    pass
        finally:
            LIVE.unwatch(changed)

    # X-Accel-Buffering: proxies must pass each frame through, not collect the response.
    return StreamingResponse(frames(),media_type="text/event-stream",
                             headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})


def _history_for(device: str, my_devices: dict[str, datetime | None], request: Request, session: AsyncSession):
    if device not in my_devices:
        raise HTTPException(404,f"No device {device!r} on your account.")
    demo=getattr(request.app.state,"demos",{}).get(device)
    return demo.history if demo else DatabaseHistory(session,since=my_devices[device])


@router.get("/history",summary="Temperatures over time for charts (bucket size chosen from the range)")
async def get_history(device: str, my_devices: MyDevicesDep, request: Request, session: SessionDep,
                      minutes: float=Query(60,gt=0,le=MAX_MINUTES)) -> dict:
    source=_history_for(device,my_devices,request,session)
    result=source.readings(device,minutes)
    if not isinstance(source,RecentHistory):
        result=await result
    return {"device_id":device,"minutes":minutes,**result}


@router.get("/metrics",summary="Calculated values over time: rate, expected rate, surprise, forecast, ...")
async def get_metrics(device: str, my_devices: MyDevicesDep, request: Request, session: SessionDep,
                      minutes: float=Query(60,gt=0,le=MAX_MINUTES),
                      names: str | None=Query(None,description="comma-separated, e.g. rate_c_per_min,forecast_minutes")) -> dict:
    source=_history_for(device,my_devices,request,session)
    wanted={n.strip() for n in names.split(",") if n.strip()} if names else None
    result=source.metrics(device,minutes,wanted)
    if not isinstance(source,RecentHistory):
        result=await result
    return {"device_id":device,"minutes":minutes,**result}
