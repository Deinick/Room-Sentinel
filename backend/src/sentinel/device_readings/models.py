from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, Double, Index, Table, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class DeviceReading(Base):
    """
    The envelope the ESP32 wraps around each STM32 reading.
    The temperatures go into `readings` in the same transaction, with the same
    (device_id, time), so the two join on those columns.

    seq gaps mean lost messages; uptime going down means the device rebooted.
    """
    __tablename__ = "device_readings"

    # time = when the server received the message (UTC), as for every reading.
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    device_id: Mapped[str] = mapped_column(Text, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    uptime_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)


# create_hypertable() adds this index; declared so autogenerate doesn't drop it. Same for readings below.
Index("device_readings_time_idx", DeviceReading.time.desc())


# One row per sensor per reading (alembic/versions/0001_readings.py). Also written by
# sentinel.storage.PostgresStorage for the serial reader.
readings_table = Table(
    "readings",
    Base.metadata,
    Column("time", DateTime(timezone=True), nullable=False),
    Column("device_id", Text, nullable=False),
    Column("sensor", Text, nullable=False),
    Column("temp_c", Double),
    Column("status", Text, nullable=False),
)
Index("readings_time_idx", readings_table.c.time.desc())
