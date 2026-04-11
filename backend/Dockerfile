# Этап 1: Сборка (builder)
FROM python:3.12-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y \
    build-essential \
    gdal-bin \
    libgdal-dev \
    libpq-dev \
    wget \
    proj-bin \
    libproj-dev\
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Собираем wheels (бинарные пакеты), чтобы не тащить компиляторы в финальный образ
RUN pip wheel --no-cache-dir --wheel-dir /app/wheels -r requirements.txt

# Этап 2: Финальный образ (runtime)
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Создаем пользователя, чтобы не запускать как root
RUN useradd -m appuser \
    && apt-get update \
    && apt-get install --no-install-recommends -y \
    libpq5 gdal-bin \
    proj-bin \
    libproj-dev\
    && rm -rf /var/lib/apt/lists/* \
    # Меняем владельца папки приложения и папки загрузок
    && mkdir /app/uploads \
    && chown -R appuser:appuser /app


COPY requirements.txt .
COPY --from=builder /app/wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels /wheels/* \
    && rm -rf /wheels

# Копируем код приложения и отдаем права нашему новому пользователю
COPY --chown=appuser:appuser . .

USER appuser