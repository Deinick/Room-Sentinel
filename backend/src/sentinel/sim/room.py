r"""Room physics, one step per simulated second.

Heat stores (J/K) and couplings (W/K) for a 5 x 4 x 2.7 m room (54 m3) with one outside wall:

    air + furniture  --150-->  walls  --30-->  outside
          |  \--8 (gaps)--------------------->  outside
          |  \--window: 54 tilted / 181 open-->  outside      (3 / 10 air changes per hour)
          |  \--door: 60 when open------------>  corridor
          \<--heater element (1.5 kW, 44 W/K to the air)

The walls are what make it realistic: open the window and the air drops fast but the walls
hold their heat, so the room recovers quickly after closing it. The detector only models one
heat store, so it has to cope with things it doesn't model, as it will in a real room.

Each probe sees a local temperature: Window and Door sit in small zones that drift towards
the outside / corridor air, Far wall is partly warmed or cooled by the wall, Heater sits on
the radiator.
"""

import math
import random
from dataclasses import dataclass, field

WINDOW_OPENING={"closed":0.0,"tilted":0.3,"open":1.0}


@dataclass
class RoomParams:
    air_heat_capacity: float=400e3  # J/K, air plus furniture
    wall_heat_capacity: float=5e6
    heater_heat_capacity: float=20e3
    air_to_wall: float=150.0  # W/K
    wall_to_outside: float=30.0
    gaps: float=8.0  # air leaking out with everything closed
    window_open: float=181.0  # fully open; tilted is a share of this
    door_open: float=60.0
    heater_power: float=1500.0  # W
    heater_to_air: float=44.0  # element is about 55 °C when running in a 21 °C room
    thermostat_band: float=0.5  # heater switches on below setpoint - band, off above setpoint + band
    zone_seconds: float=120.0  # how quickly the window/door zones follow the air there
    people_watts: float=60.0  # average unmeasured heat (people, laptops, sun)
    people_watts_spread: float=40.0


@dataclass
class Controls:
    """What demo mode lets you change."""
    outside_c: float=5.0
    corridor_c: float=19.0
    window: str="closed"  # closed | tilted | open
    door_open: bool=False
    heater: str="auto"  # auto (thermostat) | on | off
    setpoint_c: float=21.0


@dataclass
class RoomState:
    air: float
    wall: float
    heater_element: float
    window_zone: float
    door_zone: float
    heater_running: bool=False
    people_watts: float=0.0
    heat_flows: dict=field(default_factory=dict)  # W, last step, for showing what really happens


class Room:
    def __init__(self, params: RoomParams | None=None, controls: Controls | None=None, seed: int=1):
        self.p=params or RoomParams()
        self.controls=controls or Controls()
        self.rng=random.Random(seed)
        self.state=self.steady_state()

    def steady_state(self) -> RoomState:
        """A room that has been at the setpoint for hours with the current outside temperature."""
        p,c=self.p,self.controls
        air=c.setpoint_c
        wall=(p.air_to_wall*air+p.wall_to_outside*c.outside_c)/(p.air_to_wall+p.wall_to_outside)
        return RoomState(air=air,wall=wall,heater_element=air,
                         window_zone=self._window_target(air),door_zone=self._door_target(air),
                         people_watts=p.people_watts)

    def step(self, dt: float=1.0) -> None:
        p,c,s=self.p,self.controls,self.state
        s.heater_running=self._heater_running(s)

        # Unmeasured heat drifts slowly around its average (people coming and going).
        drift=math.exp(-dt/1800)
        s.people_watts=p.people_watts+(s.people_watts-p.people_watts)*drift \
            +p.people_watts_spread*math.sqrt(1-drift*drift)*self.rng.gauss(0,1)
        people=max(0.0,s.people_watts)

        opening=WINDOW_OPENING[c.window]
        flows={
            "heater":p.heater_to_air*(s.heater_element-s.air),
            "people":people,
            "to_walls":-p.air_to_wall*(s.air-s.wall),
            "gaps":-p.gaps*(s.air-c.outside_c),
            "window":-p.window_open*opening*(s.air-c.outside_c),
            "door":-p.door_open*(s.air-c.corridor_c) if c.door_open else 0.0,
        }
        wall_loss=p.wall_to_outside*(s.wall-c.outside_c)
        element_in=p.heater_power if s.heater_running else 0.0

        s.air+=sum(flows.values())/p.air_heat_capacity*dt
        s.wall+=(p.air_to_wall*(s.air-s.wall)-wall_loss)/p.wall_heat_capacity*dt
        s.heater_element+=(element_in-p.heater_to_air*(s.heater_element-s.air))/p.heater_heat_capacity*dt

        follow=1-math.exp(-dt/p.zone_seconds)
        s.window_zone+=(self._window_target(s.air)-s.window_zone)*follow
        s.door_zone+=(self._door_target(s.air)-s.door_zone)*follow
        s.heat_flows={k:round(v) for k,v in flows.items()}

    def true_temperatures(self) -> dict[str,float]:
        """What a perfect probe would read at each sensor position right now."""
        s=self.state
        return {
            "Centre":s.air,
            "Window":s.window_zone,
            "Heater":s.air+0.8*(s.heater_element-s.air),
            "Door":s.door_zone,
            "Far wall":s.air+0.25*(s.wall-s.air),
        }

    def _heater_running(self, s: RoomState) -> bool:
        c=self.controls
        if c.heater=="on":
            return True
        if c.heater=="off":
            return False
        if s.air<c.setpoint_c-self.p.thermostat_band:
            return True
        if s.air>c.setpoint_c+self.p.thermostat_band:
            return False
        return s.heater_running

    def _window_target(self, air: float) -> float:
        # Next to the glass it is always a bit colder; with the window open the draught dominates.
        share={"closed":0.08,"tilted":0.45,"open":0.6}[self.controls.window]
        return air+share*(self.controls.outside_c-air)

    def _door_target(self, air: float) -> float:
        share=0.6 if self.controls.door_open else 0.05
        return air+share*(self.controls.corridor_c-air)
