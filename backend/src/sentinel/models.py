"""The shapes data takes as it moves through the pipeline.

    Reading --analyzers--> Finding + Metric --advice--> Recommendation
    Finding --issue tracker--> IssueEvent --channels--> console / phone / ...
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import IntEnum, StrEnum


class Severity(IntEnum):
    INFO=1
    WARNING=2
    CRITICAL=3


@dataclass(frozen=True)
class SensorValue:
    temp_c: float | None
    status: str

    @property
    def ok(self) -> bool:
        return self.status=="ok"


@dataclass(frozen=True)
class Reading:
    """One line from one device, cleaned up. time = when the gateway received it (UTC)."""
    device_id: str
    time: datetime
    sensors: dict[str, SensorValue]


@dataclass(frozen=True)
class Metric:
    """A number worth graphing over time, e.g. cooling rate."""
    device_id: str
    time: datetime
    name: str
    value: float
    sensor: str | None=None


@dataclass(frozen=True)
class Finding:
    """Something an analyzer believes is true right now, with the numbers behind it."""
    kind: str  # e.g. SENSOR_FAULT, DEVICE_SILENT
    device_id: str
    severity: Severity
    message: str
    sensor: str | None=None
    evidence: dict=field(default_factory=dict)

    @property
    def key(self) -> str:
        """Same problem -> same key, so it is tracked as one issue while it lasts."""
        return f"{self.device_id}:{self.kind}:{self.sensor or '-'}"


@dataclass(frozen=True)
class Recommendation:
    action: str  # what a person should do
    severity: Severity
    # For automatic stabilising later, e.g. {"heater": "on"}; sent to the device by a channel.
    command: dict | None=None


class EventType(StrEnum):
    OPENED="opened"
    ESCALATED="escalated"  # severity went up
    REMINDER="reminder"  # still not fixed
    RESOLVED="resolved"


@dataclass(frozen=True)
class IssueEvent:
    type: EventType
    time: datetime
    finding: Finding
    opened_at: datetime
    recommendations: list[Recommendation]=field(default_factory=list)
