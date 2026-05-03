
def _normalize_format(value: str | None) -> str | None:
    if value is None:
        return None

    value = value.strip().lower()

    mapping = {
        "shp": "shapefile_zip",
        ".shp": "shapefile_zip",
        "shape": "shapefile_zip",
        "shapefile": "shapefile_zip",
        "shapefile_zip": "shapefile_zip",
        "zip": "shapefile_zip",
        ".zip": "shapefile_zip",
        "geojson": "geojson",
        ".geojson": "geojson",
        "docx": "docx",
        ".docx": "docx",
        "doc": "doc",
        ".doc": "doc",
        "txt": "txt",
        ".txt": "txt",
    }

    return mapping.get(value, value)

def _normalize_layer_name(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip().lower()

    # убираем расширения, если вдруг они попали в имя
    for ext in [".shp", ".dbf", ".shx", ".prj", ".geojson", ".zip"]:
        if value.endswith(ext):
            value = value[: -len(ext)]

    return value


def match_assets_to_expected_outputs(
    assets,
    expected_outputs: list[dict] | None,
):
    """
    Сопоставляет layer-assets со списком ожидаемых outputs задания.
    Сравнение идёт по нормализованному basename и формату.
    """
    layer_assets = [
        asset for asset in assets
        if asset.asset_type == "layer" and asset.status != "failed"
    ]

    if not expected_outputs:
        return {
            "matches": [],
            "unmatched_expected_outputs": [],
            "unmatched_assets": layer_assets,
        }

    remaining_assets = list(layer_assets)
    matches = []

    for expected in expected_outputs:
        best_asset = None
        best_score = -1

        expected_name = _normalize_layer_name(expected.get("name"))
        expected_format = expected.get("deliverable_format")

        for asset in remaining_assets:
            score = 0

            asset_name = _normalize_layer_name(asset.asset_name)
            asset_detected_format = asset.detected_format

            # 1. точный матч имени
            if expected_name and asset_name == expected_name:
                score += 100

            # 2. частичный матч имени
            elif expected_name and (expected_name in asset_name or asset_name in expected_name):
                score += 40

            # 3. матч по формату
            if expected_format and _normalize_format(asset_detected_format) == _normalize_format(expected_format):
                score += 20

            if score > best_score:
                best_score = score
                best_asset = asset

        min_score = 40 if expected_name else 20

        if best_asset is not None and best_score >= min_score:
            matches.append({
                "expected_output": expected,
                "asset_id": best_asset.id,
                "asset_name": best_asset.asset_name,
                "score": best_score,
            })
            remaining_assets.remove(best_asset)
        else:
            matches.append({
                "expected_output": expected,
                "asset_id": None,
                "asset_name": None,
                "score": 0,
            })

    unmatched_expected_outputs = [
        item["expected_output"] for item in matches if item["asset_id"] is None
    ]

    return {
        "matches": matches,
        "unmatched_expected_outputs": unmatched_expected_outputs,
        "unmatched_assets": remaining_assets,
    }
