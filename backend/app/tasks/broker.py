from taskiq_redis import RedisAsyncResultBackend, RedisStreamBroker

result_backend = RedisAsyncResultBackend(
    redis_url="redis://redis:6379/0",
)

broker = RedisStreamBroker(
    url="redis://redis:6379/0",
).with_result_backend(result_backend)


@broker.task
async def demo_task() -> str:
    return "worker is alive"