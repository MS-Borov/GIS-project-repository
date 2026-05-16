# GIS Education Platform

Дипломный проект: образовательная ГИС-платформа с автоматической проверкой лабораторных работ, интерфейсом в стиле Google Classroom и AI-помощником для оцифровки объектов на карте.

Платформа ориентирована на учебный сценарий:

- преподаватель создаёт курс и задание;
- система извлекает требования из файла задания;
- преподаватель проверяет и при необходимости правит требования;
- студент открывает задание, работает с картой, загружает архив или сдаёт черновик слоя;
- backend разбирает отчёт и GIS-файлы, выполняет формальные проверки;
- AI-review формирует понятную обратную связь для преподавателя и студента;
- AI-assisted digitizing помогает студенту быстрее оцифровывать объекты на карте.

## Основные Возможности

- Авторизация и роли: `admin`, `teacher`, `student`.
- Курсы и группы студентов.
- Создание заданий преподавателем.
- Загрузка DOC/DOCX файла задания.
- Автоизвлечение требований из текста задания.
- Редактор требований для преподавателя.
- Загрузка студенческих архивов с отчётом и GIS-файлами.
- Разбор ZIP-архивов, GeoJSON и Shapefile-комплектов.
- Формальная проверка слоёв: формат, геометрия, CRS, атрибуты, ошибки геометрии.
- AI-review по отчёту и результатам проверки.
- Карта на OpenLayers.
- Просмотр слоёв, группировка, порядок, видимость, подписи, стили и классификация.
- Атрибутивная таблица слоя.
- Черновики слоёв для работы студента в браузере.
- Экспорт карты в PNG.
- AI-оцифровка через отдельный `ai-digitizer-service`.

## Стек

Backend:

- FastAPI
- SQLAlchemy
- PostgreSQL + PostGIS
- Redis
- Taskiq
- MinIO как S3-compatible storage

Frontend:

- React
- TypeScript
- Vite
- OpenLayers

GIS / обработка данных:

- GeoPandas
- Shapely
- Rasterio
- GDAL/Fiona/pyogrio, если доступны в окружении

AI:

- LLM relay для извлечения требований и AI-review;
- эвристический extractor как fallback;
- отдельный сервис AI-оцифровки;
- GeoSAM/SAM2 как основной backend для интерактивной сегментации;
- OpenCV fallback для тестов без тяжёлой модели.

Инфраструктура:

- Docker
- docker-compose
- PostgreSQL/PostGIS
- Redis
- MinIO
- отдельные контейнеры для backend, worker, frontend и AI digitizer.

## Структура Проекта

```text
.
├── backend/
│   └── app/
│       ├── api/routes/              # FastAPI routes
│       ├── api/deps/                # зависимости авторизации и доступа
│       ├── core/                    # конфигурация
│       ├── models/                  # SQLAlchemy модели
│       ├── schemas/                 # Pydantic схемы
│       ├── services/                # парсинг, проверки, LLM, GIS preview
│       └── tasks/                   # Taskiq worker
├── frontend/
│   └── src/                         # React/Vite приложение
├── ai-digitizer-service/
│   ├── app/main.py                  # сервис AI-оцифровки
│   ├── Dockerfile                   # лёгкий образ
│   └── Dockerfile.sam2              # образ с GeoSAM/SAM2
├── tools/                           # вспомогательные инструменты, relay
├── docker-compose.yml
└── .env.example
```

## Быстрый Запуск

1. Скопировать `.env.example` в `.env`.

```powershell
Copy-Item .env.example .env
```

2. Запустить сервисы.

```powershell
docker compose up --build
```

3. Открыть приложение.

```text
Frontend: http://localhost:5173
Backend:  http://localhost:8000
API docs: http://localhost:8000/docs
MinIO:    http://localhost:9001
```

Если порт `5173` занят, можно поменять `FRONTEND_PORT` в `.env`.

## Переменные Окружения

Основные значения находятся в `.env.example`.

Важные переменные:

```env
BACKEND_PORT=8000
FRONTEND_PORT=5173
AI_DIGITIZER_PORT=8790

DB_HOST=postgres
DB_PORT=5432
DB_NAME=gis_platform
DB_USER=postgres
DB_PASSWORD=postgres

S3_ENDPOINT=minio:9000
S3_BUCKET_NAME=submissions

JWT_ACCESS_SECRET=change_me_access
JWT_REFRESH_SECRET=change_me_access

VITE_API_URL=http://localhost:8000
AI_DIGITIZER_URL=http://ai-digitizer:8790
```

Для реального сервера секреты JWT и пароли нужно заменить.

## Роли И Доступ

`admin`:

- управляет пользователями;
- может выполнять административные действия.

`teacher`:

- создаёт курсы;
- добавляет студентов в курс;
- создаёт задания;
- загружает файл задания;
- запускает автоизвлечение требований;
- редактирует requirements;
- просматривает сдачи, checks и AI-review.

`student`:

- видит свои курсы и задания;
- открывает карту задания;
- создаёт и редактирует черновые слои;
- загружает архив с отчётом и GIS-файлами;
- сдаёт черновик как работу;
- смотрит feedback по своей сдаче.

Студент не должен удалять преподавателя, задания или участников курса. Управление курсом остаётся за преподавателем и администратором.

## Backend Pipeline Проверки

Основной поток:

1. Преподаватель создаёт assignment.
2. Загружает файл задания.
3. Backend извлекает requirements.
4. Преподаватель проверяет и правит requirements.
5. Студент загружает ZIP/DOCX/GeoJSON/Shapefile или сдаёт черновик.
6. `submission_archive_parser` разбирает архив.
7. GIS assets сохраняются в MinIO.
8. Validator проверяет формат, геометрию, CRS, атрибуты и соответствие требованиям.
9. AI-review получает компактный payload и формирует текстовый обзор.

