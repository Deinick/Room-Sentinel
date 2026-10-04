"""Live endpoints, included in the team API (src/main.py). Each user sees their own devices plus the demo devices."""

from typing import Annotated

from fastapi import APIRouter, Depends

from src.auth.dependencies import get_current_user
from src.auth.models import User
from src.database import get_repository
from src.device.services import DeviceService
from src.sentinel.demo import DEMO_DEVICES
from src.sentinel.demo_routes import router as demo_router
from src.sentinel.device_readings.routes import router as device_readings_router
from src.sentinel.live import LIVE

router=APIRouter(tags=["sentinel"])
router.include_router(device_readings_router)
router.include_router(demo_router)


async def _my_device_ids(
    user: Annotated[User, Depends(get_current_user)],
    devices: Annotated[DeviceService, Depends(get_repository(DeviceService))],
) -> set[str]:
    return {d.device_id for d in await devices.list_for_user(user.id)}|set(DEMO_DEVICES)


MyDevicesDep=Annotated[set[str], Depends(_my_device_ids)]


@router.get("/latest",summary="Newest reading per device")
def get_latest(my_devices: MyDevicesDep) -> dict:
    latest={device_id:r for device_id,r in LIVE.latest().items() if device_id in my_devices}
    if not latest:
        return {"error":"no data yet"}
    return latest


@router.get("/issues",summary="Problems open right now, with advice")
def get_issues(my_devices: MyDevicesDep) -> list[dict]:
    return [i for i in LIVE.issues() if i["device_id"] in my_devices]
