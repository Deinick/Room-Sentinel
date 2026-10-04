"""Which phones get a user's notifications. Sending them is src.sentinel.notify.expo."""

from datetime import datetime, timezone

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert

from src.services import BaseService
from .models import PushToken


class PushTokenService(BaseService):
    async def register(self, *, token: str, user_id: int) -> None:
        """Idempotent. A token already registered to another user moves to this one."""
        stmt = insert(PushToken).values(token=token, user_id=user_id)
        await self.session.execute(
            stmt.on_conflict_do_update(
                index_elements=[PushToken.token],
                set_={"user_id": stmt.excluded.user_id, "updated_at": datetime.now(timezone.utc)},
            )
        )

    async def unregister(self, *, token: str, user_id: int) -> None:
        """Idempotent. Only removes the token if it belongs to this user."""
        await self.session.execute(delete(PushToken).where(PushToken.token == token, PushToken.user_id == user_id))
