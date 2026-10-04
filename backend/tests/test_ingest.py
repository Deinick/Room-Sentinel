from datetime import datetime, timezone

from src.sentinel.ingest.parser import parse_line
from src.sentinel.ingest.validate import check, to_reading

GOOD='{"id":"room-101","Centre":21.44,"Window":19.81,"Heater":34.06,"Door":20.90,"Far wall":21.12}'


def test_good_line():
    assert parse_line(GOOD)=={"id":"room-101","temps":{
        "Centre":21.44,"Window":19.81,"Heater":34.06,"Door":20.9,"Far wall":21.12}}


def test_lines_that_are_not_readings():
    for line in ['','hello from stm32','{"Centre":21.5}','{"id":"room-101","Centre":21.44,"Window":19.6',
                 '{"id":"room-101","boot":1}','{"id":5,"Centre":21.5}','5']:
        assert parse_line(line) is None, line


def test_garbage_values_become_none():
    assert parse_line('{"id":"a","Centre":"abc","Window":null}')["temps"]=={"Centre":None,"Window":None}


def test_check():
    assert check(21.5)==(21.5,"ok")
    assert check(0.0)==(0.0,"ok")
    assert check(None)==(None,"missing")
    assert check(-127.0)==(None,"disconnected")
    assert check(85.0)==(None,"power_on")
    assert check(400.0)==(None,"out_of_range")


def test_to_reading_fills_in_every_sensor():
    now=datetime.now(timezone.utc)
    reading=to_reading({"id":"room-101","temps":{"Centre":21.5,"Door":-127.0}},now)
    assert reading.device_id=="room-101" and reading.time==now
    assert reading.sensors["Centre"].ok
    assert reading.sensors["Door"].status=="disconnected"
    assert reading.sensors["Heater"].status=="missing"
    assert len(reading.sensors)==5
