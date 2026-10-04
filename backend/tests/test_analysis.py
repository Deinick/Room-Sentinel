from datetime import datetime, timedelta, timezone

from src.sentinel.analysis.device_silence import DeviceSilence
from src.sentinel.analysis.sensor_health import SensorHealth
from src.sentinel.ingest.validate import to_reading

T0=datetime(2026,10,3,12,0,tzinfo=timezone.utc)
ALL_OK={"Centre":21.0,"Window":20.0,"Heater":30.0,"Door":20.5,"Far wall":20.8}


def reading(seconds, device="room-101", **overrides):
    temps={**ALL_OK,**{k.replace("_"," "):v for k,v in overrides.items()}}
    return to_reading({"id":device,"temps":temps},T0+timedelta(seconds=seconds))


def test_sensor_health_ignores_a_short_glitch():
    sh=SensorHealth(grace_seconds=10)
    assert sh.analyze(reading(0,Door=-127.0)).findings==[]
    assert sh.analyze(reading(5,Door=-127.0)).findings==[]
    assert sh.analyze(reading(6)).findings==[]  # recovered before the grace period
    assert sh.analyze(reading(20,Door=-127.0)).findings==[]  # glitch timer restarted


def test_sensor_health_reports_a_lasting_fault():
    sh=SensorHealth(grace_seconds=10)
    first=sh.analyze(reading(0,Door=-127.0))
    result=sh.analyze(reading(12,Door=-127.0))
    [finding]=result.findings
    assert finding.kind=="SENSOR_FAULT" and finding.sensor=="Door"
    assert finding.evidence["status"]=="disconnected"
    assert [(m.name,m.value) for m in first.metrics]==[("sensors_ok",4)]


def test_sensors_ok_metric_once_a_minute_or_on_change():
    sh=SensorHealth()
    written=[(s,m.value) for s in range(0,130) for m in sh.analyze(reading(s)).metrics]
    assert written==[(0,5),(60,5),(120,5)]  # not 130 rows of the same number
    assert [m.value for m in sh.analyze(reading(130,Door=-127.0)).metrics]==[4]  # a change is written at once


def test_sensor_health_keeps_devices_apart():
    sh=SensorHealth(grace_seconds=10)
    sh.analyze(reading(0,device="room-101",Door=-127.0))
    assert sh.analyze(reading(12,device="room-202",Door=-127.0)).findings==[]


def test_device_silence():
    ds=DeviceSilence(silent_after_seconds=30)
    ds.analyze(reading(0))
    assert ds.tick(T0+timedelta(seconds=10))=={"room-101":[]}
    [finding]=ds.tick(T0+timedelta(seconds=45))["room-101"]
    assert finding.kind=="DEVICE_SILENT"
