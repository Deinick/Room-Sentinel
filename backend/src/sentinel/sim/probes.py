"""What a real DS18B20 would report for a given true temperature.

Each probe has a fixed calibration offset (the part is rated ±0.5 °C), responds slowly
(a waterproof probe in still air takes about a minute), adds a little noise, and reports in
0.0625 °C steps (12-bit). Faults reproduce what the hardware really sends: -127 when the probe
stops answering, a missing value when the read fails.
"""

import math
import random
from dataclasses import dataclass

DISCONNECTED=-127.0
STEP=0.0625


@dataclass
class ProbeParams:
    max_offset: float=0.3  # °C, drawn once per probe
    response_seconds: float=60.0
    noise: float=0.03  # °C, standard deviation
    missing_chance: float=0.0005  # share of readings lost


class Probe:
    def __init__(self, name: str, rng: random.Random, params: ProbeParams | None=None):
        self.name=name
        self.p=params or ProbeParams()
        self.rng=rng
        self.offset=rng.uniform(-self.p.max_offset,self.p.max_offset)
        self.sensed: float | None=None  # the probe's own temperature, lagging behind the air
        self.unplugged=False
        self.hand_left=0.0  # seconds a hand is still holding it

    def step(self, true_temp: float, dt: float=1.0) -> None:
        if self.hand_left>0:
            true_temp=33.0
            self.hand_left=max(0.0,self.hand_left-dt)
        if self.sensed is None:
            self.sensed=true_temp
        self.sensed+=(true_temp-self.sensed)*(1-math.exp(-dt/self.p.response_seconds))

    def read(self) -> float | None:
        if self.unplugged:
            return DISCONNECTED
        if self.rng.random()<self.p.missing_chance:
            return None
        value=self.sensed+self.offset+self.rng.gauss(0,self.p.noise)
        return round(value/STEP)*STEP
