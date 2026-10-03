"""Line sources the reader consumes: a replayed log file or a live serial port."""

import time
from collections.abc import Iterator

import serial


def lines_from_file(path: str) -> Iterator[str]:
    with open(path) as file:
        for line in file:
            time.sleep(1)
            yield line


def lines_from_serial(port: str) -> Iterator[str]:
    with serial.Serial(port, 115200, timeout=1) as conn:
        while True:
            raw = conn.readline()
            if raw:
                yield raw.decode("ascii", errors="replace")
