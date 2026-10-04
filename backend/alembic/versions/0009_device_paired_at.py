"""devices.paired_at: owners only see readings from when they paired

Revision ID: 0009_device_paired_at
Revises: 0008_readings_device_fk
Create Date: 2026-10-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0009_device_paired_at"
down_revision: Union[str, Sequence[str], None] = "0008_readings_device_fk"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("paired_at", sa.DateTime(timezone=True), nullable=True))
    # Current owners keep their full history: no reading predates the device row.
    op.execute("UPDATE devices SET paired_at = created_at WHERE user_id IS NOT NULL")


def downgrade() -> None:
    op.drop_column("devices", "paired_at")
