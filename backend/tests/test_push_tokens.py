"""Push token registration and the owner lookup the Expo channel uses, against a real TimescaleDB.

Needs a disposable *_test database in the PG* variables, like tests/test_pairing.py. Skipped otherwise.
"""

import asyncio
import os

import pytest

if not os.environ.get("PGDATABASE", "").endswith("_test"):
    pytest.skip("needs a disposable *_test database in PG* variables", allow_module_level=True)

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from src.auth.models import User
from src.database import Base, database_url
from src.device.models import Device
from src.push.models import PushToken
from src.push.services import PushTokenService
from src.sentinel.notify.expo import ExpoPushChannel

PHONE = "ExponentPushToken[phone-1]"


def run(test):
    """Fresh schema, users 1 and 2, device SN-1 owned by user 1 and SN-2 unowned."""
    async def main():
        engine = create_async_engine(database_url(), poolclass=NullPool)
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb"))
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            session.add_all([User(id=1, email="a@x.io", hashed_password="-"), User(id=2, email="b@x.io", hashed_password="-")])
            await session.flush()
            session.add_all([Device(device_id="SN-1", user_id=1, name="Kitchen", secret_hash="-"), Device(device_id="SN-2", secret_hash="-")])
            await session.commit()
            await test(PushTokenService(session), session)
        await engine.dispose()
    asyncio.run(main())


async def owners(session):
    return dict((await session.execute(select(PushToken.token, PushToken.user_id))).all())


def test_register_is_idempotent_and_moves_between_users():
    async def body(service, session):
        await service.register(token=PHONE, user_id=1)
        await service.register(token=PHONE, user_id=1)
        assert await owners(session) == {PHONE: 1}
        await service.register(token=PHONE, user_id=2)  # user 2 signs in on the same phone
        assert await owners(session) == {PHONE: 2}
    run(body)


def test_unregister_only_removes_own_token():
    async def body(service, session):
        await service.register(token=PHONE, user_id=1)
        await service.unregister(token=PHONE, user_id=2)
        assert await owners(session) == {PHONE: 1}
        await service.unregister(token=PHONE, user_id=1)
        assert await owners(session) == {}
    run(body)


def test_channel_finds_owner_phones_and_forgets_dead_ones():
    async def body(service, session):
        await service.register(token=PHONE, user_id=1)
        await service.register(token="ExponentPushToken[other-user]", user_id=2)
        await session.commit()

        channel = ExpoPushChannel()
        assert await asyncio.to_thread(channel._recipients, "SN-1") == ([PHONE], "Kitchen")
        assert await asyncio.to_thread(channel._recipients, "SN-2") == ([], None)  # unowned device
        await asyncio.to_thread(channel._forget, [PHONE])
        assert await owners(session) == {"ExponentPushToken[other-user]": 2}
    run(body)
