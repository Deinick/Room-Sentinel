"""A device that stopped sending: unplugged, crashed or out of power.

Can't be noticed from readings (there aren't any), so this uses tick().
"""

from datetime import datetime

from src.sentinel.analysis.base import AnalysisResult, Analyzer
from src.sentinel.models import Finding, Reading, Severity


class DeviceSilence(Analyzer):
    name="device_silence"

    def __init__(self, silent_after_seconds=30):
        self.silent_after_seconds=silent_after_seconds
        self._last_seen: dict[str,datetime]={}

    def analyze(self, reading: Reading) -> AnalysisResult:
        self._last_seen[reading.device_id]=reading.time
        return AnalysisResult()  # data arrived, so it isn't silent

    def tick(self, now: datetime) -> dict[str,list[Finding]]:
        result={}
        for device_id,last in self._last_seen.items():
            quiet=(now-last).total_seconds()
            if quiet<self.silent_after_seconds:
                result[device_id]=[]
                continue
            result[device_id]=[Finding(
                kind="DEVICE_SILENT",
                device_id=device_id,
                severity=Severity.WARNING,
                message=f"No data from {device_id} for {int(quiet)} s",
                evidence={"last_seen":last.isoformat(),"silent_for_seconds":round(quiet)},
            )]
        return result
