from datetime import datetime, timedelta, timezone

from src.sentinel.advice import advise
from src.sentinel.analysis.device_silence import DeviceSilence
from src.sentinel.analysis.sensor_health import SensorHealth
from src.sentinel.issues import IssueTracker
from src.sentinel.models import EventType, Finding, Severity
from src.sentinel.notify.base import Channel
from src.sentinel.pipeline import Pipeline
from src.sentinel.storage import MemoryStorage
from tests.test_analysis import T0, reading


def finding(severity=Severity.WARNING):
    return Finding("SENSOR_FAULT","room-101",severity,"Door broken",sensor="Door",evidence={"status":"disconnected"})


def at(seconds):
    return T0+timedelta(seconds=seconds)


def test_tracker_lifecycle():
    tracker=IssueTracker(advise,reminder_every=timedelta(minutes=10))
    [opened]=tracker.update("sensor_health","room-101",[finding()],at(0))
    assert opened.type==EventType.OPENED and opened.recommendations
    assert tracker.update("sensor_health","room-101",[finding()],at(60))==[]  # no spam
    [escalated]=tracker.update("sensor_health","room-101",[finding(Severity.CRITICAL)],at(120))
    assert escalated.type==EventType.ESCALATED
    [reminder]=tracker.update("sensor_health","room-101",[finding(Severity.CRITICAL)],at(120+600))
    assert reminder.type==EventType.REMINDER
    [resolved]=tracker.update("sensor_health","room-101",[],at(800))
    assert resolved.type==EventType.RESOLVED and resolved.opened_at==at(0)
    assert tracker.update("sensor_health","room-101",[],at(900))==[]


def test_tracker_keeps_analyzers_apart():
    tracker=IssueTracker(advise)
    tracker.update("a","room-101",[finding()],at(0))
    # Analyzer "b" reporting nothing must not resolve analyzer "a"'s issue.
    assert tracker.update("b","room-101",[],at(1))==[]


class Recorder(Channel):
    def __init__(self): self.events=[]
    def send(self, event): self.events.append(event)


class Broken(Channel):
    def send(self, event): raise RuntimeError("no internet")


def test_pipeline_end_to_end():
    storage=MemoryStorage()
    recorder=Recorder()
    pipeline=Pipeline([SensorHealth(grace_seconds=10),DeviceSilence(silent_after_seconds=30)],
                      IssueTracker(advise),storage,[Broken(),recorder])

    for s in range(0,15):
        pipeline.process(reading(s,Door=-127.0))
    pipeline.process(reading(15))  # Door fixed
    pipeline.tick(at(60))  # device went quiet

    assert len(storage.readings)==16
    assert [m.value for m in storage.metrics][:2]==[4,4]
    types=[(e.type,e.finding.kind) for e in recorder.events]
    assert types==[(EventType.OPENED,"SENSOR_FAULT"),(EventType.RESOLVED,"SENSOR_FAULT"),
                   (EventType.OPENED,"DEVICE_SILENT")]
    assert storage.events==recorder.events  # every event saved, even though one channel crashed
