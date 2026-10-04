"""device_readings hypertable

Revision ID: 0005_device_readings
Revises: 0004_devices_and_pairing
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0005_device_readings"
down_revision: Union[str, Sequence[str], None] = "0004_devices_and_pairing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Envelope of each reading streamed by an ESP32; temperatures live in `readings`.
    op.execute("""
        CREATE TABLE device_readings (
            time       TIMESTAMPTZ NOT NULL,
            device_id  TEXT NOT NULL,
            seq        BIGINT NOT NULL,
            uptime_ms  BIGINT NOT NULL,
            CONSTRAINT pk_device_readings PRIMARY KEY (device_id, time)
        )
    """)
    op.execute("SELECT create_hypertable('device_readings', by_range('time'))")


def downgrade() -> None:
    op.execute("DROP TABLE device_readings")
