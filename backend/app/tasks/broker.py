from taskiq_redis import RedisAsyncResultBackend, RedisStreamBroker

from app.core.config import settings

result_backend = RedisAsyncResultBackend(
    redis_url=settings.redis_url,
)

broker = RedisStreamBroker(
    url=settings.redis_url,
).with_result_backend(result_backend)


@broker.task
async def demo_task() -> str:
    return "worker is alive"
