import time

from src.sentinel.ingest.validate import to_reading
from src.sentinel.sim.device import SimulatedDevice
from src.sentinel.sim.probes import STEP


def settled(scenario="quiet", seed=3, **controls):
    device=SimulatedDevice("demo-101",seed=seed)
    device.apply(controls)
    device.settle(2*3600)
    device.load_scenario(scenario)
    return device


def air_after(device, minutes):
    device.settle(minutes*60)
    return device.room.state.air


def test_quiet_room_stays_near_the_setpoint_and_the_heater_cycles():
    device=settled()
    airs,running=[],[]
    for _ in range(2*3600):
        device.step()
        airs.append(device.room.state.air)
        running.append(device.room.state.heater_running)
    assert 19.8<min(airs) and max(airs)<22.2
    assert 0.1<sum(running)/len(running)<0.9  # on/off, like a real thermostat


def test_open_window_cools_fast_and_the_window_probe_most():
    device=settled("window_open",outside_c=0.0)
    before=air_after(device,10)
    after=air_after(device,10)  # 10 min with the window open
    assert 2.0<before-after<7.0
    truth=device.room.true_temperatures()
    assert truth["Centre"]-truth["Window"]>4*(truth["Centre"]-truth["Door"])  # the cold comes from the window side
    closed=air_after(device,25)  # closed at minute 25, then 20 min to recover
    assert closed-after>1.5


def test_heater_failure_cools_slowly():
    device=settled("heater_failure")
    start=air_after(device,10)
    drop=start-air_after(device,60)
    assert 1.0<drop<5.0


def test_probes_report_like_a_ds18b20():
    device=settled("sensor_unplugged")
    readings=[frame for _,frame in device.advance(9*60)]
    values=[v for f in readings for v in f["temps"].values()]
    assert all(abs(v/STEP-round(v/STEP))<1e-9 for v in values)  # 0.0625 °C steps
    _,frame=device.advance(120)[-1]  # minute 11: Door is unplugged
    assert frame["temps"]["Door"]==-127.0
    reading=to_reading(frame,device.time)
    assert reading.sensors["Door"].status=="disconnected" and reading.sensors["Centre"].ok


def test_hand_on_probe_warms_only_that_probe():
    device=settled("hand_on_probe")
    device.settle(10*60)
    frames=[f for _,f in device.advance(60)]
    assert max(f["temps"]["Centre"] for f in frames if "Centre" in f["temps"])>26  # lag: not 33 at once
    assert max(f["temps"]["Door"] for f in frames if "Door" in f["temps"])<23


def test_same_seed_same_room():
    a=[f for _,f in settled(seed=7).advance(300)]
    b=[f for _,f in settled(seed=7).advance(300)]
    assert a==b


def test_simulated_time_moves_one_second_per_reading():
    device=SimulatedDevice("demo-101")
    start=device.time
    times=[t for t,_ in device.advance(10)]
    assert [(t-start).total_seconds() for t in times]==list(range(1,11))


def test_fast_enough_to_warm_up_instantly():
    started=time.perf_counter()
    SimulatedDevice("demo-101").settle(6*3600)
    assert time.perf_counter()-started<2.0
