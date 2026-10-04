"""devices.min_temperature and devices.max_temperature

Revision ID: 0007_device_temperature_limits
Revises: 0006_device_settings
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007_device_temperature_limits"
down_revision: Union[str, Sequence[str], None] = "0006_device_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("min_temperature", sa.Float(), nullable=True))
    op.add_column("devices", sa.Column("max_temperature", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("devices", "max_temperature")
    op.drop_column("devices", "min_temperature")
