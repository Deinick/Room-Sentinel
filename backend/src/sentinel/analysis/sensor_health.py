"""Sensors that keep failing: disconnected, stuck at power-on, missing or impossible values."""

from datetime import datetime

from src.sentinel.analysis.base import AnalysisResult, Analyzer
from src.sentinel.models import Finding, Metric, Reading, Severity

PROBLEM_TEXT={
    "disconnected":"is not responding (reads -127)",
    "power_on":"is stuck at its power-on value (85)",
    "missing":"is missing from the data",
    "out_of_range":"reports impossible temperatures",
}


class SensorHealth(Analyzer):
    name="sensor_health"

    def __init__(self, grace_seconds=10, metric_every_seconds=60):
        # One bad reading is normal noise; only report a sensor that stays bad this long.
        self.grace_seconds=grace_seconds
        # Readings arrive every second; sensors_ok is written when it changes, otherwise once a minute.
        self.metric_every_seconds=metric_every_seconds
        self._bad_since: dict[tuple[str,str],datetime]={}  # (device, sensor) -> first bad reading
        self._last_metric: dict[str,tuple[datetime,int]]={}  # device -> (time, value) last written

    def analyze(self, reading: Reading) -> AnalysisResult:
        findings=[]
        ok_count=0
        for name,value in reading.sensors.items():
            key=(reading.device_id,name)
            if value.ok:
                ok_count+=1
                self._bad_since.pop(key,None)
                continue

            since=self._bad_since.setdefault(key,reading.time)
            bad_for=(reading.time-since).total_seconds()
            if bad_for<self.grace_seconds:
                continue
            findings.append(Finding(
                kind="SENSOR_FAULT",
                device_id=reading.device_id,
                severity=Severity.WARNING,
                message=f"{name} sensor {PROBLEM_TEXT.get(value.status,value.status)} for {int(bad_for)} s",
                sensor=name,
                evidence={"status":value.status,"bad_for_seconds":round(bad_for),"since":since.isoformat()},
            ))

        return AnalysisResult(findings,self._metrics(reading,ok_count))

    def _metrics(self, reading: Reading, ok_count: int) -> list[Metric]:
        last=self._last_metric.get(reading.device_id)
        due=last is None or last[1]!=ok_count or (reading.time-last[0]).total_seconds()>=self.metric_every_seconds
        if not due:
            return []
        self._last_metric[reading.device_id]=(reading.time,ok_count)
        return [Metric(reading.device_id,reading.time,"sensors_ok",ok_count)]
