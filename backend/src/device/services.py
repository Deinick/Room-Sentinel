"""Device provisioning and the account pairing flow.

    device  -> start_pairing(serial, secret)      -> pairing URL (shown as QR code)
    user    -> get_pairing(code) / confirm(code)  -> device linked to the account
    device  -> claim_token(code, serial, secret)  -> device token, delivered once

The user's password only ever reaches the server. The device proves itself with its
manufacturing secret until it holds a device token.
"""

import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from src.services import BaseService
from .models import Device, PairingSession

logger = logging.getLogger(__name__)

PAIRING_TTL = timedelta(minutes=10)
# Where the website serves the pairing page; the code is appended as the last path segment.
PAIRING_URL_BASE = os.environ.get("PAIRING_URL_BASE", "http://localhost:8000/pair")


class DeviceAuthError(Exception):
    """Unknown serial number or wrong manufacturing secret."""


class PairingNotFound(Exception):
    """No such pairing code, or it was already used."""


class PairingExpired(Exception):
    pass


class PairingPending(Exception):
    """The user has not confirmed yet; the device should ask again shortly."""


def _hash(value: str) -> str:
    # Secrets and tokens are long random strings, so a fast hash is enough
    # and lets token lookups use an index.
    return hashlib.sha256(value.encode()).hexdigest()


class DeviceService(BaseService):

    async def get(self, device_id: str) -> Optional[Device]:
        return await self.session.get(Device, device_id)

    async def list_for_user(self, user_id: int) -> list[Device]:
        stmt = select(Device).where(Device.user_id == user_id).order_by(Device.device_id)
        return list(await self.session.scalars(stmt))

    async def get_by_token(self, token: str) -> Optional[Device]:
        """Resolve a device token. For authenticating the device's telemetry connection."""
        return await self.session.scalar(select(Device).where(Device.token_hash == _hash(token)))

    async def provision(self, *, device_id: str, secret: str) -> Device:
        """Record a newly manufactured device and its secret."""
        device = Device(device_id=device_id, secret_hash=_hash(secret))
        self.session.add(device)
        try:
            await self.session.flush()
        except IntegrityError:
            await self.session.rollback()
            raise ValueError("A device with that serial number already exists.")
        await self.session.refresh(device)
        logger.info("Device %r provisioned.", device_id)
        return device

    async def unpair(self, *, device_id: str, user_id: int) -> None:
        """Detach a device from its owner and revoke its token."""
        device = await self.get(device_id)
        if device is None or device.user_id != user_id:
            raise PairingNotFound()
        device.user_id = None
        device.token_hash = None
        await self.session.flush()
        logger.info("Device %r unpaired from user id=%d.", device_id, user_id)

    async def _authenticate(self, device_id: str, secret: str) -> Device:
        device = await self.get(device_id)
        if device is None or not hmac.compare_digest(device.secret_hash, _hash(secret)):
            raise DeviceAuthError()
        return device

    # -----------------------------------------------------------------------
    # Pairing
    # -----------------------------------------------------------------------

    async def start_pairing(self, *, device_id: str, secret: str) -> tuple[PairingSession, str]:
        """Open a pairing session for the device. Any earlier open session for it stops working."""
        device = await self._authenticate(device_id, secret)
        now = datetime.now(timezone.utc)

        await self.session.execute(
            update(PairingSession)
            .where(PairingSession.device_id == device.device_id, PairingSession.consumed_at.is_(None))
            .values(consumed_at=now)
        )
        pairing = PairingSession(
            id=secrets.token_urlsafe(16),
            device_id=device.device_id,
            created_at=now,
            expires_at=now + PAIRING_TTL,
        )
        self.session.add(pairing)
        await self.session.flush()
        logger.info("Pairing started for device %r.", device_id)
        return pairing, f"{PAIRING_URL_BASE}/{pairing.id}"

    async def _open_session(self, code: str) -> PairingSession:
        """Lock and return a usable session. Row lock serialises confirm and claim on the same code."""
        pairing = await self.session.scalar(
            select(PairingSession).where(PairingSession.id == code).with_for_update()
        )
        if pairing is None or pairing.consumed_at is not None:
            raise PairingNotFound()
        if pairing.expires_at <= datetime.now(timezone.utc):
            raise PairingExpired()
        return pairing

    async def get_pairing(self, code: str) -> PairingSession:
        return await self._open_session(code)

    async def confirm(self, *, code: str, user_id: int) -> None:
        """The signed-in user confirmed the serial number: link the device to their account."""
        pairing = await self._open_session(code)
        if pairing.confirmed_by is not None and pairing.confirmed_by != user_id:
            raise PairingNotFound()

        device = await self.get(pairing.device_id)
        assert device is not None  # FK guarantees it.
        if device.user_id != user_id:
            # Physical possession plus a factory reset is what transfers a device,
            # so the previous owner's token stops working here.
            device.token_hash = None
        device.user_id = user_id
        pairing.confirmed_by = user_id
        await self.session.flush()
        logger.info("Device %r linked to user id=%d.", device.device_id, user_id)

    async def claim_token(self, *, code: str, device_id: str, secret: str) -> str:
        """Hand the device its token once the user has confirmed. Single use."""
        device = await self._authenticate(device_id, secret)
        pairing = await self._open_session(code)
        if pairing.device_id != device.device_id:
            raise PairingNotFound()
        if pairing.confirmed_by is None:
            raise PairingPending()

        # Generated here, not at confirm time, so the plaintext is never stored.
        token = secrets.token_urlsafe(32)
        device.token_hash = _hash(token)
        pairing.consumed_at = datetime.now(timezone.utc)
        await self.session.flush()
        logger.info("Device token issued to %r.", device_id)
        return token
