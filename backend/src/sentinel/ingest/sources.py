"""Where lines come from. Every source yields text lines, so the rest of the pipeline doesn't care."""

import logging
import sys
import time

log=logging.getLogger(__name__)


def lines_from_file(path, delay=1.0):
    """Replay a recorded log. delay = seconds between lines (1.0 behaves like the device, 0 = as fast as possible)."""
    with open(path) as file:
        for line in file:
            if delay:
                time.sleep(delay)
            yield line


def lines_from_serial(port, baud=115200):
    """Read the STM32 over USB forever. If the cable is pulled, keep retrying instead of crashing."""
    import serial  # only needed on the machine the board is plugged into

    while True:
        try:
            with serial.Serial(port,baud,timeout=1) as conn:
                log.info("connected to %s",port)
                while True:
                    raw=conn.readline()
                    if raw:
                        yield raw.decode("ascii",errors="replace")
        except serial.SerialException as e:
            log.warning("serial port problem (%s), retrying in 2 s",e)
            time.sleep(2)


def lines_from_stdin():
    """For piping, e.g. from a simulator: python sim.py | python -m src.sentinel.run --stdin"""
    yield from sys.stdin
