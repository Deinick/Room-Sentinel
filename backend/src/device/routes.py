"""
Device and pairing routes.

Two kinds of caller:
- The controller (ESP32) authenticates with its serial number and manufacturing secret
  in the request body. It never sees or sends a user's password.
- The user's browser authenticates with the normal bearer token from POST /token.
"""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status

from src.auth.dependencies import get_current_staff_user, get_current_user
from src.auth.models import User
from src.database import get_repository
from src.sentinel.profiles import PROFILES
from .live import connections
from .schemas import (
    DeviceCreate,
    DeviceCredentials,
    DeviceToken,
    DeviceUpdate,
    PairingInfo,
    PairingStarted,
    ReadDevice,
)
from .services import (
    DeviceAuthError,
    DeviceService,
    InvalidLimits,
    PairingExpired,
    PairingNotFound,
    PairingPending,
)

router = APIRouter(tags=["devices"])

ServiceDep = Annotated[DeviceService, Depends(get_repository(DeviceService))]
UserDep = Annotated[User, Depends(get_current_user)]

_device_auth_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown device or wrong secret.")
_not_found = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pairing code not found or already used.")
_expired = HTTPException(status_code=status.HTTP_410_GONE, detail="Pairing code expired. Start login again on the device.")


# ---------------------------------------------------------------------------
# Called by the controller
# ---------------------------------------------------------------------------

@router.post(
    "/devices/pairing",
    response_model=PairingStarted,
    status_code=status.HTTP_201_CREATED,
    summary="Device: start pairing (START_LOGIN)",
)
async def start_pairing(payload: DeviceCredentials, service: ServiceDep) -> PairingStarted:
    try:
        pairing, url = await service.start_pairing(device_id=payload.device_id, secret=payload.secret)
    except DeviceAuthError:
        raise _device_auth_error
    return PairingStarted(code=pairing.id, pairing_url=url, expires_at=pairing.expires_at)


@router.post(
    "/devices/pairing/{code}/token",
    response_model=DeviceToken,
    responses={202: {"description": "User has not confirmed yet; poll again."}},
    summary="Device: collect the device token after the user confirmed",
)
async def claim_token(code: str, payload: DeviceCredentials, service: ServiceDep) -> DeviceToken | Response:
    try:
        token = await service.claim_token(code=code, device_id=payload.device_id, secret=payload.secret)
    except DeviceAuthError:
        raise _device_auth_error
    except PairingNotFound:
        raise _not_found
    except PairingExpired:
        raise _expired
    except PairingPending:
        return Response(status_code=status.HTTP_202_ACCEPTED)
    return DeviceToken(device_token=token)


# ---------------------------------------------------------------------------
# Called by the signed-in user on the website
# ---------------------------------------------------------------------------

@router.get("/pairing/{code}", response_model=PairingInfo, summary="User: show which device is pairing")
async def get_pairing(code: str, _: UserDep, service: ServiceDep) -> PairingInfo:
    try:
        pairing = await service.get_pairing(code)
    except PairingNotFound:
        raise _not_found
    except PairingExpired:
        raise _expired
    return PairingInfo(device_id=pairing.device_id, expires_at=pairing.expires_at)


@router.post(
    "/pairing/{code}/confirm",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="User: confirm the serial number and link the device",
)
async def confirm_pairing(code: str, user: UserDep, service: ServiceDep, background: BackgroundTasks) -> None:
    try:
        revoked_device_id = await service.confirm(code=code, user_id=user.id)
    except PairingNotFound:
        raise _not_found
    except PairingExpired:
        raise _expired
    if revoked_device_id is not None:
        # The previous owner's token is gone; drop the connection it opened. Runs after the commit.
        background.add_task(connections.disconnect, revoked_device_id)


@router.get("/devices", response_model=list[ReadDevice], summary="User: list my devices")
async def list_devices(user: UserDep, service: ServiceDep) -> list[ReadDevice]:
    return [ReadDevice.model_validate(d) for d in await service.list_for_user(user.id)]


@router.patch("/devices/{device_id}", response_model=ReadDevice, summary="User: rename a device or set its target and limit temperatures")
async def update_device(
    device_id: str, payload: DeviceUpdate, user: UserDep, service: ServiceDep, background: BackgroundTasks
) -> ReadDevice:
    changes = payload.model_dump(exclude_unset=True)
    try:
        device = await service.update_settings(device_id=device_id, user_id=user.id, changes=changes)
    except PairingNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found.")
    except InvalidLimits:
        raise HTTPException(status_code=422, detail="min_temperature must be below max_temperature.")
    if changes.keys() & {"min_temperature", "max_temperature"}:
        background.add_task(PROFILES.set_limits, device.device_id, device.min_temperature, device.max_temperature)
    if "target_temperature" in changes:
        # Runs after the commit, so the device never sees a value that was rolled back.
        background.add_task(connections.push_settings, device.device_id, device.target_temperature)
    return ReadDevice.model_validate(device)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT, summary="User: unpair a device")
async def unpair_device(device_id: str, user: UserDep, service: ServiceDep, background: BackgroundTasks) -> None:
    try:
        await service.unpair(device_id=device_id, user_id=user.id)
    except PairingNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found.")
    # The token is revoked; drop the connection it opened. Runs after the commit.
    background.add_task(connections.disconnect, device_id)


# ---------------------------------------------------------------------------
# Factory provisioning
# ---------------------------------------------------------------------------

@router.post(
    "/devices",
    response_model=ReadDevice,
    status_code=status.HTTP_201_CREATED,
    summary="Provision a manufactured device (staff only)",
    dependencies=[Depends(get_current_staff_user)],
)
async def provision_device(payload: DeviceCreate, service: ServiceDep) -> ReadDevice:
    try:
        device = await service.provision(device_id=payload.device_id, secret=payload.secret)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    return ReadDevice.model_validate(device)
