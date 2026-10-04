"""Fill the database with 6 hours of simulated history for one test device, ending now.

    python -m src.sentinel.seed                  # device "test-room-1"
    python -m src.sentinel.seed --device lab-2
    python -m src.sentinel.seed --owner ts@ts.com  # paired to that account, so its apps show it

The simulated room goes through a few incidents so the charts and the issue table have
something to show: a quiet start, an open window, an unplugged probe, then a heater failure.
Readings go through the real analyzers, so metrics and issue events are the real ones too.
Running it again replaces that device's earlier data.
"""

import argparse
from datetime import datetime, timedelta, timezone

import psycopg

from src.sentinel.advice import advise
from src.sentinel.ingest.validate import to_reading
from src.sentinel.issues import IssueTracker
from src.sentinel.pipeline import Pipeline
from src.sentinel.profiles import PROFILES
from src.sentinel.run import build_analyzers
from src.sentinel.sim.device import SimulatedDevice
from src.sentinel.storage import INSERT_EVENT, MemoryStorage, event_row

# (scenario, hours to run it)
PLAN=[("quiet",2),("window_open",1),("sensor_unplugged",1),("heater_failure",2)]


def simulate(device_id: str, start: datetime) -> MemoryStorage:
    device=SimulatedDevice(device_id,start=start)
    # "device silent" needs wall-clock ticks, which a replay doesn't have.
    analyzers=[a for a in build_analyzers() if a.name!="device_silence"]
    storage=MemoryStorage()
    pipeline=Pipeline(analyzers,IssueTracker(advise),storage,[])
    for scenario,h in PLAN:
        device.load_scenario(scenario)
        for time,frame in device.advance(h*3600):
            PROFILES.set_outside(device_id,device.room.controls.outside_c)
            pipeline.process(to_reading(frame,time))
    return storage


def save(device_id: str, data: MemoryStorage, owner: str | None, start: datetime) -> None:
    with psycopg.connect() as conn, conn.cursor() as cur:
        now=datetime.now(timezone.utc)
        # readings.device_id references devices; a test device can't be paired, so it has no secret.
        cur.execute("INSERT INTO devices (device_id, secret_hash, created_at, updated_at) VALUES (%s, '!', %s, %s)"
                    " ON CONFLICT (device_id) DO NOTHING",(device_id,now,now))
        if owner:
            cur.execute("SELECT id FROM users WHERE email = %s",(owner,))
            user=cur.fetchone()
            if user is None:
                raise SystemExit(f"No user {owner!r}.")
            # paired_at at the first reading: owners see history from pairing on.
            cur.execute("UPDATE devices SET user_id = %s, paired_at = %s, updated_at = %s"
                        " WHERE device_id = %s AND (user_id IS NULL OR user_id = %s)",(user[0],start,now,device_id,user[0]))
            if cur.rowcount==0:
                raise SystemExit(f"{device_id!r} belongs to another account.")
        for table in ("readings","metrics","issue_events"):
            cur.execute(f"DELETE FROM {table} WHERE device_id = %s",(device_id,))
        with cur.copy("COPY readings (time, device_id, sensor, temp_c, status) FROM STDIN") as copy:
            for r in data.readings:
                for name,v in r.sensors.items():
                    copy.write_row((r.time,r.device_id,name,v.temp_c,v.status))
        with cur.copy("COPY metrics (time, device_id, name, sensor, value) FROM STDIN") as copy:
            for m in data.metrics:
                copy.write_row((m.time,m.device_id,m.name,m.sensor,m.value))
        cur.executemany(INSERT_EVENT,[event_row(e) for e in data.events])


def main():
    ap=argparse.ArgumentParser(prog="python -m src.sentinel.seed")
    ap.add_argument("--device",default="test-room-1")
    ap.add_argument("--owner",help="email of the account to pair the device to")
    args=ap.parse_args()
    start=datetime.now(timezone.utc)-timedelta(hours=sum(h for _,h in PLAN))
    data=simulate(args.device,start)
    save(args.device,data,args.owner,start)
    print(f"{args.device}{f' (owner {args.owner})' if args.owner else ''}: {len(data.readings)} readings, {len(data.metrics)} metrics, {len(data.events)} issue events")


if __name__=="__main__":
    main()
