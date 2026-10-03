from datetime import datetime, timezone
from parser import parse_line
from validate import check_all

import sys

import serial

import psycopg

import threading
import time
import uvicorn
from fastapi import FastAPI

LOG_FILE="sample.log"

latest={}  # newest reading per device: {"room-101": {...}, "room-202": {...}}

app=FastAPI()

@app.get("/latest")
def get_latest():
    if not latest:
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


def save_reading(conn,device_id,time,sensors):
    with conn.cursor() as cur:
        for name,s in sensors.items():
            cur.execute(
                "INSERT INTO readings (time, device_id, sensor, temp_c, status) VALUES (%s, %s, %s, %s, %s)",
                (time,device_id,name,s["temp"],s["status"]),
            )


def read_loop(lines):
    conn=None
    for line in lines:
        frame=parse_line(line)
        if frame is None:
            print("skipped:",repr(line))
            continue

        now=datetime.now(timezone.utc)
        results=check_all(frame["temps"])
        sensors={}
        for name,(temp, label) in results.items():
            sensors[name]={"temp":temp,"status":label}

        latest[frame["id"]]={"time": now.isoformat(),"sensors":sensors}
        try:
            if conn is None:
                # No arguments: psycopg reads PGHOST, PGUSER, PGPASSWORD, ... from the environment (.env)
                conn=psycopg.connect(autocommit=True)
            save_reading(conn,frame["id"],now,sensors)
        except psycopg.Error as e:
            # Don't let a database problem stop the reader: /latest stays live,
            # and we reconnect on the next reading
            print("database error, reading not saved:",e)
            if conn is not None:
                conn.close()
            conn=None
        print("reading from",frame["id"],"at",now.strftime("%H:%M:%S"))

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

