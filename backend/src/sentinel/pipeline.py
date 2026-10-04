"""Wires the stages together: Reading -> storage + analyzers -> issue tracker -> storage + channels."""

import logging
import threading
from datetime import datetime

from src.sentinel.analysis.base import Analyzer
from src.sentinel.issues import IssueTracker
from src.sentinel.live import LiveView
from src.sentinel.models import IssueEvent, Reading
from src.sentinel.notify.base import Channel
from src.sentinel.storage import Storage

log=logging.getLogger(__name__)


class Pipeline:
    def __init__(self, analyzers: list[Analyzer], tracker: IssueTracker, storage: Storage, channels: list[Channel],
                 live: LiveView | None=None):
        self.analyzers=analyzers
        self.tracker=tracker
        self.storage=storage
        self.channels=channels
        self.live=live or LiveView()
        # process() runs on the reader, tick() on a timer thread; analyzers aren't thread-safe on their own.
        self._lock=threading.Lock()

    def process(self, reading: Reading, saved: bool=False) -> list[IssueEvent]:
        """saved=True when the caller already stored the reading in its own transaction."""
        with self._lock:
            self.live.on_reading(reading)
            if not saved:
                self.storage.save_reading(reading)
            metrics=[]
            events=[]
            findings=[]
            for analyzer in self.analyzers:
                result=analyzer.analyze(reading)
                metrics.extend(result.metrics)
                findings.extend(result.findings)
                events.extend(self.tracker.update(analyzer.name,reading.device_id,result.findings,reading.time))
            self.storage.save_metrics(metrics)
            self._publish(events)
            for finding in findings:
                self.live.refresh(finding,self.tracker.advise(finding))
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
            self.live.on_event(event)
            self.storage.save_event(event)
            for channel in self.channels:
                try:
                    channel.send(event)
                except Exception:
                    # One broken channel must not stop the others.
                    log.exception("channel %s failed",type(channel).__name__)
