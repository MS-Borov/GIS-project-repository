import re
from pathlib import Path


def choose_target_gis_asset(
    assets,
    requirements=None,
    report_text: str | None = None,
):
    """
    Выбирает основной GIS asset для проверки.

    Логика выбора:
    1. берём только layer-assets со статусом != failed
    2. если слой один -> берём его
    3. если есть deliverable_format -> фильтруем по формату
    4. если есть report_text -> пытаемся найти упоминание имени слоя в отчёте
    5. если после этого всё ещё неоднозначно -> None

    Почему это нужно:
    - в лабораторных архивах часто лежит несколько слоёв;
    - без выбора target layer AI review и requirements-check становятся неточными.
    """
    layer_assets = [
        asset for asset in assets
        if asset.asset_type == "layer" and asset.status != "failed"
    ]

    if not layer_assets:
        return None

    if len(layer_assets) == 1:
        return layer_assets[0]

    # 1. Пытаемся отфильтровать по формату сдачи
    if requirements and requirements.deliverable_format:
        by_format = [
            asset for asset in layer_assets
            if asset.detected_format == requirements.deliverable_format
        ]
        if len(by_format) == 1:
            return by_format[0]
        if by_format:
            layer_assets = by_format

    # 2. Пытаемся выбрать по упоминанию имени слоя в отчёте
    if report_text:
        scored = []
        lowered_report = report_text.lower()

        for asset in layer_assets:
            stem = Path(asset.asset_name).stem.lower()

            score = 0

            # Точное упоминание имени слоя
            if re.search(rf"(?<![a-zA-Z0-9_]){re.escape(stem)}(?![a-zA-Z0-9_])", lowered_report):
                score += 100

            # Упрощённая эвристика: если у слоя имя вида dnar_prj,
            # пробуем матчить и по первой части dnar
            if "_" in stem:
                base_stem = stem.split("_")[0]
                if re.search(rf"(?<![a-zA-Z0-9_]){re.escape(base_stem)}(?![a-zA-Z0-9_])", lowered_report):
                    score += 30

            # Небольшой бонус за короткое и "похожее на код слоя" имя
            if len(stem) <= 12:
                score += 1

            scored.append((score, asset))

        scored.sort(key=lambda x: x[0], reverse=True)

        # Берём только если лидер один и score > 0
        if scored and scored[0][0] > 0:
            top_score = scored[0][0]
            top_assets = [asset for score, asset in scored if score == top_score]
            if len(top_assets) == 1:
                return top_assets[0]

    return None