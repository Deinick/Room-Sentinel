"""readings hypertable

Revision ID: 0001_readings
Revises:
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0001_readings"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    # One row per sensor per reading. temp_c is NULL when the reading was bad;
    # status says why (ok, missing, disconnected, power_on, out_of_range).
    op.execute("""
        CREATE TABLE readings (
            time       TIMESTAMPTZ NOT NULL,
            device_id  TEXT NOT NULL,
            sensor     TEXT NOT NULL,
            temp_c     DOUBLE PRECISION,
            status     TEXT NOT NULL
        )
    """)
    op.execute("SELECT create_hypertable('readings', by_range('time'))")


def downgrade() -> None:
    op.execute("DROP TABLE readings")
