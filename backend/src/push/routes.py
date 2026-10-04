"""
Push token registration for the mobile app.

After sign-in the app gets its Expo push token and registers it; on sign-out it removes it.
Notifications are then sent for issues on every device the user owns.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from src.auth.dependencies import get_current_user
from src.auth.models import User
from src.database import get_repository
from .schemas import PushTokenIn
from .services import PushTokenService

router = APIRouter(tags=["push"])

ServiceDep = Annotated[PushTokenService, Depends(get_repository(PushTokenService))]
UserDep = Annotated[User, Depends(get_current_user)]


@router.post("/me/push-tokens", status_code=status.HTTP_204_NO_CONTENT, summary="User: receive notifications on this phone")
async def register_push_token(payload: PushTokenIn, user: UserDep, service: ServiceDep) -> None:
    await service.register(token=payload.token, user_id=user.id)


@router.delete("/me/push-tokens", status_code=status.HTTP_204_NO_CONTENT, summary="User: stop notifications on this phone")
async def unregister_push_token(payload: PushTokenIn, user: UserDep, service: ServiceDep) -> None:
    await service.unregister(token=payload.token, user_id=user.id)
