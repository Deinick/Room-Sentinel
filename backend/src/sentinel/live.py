"""What's happening right now, kept in memory for the API: newest reading per device and open issues.

The pipeline updates it; the API (api.py) reads it. Works only when the reader runs in the
same process as the API (python -m src.sentinel.run --api). History lives in the database.
Dashboards follow changes through watch() (the /live stream in api.py).
"""

import asyncio
import threading
import time
from dataclasses import replace

from src.sentinel.models import EventType, Finding, IssueEvent, Reading, Recommendation

LIVE_SECONDS=5  # the device sends every second, so older than this means it went quiet


class LiveView:
    def __init__(self):
        # Newest reading per device, with when it arrived (monotonic clock). Age is measured from
        # arrival, not from reading.time, because the demo device's clock can run faster than real time.
        self._latest: dict[str,tuple[Reading,float]]={}
        self._open: dict[str,IssueEvent]={}  # issue key -> newest event
        self._demo: set[str]=set()
        self._lock=threading.Lock()
        # Open /live streams: each one's event loop and the event to set when something changes.
        self._watchers: set[tuple[asyncio.AbstractEventLoop,asyncio.Event]]=set()

    def watch(self) -> asyncio.Event:
        """An event set on every change to readings or issues. Call from the event loop; end with unwatch()."""
        watcher=(asyncio.get_running_loop(),asyncio.Event())
        with self._lock:
            self._watchers.add(watcher)
        return watcher[1]

    def unwatch(self, changed: asyncio.Event) -> None:
        with self._lock:
            self._watchers={w for w in self._watchers if w[1] is not changed}

    def _notify(self) -> None:
        """Wake every watcher. Callers hold the lock; the pipeline runs in worker threads, hence threadsafe."""
        for loop,changed in self._watchers:
            try:
                loop.call_soon_threadsafe(changed.set)
            except RuntimeError:
                pass  # its loop has closed; unwatch() removes it

    def mark_demo(self, device_id: str) -> None:
        with self._lock:
            self._demo.add(device_id)

    def forget(self, device_id: str) -> None:
        """Drop a device's newest reading and open issues (used when the demo is reset)."""
        with self._lock:
            self._latest.pop(device_id,None)
            self._open={k:e for k,e in self._open.items() if e.finding.device_id!=device_id}
            self._notify()

    def on_reading(self, reading: Reading) -> None:
        with self._lock:
            self._latest[reading.device_id]=(reading,time.monotonic())
            self._notify()

    def refresh(self, finding: Finding, recommendations: list[Recommendation]) -> None:
        """Keep an open issue's text, numbers and advice current between notifications."""
        with self._lock:
            event=self._open.get(finding.key)
            if event is not None:
                self._open[finding.key]=replace(event,finding=finding,recommendations=recommendations)
                self._notify()

    def on_event(self, event: IssueEvent) -> None:
        with self._lock:
            if event.type==EventType.RESOLVED:
                self._open.pop(event.finding.key,None)
            else:
                self._open[event.finding.key]=event
            self._notify()

    def latest(self) -> dict:
        now=time.monotonic()
        with self._lock:
            result={}
            for device_id,(r,arrived) in self._latest.items():
                age=now-arrived
                result[device_id]={
                    "time":r.time.isoformat(),
                    "mode":"demo" if device_id in self._demo else "device",
                    "age_seconds":round(age,1),
                    "live":age<LIVE_SECONDS,
                    "sensors":{name:{"temp":v.temp_c,"status":v.status} for name,v in r.sensors.items()},
                }
            return result

    def issues(self) -> list[dict]:
        with self._lock:
            events=sorted(self._open.values(),key=lambda e:e.opened_at)
        return [{
            "device_id":e.finding.device_id,
            "kind":e.finding.kind,
            "sensor":e.finding.sensor,
            "severity":e.finding.severity.name,
            "message":e.finding.message,
            "evidence":e.finding.evidence,  # numbers for the apps: side, rate, forecast_minutes, ...
            "opened_at":e.opened_at.isoformat(),
            "last_event":e.type.value,
            "recommendations":[r.action for r in e.recommendations],
        } for e in events]


LIVE=LiveView()
