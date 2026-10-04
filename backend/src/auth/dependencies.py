"""FastAPI dependencies for authentication and authorization."""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials

from src.database import get_repository
from .models import User
from .security import bearer_scheme
from .token_service import TokenService

logger = logging.getLogger(__name__)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
    token_service: Annotated[TokenService, Depends(get_repository(TokenService))],
) -> User:
    """
    Resolve and validate the bearer token, returning the authenticated User.
    Raises HTTP 401 if the token is invalid, the user doesn't exist,
    has been soft-deleted, or is inactive.
    """
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user = await token_service.get_user_from_token(credentials.credentials)
    if user is None:
        logger.warning("Token resolved to no user.")
        raise credentials_error
    if user.is_deleted:
        logger.warning("Deleted user id=%d attempted access.", user.id)
        raise credentials_error
    if not user.is_active:
        logger.warning("Inactive user id=%d attempted access.", user.id)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive.")

    return user


async def get_current_staff_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Restrict access to staff and superusers. Raises HTTP 403 otherwise."""
    if not (current_user.is_staff or current_user.is_superuser):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient privileges.")
    return current_user