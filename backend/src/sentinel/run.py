"""Start the gateway. Run from the backend/ folder:

    python -m src.sentinel.run                                 # replay sample.log, one line per second
    python -m src.sentinel.run --file my.log --delay 0          # replay a log as fast as possible
    python -m src.sentinel.run --serial /dev/tty.usbmodem1103   # the real device
    python -m src.sentinel.run --no-db                          # don't save anything
    python -m src.sentinel.run --api                            # also serve the team API (/latest, /issues, auth)

Database settings come from PGHOST, PGUSER, PGPASSWORD, ... in the environment.
Set NTFY_TOPIC to also get phone notifications.
"""

import argparse
import logging
import os
import threading
import time
from datetime import datetime, timezone

from src.sentinel.advice import advise
from src.sentinel.analysis.device_silence import DeviceSilence
from src.sentinel.analysis.sensor_health import SensorHealth
from src.sentinel.ingest import sources
from src.sentinel.ingest.parser import parse_line
from src.sentinel.ingest.validate import to_reading
from src.sentinel.issues import IssueTracker
from src.sentinel.live import LIVE
from src.sentinel.notify.console import ConsoleChannel
from src.sentinel.notify.ntfy import NtfyChannel
from src.sentinel.pipeline import Pipeline
from src.sentinel.storage import MemoryStorage, PostgresStorage

log=logging.getLogger("sentinel")

TICK_SECONDS=5


def build_pipeline(use_db=True) -> Pipeline:
    # Add new analysis features here.
    analyzers=[
        SensorHealth(),
        DeviceSilence(),
    ]
    channels=[ConsoleChannel()]
    if os.environ.get("NTFY_TOPIC"):
        channels.append(NtfyChannel(os.environ["NTFY_TOPIC"]))
    storage=PostgresStorage() if use_db else MemoryStorage()
    return Pipeline(analyzers,IssueTracker(advise),storage,channels,live=LIVE)


def tick_forever(pipeline: Pipeline):
    while True:
        time.sleep(TICK_SECONDS)
        pipeline.tick(datetime.now(timezone.utc))


def main():
    ap=argparse.ArgumentParser(prog="python -m src.sentinel.run")
    source=ap.add_mutually_exclusive_group()
    source.add_argument("--file",default="sample.log",help="log file to replay (default: sample.log)")
    source.add_argument("--serial",metavar="PORT",help="read the device, e.g. /dev/tty.usbmodem1103")
    source.add_argument("--stdin",action="store_true",help="read lines piped in")
    ap.add_argument("--delay",type=float,default=1.0,help="seconds between replayed lines (0 = no wait)")
    ap.add_argument("--no-db",action="store_true",help="don't save to the database")
    ap.add_argument("--api",action="store_true",help="also run the team API in this process")
    ap.add_argument("--port",type=int,default=8000,help="API port (with --api)")
    args=ap.parse_args()

    logging.basicConfig(level=logging.INFO,format="%(asctime)s %(levelname)-7s %(message)s",datefmt="%H:%M:%S")

    if args.serial:
        lines=sources.lines_from_serial(args.serial)
    elif args.stdin:
        lines=sources.lines_from_stdin()
    else:
        lines=sources.lines_from_file(args.file,args.delay)

    pipeline=build_pipeline(use_db=not args.no_db)
    threading.Thread(target=tick_forever,args=(pipeline,),daemon=True).start()

    if args.api:
        # The API needs the PG* settings even with --no-db (it builds its engine at import).
        import uvicorn

        from src.main import app

        app.state.pipeline=pipeline  # the API's /devices/stream feeds the same pipeline
        threading.Thread(target=read_forever,args=(lines,pipeline),daemon=True).start()
        uvicorn.run(app,host="127.0.0.1",port=args.port)
    else:
        read_forever(lines,pipeline)


def read_forever(lines, pipeline: Pipeline):
    for line in lines:
        frame=parse_line(line)
        if frame is None:
            log.info("skipped: %r",line)
            continue
        reading=to_reading(frame,datetime.now(timezone.utc))
        pipeline.process(reading)
        bad=[name for name,v in reading.sensors.items() if not v.ok]
        log.info("reading from %s%s",reading.device_id,f" (bad: {', '.join(bad)})" if bad else "")
    log.info("input ended")


if __name__=="__main__":
    main()
