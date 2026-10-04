"""Phone push through ntfy (https://ntfy.sh): install the ntfy app and subscribe to your topic.

Anyone who knows the topic name can read the messages, so use a long random one.
"""

import logging
import threading
import urllib.request

from src.sentinel.models import EventType, IssueEvent, Severity
from src.sentinel.notify.base import Channel, describe

log=logging.getLogger(__name__)

PRIORITY={Severity.INFO:"3",Severity.WARNING:"4",Severity.CRITICAL:"5"}


class NtfyChannel(Channel):
    def __init__(self, topic: str, server="https://ntfy.sh", min_severity=Severity.WARNING):
        self.url=f"{server.rstrip('/')}/{topic}"
        self.min_severity=min_severity

    def send(self, event: IssueEvent) -> None:
        if event.finding.severity<self.min_severity:
            return
        title,body=describe(event)
        resolved=event.type==EventType.RESOLVED
        headers={
            "Title":title,
            "Priority":"2" if resolved else PRIORITY[event.finding.severity],
            "Tags":"white_check_mark" if resolved else "warning",
        }
        # Send in the background so a slow network never delays the next reading.
        threading.Thread(target=self._post,args=(body,headers),daemon=True).start()

    def _post(self, body, headers):
        request=urllib.request.Request(self.url,data=body.encode(),headers=headers,method="POST")
        try:
            urllib.request.urlopen(request,timeout=10).close()
        except OSError as e:
            log.warning("ntfy push failed: %s",e)
