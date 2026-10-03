from datetime import datetime, timezone
from parser import parse_line
from validate import check_all

import sys

import serial

import threading
import time
import uvicorn
from fastapi import FastAPI

LOG_FILE="sample.log"

latest=None

app=FastAPI()

@app.get("/latest")
def get_latest():
    if latest is None:
        return {"error": "no data yet"}
    return latest

def lines_from_file(path):
    with open(path) as file:
        for line in file:
            time.sleep(1)
            yield line


def lines_from_serial(port):
    with serial.Serial(port,115200,timeout=1) as conn:
        while True:
            raw=conn.readline()
            if raw:
                yield raw.decode("ascii", errors="replace")


def read_loop(lines):
    global latest
    for line in lines:
        frame=parse_line(line)
        if frame is None:
            print("skipped:",repr(line))
            continue

        now=datetime.now(timezone.utc)
        results=check_all(frame["temps"])
        sensors={}
        for sensor_id,(temp, label) in results.items():
            sensors[sensor_id]={"temp":temp,"status":label}

        latest={"time": now.isoformat(),"ms":frame["ms"],"sensors":sensors}
        print("reading at",now.strftime("%H:%M:%S"))

def main():
    if len(sys.argv)>1:
        lines=lines_from_serial(sys.argv[1])
    else:
        lines=lines_from_file(LOG_FILE)

    reader=threading.Thread(target=read_loop,args=(lines,),daemon=True)
    reader.start()
    uvicorn.run(app,host="127.0.0.1",port=8000)


if __name__=="__main__":
    main()

