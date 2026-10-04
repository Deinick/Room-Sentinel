"""What every analyzer looks like.

To add an analysis feature: subclass Analyzer in a new file, then add it to
ANALYZERS in run.py. Nothing else needs to change.
"""

from dataclasses import dataclass, field
from datetime import datetime

from src.sentinel.models import Finding, Metric, Reading


@dataclass
class AnalysisResult:
    findings: list[Finding]=field(default_factory=list)
    metrics: list[Metric]=field(default_factory=list)


class Analyzer:
    name="analyzer"  # unique; used to track each analyzer's findings separately

    def analyze(self, reading: Reading) -> AnalysisResult:
        """Called for every reading. Keep per-device state on self; devices must never mix."""
        return AnalysisResult()

    def tick(self, now: datetime) -> dict[str, list[Finding]]:
        """Called every few seconds even when no data arrives (e.g. to notice a silent device).
        Returns {device_id: current findings} for each device it has an opinion about."""
        return {}
