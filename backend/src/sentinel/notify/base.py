"""What every notification channel looks like, plus the shared message text.

To add a channel (email, voice, a command back to the device...): subclass
Channel in a new file and add it to the channel list in run.py.
"""

from src.sentinel.models import EventType, IssueEvent


class Channel:
    def send(self, event: IssueEvent) -> None:
        raise NotImplementedError


def describe(event: IssueEvent, device_name: str | None=None) -> tuple[str,str]:
    """(title, body) in plain words, used by every channel so messages look the same everywhere.

    device_name is the owner's name for the device; the serial is used when there is none.
    """
    f=event.finding
    device=device_name or f.device_id
    if event.type==EventType.RESOLVED:
        minutes=(event.time-event.opened_at).total_seconds()/60
        return f"Resolved: {device} {f.kind}", f"Back to normal after {minutes:.0f} min. Was: {f.message}"
    prefix={EventType.OPENED:"",EventType.ESCALATED:"Worse: ",EventType.REMINDER:"Still: "}[event.type]
    title=f"{f.severity.name} {device}: {f.kind}"
    lines=[prefix+f.message]+[f"-> {r.action}" for r in event.recommendations]
    return title, "\n".join(lines)