Важные сервисы:

```text
backend/app/services/submission_archive_parser.py
backend/app/services/expected_output_evaluator.py
backend/app/services/multi_layer_requirement_matcher.py
backend/app/services/assignment_llm_extractor.py
backend/app/services/ai_review_service.py
backend/app/services/geojson_preview.py
backend/app/services/qgis_project_parser.py
```

## Формат Сдачи

На практике работа обычно сдаётся архивом:

```text
submission.zip
  report.docx
  layer_1.shp
  layer_1.dbf
  layer_1.shx
  layer_1.prj
  layer_2.geojson
```

Shapefile-комплект группируется как один `layer asset`.

Служебные файлы вроде `.lock`, `.sr.lock`, `.shp.xml` не должны становиться отдельными ошибочными assets.

## Requirements Extraction

Система пытается извлечь из задания:

- формат сдачи;
- нужен ли отчёт;
- ожидаемые GIS outputs, если они явно указаны;
- CRS;
- типы геометрии;
- обязательные поля;
- темы, которые стоит проверить в отчёте;
- контрольные вопросы;
- упомянутые исходные слои.

Важный принцип:

> Исходные учебные слои не должны автоматически превращаться в expected outputs. Если в задании перечислены файлы для работы, но нет явного требования “создать/сдать/экспортировать результат”, expected outputs остаются пустыми или требуют проверки преподавателем.

## Карта И GIS Workspace

Карта построена на OpenLayers.

Сейчас поддерживается:

- загрузка слоёв задания;
- локальная загрузка слоёв;
- GeoJSON preview;
- Shapefile ZIP preview;
- группы слоёв;
- изменение порядка;
- скрытие и удаление слоёв в черновике;
- свойства слоя;
- подписи;
- стили;
- классификация;
- атрибутивная таблица;
- рисование точек, линий и полигонов;
- редактирование геометрии;
- undo/redo;
- координаты курсора;
- выбор СК карты;
- экспорт PNG.

Поддержка QGIS-проектов частичная: платформа может использовать информацию из `.qgs/.qgz` для порядка, стилей и классификации, но не является полноценной заменой QGIS.

## AI-Оцифровка

AI-оцифровка вынесена в отдельный сервис:

```text
ai-digitizer-service/
```

Причина:

- тяжёлые зависимости;
- PyTorch;
- модели и checkpoints;
- возможность вынести на GPU-машину;
- основной backend остаётся легче.

Режимы:

```env
AI_DIGITIZER_BACKEND=classical-cv
AI_DIGITIZER_BACKEND=geosam
AI_DIGITIZER_BACKEND=sam2
```

Для дипломного проекта основной AI-путь — GeoSAM/SAM2: студент задаёт подсказку на карте, сервис строит маску и возвращает контур в GeoJSON. Лёгкий `classical-cv` остаётся fallback-режимом, если checkpoint или GPU-модель недоступны.

Подробнее см. [ai-digitizer-service/README.md](ai-digitizer-service/README.md).

## AI-Review

AI-review анализирует:

- текст отчёта;
- результаты формальной проверки;
- requirements;
- найденные ошибки и предупреждения.

Важно: в LLM отправляется компактный payload, а не полный архив, не весь DOCX и не огромные логи. Это снижает шанс ошибок relay и делает ответ стабильнее.

Если LLM недоступна, backend возвращает fallback review, чтобы пользователь всё равно видел результат проверки.

## Локальная Разработка

Полный запуск:

```powershell
docker compose up --build
```

Остановка:

```powershell
docker compose down
```

Пересборка только frontend:

```powershell
docker compose build frontend
docker compose up frontend
```

Пересборка только backend:

```powershell
docker compose build backend worker
docker compose up backend worker
```

Проверка health:

```powershell
curl http://localhost:8000/health
curl http://localhost:8790/health
```

## Тестовый Сценарий Для Демонстрации

Минимальный сценарий для защиты или пилотного теста:

1. Admin/teacher входит в систему.
2. Преподаватель создаёт курс.
3. Добавляет студента.
4. Создаёт задание.
5. Загружает файл задания DOCX.
6. Запускает автоизвлечение requirements.
7. Проверяет и правит requirements.
8. Загружает материалы карты, если они нужны.
9. Студент открывает курс и задание.
10. Студент открывает карту.
11. Создаёт или редактирует слой.
12. Использует AI-оцифровку для помощи с контуром.
13. Сдаёт черновик или ZIP-архив.
14. Backend выполняет проверку.
15. Преподаватель смотрит assets, checks, карту и AI-review.

## Ограничения Текущей Версии

- Автоизвлечение требований требует проверки преподавателем.
- AI-review может ошибаться и не заменяет ручную оценку.
- Поддержка QGIS-проектов частичная.
- AI-оцифровка с GeoSAM/SAM2 требует отдельной установки модели и checkpoint.
- Для больших слоёв карту нужно оптимизировать: тайлинг, генерализация, лимиты preview.
- Для реального сервера нужно настроить домен, HTTPS, production-секреты, резервное копирование и ограничения ресурсов.

## Что Дальше

Ближайшие практические задачи:

1. Подключить GeoSAM/SAM2 checkpoint и проверить AI-оцифровку на реальных лабораторных слоях.
2. Улучшить сохранение черновика карты как полноценной сдачи.
3. Доработать поддержку QGIS `.qgz/.qgs`.
4. Оптимизировать preview больших слоёв.
5. Подготовить 2-3 стабильных демонстрационных задания для тестовой группы.
