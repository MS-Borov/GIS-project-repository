# Этап 1: Сборка (builder)
FROM python:3.12-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Build-time toolchain only — нужен на случай если pip придётся компилировать
# что-то из исходников (manylinux wheels обычно покрывают всё, но это страховка).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgdal-dev \
    libpq-dev \
    libproj-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Собираем wheels (бинарные пакеты), чтобы не тащить компиляторы в финальный образ
RUN pip wheel --no-cache-dir --wheel-dir /app/wheels -r requirements.txt

# Этап 2: Финальный образ (runtime)
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# В runtime нужны только shared-библиотеки для psycopg2-binary.
# pyogrio, pyproj и shapely используют GDAL/PROJ/GEOS, вшитые в их wheels.
RUN useradd -m appuser \
    && apt-get update \
    && apt-get install --no-install-recommends -y libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /app/uploads \
    && chown -R appuser:appuser /app


COPY requirements.txt .
COPY --from=builder /app/wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels /wheels/* \
    && rm -rf /wheels

# Копируем код приложения и отдаем права нашему новому пользователю
COPY --chown=appuser:appuser . .

USER appuser