# Training Water Model

Практический AI-путь для диплома: не пытаться делать универсальную оцифровку всего, а обучить локальную модель под один понятный класс — водоёмы на спутниковой подложке.

## 1. Подготовить Датасет

В WSL из корня проекта:

```bash
python tools/prepare_water_segmentation_dataset.py \
  --input "/mnt/e/datasets/water-bodies.zip" \
  --out datasets/water_bodies_segmentation \
  --threshold 128
```

Если хочется быстрый smoke-test:

```bash
python tools/prepare_water_segmentation_dataset.py \
  --input "/mnt/e/datasets/water-bodies.zip" \
  --out datasets/water_bodies_segmentation_smoke \
  --threshold 128 \
  --limit 300
```

## 2. Обучить Лёгкую Water-UNet Модель

На GPU через контейнер `ai-digitizer`:

```bash
docker compose run --rm \
  -e AI_DIGITIZER_BACKEND=water-unet \
  ai-digitizer bash -lc \
  'python /tools/train_water_unet.py \
    --dataset /datasets/water_bodies_segmentation \
    --out /models/water_unet.pt \
    --epochs 8 \
    --batch-size 4 \
    --image-size 512 \
    --base-channels 24 \
    --workers 2'
```

Если памяти GPU мало:

```bash
docker compose run --rm \
  -e AI_DIGITIZER_BACKEND=water-unet \
  ai-digitizer bash -lc \
  'python /tools/train_water_unet.py \
    --dataset /datasets/water_bodies_segmentation \
    --out /models/water_unet.pt \
    --epochs 8 \
    --batch-size 2 \
    --image-size 384 \
    --base-channels 16 \
    --workers 2'
```

## 3. Подключить Модель К Карте

В `.env`:

```env
AI_DIGITIZER_BACKEND=water-unet
AI_DIGITIZER_DOCKERFILE=Dockerfile.sam2
WATER_UNET_CHECKPOINT=/models/water_unet.pt
WATER_UNET_DEVICE=auto
WATER_UNET_THRESHOLD=0.5
```

Пересоздать контейнер:

```bash
docker compose up -d --force-recreate ai-digitizer
curl http://localhost:8790/health
```

Ожидаемо:

```json
{
  "backend": "water-unet",
  "water_unet_configured": true
}
```

После первого AI-запроса:

```json
{
  "water_unet_loaded": true,
  "water_unet_error": null
}
```

## 4. Как Тестировать

1. Включить спутниковую подложку.
2. Включить редактирование слоя.
3. Грубо обвести водоём.
4. Выделить грубый полигон.
5. Нажать `AI`.
6. Принять результат только если он лучше ручного контура.

Эта модель не предназначена для дорог, зданий, административных границ и условных знаков QGIS. Для них нужны отдельные датасеты и отдельное обучение.
