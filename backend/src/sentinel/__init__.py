"""Room Sentinel: collect -> analyze -> advise -> notify.

    ingest/     lines from the device -> Reading
    analysis/   Reading -> Findings (what is wrong) + Metrics (numbers to graph)
    advice.py   Finding -> Recommendations (what to do)
    issues.py   tracks findings over time -> IssueEvents (opened / reminder / resolved)
    notify/     IssueEvent -> console (Grafana reads issue_events for alerts)
    storage.py  everything -> TimescaleDB
    pipeline.py wires the stages together
    run.py      entry point: python -m src.sentinel.run
"""
