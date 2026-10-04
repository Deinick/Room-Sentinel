"""The thermal analyzer against the simulator. These numbers are simulated, not measured."""

from datetime import datetime, timedelta, timezone

from src.sentinel.analysis.stats import least_squares, line_fit, median, robust_sigma
from src.sentinel.analysis.thermal import ThermalAnalyzer
from src.sentinel.config import SENSOR_NAMES
from src.sentinel.ingest.validate import to_reading
from src.sentinel.profiles import PRESETS, Profiles
from src.sentinel.sim.device import SimulatedDevice


def run(scenario, seed=1, minutes=40, outside=5.0, **controls):
    """2 quiet hours to learn the room, then the scenario. Returns {kind: (minute first seen, finding)}."""
    profiles=Profiles()
    analyzer=ThermalAnalyzer(profiles)
    device=SimulatedDevice("demo-101",seed=seed)
    device.apply({"outside_c":outside,**controls})

    def feed(seconds):
        found={}
        for i in range(seconds):
            time,frame=device.step()
            profiles.set_outside("demo-101",device.room.controls.outside_c)
            for f in analyzer.analyze(to_reading(frame,time)).findings:
                found.setdefault(f.kind,(i/60,f))
        return found

    feed(2*3600)
    device.load_scenario(scenario)
    return feed(minutes*60),analyzer


def test_quiet_room_and_cold_night_raise_nothing():
    for scenario in ("quiet","cold_night","hand_on_probe","sensor_unplugged"):
        for seed in (1,2,3):
            found,_=run(scenario,seed,minutes=90)
            assert set(found)<= {"PROBE_DISTURBED"},(scenario,seed,found)


def test_learns_the_room():
    _,analyzer=run("quiet",minutes=1)
    model=analyzer.model("demo-101")
    assert model is not None and model.uses_heater
    assert model.g>0 and model.h>0 and model.sigma<0.03


def test_open_window_is_caught_within_minutes_and_on_the_right_side():
    for seed in (1,2,3):
        found,_=run("window_open",seed,outside=0.0)
        minute,finding=found["FAST_COOLING"]
        assert 10<minute<10+7  # the window opens at minute 10
        assert finding.evidence["side"]=="Window" and "Window side" in finding.message
        assert finding.evidence["model_ready"] and finding.evidence["surprise_c_per_min"]<0


def test_cold_corridor_door_points_at_the_door():
    found,_=run("door_open",corridor_c=5.0)
    assert found["FAST_COOLING"][1].evidence["side"]=="Door"


def test_heater_failure_is_noticed():
    found,_=run("heater_failure",minutes=90)
    minute,finding=found["HEATING_OFF"]
    assert finding.sensor=="Heater" and minute<10+60
    assert "FAST_COOLING" not in found  # a room without heat cools exactly as the model expects


def test_hand_on_probe_is_ignored_not_alarmed():
    found,_=run("hand_on_probe")
    assert found["PROBE_DISTURBED"][1].sensor=="Centre"
    assert "FAST_WARMING" not in found and "FAST_COOLING" not in found


def synthetic(analyzer, start_c, rate_per_min, minutes, device="rack-1"):
    """Every probe at the same temperature, changing at a fixed rate."""
    t0=datetime(2026,10,3,12,0,tzinfo=timezone.utc)
    found={}
    for s in range(minutes*60):
        value=round(start_c+rate_per_min*s/60,4)
        reading=to_reading({"id":device,"temps":{n:value for n in SENSOR_NAMES}},t0+timedelta(seconds=s))
        for f in analyzer.analyze(reading).findings:
            found.setdefault(f.kind,(s/60,f))
    return found


def test_server_room_warming_fast_and_past_its_limit():
    profiles=Profiles()
    profiles.set("rack-1",PRESETS["server_room"])
    found=synthetic(ThermalAnalyzer(profiles),24.0,0.25,30)  # cooling failed: +0.25 °C/min
    assert found["FAST_WARMING"][0]<15  # simple rule, before anything is learned
    assert found["TOO_WARM"][1].severity.name=="CRITICAL"


def test_watch_direction_is_respected():
    profiles=Profiles()
    profiles.set("rack-1",PRESETS["server_room"])  # only warming matters there
    found=synthetic(ThermalAnalyzer(profiles),24.0,-0.25,20)
    assert "FAST_COOLING" not in found


def test_data_gap_restarts_the_windows():
    analyzer=ThermalAnalyzer(Profiles())
    synthetic(analyzer,21.0,-0.3,15,device="d")  # fast cooling, alarm on
    later=datetime(2026,10,3,13,0,tzinfo=timezone.utc)  # 45 min of silence
    result=analyzer.analyze(to_reading({"id":"d","temps":{n:16.0 for n in SENSOR_NAMES}},later))
    assert result.findings==[]  # no conclusions across the gap


def test_metrics_once_a_minute():
    analyzer=ThermalAnalyzer(Profiles())
    t0=datetime(2026,10,3,12,0,tzinfo=timezone.utc)
    names=[]
    for s in range(20*60):
        reading=to_reading({"id":"d","temps":{n:21.0 for n in SENSOR_NAMES}},t0+timedelta(seconds=s))
        names+=[(m.time,m.name) for m in analyzer.analyze(reading).metrics]
    times=sorted({t for t,_ in names})
    assert all((b-a)>=timedelta(minutes=1) for a,b in zip(times,times[1:]))


def test_stats_helpers():
    assert median([3,1,2])==2 and median([4,1,2,3])==2.5 and median([]) is None
    assert robust_sigma([1,1,1,1,100])==0.0  # one spike doesn't count
    slope,intercept,se=line_fit([0,1,2,3],[1,3,5,7])
    assert abs(slope-2)<1e-12 and abs(intercept-1)<1e-12 and se<1e-9
    coef=least_squares([[1,0],[0,1],[1,1]],[1,2,3])
    assert abs(coef[0]-1)<1e-9 and abs(coef[1]-2)<1e-9
