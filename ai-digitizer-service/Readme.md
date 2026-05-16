# AI Digitizer Service

Отдельный сервис для AI-assisted digitizing в образовательной ГИС-платформе.

Сервис нужен для сценария, где студент начинает оцифровывать объект на карте, а модель предлагает контур по подсказке. Основной backend и frontend при этом не зависят от конкретной модели: они вызывают один HTTP endpoint, а внутри сервиса можно переключать реализацию между лёгким OpenCV fallback и GeoSAM/SAM2.

## Роль В Проекте

`ai-digitizer-service` не проверяет работу студента и не заменяет преподавателя. Его задача уже: ускорить ручную оцифровку на карте.

Типовой сценарий:

1. Студент открывает карту задания.
2. Выбирает редактируемый слой.
3. Начинает рисовать объект или задаёт область интереса.
4. Frontend отправляет crop карты, bbox и начальную геометрию в сервис.
5. Сервис возвращает предложенный контур в GeoJSON.
6. Студент принимает, редактирует или отклоняет результат.
7. Черновик сохраняется как обычный слой и дальше проходит стандартную проверку.

## Endpoints

- `GET /health` — состояние сервиса и выбранного backend модели.
- `POST /segment-box` — построение предлагаемого контура по изображению, bbox и подсказке пользователя.

Пример запроса:

```json
{
  "image_data": "base64 image or data URL",
  "bbox_pixels": [10, 10, 120, 120],
  "image_extent": [0, 0, 1000, 1000],
  "prompt_geometry": {
    "type": "Polygon",
    "coordinates": []
  },
  "target_geometry_type": "polygon"
}
```

Пример ответа:

```json
{
  "status": "passed",
  "geometry": {
    "type": "Polygon",
    "coordinates": []
  },
  "confidence": 0.6,
  "message": "AI contour generated from the student's prompt. Review and edit it before submitting.",
  "meta": {
    "backend": "classical-cv"
  }
}
```

## Режим По Умолчанию

По умолчанию используется лёгкий fallback:

```env
AI_DIGITIZER_BACKEND=classical-cv
```

Этот режим не требует весов модели и тяжёлых зависимостей. Он использует OpenCV GrabCut внутри выделенной области. Если frontend отправляет `prompt_geometry`, сервис превращает начатую студентом геометрию в foreground mask и пытается найти похожий контур.

Это не полноценная нейросетевая модель, а fallback и прототип для проверки workflow.

## Основной Model Backend: GeoSAM/SAM2

Для дипломного AI-assisted digitizing используется GeoSAM-подход поверх SAM2: пользователь задаёт bbox, точку или начатую геометрию, модель строит маску объекта, а сервис переводит маску в GeoJSON.

Это не QGIS-плагин GeoSAM один-в-один, а backend с похожей идеей: prompt-based segmentation для геоизображения внутри отдельного сервиса. Такой вариант хорошо ложится на сценарий, где студент задаёт подсказку, а затем вручную принимает или правит предложенный контур.

Переменные окружения:

```env
AI_DIGITIZER_BACKEND=geosam
AI_DIGITIZER_DOCKERFILE=Dockerfile.sam2

SAM2_REPO_PATH=/opt/sam2
SAM2_MODEL_CFG=configs/sam2.1/sam2.1_hiera_t.yaml
SAM2_CHECKPOINT=/models/sam2.1_hiera_tiny.pt
SAM2_DEVICE=auto

SAM2_REPO_PATH_HOST=./ai-digitizer-service/vendor/sam2
AI_MODELS_DIR=./models
```

Что нужно положить руками:

- исходники SAM2 в `ai-digitizer-service/vendor/sam2`, если хочешь монтировать локальную копию;
- checkpoint SAM2, например `models/sam2.1_hiera_tiny.pt`;
- в `.env` указать `AI_DIGITIZER_BACKEND=geosam` и `AI_DIGITIZER_DOCKERFILE=Dockerfile.sam2`.

## Fallback

Если выбранный model backend недоступен, например:

- не найден checkpoint;
- не примонтирована папка с исходным кодом модели;
- не установлены зависимости;
- модель не смогла построить маску,

сервис не должен ломать весь workflow. Он возвращается к `classical-cv` и пишет причину в `meta`.

