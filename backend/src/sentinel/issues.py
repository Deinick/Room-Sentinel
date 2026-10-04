"""Turns a stream of findings into issue events, so people are told once, not every second.

    new finding                    -> OPENED
    same finding, higher severity  -> ESCALATED
    same finding, still there      -> REMINDER (every `reminder_every`)
    finding no longer reported     -> RESOLVED
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from src.sentinel.models import EventType, Finding, IssueEvent, Recommendation, Severity


@dataclass
class _OpenIssue:
    finding: Finding
    opened_at: datetime
    last_notified: datetime
    severity: Severity


class IssueTracker:
    def __init__(self, advise: Callable[[Finding],list[Recommendation]], reminder_every=timedelta(minutes=10)):
        self.advise=advise
        self.reminder_every=reminder_every
        self._open: dict[tuple[str,str],dict[str,_OpenIssue]]={}  # (analyzer, device) -> key -> issue

    def update(self, analyzer: str, device_id: str, findings: list[Finding], now: datetime) -> list[IssueEvent]:
        """findings = everything `analyzer` currently reports for `device_id`."""
        current={f.key:f for f in findings}
        open_issues=self._open.setdefault((analyzer,device_id),{})
        events=[]

        for key,finding in current.items():
            issue=open_issues.get(key)
            if issue is None:
                open_issues[key]=_OpenIssue(finding,now,now,finding.severity)
                events.append(self._event(EventType.OPENED,finding,now,now))
                continue
            issue.finding=finding
            if finding.severity>issue.severity:
                issue.severity=finding.severity
                issue.last_notified=now
                events.append(self._event(EventType.ESCALATED,finding,now,issue.opened_at))
            elif now-issue.last_notified>=self.reminder_every:
                issue.last_notified=now
                events.append(self._event(EventType.REMINDER,finding,now,issue.opened_at))

        for key in list(open_issues):
            if key not in current:
                issue=open_issues.pop(key)
                events.append(IssueEvent(EventType.RESOLVED,now,issue.finding,issue.opened_at))
        return events

    def open_issues(self) -> list[Finding]:
        return [i.finding for issues in self._open.values() for i in issues.values()]

    def _event(self, type_, finding, now, opened_at) -> IssueEvent:
        return IssueEvent(type_,now,finding,opened_at,self.advise(finding))
