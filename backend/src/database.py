"""
SQLAlchemy engine, session factory, and FastAPI dependency helpers.
All other modules should import SessionDep / get_repository from here.
"""

import os
from collections.abc import AsyncIterator, Callable
from typing import Annotated

from fastapi import Depends
from sqlalchemy import MetaData
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

# Explicit constraint names make Alembic autogenerate deterministic.
NAMING_CONVENTION: dict[str, str] = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """All ORM models inherit from this so Base.metadata stays consistent."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


def database_url() -> URL:
    # Tiger Cloud hands out postgres:// URLs; SQLAlchemy needs the psycopg 3 driver named.
    # The same URL works for both the async app engine and Alembic's sync engine.
    url = make_url(os.environ["TIMESCALE_DB_URL"]).set(drivername="postgresql+psycopg")
    # A raw password with URL-special characters (@ : / ? # %) breaks URL parsing,
    # so it can be supplied separately and needs no escaping.
    if password := os.environ.get("TIMESCALE_DB_PASSWORD"):
        url = url.set(password=password)
    return url


# pool_pre_ping discards connections the cloud database closed while they sat idle.
engine: AsyncEngine = create_async_engine(database_url(), pool_pre_ping=True)

async_session_maker = async_sessionmaker(
    engine,
    expire_on_commit=False,  # Avoids lazy-load errors on objects accessed after commit.
    autoflush=False,
)


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------


async def get_session() -> AsyncIterator[AsyncSession]:
    """
    Per-request AsyncSession. Commits on success, rolls back on any exception.
    """
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise


# scope="function" commits before the response is sent, so a failed commit
# surfaces as a 500 instead of the client already having received a 2xx.
SessionDep = Annotated[AsyncSession, Depends(get_session, scope="function")]


def get_repository[T](service_cls: Callable[[AsyncSession], T]) -> Callable[[AsyncSession], T]:
    """
    Returns a Depends-compatible factory for service_cls(session).

    Usage:
        @router.get("/me")
        async def me(svc: Annotated[UserService, Depends(get_repository(UserService))]):
            ...
    """

    def _provider(session: SessionDep) -> T:
        return service_cls(session)

    return _provider
