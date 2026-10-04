"""ExpoPushChannel message building and dead-token handling, with the database and Expo faked."""

import pytest
from pydantic import ValidationError

from src.push.schemas import PushTokenIn
from src.sentinel.advice import advise
from src.sentinel.issues import IssueTracker
from src.sentinel.notify.expo import ExpoPushChannel
from tests.test_issues_and_pipeline import at, finding


class FakeExpo(ExpoPushChannel):
    def __init__(self, tokens, tickets, name=None):
        super().__init__()
        self.tokens=tokens
        self.name=name
        self.tickets=tickets
        self.posted=[]
        self.forgotten=[]

    def _recipients(self, device_id): return self.tokens,self.name
    def _post(self, messages):
        self.posted.append(messages)
        return self.tickets[:len(messages)]
    def _forget(self, tokens): self.forgotten.extend(tokens)


def opened_event():
    [event]=IssueTracker(advise).update("sensor_health","room-101",[finding()],at(0))
    return event


def test_sends_to_every_owner_phone():
    channel=FakeExpo(["ExponentPushToken[a]","ExponentPushToken[b]"],[{"status":"ok"}]*2)
    channel.deliver(opened_event())
    [messages]=channel.posted
    assert [m["to"] for m in messages]==["ExponentPushToken[a]","ExponentPushToken[b]"]
    assert messages[0]["title"]=="WARNING room-101: SENSOR_FAULT"
    assert messages[0]["data"]=={"device_id":"room-101","kind":"SENSOR_FAULT","severity":"WARNING","event":"opened"}
    assert channel.forgotten==[]


def test_title_uses_owner_device_name():
    channel=FakeExpo(["ExponentPushToken[a]"],[{"status":"ok"}],name="Server room")
    channel.deliver(opened_event())
    assert channel.posted[0][0]["title"]=="WARNING Server room: SENSOR_FAULT"
    assert channel.posted[0][0]["data"]["device_id"]=="room-101"


def test_no_owner_phones_sends_nothing():
    channel=FakeExpo([],[])
    channel.deliver(opened_event())
    assert channel.posted==[]


def test_drops_unregistered_tokens_only():
    tickets=[{"status":"error","message":"gone","details":{"error":"DeviceNotRegistered"}},
             {"status":"error","message":"too big","details":{"error":"MessageTooBig"}},
             {"status":"ok"}]
    channel=FakeExpo(["ExponentPushToken[a]","ExponentPushToken[b]","ExponentPushToken[c]"],tickets)
    channel.deliver(opened_event())
    assert channel.forgotten==["ExponentPushToken[a]"]


def test_batches_of_100():
    tokens=[f"ExponentPushToken[{i}]" for i in range(150)]
    channel=FakeExpo(tokens,[{"status":"ok"}]*100)
    channel.deliver(opened_event())
    assert [len(batch) for batch in channel.posted]==[100,50]


@pytest.mark.parametrize("token",["ExponentPushToken[xxxxxxxx]","ExpoPushToken[yyyy]"])
def test_accepts_expo_tokens(token):
    assert PushTokenIn(token=token).token==token


@pytest.mark.parametrize("token",["","abc","ExponentPushToken[]","fcm-token-123"])
def test_rejects_other_tokens(token):
    with pytest.raises(ValidationError):
        PushTokenIn(token=token)
