"""Finding -> what to do about it.

Kept apart from the analyzers on purpose: analyzers find facts, rules here decide
what they mean for the people in the room. To add advice for a new finding kind,
write a function and register it in RULES.
"""

from src.sentinel.models import Finding, Recommendation, Severity


def sensor_fault(f: Finding) -> list[Recommendation]:
    status=f.evidence.get("status")
    if status=="disconnected":
        action=f"Check the {f.sensor} probe's wiring on {f.device_id} (power, data and ground)."
    elif status=="power_on":
        action=f"The {f.sensor} probe keeps resetting: check its power wire, or use 3-wire power instead of parasite power."
    elif status=="out_of_range":
        action=f"The {f.sensor} probe reports impossible values: reseat it, or replace it."
    else:
        action=f"The board isn't sending {f.sensor}: check that the firmware reads all 5 probes."
    return [Recommendation(action,f.severity)]


def device_silent(f: Finding) -> list[Recommendation]:
    return [Recommendation(
        f"Check that {f.device_id} is powered and connected to Wi-Fi (or its USB cable is plugged in).",
        Severity.WARNING,
    )]


def _deadline(f: Finding) -> str:
    """' before it reaches 18 °C (about 25 min)' when there is a forecast."""
    minutes=f.evidence.get("forecast_minutes")
    if minutes is None:
        return ""
    about=f"about {max(1,round(minutes))} min" if minutes<15 else f"about {5*round(minutes/5)} min"
    return f" before it reaches {f.evidence['forecast_limit_c']:g} °C ({about})"


def fast_cooling(f: Finding) -> list[Recommendation]:
    side=f.evidence.get("side")
    profile=f.evidence.get("profile","room")
    if side=="Window":
        action=f"Close the window{_deadline(f)}."
    elif side=="Door":
        action=("Close the door: it is letting the cold in" if profile=="cold_storage" else
                "Close the door: cold air is coming in from that side")+f"{_deadline(f)}."
    elif profile in ("cold_storage","server_room"):
        action=f"Check the cooling: the temperature is dropping faster than normal{_deadline(f)}."
    else:
        action=f"Check the heating and look for an open window or door elsewhere{_deadline(f)}."
    return [Recommendation(action,f.severity)]


def fast_warming(f: Finding) -> list[Recommendation]:
    side=f.evidence.get("side")
    profile=f.evidence.get("profile","room")
    if profile=="server_room":
        action=(f"Check the cooling (air conditioning / CRAC unit) and that airflow isn't blocked{_deadline(f)}; "
                "be ready to shut down non-essential equipment.")
    elif profile=="cold_storage":
        action=(f"Keep the door shut and check the compressor{_deadline(f)}"
                +("; the door side is warming fastest." if side=="Door" else "."))
    elif side:
        action=f"Warm air is coming from the {side} side: check for a heat source there{_deadline(f)}."
    else:
        action=f"Turn the heating down or ventilate{_deadline(f)}."
    return [Recommendation(action,f.severity)]


def too_cold(f: Finding) -> list[Recommendation]:
    profile=f.evidence.get("profile","room")
    if profile=="cold_storage":
        action="Check the thermostat setting: stock may freeze below the safe range."
    elif profile=="freeze_protection":
        action="Freezing risk: check the heating and insulation now."
    elif profile=="server_room":
        action="Too cold for the equipment: check the cooling setpoint (condensation risk)."
    else:
        action="Turn the heating up and close any open windows or doors."
    return [Recommendation(action,f.severity,command={"heater":"on"} if profile=="room" else None)]


def too_warm(f: Finding) -> list[Recommendation]:
    profile=f.evidence.get("profile","room")
    if profile=="server_room":
        action="Too hot for the equipment: restore cooling now, reduce load, and prepare a controlled shutdown."
    elif profile=="cold_storage":
        action="Out of the safe range: keep the door shut, check the compressor, and move stock if it doesn't recover."
    else:
        action="Turn the heating down or open a window."
    return [Recommendation(action,f.severity)]


def heating_off(f: Finding) -> list[Recommendation]:
    return [Recommendation(
        f"Check the heater{_deadline(f)}: is it switched on and powered, and is its thermostat set high enough?",
        f.severity,command={"heater":"on"},
    )]


def limit_soon(f: Finding) -> list[Recommendation]:
    profile=f.evidence.get("profile","room")
    if f.evidence.get("direction")=="warm":
        action=("Check the cooling now" if profile in ("server_room","cold_storage") else "Turn the heating down")
    else:
        action=("Check the thermostat setting" if profile=="cold_storage" else "Turn the heating up")
    return [Recommendation(f"{action}{_deadline(f)}.",f.severity)]


def probe_disturbed(f: Finding) -> list[Recommendation]:
    return [Recommendation(
        f"Nothing to do unless it keeps happening: readings from the {f.sensor} probe are ignored for a few minutes. "
        "If it repeats, move the probe away from hands, sun or heat sources.",
        Severity.INFO,
    )]


RULES={
    "SENSOR_FAULT":sensor_fault,
    "DEVICE_SILENT":device_silent,
    "FAST_COOLING":fast_cooling,
    "FAST_WARMING":fast_warming,
    "TOO_COLD":too_cold,
    "TOO_WARM":too_warm,
    "HEATING_OFF":heating_off,
    "LIMIT_SOON":limit_soon,
    "PROBE_DISTURBED":probe_disturbed,
}


def advise(finding: Finding) -> list[Recommendation]:
    rule=RULES.get(finding.kind)
    return rule(finding) if rule else []
