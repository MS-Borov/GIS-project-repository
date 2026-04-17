def choose_target_gis_asset(assets, requirements=None):
    """
    Выбирает основной GIS-asset, который будет сравниваться с требованиями задания.

    Логика пока простая и объяснимая:
    1. берём только assets типа "layer"
    2. если layer один -> берём его
    3. если есть deliverable_format -> пытаемся выбрать по формату
    4. если после этого всё ещё несколько или ни одного -> возвращаем None

    Это пока rule-based selector.
    Позже можно будет сделать более умный выбор.
    """
    layer_assets = [asset for asset in assets if asset.asset_type == "layer"]

    if not layer_assets:
        return None

    if len(layer_assets) == 1:
        return layer_assets[0]

    if requirements and requirements.deliverable_format:
        matched = [
            asset for asset in layer_assets
            if asset.detected_format == requirements.deliverable_format
        ]
        if len(matched) == 1:
            return matched[0]

    return None