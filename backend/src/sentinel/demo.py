"""Demo mode: a simulated device running inside the API, shown exactly like a real one.

Each demo device has its own pipeline with the same analyzers and notification channels as
real devices, but:
- it runs on simulated time, so at 60x a minute of room passes every real second,
- nothing is written to the database (60 fake readings a second would fill it with nonsense),
- "device silent" is left out, because pausing the demo isn't a silent device,
- every signed-in user can see it (api.py).

The API's timer calls advance_real() once a second; controls (B4) call the methods below.
"""

import os
import threading
from datetime import datetime, timedelta, timezone

from src.sentinel.advice import advise
from src.sentinel.ingest.validate import to_reading
from src.sentinel.issues import IssueTracker
from src.sentinel.live import LIVE, LiveView
from src.sentinel.notify.base import Channel
from src.sentinel.pipeline import Pipeline
from src.sentinel.run import build_analyzers, build_channels
from src.sentinel.sim.device import SimulatedDevice
from src.sentinel.storage import NullStorage

# Comma-separated ids; set DEMO_DEVICES="" to switch demo mode off.
DEMO_DEVICES=[d.strip() for d in os.environ.get("DEMO_DEVICES","demo-101").split(",") if d.strip()]
MAX_SPEED=120  # x real time; 120 readings a second per demo device
WARM_UP_SECONDS=2*3600  # quiet history so the room and the analyzers are settled before anyone looks


class DemoRunner:
    def __init__(self, device_id: str, live: LiveView=LIVE, channels: list[Channel] | None=None, seed: int=1):
        self.device_id=device_id
        self.seed=seed
        self.live=live
        self.channels=build_channels() if channels is None else channels
        self.speed=1.0
        self.paused=False
        self._carry=0.0  # simulated seconds owed but not yet run (speed can be fractional)
        self._lock=threading.RLock()  # the timer and the controls both touch the device
        live.mark_demo(device_id)
        self._build()

    def _build(self) -> None:
        # Start in the past so that after warming up the simulated clock is at "now".
        start=datetime.now(timezone.utc)-timedelta(seconds=WARM_UP_SECONDS)
        self.device=SimulatedDevice(self.device_id,seed=self.seed,start=start)
        analyzers=[a for a in build_analyzers() if a.name!="device_silence"]
        self.pipeline=Pipeline(analyzers,IssueTracker(advise),NullStorage(),self.channels,live=self.live)

    def warm_up(self, seconds: int=WARM_UP_SECONDS) -> None:
        """Feed quiet history through the analyzers without notifying anyone."""
        with self._lock:
            self.pipeline.channels=[]
            try:
                self._run(seconds)
            finally:
                self.pipeline.channels=self.channels

    def advance_real(self, real_seconds: float) -> int:
        """Move the simulation on by real_seconds x speed. Returns how many readings were produced."""
        with self._lock:
            if self.paused:
                return 0
            self._carry+=real_seconds*self.speed
            seconds=int(self._carry)
            self._carry-=seconds
            return self._run(seconds)

    def set_speed(self, speed: float) -> None:
        if not 0<speed<=MAX_SPEED:
            raise ValueError(f"speed must be between 0 and {MAX_SPEED}")
        with self._lock:
            self.speed=speed

    def set_paused(self, paused: bool) -> None:
        with self._lock:
            self.paused=paused

    def _run(self, seconds: int) -> int:
        for time,frame in self.device.advance(seconds):
            self.pipeline.process(to_reading(frame,time))
        if seconds:
            self.pipeline.tick(self.device.time)  # time-based analyzers run on simulated time too
        return seconds

    def state(self) -> dict:
        with self._lock:
            return {"device_id":self.device_id,"speed":self.speed,"paused":self.paused,**self.device.truth()}
