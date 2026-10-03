"""
Auth and user routes.

Security notes:
- GET /users and GET /users/{id} require staff privileges - do not comment out those guards.
- PrivateUser intentionally omits hashed_password; never expose it in a response.
- DELETE returns 204 with no body (HTTP spec forbids a body on 204).
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from src.database import get_repository
from .dependencies import get_current_staff_user, get_current_user
from .models import User
from .schemas import (
    PrivateUser,
    ReadUser,
    Token,
    UpdateUser,
    UserCreate,
)
from .services import UserService
from .token_service import TokenService

logger = logging.getLogger(__name__)

auth_router = APIRouter(tags=["tokens"])
users_router = APIRouter(tags=["users"])
router = APIRouter()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@auth_router.post("/token", response_model=Token, summary="OAuth2 password-flow login")
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    token_service: Annotated[TokenService, Depends(get_repository(TokenService))],
) -> Token:
    user = await token_service.authenticate_user(form_data.username, form_data.password)
    if not user:
        logger.warning("Failed login attempt for %r.", form_data.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = token_service.create_access_token(user.username)
    logger.info("Token issued for user %r.", user.username)
    return Token(access_token=access_token, token_type="bearer")


# ---------------------------------------------------------------------------
# Current user
# ---------------------------------------------------------------------------

@users_router.get("/users/me", response_model=ReadUser, summary="Get current user")
async def read_users_me(
    current_user: Annotated[User, Depends(get_current_user)],
) -> ReadUser:
    return ReadUser.model_validate(current_user)


@users_router.put("/users/me", response_model=ReadUser, summary="Update self")
async def update_user(
    payload: UpdateUser,
    current_user: Annotated[User, Depends(get_current_user)],
    service: Annotated[UserService, Depends(get_repository(UserService))],
) -> ReadUser:
    if payload.password1 or payload.password2:
        if payload.password1 != payload.password2:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match.")

    try:
        updated = await service.update_user(
            id=current_user.id,
            username=payload.username,
            email=str(payload.email) if payload.email else None,
            password=payload.password1,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return ReadUser.model_validate(updated)


@users_router.delete("/users/me", status_code=status.HTTP_204_NO_CONTENT, summary="Delete self")
async def delete_self(
    current_user: Annotated[User, Depends(get_current_user)],
    service: Annotated[UserService, Depends(get_repository(UserService))],
) -> None:
    # 204 No Content - no response body (HTTP spec); decorator's status_code handles it.
    try:
        await service.delete_user(current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


# ---------------------------------------------------------------------------
# User management (public registration)
# ---------------------------------------------------------------------------

@users_router.post("/users", response_model=ReadUser, status_code=status.HTTP_201_CREATED, summary="Register user")
async def create_user(
    payload: UserCreate,
    service: Annotated[UserService, Depends(get_repository(UserService))],
) -> ReadUser:
    try:
        user = await service.create_user(
            username=payload.username,
            email=str(payload.email),
            password=payload.password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return ReadUser.model_validate(user)


# ---------------------------------------------------------------------------
# Staff-only user management
# ---------------------------------------------------------------------------

@users_router.get(
    "/users",
    response_model=list[ReadUser],
    summary="List users (staff only)",
    dependencies=[Depends(get_current_staff_user)],
)
async def list_users(
    service: Annotated[UserService, Depends(get_repository(UserService))],
    limit: int = 100,
    offset: int = 0,
) -> list[ReadUser]:
    limit = min(max(limit, 1), 100)
    users = await service.list_users(limit=limit, offset=offset)
    return [ReadUser.model_validate(u) for u in users]


@users_router.get(
    "/users/{id}",
    response_model=PrivateUser,
    summary="Get user by id (staff only)",
    dependencies=[Depends(get_current_staff_user)],
)
async def staff_read_user(
    id: int,
    service: Annotated[UserService, Depends(get_repository(UserService))],
) -> PrivateUser:
    user = await service.get_by_id(id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return PrivateUser.model_validate(user)


@users_router.delete(
    "/users/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete user by id (staff only)",
)
async def staff_delete_user(
    id: int,
    service: Annotated[UserService, Depends(get_repository(UserService))],
    _: Annotated[User, Depends(get_current_staff_user)],
) -> None:
    try:
        await service.delete_user(id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

router.include_router(auth_router)
router.include_router(users_router)