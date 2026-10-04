import logging

from src.sentinel.models import IssueEvent
from src.sentinel.notify.base import Channel, describe

log=logging.getLogger("sentinel.alerts")


class ConsoleChannel(Channel):
    def send(self, event: IssueEvent) -> None:
        title,body=describe(event)
        log.warning("[%s] %s\n    %s",event.type.value.upper(),title,body.replace("\n","\n    "))
