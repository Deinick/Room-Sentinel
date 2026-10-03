"""
Run the gateway with a live reader feeding it.

    python -m src.analyzer             # replay sample.log
    python -m src.analyzer /dev/ttyX   # read from a serial port
"""

import logging
import sys
import threading

import uvicorn

from src.main import app
from .services import read_loop
from .sources import lines_from_file, lines_from_serial

LOG_FILE = "sample.log"


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    lines = lines_from_serial(sys.argv[1]) if len(sys.argv) > 1 else lines_from_file(LOG_FILE)

    reader = threading.Thread(target=read_loop, args=(lines,), daemon=True)
    reader.start()
    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
