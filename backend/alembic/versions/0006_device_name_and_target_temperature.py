"""devices.name and devices.target_temperature

Revision ID: 0006_device_settings
Revises: 0005_device_readings
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006_device_settings"
down_revision: Union[str, Sequence[str], None] = "0005_device_readings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("name", sa.String(), nullable=True))
    op.add_column("devices", sa.Column("target_temperature", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("devices", "target_temperature")
    op.drop_column("devices", "name")
