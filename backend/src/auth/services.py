"""User CRUD operations."""

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from src.services import BaseService
from .models import User
from .security import get_password_hash

logger = logging.getLogger(__name__)


def _validate_password(password: str) -> None:
    """Raise ValueError if password doesn't meet strength requirements."""
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        raise ValueError("Password must contain at least one letter and one digit.")


def _normalize_email(raw: str) -> str:
    """Validate and normalize an email string. Raises ValueError on failure."""
    try:
        return validate_email(raw.strip(), check_deliverability=False).normalized
    except EmailNotValidError as exc:
        raise ValueError(str(exc))


class UserService(BaseService):

    async def get_by_email(self, email: str) -> Optional[User]:
        return await self.session.scalar(select(User).where(User.email == email))

    async def get_by_id(self, id: int) -> Optional[User]:
        return await self.session.scalar(select(User).where(User.id == id))

    async def list_users(self, *, limit: int = 100, offset: int = 0) -> list[User]:
        """Return a paginated list of non-deleted users ordered by id."""
        stmt = (
            select(User)
            .where(User.is_deleted.is_(False))
            .order_by(User.id)
            .offset(max(0, offset))
            .limit(max(0, limit))
        )
        return list(await self.session.scalars(stmt))

    async def _ensure_email_available(self, email: str, *, exclude_id: Optional[int] = None) -> None:
        existing = await self.get_by_email(email)
        if existing and existing.id != exclude_id:
            raise ValueError("Email is already registered.")

    async def create_user(
        self,
        *,
        email: str,
        password: str,
        is_active: bool = True,
        is_superuser: bool = False,
        is_staff: bool = False,
    ) -> User:
        email = _normalize_email(email)
        _validate_password(password)

        await self._ensure_email_available(email)

        user = User(
            email=email,
            hashed_password=get_password_hash(password),
            is_active=is_active,
            is_superuser=is_superuser,
            is_staff=is_staff,
        )
        self.session.add(user)
        try:
            # flush assigns the DB-generated id without committing the transaction.
            # The enclosing get_session() dependency commits when the request succeeds.
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise ValueError("A user with that email already exists.")
        await self.session.refresh(user)

        logger.info("User %r created (id=%d).", user.email, user.id)
        return user

    async def update_user(
        self,
        *,
        id: int,
        email: Optional[str] = None,
        password: Optional[str] = None,
    ) -> User:
        user = await self.session.get(User, id)
        if not user:
            raise ValueError("User not found.")

        if email is not None:
            new_email = _normalize_email(email)
            if new_email != user.email:
                await self._ensure_email_available(new_email, exclude_id=user.id)
                user.email = new_email

        if password is not None:
            _validate_password(password)
            user.hashed_password = get_password_hash(password)

        user.updated_at = datetime.now(timezone.utc)

        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise ValueError("Update failed due to a data conflict.")
        await self.session.refresh(user)
        logger.info("User id=%d updated.", user.id)
        return user

    async def delete_user(self, id: int) -> bool:
        user = await self.session.get(User, id)
        if not user:
            raise ValueError("User not found.")
        if user.is_deleted:
            raise ValueError("User is already deleted.")

        user.is_deleted = True
        user.deleted_at = datetime.now(timezone.utc)
        await self.session.flush()
        logger.info("User id=%d soft-deleted.", id)
        return True