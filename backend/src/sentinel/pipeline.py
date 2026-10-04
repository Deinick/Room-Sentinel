"""Wires the stages together: Reading -> storage + analyzers -> issue tracker -> storage + channels."""

import logging
import threading
from datetime import datetime

from src.sentinel.analysis.base import Analyzer
from src.sentinel.issues import IssueTracker
from src.sentinel.models import IssueEvent, Reading
from src.sentinel.notify.base import Channel
from src.sentinel.storage import Storage

log=logging.getLogger(__name__)


class Pipeline:
    def __init__(self, analyzers: list[Analyzer], tracker: IssueTracker, storage: Storage, channels: list[Channel]):
        self.analyzers=analyzers
        self.tracker=tracker
        self.storage=storage
        self.channels=channels
        # process() runs on the reader, tick() on a timer thread; analyzers aren't thread-safe on their own.
        self._lock=threading.Lock()

    def process(self, reading: Reading) -> list[IssueEvent]:
        with self._lock:
            self.storage.save_reading(reading)
            metrics=[]
            events=[]
            for analyzer in self.analyzers:
                result=analyzer.analyze(reading)
                metrics.extend(result.metrics)
                events.extend(self.tracker.update(analyzer.name,reading.device_id,result.findings,reading.time))
            self.storage.save_metrics(metrics)
            self._publish(events)
            return events

    def tick(self, now: datetime) -> list[IssueEvent]:
        with self._lock:
            events=[]
            for analyzer in self.analyzers:
                for device_id,findings in analyzer.tick(now).items():
                    events.extend(self.tracker.update(analyzer.name,device_id,findings,now))
            self._publish(events)
            return events

    def _publish(self, events: list[IssueEvent]) -> None:
        for event in events:
            self.storage.save_event(event)
            for channel in self.channels:
                try:
                    channel.send(event)
                except Exception:
                    # One broken channel (e.g. no internet for ntfy) must not stop the others.
                    log.exception("channel %s failed",type(channel).__name__)
