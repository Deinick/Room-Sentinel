"""metrics hypertable and issue_events table

Revision ID: 0003_metrics_and_issue_events
Revises: 0002_drop_users_username
Create Date: 2026-10-03

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003_metrics_and_issue_events"
down_revision: Union[str, Sequence[str], None] = "0002_drop_users_username"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Numbers analyzers produce for graphs (cooling rate, sensors_ok, forecast, ...).
    op.execute("""
        CREATE TABLE metrics (
            time       TIMESTAMPTZ NOT NULL,
            device_id  TEXT NOT NULL,
            name       TEXT NOT NULL,
            sensor     TEXT,
            value      DOUBLE PRECISION NOT NULL
        )
    """)
    op.execute("SELECT create_hypertable('metrics', by_range('time'))")

    # Every opened / escalated / reminder / resolved event, with the advice given at the time.
    op.execute("""
        CREATE TABLE issue_events (
            time             TIMESTAMPTZ NOT NULL,
            device_id        TEXT NOT NULL,
            issue_key        TEXT NOT NULL,
            kind             TEXT NOT NULL,
            sensor           TEXT,
            severity         TEXT NOT NULL,
            event            TEXT NOT NULL,
            message          TEXT NOT NULL,
            evidence         JSONB NOT NULL,
            recommendations  JSONB NOT NULL,
            opened_at        TIMESTAMPTZ NOT NULL
        )
    """)
    op.execute("CREATE INDEX issue_events_key_time ON issue_events (issue_key, time DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE issue_events")
    op.execute("DROP TABLE metrics")
