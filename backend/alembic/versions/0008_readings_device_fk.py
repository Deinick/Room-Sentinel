"""readings.device_id references devices

Revision ID: 0008_readings_device_fk
Revises: 0007_device_temperature_limits
Create Date: 2026-10-04

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0008_readings_device_fk"
down_revision: Union[str, Sequence[str], None] = "0007_device_temperature_limits"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Readings from devices that were never registered cannot satisfy the constraint.
    op.execute("DELETE FROM readings WHERE device_id NOT IN (SELECT device_id FROM devices)")
    op.create_foreign_key(op.f("fk_readings_device_id_devices"), "readings", "devices", ["device_id"], ["device_id"])


def downgrade() -> None:
    op.drop_constraint(op.f("fk_readings_device_id_devices"), "readings", type_="foreignkey")
