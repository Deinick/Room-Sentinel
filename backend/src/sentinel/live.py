"""What's happening right now, kept in memory for the API: newest reading per device and open issues.

The pipeline updates it; the API (api.py) reads it. Works only when the reader runs in the
same process as the API (python -m src.sentinel.run --api). History lives in the database.
"""

import threading
import time

from src.sentinel.models import EventType, IssueEvent, Reading

LIVE_SECONDS=5  # the device sends every second, so older than this means it went quiet


class LiveView:
    def __init__(self):
        # Newest reading per device, with when it arrived (monotonic clock). Age is measured from
        # arrival, not from reading.time, because the demo device's clock can run faster than real time.
        self._latest: dict[str,tuple[Reading,float]]={}
        self._open: dict[str,IssueEvent]={}  # issue key -> newest event
        self._demo: set[str]=set()
        self._lock=threading.Lock()

    def mark_demo(self, device_id: str) -> None:
        with self._lock:
            self._demo.add(device_id)

    def on_reading(self, reading: Reading) -> None:
        with self._lock:
            self._latest[reading.device_id]=(reading,time.monotonic())

    def on_event(self, event: IssueEvent) -> None:
        with self._lock:
            if event.type==EventType.RESOLVED:
                self._open.pop(event.finding.key,None)
            else:
                self._open[event.finding.key]=event

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
            "opened_at":e.opened_at.isoformat(),
            "last_event":e.type.value,
            "recommendations":[r.action for r in e.recommendations],
        } for e in events]


LIVE=LiveView()
