"""JWT creation, decoding, and user resolution."""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
from jwt import InvalidTokenError
from sqlalchemy import select

from src.services import BaseService
from .models import User
from .security import verify_password

logger = logging.getLogger(__name__)

JWT_SECRET_KEY = os.environ["JWT_SECRET_KEY"]
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRY = timedelta(minutes=60)


class TokenService(BaseService):
    """
    Handles JWT lifecycle and credential verification.
    Instantiated via get_repository(TokenService) - only receives session.
    """

    async def authenticate_user(self, username: str, password: str) -> Optional[User]:
        """Return the User if credentials are valid, otherwise None.

        Accepts username or email in the username field.
        Rejects soft-deleted accounts.
        """
        lookup = (username or "").strip()
        if not lookup:
            return None

        user = await self.session.scalar(select(User).where(User.username == lookup))

        if user is None and "@" in lookup:
            # Fall back to email lookup if the input looks like an email.
            user = await self.session.scalar(select(User).where(User.email == lookup.lower()))

        if user is None or user.is_deleted:
            return None
        if not verify_password(password, user.hashed_password):
            return None

        logger.info("User %r authenticated successfully.", user.username)
        return user

    def create_access_token(self, username: str) -> str:
        """Sign and return a JWT access token for the given username."""
        payload: Dict[str, Any] = {
            "sub": username,
            "exp": datetime.now(timezone.utc) + ACCESS_TOKEN_EXPIRY,
        }
        return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)

    async def get_user_from_token(self, token: str) -> Optional[User]:
        """Resolve the user referenced by the token's 'sub' claim."""
        try:
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        except InvalidTokenError:
            logger.warning("Token decode failed.")
            return None

        username: Optional[str] = payload.get("sub")
        if not username:
            return None

        return await self.session.scalar(select(User).where(User.username == username))
