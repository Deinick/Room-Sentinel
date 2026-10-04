"""Device pairing, device tokens, and history scoping, against a real TimescaleDB.

Needs a disposable database: the PG* variables must name one whose name ends in "_test",
because every test drops and recreates the schema. Skipped otherwise. For example:

    docker run -d --rm -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=stormhacks_test timescale/timescaledb:latest-pg16
    PGHOST=localhost PGPORT=55432 PGUSER=postgres PGPASSWORD=test PGDATABASE=stormhacks_test PGSSLMODE=disable pytest tests/test_pairing.py
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone

import pytest

if not os.environ.get("PGDATABASE", "").endswith("_test"):
    pytest.skip("needs a disposable *_test database in PG* variables", allow_module_level=True)

from sqlalchemy import insert, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from src.auth.models import User
from src.database import Base, database_url
from src.device.models import Device, PairingSession
from src.device.services import (
    DeviceAuthError,
    DeviceService,
    PairingExpired,
    PairingNotFound,
    PairingPending,
)
from src.sentinel.device_readings.models import readings_table
from src.sentinel.history import DatabaseHistory

SERIAL = "SN-0001"
SECRET = "factory-secret-0123456789"


def run(test):
    """Run an async test body with a fresh schema, two users and one registered device."""
    async def main():
        engine = create_async_engine(database_url(), poolclass=NullPool)
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb"))
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            session.add_all([User(id=1, email="a@x.io", hashed_password="-"), User(id=2, email="b@x.io", hashed_password="-")])
            await session.flush()
            await DeviceService(session).start_pairing(device_id=SERIAL, secret=SECRET)
            await session.commit()
            try:
                await test(DeviceService(session), session)
            finally:
                await session.rollback()
        await engine.dispose()
    asyncio.run(main())


async def pair(service: DeviceService, user_id: int) -> str:
    pairing, _ = await service.start_pairing(device_id=SERIAL, secret=SECRET)
    await service.confirm(code=pairing.id, user_id=user_id)
    return await service.claim_token(code=pairing.id, device_id=SERIAL, secret=SECRET)


def test_full_flow_issues_working_token():
    async def body(service, _):
        pairing, url = await service.start_pairing(device_id=SERIAL, secret=SECRET)
        assert url.endswith("/" + pairing.id)
        with pytest.raises(PairingPending):
            await service.claim_token(code=pairing.id, device_id=SERIAL, secret=SECRET)
        assert await service.confirm(code=pairing.id, user_id=1) == SERIAL  # unowned -> owned
        token = await service.claim_token(code=pairing.id, device_id=SERIAL, secret=SECRET)

        device = await service.get_by_token(token)
        assert device.device_id == SERIAL and device.user_id == 1
        assert device.token_hash != token  # only the hash is stored
    run(body)


def test_token_is_delivered_once():
    async def body(service, _):
        pairing, _ = await service.start_pairing(device_id=SERIAL, secret=SECRET)
        await service.confirm(code=pairing.id, user_id=1)
        await service.claim_token(code=pairing.id, device_id=SERIAL, secret=SECRET)
        with pytest.raises(PairingNotFound):
            await service.claim_token(code=pairing.id, device_id=SERIAL, secret=SECRET)
    run(body)


def test_wrong_secret_or_unknown_serial_is_rejected():
    async def body(service, _):
        with pytest.raises(DeviceAuthError):
            await service.start_pairing(device_id=SERIAL, secret="wrong")
        with pytest.raises(DeviceAuthError):
            await service.claim_token(code="nope", device_id="SN-NOPE", secret=SECRET)
        pairing, _ = await service.start_pairing(device_id=SERIAL, secret=SECRET)
        await service.confirm(code=pairing.id, user_id=1)
        with pytest.raises(DeviceAuthError):
            await service.claim_token(code=pairing.id, device_id=SERIAL, secret="wrong")
    run(body)


def test_token_for_another_devices_code_is_refused():
    async def body(service, _):
        await service.start_pairing(device_id="SN-0002", secret=SECRET)
        pairing, _ = await service.start_pairing(device_id=SERIAL, secret=SECRET)
        await service.confirm(code=pairing.id, user_id=1)
        with pytest.raises(PairingNotFound):
            await service.claim_token(code=pairing.id, device_id="SN-0002", secret=SECRET)
    run(body)


def test_expired_code_is_refused():
    async def body(service, session):
        pairing, _ = await service.start_pairing(device_id=SERIAL, secret=SECRET)
        pairing.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await session.flush()
        with pytest.raises(PairingExpired):
            await service.get_pairing(pairing.id)
        with pytest.raises(PairingExpired):
            await service.confirm(code=pairing.id, user_id=1)
    run(body)


def test_new_pairing_cancels_the_older_code():
    async def body(service, _):
        old, _ = await service.start_pairing(device_id=SERIAL, secret=SECRET)
        await service.start_pairing(device_id=SERIAL, secret=SECRET)
        with pytest.raises(PairingNotFound):
            await service.confirm(code=old.id, user_id=1)
    run(body)


def test_second_user_cannot_confirm_the_same_code():
    async def body(service, _):
        pairing, _ = await service.start_pairing(device_id=SERIAL, secret=SECRET)
        await service.confirm(code=pairing.id, user_id=1)
        with pytest.raises(PairingNotFound):
            await service.confirm(code=pairing.id, user_id=2)
    run(body)


def test_new_owner_revokes_previous_token():
    async def body(service, _):
        old_token = await pair(service, user_id=1)
        pairing, _ = await service.start_pairing(device_id=SERIAL, secret=SECRET)
        assert await service.confirm(code=pairing.id, user_id=2) == SERIAL
        assert await service.get_by_token(old_token) is None  # dead before the device even claims
        new_token = await service.claim_token(code=pairing.id, device_id=SERIAL, secret=SECRET)
        assert (await service.get_by_token(new_token)).user_id == 2
    run(body)


def test_same_owner_repairing_keeps_paired_at():
    async def body(service, _):
        await pair(service, user_id=1)
        paired_at = (await service.get(SERIAL)).paired_at
        assert paired_at is not None
        pairing, _ = await service.start_pairing(device_id=SERIAL, secret=SECRET)
        assert await service.confirm(code=pairing.id, user_id=1) is None  # nothing revoked
        assert (await service.get(SERIAL)).paired_at == paired_at
    run(body)


def test_unpair_revokes_token_and_ownership():
    async def body(service, _):
        token = await pair(service, user_id=1)
        with pytest.raises(PairingNotFound):
            await service.unpair(device_id=SERIAL, user_id=2)  # not theirs
        await service.unpair(device_id=SERIAL, user_id=1)
        device = await service.get(SERIAL)
        assert await service.get_by_token(token) is None
        assert device.user_id is None and device.paired_at is None
    run(body)


def test_new_owner_does_not_see_previous_owners_history():
    async def body(service, session):
        now = datetime.now(timezone.utc)
        await pair(service, user_id=1)
        # Backdate the first owner's pairing so their readings fall inside the chart window.
        (await service.get(SERIAL)).paired_at = now - timedelta(minutes=50)
        old = now - timedelta(minutes=40)
        await session.execute(insert(readings_table).values(time=old, device_id=SERIAL, sensor="Centre", temp_c=20.0, status="ok"))

        first = await DatabaseHistory(session, since=(await service.get(SERIAL)).paired_at).readings(SERIAL, 60)
        assert len(first["points"]) == 1

        await pair(service, user_id=2)
        await session.execute(insert(readings_table).values(time=datetime.now(timezone.utc), device_id=SERIAL, sensor="Centre", temp_c=25.0, status="ok"))
        device = await service.get(SERIAL)
        assert device.paired_at > old
        second = await DatabaseHistory(session, since=device.paired_at).readings(SERIAL, 60)
        assert [p["Centre"] for p in second["points"]] == [25.0]
    run(body)


def test_first_contact_registers_and_locks_the_secret():
    async def body(service, _):
        assert await service.get("SN-NEW") is None
        await service.start_pairing(device_id="SN-NEW", secret=SECRET)
        device = await service.get("SN-NEW")
        assert device is not None and device.user_id is None
        assert device.secret_hash != SECRET  # only the hash is stored
        with pytest.raises(DeviceAuthError):
            await service.start_pairing(device_id="SN-NEW", secret="another-secret-0123456789")
    run(body)
