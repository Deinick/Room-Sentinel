"""Per-device settings: what "too cold" / "too warm" means and what each sensor is for.

The analysis is the same everywhere; only these settings change between a living room,
a vaccine fridge, a server room or a pipe that must not freeze.

    PROFILES.set("fridge-1", PRESETS["cold_storage"])
    PROFILES.set_outside("room-101", 3.5)   # from a weather service, or the demo's slider
"""

import threading
from dataclasses import dataclass, replace


@dataclass(frozen=True)
class Profile:
    kind: str="room"
    min_c: float | None=18.0  # too cold below this (WHO's recommended minimum indoors in winter)
    max_c: float | None=None  # too warm above this
    watch: str="cold"  # which fast change matters: cold | warm | both
    ambient: tuple[str,...]=("Centre","Far wall","Door")  # their median is "the room temperature"
    edges: tuple[str,...]=("Window","Door")  # where cold or warm air can come in
    source: str | None="Heater"  # the heating (or cooling) element's probe, if there is one
    limit_severity: str="WARNING"  # for crossing min_c / max_c

    def watches(self, direction: str) -> bool:
        return self.watch in (direction,"both")


PRESETS={
    "room":Profile(),
    "cold_storage":Profile(kind="cold_storage",min_c=2.0,max_c=8.0,watch="both",
                           ambient=("Centre","Far wall"),edges=("Door",),source=None,limit_severity="CRITICAL"),
    "server_room":Profile(kind="server_room",min_c=18.0,max_c=27.0,watch="warm",
                          ambient=("Centre","Far wall"),edges=("Door","Window"),source=None,limit_severity="CRITICAL"),
    "freeze_protection":Profile(kind="freeze_protection",min_c=4.0,max_c=None,watch="cold",limit_severity="CRITICAL"),
}


class Profiles:
    def __init__(self):
        self._profiles: dict[str,Profile]={}
        self._outside: dict[str,float]={}
        self._lock=threading.Lock()

    def get(self, device_id: str) -> Profile:
        with self._lock:
            return self._profiles.get(device_id,PRESETS["room"])

    def set(self, device_id: str, profile: Profile) -> None:
        with self._lock:
            self._profiles[device_id]=profile

    def set_limits(self, device_id: str, min_c: float | None, max_c: float | None) -> None:
        with self._lock:
            self._profiles[device_id]=replace(self._profiles.get(device_id,PRESETS["room"]),min_c=min_c,max_c=max_c)

    def outside(self, device_id: str) -> float | None:
        """Outside temperature if something provides it (weather service, demo); None if unknown."""
        with self._lock:
            return self._outside.get(device_id)

    def set_outside(self, device_id: str, celsius: float) -> None:
        with self._lock:
            self._outside[device_id]=celsius


PROFILES=Profiles()
