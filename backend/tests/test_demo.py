from datetime import datetime, timezone

from src.sentinel.demo import DemoRunner
from src.sentinel.live import LiveView
from src.sentinel.models import EventType
from src.sentinel.storage import NullStorage
from tests.test_issues_and_pipeline import Recorder


def runner():
    recorder=Recorder()
    demo=DemoRunner("demo-101",live=LiveView(),channels=[recorder])
    demo.warm_up()
    return demo,recorder


def test_warm_up_is_silent_and_ends_at_now():
    demo,recorder=runner()
    assert recorder.events==[]
    assert abs((demo.device.time-datetime.now(timezone.utc)).total_seconds())<5
    latest=demo.live.latest()["demo-101"]
    assert latest["mode"]=="demo" and latest["live"]
    assert all(s["status"]=="ok" for s in latest["sensors"].values())


def test_speed_and_pause():
    demo,_=runner()
    start=demo.device.time
    demo.set_speed(60)
    assert demo.advance_real(1.0)==60  # one real second = one simulated minute
    assert (demo.device.time-start).total_seconds()==60
    demo.set_speed(0.5)
    assert demo.advance_real(1.0)==0 and demo.advance_real(1.0)==1  # fractions carry over
    demo.set_paused(True)
    assert demo.advance_real(10.0)==0


def test_demo_alerts_go_out_but_nothing_is_stored():
    demo,recorder=runner()
    demo.device.load_scenario("sensor_unplugged")
    demo.set_speed(60)
    for _ in range(20):  # 20 simulated minutes
        demo.advance_real(1.0)
    assert [(e.type,e.finding.kind) for e in recorder.events]==[
        (EventType.OPENED,"SENSOR_FAULT"),(EventType.RESOLVED,"SENSOR_FAULT")]
    assert type(demo.pipeline.storage) is NullStorage
    assert "device_silence" not in [a.name for a in demo.pipeline.analyzers]


def test_state_shows_what_really_happens():
    demo,_=runner()
    demo.device.apply({"window":"open","outside_c":-5.0})
    state=demo.state()
    assert state["controls"]["window"]=="open" and state["controls"]["outside_c"]==-5.0
    assert set(state["true_temperatures"])=={"Centre","Window","Heater","Door","Far wall"}
    assert state["speed"]==1.0 and state["paused"] is False
