from datetime import datetime, timezone
from parser import parse_line
from validate import check_all

import sys

import serial

def lines_from_file(path):
    with open(path) as file:
        for line in file:
            yield line


def lines_from_serial(port):
    with serial.Serial(port,115200,timeout=1) as conn:
        while True:
            raw=conn.readline()
            if raw:
                yield raw.decode("ascii", errors="replace")

LOG_FILE="sample.log"


def main():
    if len(sys.argv)>1:
        lines=lines_from_serial(sys.argv[1])
    else:
        lines=lines_from_file(LOG_FILE)

    for line in lines:
        frame=parse_line(line)
        if frame is None:
            print("skipped:", repr(line))
            continue

        now=datetime.now(timezone.utc)
        results = check_all(frame["temps"])
        print(now.strftime("%H:%M:%S"), "ms =", frame["ms"])
        for sensor_id, (temp, label) in results.items():
            print("   sensor", sensor_id, temp, label)


if __name__=="__main__":
    main()

