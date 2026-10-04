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
        f"Check that {f.device_id} is powered and its USB cable is plugged in, and that the gateway is running.",
        Severity.WARNING,
    )]


RULES={
    "SENSOR_FAULT":sensor_fault,
    "DEVICE_SILENT":device_silent,
}


def advise(finding: Finding) -> list[Recommendation]:
    rule=RULES.get(finding.kind)
    return rule(finding) if rule else []
