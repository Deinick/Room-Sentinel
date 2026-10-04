"""A virtual device: the room, five probes and an optional scenario script.

It runs on its own simulated clock, one reading per simulated second, exactly like the real
device. Running faster than real time just means calling advance() with more seconds.

    device=SimulatedDevice("demo-101",scenario="window_open")
    device.settle(2*3600)                       # two quiet hours, so the room and the detector are warmed up
    for time,frame in device.advance(60):       # one simulated minute = 60 readings
        reading=to_reading(frame,time)          # the same path as a real device
"""

import random
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

from src.sentinel.config import SENSOR_NAMES
from src.sentinel.sim.probes import Probe, ProbeParams
from src.sentinel.sim.room import Controls, Room, RoomParams

# (minute, change). A change sets Controls fields, or acts on a probe:
# {"unplug": name}, {"plug": name}, {"hand": name, "seconds": 60}
SCENARIOS={
    "quiet":[],
    "cold_night":[(0,{"outside_c":-10.0})],
    "window_open":[(10,{"window":"open"}),(25,{"window":"closed"})],
    "window_tilted":[(10,{"window":"tilted"}),(40,{"window":"closed"})],
    "door_open":[(10,{"door_open":True}),(25,{"door_open":False})],
    "heater_failure":[(10,{"heater":"off"})],
    "hand_on_probe":[(10,{"hand":"Centre","seconds":60})],
    "sensor_unplugged":[(10,{"unplug":"Door"}),(15,{"plug":"Door"})],
}


class SimulatedDevice:
    def __init__(self, device_id: str, scenario: str="quiet", controls: Controls | None=None,
                 params: RoomParams | None=None, probe_params: ProbeParams | None=None,
                 seed: int=1, start: datetime | None=None):
        rng=random.Random(seed)
        self.device_id=device_id
        self.room=Room(params,controls,seed=rng.randrange(2**31))
        self.probes={name:Probe(name,random.Random(rng.randrange(2**31)),probe_params) for name in SENSOR_NAMES}
        self.time=start or datetime.now(timezone.utc)
        self.elapsed=0  # simulated seconds since the scenario started
        self.script: list[tuple[int,dict]]=[]
        self.load_scenario(scenario)

    def load_scenario(self, name: str) -> None:
        """Start a scenario from now. Minutes in the script count from this moment."""
        self.scenario=name
        self.script=sorted(((self.elapsed+minute*60,change) for minute,change in SCENARIOS[name]),key=lambda x:x[0])

    def apply(self, change: dict) -> None:
        """Change the room or a probe right now (demo controls use this too)."""
        for key,value in change.items():
            if key=="unplug":
                self.probes[value].unplugged=True
            elif key=="plug":
                self.probes[value].unplugged=False
            elif key=="hand":
                self.probes[value].hand_left=float(change.get("seconds",60))
            elif key=="seconds":
                continue
            elif hasattr(self.room.controls,key):
                setattr(self.room.controls,key,value)
            else:
                raise ValueError(f"unknown change: {key}")

    def step(self) -> tuple[datetime,dict]:
        """One simulated second: advance the room and the probes, return (time, frame)."""
        while self.script and self.script[0][0]<=self.elapsed:
            self.apply(self.script.pop(0)[1])
        self.room.step(1.0)
        truth=self.room.true_temperatures()
        for name,probe in self.probes.items():
            probe.step(truth[name],1.0)
        self.elapsed+=1
        self.time+=timedelta(seconds=1)
        frame={"id":self.device_id,"temps":{}}
        for name,probe in self.probes.items():
            value=probe.read()
            if value is not None:  # a lost read is simply absent, like on the real device
                frame["temps"][name]=value
        return self.time,frame

    def advance(self, seconds: int) -> list[tuple[datetime,dict]]:
        return [self.step() for _ in range(seconds)]

    def settle(self, seconds: int) -> None:
        """Run quietly, e.g. to warm up before a demo. Readings are thrown away."""
        for _ in range(seconds):
            self.step()

    def truth(self) -> dict:
        """What is really happening, for the demo screen: true temperatures, heat flows, controls."""
        s=self.room.state
        return {
            "time":self.time.isoformat(),
            "elapsed_seconds":self.elapsed,
            "scenario":self.scenario,
            "controls":asdict(self.room.controls),
            "air_c":round(s.air,2),
            "wall_c":round(s.wall,2),
            "heater_running":s.heater_running,
            "true_temperatures":{k:round(v,2) for k,v in self.room.true_temperatures().items()},
            "heat_flows_w":s.heat_flows,
            "probes":{n:{"offset_c":round(p.offset,2),"unplugged":p.unplugged,"hand":p.hand_left>0}
                      for n,p in self.probes.items()},
        }
