"""Saving everything the pipeline produces. Tables are created by Alembic (alembic/versions/)."""

import logging

import psycopg
from psycopg.types.json import Jsonb

from src.sentinel.models import IssueEvent, Metric, Reading

log=logging.getLogger(__name__)


class Storage:
    def save_reading(self, reading: Reading) -> None: ...
    def save_metrics(self, metrics: list[Metric]) -> None: ...
    def save_event(self, event: IssueEvent) -> None: ...


class MemoryStorage(Storage):
    """Keeps everything in lists. For tests and for running without a database (--no-db)."""

    def __init__(self):
        self.readings: list[Reading]=[]
        self.metrics: list[Metric]=[]
        self.events: list[IssueEvent]=[]

    def save_reading(self, reading): self.readings.append(reading)
    def save_metrics(self, metrics): self.metrics.extend(metrics)
    def save_event(self, event): self.events.append(event)


INSERT_EVENT=("INSERT INTO issue_events (time, device_id, issue_key, kind, sensor, severity, event, message,"
              " evidence, recommendations, opened_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)")


def event_row(event):
    f=event.finding
    recommendations=[{"action":r.action,"severity":r.severity.name,"command":r.command}
                     for r in event.recommendations]
    return (event.time,f.device_id,f.key,f.kind,f.sensor,f.severity.name,event.type.value,f.message,
            Jsonb(f.evidence),Jsonb(recommendations),event.opened_at)


class PostgresStorage(Storage):
    """TimescaleDB / Tiger Cloud. Connection settings come from PGHOST, PGUSER, PGPASSWORD, ... (.env).

    A database problem is logged and that write is skipped; it never stops the pipeline.
    It reconnects on the next write.
    """

    def __init__(self):
        self._conn=None

    def save_reading(self, reading):
        rows=[(reading.time,reading.device_id,name,v.temp_c,v.status) for name,v in reading.sensors.items()]
        self._write(
            "INSERT INTO readings (time, device_id, sensor, temp_c, status) VALUES (%s, %s, %s, %s, %s)",rows)

    def save_metrics(self, metrics):
        rows=[(m.time,m.device_id,m.name,m.sensor,m.value) for m in metrics]
        self._write("INSERT INTO metrics (time, device_id, name, sensor, value) VALUES (%s, %s, %s, %s, %s)",rows)

    def save_event(self, event):
        self._write(INSERT_EVENT,[event_row(event)])

    def _write(self, sql, rows):
        if not rows:
            return
        try:
            if self._conn is None:
                self._conn=psycopg.connect(autocommit=True)
            with self._conn.cursor() as cur:
                cur.executemany(sql,rows)
        except psycopg.Error as e:
            log.error("database write failed, data not saved: %s",e)
            if self._conn is not None:
                self._conn.close()
            self._conn=None
