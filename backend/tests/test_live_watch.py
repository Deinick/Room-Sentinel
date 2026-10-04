import asyncio
import threading

from src.sentinel.live import LiveView
from tests.test_analysis import reading


def test_a_reading_from_a_worker_thread_wakes_a_watcher():
    async def main():
        live=LiveView()
        changed=live.watch()
        threading.Thread(target=live.on_reading,args=(reading(0),)).start()
        await asyncio.wait_for(changed.wait(),1)
        live.unwatch(changed)
        changed.clear()
        live.on_reading(reading(1))
        await asyncio.sleep(0)
        assert not changed.is_set()
    asyncio.run(main())
