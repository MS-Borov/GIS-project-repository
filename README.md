# - На данной странице будет представлен мой дипломный проект по созданию образовательной ГИС-платформы с ИИ-помощником
Используемый стек:
Backend: FastAPI
БД / GIS: PostgreSQL + PostGIS
ORM / migrations: SQLAlchemy + Alembic
Очереди: Taskiq + Redis
Frontend: React + TypeScript + Vite
Карта: OpenLayers
Геообработка: GeoPandas, Shapely, Rasterio, GDAL
Кэш: Redis
Файлы: MinIO как S3-compatible storage
Мониторинг: Sentry минимум; Prometheus + Grafana — по желанию
Инфраструктура: Docker + docker-compose + Nginx как reverse proxy
tile pipeline: Martin или pg_tileserv
