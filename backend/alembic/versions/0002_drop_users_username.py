"""drop users.username

Revision ID: 0002_drop_users_username
Revises: 0001_readings
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_drop_users_username"
down_revision: Union[str, Sequence[str], None] = "0001_readings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(op.f("uq_users_username"), "users", type_="unique")
    op.drop_column("users", "username")


def downgrade() -> None:
    # Backfill existing rows from email so the NOT NULL + UNIQUE constraints hold.
    op.add_column("users", sa.Column("username", sa.String(), nullable=True))
    op.execute("UPDATE users SET username = email")
    op.alter_column("users", "username", nullable=False)
    op.create_unique_constraint(op.f("uq_users_username"), "users", ["username"])
