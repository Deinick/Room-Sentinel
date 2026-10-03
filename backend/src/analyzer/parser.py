import json

SENSOR_NAMES=["Centre","Window","Heater","Door","Far wall"]

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


if __name__=="__main__":
    tests=[
        '{"id":"room-101","Centre":21.44,"Window":19.81,"Heater":34.06,"Door":20.90,"Far wall":21.12}',
        '{"id":"room-101","Centre":21.5,"Window":null}',
        '{"Centre":21.5}',
        '{"id":"room-101","Centre":"abc"}',
        '{"id":"room-101","Centre":21.44,"Window":19.6',
        '{"id":"room-101","boot":1}',
        '',
        'hello from stm32',
    ]
    for t in tests:
        print(repr(t), "->", parse_line(t))

