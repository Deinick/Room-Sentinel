import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from src.auth.routes import router as auth_router
from src.database import engine
from src.device.routes import router as device_router
from src.sentinel.api import router as sentinel_router
from src.sentinel.run import TICK_SECONDS, build_pipeline


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Readings streamed by devices (/devices/stream) go through this pipeline.
    # `python -m src.sentinel.run --api` sets its own first, so serial and network
    # readings share one pipeline and its timer.
    tick_task = None
    if getattr(app.state, "pipeline", None) is None:
        app.state.pipeline = build_pipeline()
        tick_task = asyncio.create_task(_tick_forever(app))
    yield
    if tick_task is not None:
        tick_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await tick_task
    await engine.dispose()


async def _tick_forever(app: FastAPI) -> None:
    """Lets time-based analyzers (e.g. a device going silent) fire without new readings."""
    while True:
        await asyncio.sleep(TICK_SECONDS)
        await run_in_threadpool(app.state.pipeline.tick, datetime.now(timezone.utc))


app = FastAPI(title="stormhacks gateway", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(device_router)
app.include_router(sentinel_router)


@app.get("/health")
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}
