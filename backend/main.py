from datetime import datetime, timezone
from parser import parse_line
from validate import check_all
LOG_FILE="sample.log"


def main():
    with open(LOG_FILE) as line:
        for line in line:
            frame=parse_line(line)
            if frame is None:
                print("skipped:",repr(line))
                continue

            now=datetime.now(timezone.utc)
            results=check_all(frame["temps"])
            print(now.strftime("%H:%M:%S"),"ms =",frame["ms"])
            for sensor_id,(temp, label) in results.items():
                print("   sensor", sensor_id, temp, label)


if __name__=="__main__":
    main()

