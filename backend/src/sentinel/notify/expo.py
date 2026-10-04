"""Push notifications to the owner's phones through the Expo Push API.

send() only queues the event: the pipeline holds its lock while channels run, so the
database lookup and the HTTP call happen on this channel's own worker thread.
Tokens Expo reports as DeviceNotRegistered (app uninstalled, permission revoked) are deleted.
"""

import json
import logging
import queue
import threading
import urllib.request

import psycopg

from src.sentinel.models import IssueEvent
from src.sentinel.notify.base import Channel, describe

log=logging.getLogger(__name__)

EXPO_PUSH_URL="https://exp.host/--/api/v2/push/send"
BATCH=100  # Expo accepts at most 100 messages per request

OWNER_TOKENS=("SELECT t.token, d.name FROM push_tokens t JOIN devices d ON d.user_id = t.user_id"
              " WHERE d.device_id = %s")


class ExpoPushChannel(Channel):
    def __init__(self):
        self._queue: queue.Queue[IssueEvent]=queue.Queue()
        self._conn=None  # used only by the worker thread
        threading.Thread(target=self._work,name="expo-push",daemon=True).start()

    def send(self, event: IssueEvent) -> None:
        self._queue.put(event)

    def _work(self):
        while True:
            event=self._queue.get()
            try:
                self.deliver(event)
            except Exception:
                log.exception("push for %s failed",event.finding.device_id)

    def deliver(self, event: IssueEvent) -> None:
        tokens,device_name=self._recipients(event.finding.device_id)
        if not tokens:
            return
        title,body=describe(event,device_name)
        f=event.finding
        messages=[{"to":token,"title":title,"body":body,"sound":"default","priority":"high",
                   "data":{"device_id":f.device_id,"kind":f.kind,"severity":f.severity.name,"event":event.type.value}}
                  for token in tokens]
        dead=[]
        for i in range(0,len(messages),BATCH):
            chunk=messages[i:i+BATCH]
            # Tickets come back in the same order as the messages.
            for message,ticket in zip(chunk,self._post(chunk)):
                if ticket.get("status")=="error":
                    if ticket.get("details",{}).get("error")=="DeviceNotRegistered":
                        dead.append(message["to"])
                    else:
                        log.warning("push rejected: %s",ticket.get("message"))
        if dead:
            self._forget(dead)

    def _post(self, messages: list[dict]) -> list[dict]:
        req=urllib.request.Request(EXPO_PUSH_URL,data=json.dumps(messages).encode(),method="POST",
                                   headers={"Content-Type":"application/json","Accept":"application/json"})
        with urllib.request.urlopen(req,timeout=10) as resp:
            return json.load(resp)["data"]

    def _recipients(self, device_id: str) -> tuple[list[str],str | None]:
        """The owner's push tokens and their name for the device."""
        rows=self._query(OWNER_TOKENS,(device_id,))
        return [token for token,_ in rows],(rows[0][1] if rows else None)

    def _forget(self, tokens: list[str]) -> None:
        log.info("dropping %d unregistered push token(s)",len(tokens))
        self._query("DELETE FROM push_tokens WHERE token = ANY(%s)",(tokens,))

    def _query(self, sql, params) -> list[tuple]:
        try:
            if self._conn is None:
                self._conn=psycopg.connect(autocommit=True)
            with self._conn.cursor() as cur:
                cur.execute(sql,params)
                return cur.fetchall() if cur.description else []
        except psycopg.Error:
            if self._conn is not None:
                self._conn.close()
            self._conn=None
            raise