Пример:

```json
{
  "meta": {
    "backend": "classical-cv",
    "fallback_from": "geosam",
    "fallback_reason": "SAM2 checkpoint not found: /models/sam2.1_hiera_tiny.pt"
  }
}
```

## Генерация Датасета Из Лабораторных GIS-Слоёв

Скрипты подготовки датасетов оставлены как заготовка для будущего обучения или оценки моделей. Они полезны, если внешние датасеты плохо похожи на учебные карты.

Пример генерации image/mask пар из лабораторных архивов:

```bash
pip install -r GIS-project-repository/tools/requirements-gis-dataset.txt
```

```bash
python GIS-project-repository/tools/build_gis_render_dataset.py \
  --input "/mnt/c/path/to/chapt08qgis.zip" \
  --out GIS-project-repository/datasets/qgis_rendered_chapt08 \
  --target-layer road-l \
  --target-layer hydro-l \
  --target-layer hydro-p \
  --grid-size 10 \
  --tile-size 512 \
  --line-mask-width 7 \
  --min-mask-ratio 0.002
```

Несколько лабораторных можно объединить повторением `--input`:

```bash
python GIS-project-repository/tools/build_gis_render_dataset.py \
  --input "/mnt/c/path/to/chapt05qgis.zip" \
  --input "/mnt/c/path/to/chapt06.zip" \
  --input "/mnt/c/path/to/chapt08.zip" \
  --input "/mnt/c/path/to/chapt09qgis.zip" \
  --out GIS-project-repository/datasets/qgis_rendered_labs \
  --grid-size 10 \
  --tile-size 512 \
  --line-mask-width 7 \
  --min-mask-ratio 0.002
```

Скрипт читает Shapefile/GeoJSON, рендерит карту как RGB-картинку, а выбранный слой отдельно рендерит как бинарную маску.

Если слой без `.prj`, можно явно назначить исходную систему координат:

```bash
python GIS-project-repository/tools/build_gis_render_dataset.py \
  --input "/mnt/c/path/to/lab.zip" \
  --out GIS-project-repository/datasets/qgis_rendered_lab \
  --assume-missing-crs EPSG:4326
```

## Датасеты Водоёмов

Для экспериментов по водоёмам можно использовать Kaggle-датасеты с изображениями и бинарными масками воды, например:

- `Satellite Images of Water Bodies`;
- `Water Body Segmentation From Satellite Images`;
- `Water body segmentation in Satellite Images`.

После скачивания ZIP его можно привести к общему формату image/mask:

```bash
python GIS-project-repository/tools/prepare_water_segmentation_dataset.py \
  --input "/mnt/e/datasets/water-bodies.zip" \
  --out GIS-project-repository/datasets/water_segmentation \
  --threshold 128
```

Если маска инвертирована, то есть вода чёрная, а фон белый:

```bash
python GIS-project-repository/tools/prepare_water_segmentation_dataset.py \
  --input "/mnt/e/datasets/water-bodies.zip" \
  --out GIS-project-repository/datasets/water_segmentation \
  --threshold 128 \
  --invert-mask
```

## Структура

```text
ai-digitizer-service/
  app/main.py              # FastAPI endpoint и backend-переключатель моделей
  Dockerfile               # лёгкий образ без тяжёлых моделей
  Dockerfile.sam2          # образ с SAM2/GeoSAM backend
  requirements.txt         # базовые зависимости
  requirements-sam2.txt    # инструкция по SAM2-зависимостям
  vendor/sam2/             # опциональная локальная копия SAM2
```

## Проверка

Лёгкая проверка без модели:

```powershell
docker build -t gis-ai-digitizer-check ./ai-digitizer-service
docker run --rm gis-ai-digitizer-check python -m py_compile /app/app/main.py
docker run --rm gis-ai-digitizer-check python -c "from app.main import health; print(health())"
```

Проверка GeoSAM/SAM2 режима:

```powershell
docker compose build ai-digitizer
docker compose up ai-digitizer
curl http://localhost:8790/health
```

В `health` должно быть видно `backend: geosam`. Если checkpoint или SAM2 недоступны, сервис покажет причину и будет использовать fallback.
