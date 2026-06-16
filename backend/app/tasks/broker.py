from taskiq import TaskiqScheduler
from taskiq.schedule_sources import LabelScheduleSource
from taskiq_redis import RedisAsyncResultBackend, RedisStreamBroker

from app.core.config import settings

result_backend = RedisAsyncResultBackend(
    redis_url=settings.redis_url,
)

broker = RedisStreamBroker(
    url=settings.redis_url,
).with_result_backend(result_backend)

# Планировщик периодических задач: расписание берётся из меток
# @broker.task(schedule=[...]) у самих задач.
scheduler = TaskiqScheduler(broker=broker, sources=[LabelScheduleSource(broker)])


@broker.task
async def demo_task() -> str:
    return "worker is alive"


# Регистрируем периодические задачи обслуживания. Импорт в конце файла —
# чтобы broker был уже определён и не возникло циклического импорта.
from app.tasks import maintenance_tasks  # noqa: E402,F401