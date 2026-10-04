from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class Device(Base):
    """A controller made at the factory. user_id is set once a user pairs it."""
    __tablename__ = "devices"

    # The device serial number.
    device_id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    # SHA-256 of the manufacturing secret. Survives factory reset; proves which device is calling.
    secret_hash: Mapped[str] = mapped_column(String, nullable=False)
    # SHA-256 of the current device token. Replaced on every pairing, cleared on unpair.
    token_hash: Mapped[Optional[str]] = mapped_column(String, nullable=True, unique=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )

    # onupdate ensures this is refreshed on every UPDATE, not just INSERT.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    def __repr__(self) -> str:
        return f"<Device device_id={self.device_id!r} user_id={self.user_id}>"


class PairingSession(Base):
    """
    A single-use link between a device asking to be paired and the user who confirms it.
    The id is the secret part of the pairing URL shown as a QR code.
    """
    __tablename__ = "pairing_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    device_id: Mapped[str] = mapped_column(String, ForeignKey("devices.device_id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Set when a signed-in user confirms the serial number.
    confirmed_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    # Set when the device has collected its token. The session is dead after that.
    consumed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
