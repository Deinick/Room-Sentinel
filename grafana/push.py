"""Push the Room Sentinel datasource, dashboard and alert rule to Grafana Cloud.

Idempotent: safe to re-run after editing anything under ./grafana.

    set -a; source .env; set +a
    python3 grafana/push.py

Needs GRAFANA_URL, GRAFANA_TOKEN (service account token, Admin role) and the
same PG* settings as the backend. Stdlib only.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
FOLDER_UID = "room-sentinel"
FOLDER_TITLE = "Room Sentinel"
DATASOURCE_UID = "timescaledb"


def api(method, path, body=None, ok_missing=False):
    req = urllib.request.Request(
        os.environ["GRAFANA_URL"].rstrip("/") + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {os.environ['GRAFANA_TOKEN']}",
            "Content-Type": "application/json",
            # Keep provisioned resources editable in the UI.
            "X-Disable-Provenance": "true",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read() or "null")
    except urllib.error.HTTPError as e:
        if ok_missing and e.code == 404:
            return None
        sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()}")


def push_datasource():
    body = {
        "uid": DATASOURCE_UID,
        "name": "TimescaleDB",
        "type": "grafana-postgresql-datasource",
        "access": "proxy",
        "isDefault": True,
        "url": f"{os.environ['PGHOST']}:{os.environ.get('PGPORT', '5432')}",
        "user": os.environ["PGUSER"],
        "jsonData": {
            "database": os.environ["PGDATABASE"],
            "sslmode": os.environ.get("PGSSLMODE", "require"),
            "timescaledb": True,
            "postgresVersion": 1500,
        },
        "secureJsonData": {"password": os.environ["PGPASSWORD"]},
    }
    if api("GET", f"/api/datasources/uid/{DATASOURCE_UID}", ok_missing=True):
        api("PUT", f"/api/datasources/uid/{DATASOURCE_UID}", body)
    else:
        api("POST", "/api/datasources", body)


def push_folder():
    if not api("GET", f"/api/folders/{FOLDER_UID}", ok_missing=True):
        api("POST", "/api/folders", {"uid": FOLDER_UID, "title": FOLDER_TITLE})


def push_dashboards():
    for path in sorted((HERE / "dashboards").glob("*.json")):
        dashboard = json.loads(path.read_text())
        dashboard["id"] = None
        api("POST", "/api/dashboards/db", {"dashboard": dashboard, "folderUid": FOLDER_UID, "overwrite": True})


def push_alerts():
    for path in sorted((HERE / "alerting").glob("*.json")):
        group = json.loads(path.read_text())
        for rule in group["rules"]:
            rule.update(folderUID=FOLDER_UID, ruleGroup=group["title"], orgID=1)
        api("PUT", f"/api/v1/provisioning/folder/{FOLDER_UID}/rule-groups/{group['title']}", group)


if __name__ == "__main__":
    push_datasource()
    push_folder()
    push_dashboards()
    push_alerts()
    print(f"Pushed to {os.environ['GRAFANA_URL'].rstrip('/')}/dashboards/f/{FOLDER_UID}")
