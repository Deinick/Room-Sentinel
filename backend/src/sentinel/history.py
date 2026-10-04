"""Readings and metrics over time, for charts.

A chart never gets raw seconds: 24 hours would be 86,400 points per sensor. The bucket size
is chosen from the time range so every answer has a few hundred points.

Two sources with the same output:
- RecentHistory: in memory, bounded (24 h at 10-s resolution). Used for demo devices, whose
  data never goes to the database.
- DatabaseHistory: TimescaleDB (readings / metrics tables) for real devices.
"""

from collections import deque
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.sentinel.config import SENSOR_NAMES
from src.sentinel.models import IssueEvent, Metric, Reading
from src.sentinel.storage import Storage

# (up to this many minutes, bucket seconds): about 300-600 points for any range
BUCKETS=[(10,1),(60,10),(6*60,60),(24*60,300),(7*24*60,1800),(30*24*60,7200)]
MAX_MINUTES=BUCKETS[-1][0]


def bucket_seconds(minutes: float, finest: int=1) -> int:
    for limit,seconds in BUCKETS:
        if minutes<=limit:
            return max(seconds,finest)
    return BUCKETS[-1][1]


def _bucket_start(time: datetime, seconds: int) -> datetime:
    return datetime.fromtimestamp(time.timestamp()//seconds*seconds,tz=time.tzinfo)


class RecentHistory(Storage):
    """The last 24 hours per device at 10-second resolution, plus metrics. Memory stays bounded."""

    BLOCK_SECONDS=10

    def __init__(self, keep: timedelta=timedelta(hours=24)):
        self._blocks: dict[str,deque]={}  # device -> deque[(block time, {sensor: mean})]
        self._open: dict[str,tuple[datetime,dict,dict]]={}  # device -> (block time, sums, counts)
        self._metrics: dict[str,deque]={}  # device -> deque[Metric]
        self._max_blocks=int(keep.total_seconds()//self.BLOCK_SECONDS)
        self._max_metrics=int(keep.total_seconds()//60)*8  # a handful of metrics a minute

    def save_reading(self, reading: Reading) -> None:
        start=_bucket_start(reading.time,self.BLOCK_SECONDS)
        current=self._open.get(reading.device_id)
        if current is not None and current[0]!=start:
            self._close(reading.device_id,current)
            current=None
        if current is None:
            current=(start,{},{})
            self._open[reading.device_id]=current
        _,sums,counts=current
        for name,value in reading.sensors.items():
            if value.ok:
                sums[name]=sums.get(name,0.0)+value.temp_c
                counts[name]=counts.get(name,0)+1

    def _close(self, device_id: str, block: tuple[datetime,dict,dict]) -> None:
        start,sums,counts=block
        blocks=self._blocks.setdefault(device_id,deque(maxlen=self._max_blocks))
        blocks.append((start,{n:sums[n]/counts[n] for n in sums}))

    def save_metrics(self, metrics: list[Metric]) -> None:
        for m in metrics:
            self._metrics.setdefault(m.device_id,deque(maxlen=self._max_metrics)).append(m)

    def save_event(self, event: IssueEvent) -> None:
        pass  # open issues are in the live view; demo events aren't kept

    def readings(self, device_id: str, minutes: float) -> dict:
        seconds=bucket_seconds(minutes,finest=self.BLOCK_SECONDS)
        blocks=self._blocks.get(device_id,())
        if not blocks:
            return {"bucket_seconds":seconds,"points":[]}
        start=blocks[-1][0]-timedelta(minutes=minutes)
        buckets: dict[datetime,dict[str,list[float]]]={}
        for time,temps in blocks:
            if time>start:
                bucket=buckets.setdefault(_bucket_start(time,seconds),{})
                for name,value in temps.items():
                    bucket.setdefault(name,[]).append(value)
        points=[{"time":t.isoformat(),**{n:(round(sum(v)/len(v),3) if (v:=temps.get(n)) else None) for n in SENSOR_NAMES}}
                for t,temps in sorted(buckets.items())]
        return {"bucket_seconds":seconds,"points":points}

    def metrics(self, device_id: str, minutes: float, names: set[str] | None) -> dict:
        seconds=bucket_seconds(minutes,finest=60)
        stored=self._metrics.get(device_id,())
        if not stored:
            return {"bucket_seconds":seconds,"series":{}}
        start=stored[-1].time-timedelta(minutes=minutes)
        buckets: dict[str,dict[datetime,list[float]]]={}
        for m in stored:
            if m.time>start and (names is None or m.name in names):
                buckets.setdefault(m.name,{}).setdefault(_bucket_start(m.time,seconds),[]).append(m.value)
        series={name:[{"time":t.isoformat(),"value":round(sum(v)/len(v),4)} for t,v in sorted(b.items())]
                for name,b in buckets.items()}
        return {"bucket_seconds":seconds,"series":series}


class DatabaseHistory:
    """The same answers from TimescaleDB, for real devices. Bad readings (temp_c NULL) are skipped.

    Once the 1-minute continuous aggregate exists (B10), ranges over a few hours should read
    from it instead of the raw table; until then this aggregates raw rows.
    """

    def __init__(self, session: AsyncSession):
        self.session=session

    async def readings(self, device_id: str, minutes: float) -> dict:
        seconds=bucket_seconds(minutes)
        rows=await self.session.execute(text("""
            SELECT time_bucket(make_interval(secs => :seconds), time) AS bucket, sensor, avg(temp_c) AS value
            FROM readings
            WHERE device_id = :device AND time > now() - make_interval(mins => :minutes) AND temp_c IS NOT NULL
            GROUP BY bucket, sensor
            ORDER BY bucket
        """),{"seconds":seconds,"device":device_id,"minutes":int(minutes)})
        buckets: dict[datetime,dict[str,float]]={}
        for bucket,sensor,value in rows:
            buckets.setdefault(bucket,{})[sensor]=round(value,3)
        points=[{"time":t.isoformat(),**{n:temps.get(n) for n in SENSOR_NAMES}} for t,temps in buckets.items()]
        return {"bucket_seconds":seconds,"points":points}

    async def metrics(self, device_id: str, minutes: float, names: set[str] | None) -> dict:
        seconds=bucket_seconds(minutes,finest=60)
        rows=await self.session.execute(text("""
            SELECT time_bucket(make_interval(secs => :seconds), time) AS bucket, name, avg(value) AS value
            FROM metrics
            WHERE device_id = :device AND time > now() - make_interval(mins => :minutes)
            GROUP BY bucket, name
            ORDER BY bucket
        """),{"seconds":seconds,"device":device_id,"minutes":int(minutes)})
        series: dict[str,list[dict]]={}
        for bucket,name,value in rows:
            if names is None or name in names:
                series.setdefault(name,[]).append({"time":bucket.isoformat(),"value":round(value,4)})
        return {"bucket_seconds":seconds,"series":series}
