"""One line of text from the STM32 -> {"id": ..., "temps": {...}}, or None if it isn't a reading."""

import json

from src.sentinel.config import SENSOR_NAMES

def parse_line(line: str) -> dict | None:
    line=line.strip()
    if line=="":
        return None


    try:
        data=json.loads(line)
    except json.JSONDecodeError:
        return None

    if not isinstance(data,dict):
        return None


    device_id=data.get("id")
    if not isinstance(device_id,str) or device_id=="":
        return None

    temps={}
    for name in SENSOR_NAMES:
        if name not in data:
            continue
        value=data[name]
        if value is None:
            temps[name]=None
        else:
            try:
                temps[name]=float(value)
            except (ValueError, TypeError):
                temps[name]=None

    if len(temps)==0:
        return None

    return {"id":device_id,"temps":temps}

