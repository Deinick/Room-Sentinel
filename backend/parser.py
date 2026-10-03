import json

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


    temps={}
    for key, value in data.items():
        if key.isdigit():
            if value is None:
                temps[int(key)]=None
            else:
                try:
                    temps[int(key)]=float(value)
                except (ValueError, TypeError):
                    temps[int(key)]=None

    if len(temps)==0:
        return None

    return {"ms":data.get("ms"),"temps":temps}


if __name__=="__main__":
    tests=[
        '{"ms":123450,"1":21.44,"2":19.81,"3":34.06,"4":20.90,"5":21.12}',
        '{"ms":1000,"1":21.5,"2":null}',
        '',
        'hello from stm32',
        '{"ms":12,"1":2',
        '{"boot":1}',
        '{"ms":1,"1":"abc"}',
    ]
    for t in tests:
        print(repr(t), "->", parse_line(t))

