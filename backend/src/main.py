import asyncio
import contextlib
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from src.auth.routes import router as auth_router
from src.database import engine
from src.device.routes import router as device_router
from src.push.routes import router as push_router
from src.sentinel.api import router as sentinel_router
from src.sentinel.demo import DEMO_DEVICES, DemoRunner
from src.sentinel.run import TICK_SECONDS, build_pipeline


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Readings streamed by devices (/devices/stream) go through this pipeline.
    # `python -m src.sentinel.run --api` sets its own first, so serial and network
    # readings share one pipeline and its timer.
    tasks = []
    if getattr(app.state, "pipeline", None) is None:
        app.state.pipeline = build_pipeline()
        tasks.append(asyncio.create_task(_tick_forever(app)))

    # Demo mode: simulated devices with their own pipelines, warmed up before the first request.
    app.state.demos = {device_id: DemoRunner(device_id) for device_id in DEMO_DEVICES}
    for demo in app.state.demos.values():
        await run_in_threadpool(demo.warm_up)
    if app.state.demos:
        tasks.append(asyncio.create_task(_run_demos(app)))
    yield
    for task in tasks:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    await engine.dispose()


async def _tick_forever(app: FastAPI) -> None:
    """Lets time-based analyzers (e.g. a device going silent) fire without new readings."""
    while True:
        await asyncio.sleep(TICK_SECONDS)
        await run_in_threadpool(app.state.pipeline.tick, datetime.now(timezone.utc))


async def _run_demos(app: FastAPI) -> None:
    """Moves every demo device on by the real time that passed, times its speed."""
    last = time.monotonic()
    while True:
        await asyncio.sleep(1)
        now = time.monotonic()
        for demo in app.state.demos.values():
            await run_in_threadpool(demo.advance_real, now - last)
        last = now


app = FastAPI(title="stormhacks gateway", lifespan=lifespan)
# Comma-separated browser origins allowed to call the API, e.g. the deployed frontend.
# Auth uses bearer tokens, not cookies, so credentialed CORS is not needed.
# Local defaults: React dev servers (3000, 5173) and the 3D room view (frontend/room-view on 8080).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get(
            "CORS_ALLOW_ORIGINS",
            "http://localhost:3000,http://localhost:5173,http://localhost:8080,http://127.0.0.1:8080",
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(device_router)
app.include_router(push_router)
app.include_router(sentinel_router)


@app.get("/health")
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}
