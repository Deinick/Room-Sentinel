"""Mark impossible or special sensor values as bad, and build the Reading."""

from datetime import datetime

from src.sentinel.config import SENSOR_NAMES
from src.sentinel.models import Reading, SensorValue

DISCONNECTED=-127.0
POWER_ON=85.0
MIN_REAL=-40.0
MAX_REAL=100.0


def check(temp:float | None)->tuple[float | None,str]:
    if temp is None:
        return None,"missing"
    if temp==DISCONNECTED:
        return None,"disconnected"
    if temp==POWER_ON:
        return None,"power_on"
    if temp<MIN_REAL or temp>MAX_REAL:
        return None, "out_of_range"
    return temp,"ok"


def check_all(temps: dict)->dict:
    result={}
    for name in SENSOR_NAMES:
        temp=temps.get(name)
        result[name]=check(temp)
    return result


def to_reading(frame: dict, time: datetime) -> Reading:
    """Parser output + arrival time -> Reading with every sensor checked."""
    sensors={}
    for name,(temp,status) in check_all(frame["temps"]).items():
        sensors[name]=SensorValue(temp,status)
    return Reading(frame["id"],time,sensors)
