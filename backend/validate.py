DISCONNECTED=-127.0
POWER_ON=85.0
MIN_REAL=-40.0
MAX_REAL=100.0

SENSOR_IDS=[1,2,3,4,5]


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
    for sensor_id in SENSOR_IDS:
        temp=temps.get(sensor_id)
        result[sensor_id]=check(temp)
    return result


if __name__=="__main__":
    for t in [21.5, None, -127.0, 85.0, 400.0, -50.0, 0.0]:
        print(t,"->",check(t))

    print(check_all({1: 21.5, 2: -127.0, 4: 85.0}))
