"""
Reading pipeline: parse each line, validate its temperatures, keep the newest
reading per device in memory, and persist every reading to the readings table.
"""

import logging
from collections.abc import Iterable
from datetime import datetime, timezone

import psycopg

from .parser import parse_line
from .validate import check_all

logger = logging.getLogger(__name__)

latest: dict[str, dict] = {}  # newest reading per device: {"room-101": {...}, "room-202": {...}}


def save_reading(conn: psycopg.Connection, device_id: str, time: datetime, sensors: dict) -> None:
    with conn.cursor() as cur:
        for name, s in sensors.items():
            cur.execute(
                "INSERT INTO readings (time, device_id, sensor, temp_c, status) VALUES (%s, %s, %s, %s, %s)",
                (time, device_id, name, s["temp"], s["status"]),
            )


def read_loop(lines: Iterable[str]) -> None:
    conn = None
    for line in lines:
        frame = parse_line(line)
        if frame is None:
            logger.info("Skipped: %r", line)
            continue

        now = datetime.now(timezone.utc)
        sensors = {name: {"temp": temp, "status": label} for name, (temp, label) in check_all(frame["temps"]).items()}

        latest[frame["id"]] = {"time": now.isoformat(), "sensors": sensors}
        try:
            if conn is None:
                # No arguments: psycopg reads PGHOST, PGUSER, PGPASSWORD, ... from the environment (.env).
                conn = psycopg.connect(autocommit=True)
            save_reading(conn, frame["id"], now, sensors)
        except psycopg.Error as exc:
            # Don't let a database problem stop the reader: /latest stays live,
            # and we reconnect on the next reading.
            logger.error("Database error, reading not saved: %s", exc)
            if conn is not None:
                conn.close()
            conn = None
        logger.info("Reading from %s at %s", frame["id"], now.strftime("%H:%M:%S"))
