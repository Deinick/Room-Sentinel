from datetime import datetime, timedelta, timezone

from src.sentinel.config import SENSOR_NAMES
from src.sentinel.demo import DemoRunner
from src.sentinel.history import RecentHistory, bucket_seconds
from src.sentinel.ingest.validate import to_reading
from src.sentinel.live import LiveView
from src.sentinel.models import Metric

T0=datetime(2026,10,3,12,0,tzinfo=timezone.utc)


def test_bucket_size_keeps_charts_to_a_few_hundred_points():
    for minutes in (10,60,6*60,24*60,7*24*60,30*24*60):
        points=minutes*60/bucket_seconds(minutes)
        assert 280<=points<=600,(minutes,points)
    assert bucket_seconds(5,finest=10)==10  # never finer than the data


def test_recent_history_averages_into_buckets():
    history=RecentHistory()
    for s in range(3600):
        temps={n:20.0+s/3600 for n in SENSOR_NAMES}
        temps["Door"]=-127.0 if s<1800 else 20.0  # bad half the time: skipped, not averaged in
        history.save_reading(to_reading({"id":"d","temps":temps},T0+timedelta(seconds=s)))
    result=history.readings("d",60)
    assert result["bucket_seconds"]==10 and 350<=len(result["points"])<=360
    first,last=result["points"][0],result["points"][-1]
    assert first["Door"] is None and last["Door"]==20.0
    assert first["Centre"]<last["Centre"]<21.0
    assert set(first)=={"time",*SENSOR_NAMES}


def test_recent_history_is_bounded():
    history=RecentHistory(keep=timedelta(minutes=10))
    for s in range(3600):
        history.save_reading(to_reading({"id":"d","temps":{"Centre":21.0}},T0+timedelta(seconds=s)))
    assert len(history._blocks["d"])==60  # 10 minutes of 10-s blocks, not an hour


def test_metrics_series_filtered_by_name():
    history=RecentHistory()
    history.save_metrics([Metric("d",T0+timedelta(minutes=m),name,float(m)) for m in range(30)
                          for name in ("rate_c_per_min","room_c")])
    result=history.metrics("d",60,{"rate_c_per_min"})
    assert list(result["series"])==["rate_c_per_min"]
    assert len(result["series"]["rate_c_per_min"])==30 and result["bucket_seconds"]==60


def test_demo_has_history_and_metrics_for_charts():
    demo=DemoRunner("demo-101",live=LiveView(),channels=[])
    demo.warm_up()
    readings=demo.history.readings("demo-101",60)
    assert len(readings["points"])>300
    metrics=demo.history.metrics("demo-101",120,None)["series"]
    assert {"room_c","rate_c_per_min","expected_rate_c_per_min","surprise_c_per_min"}<=set(metrics)
