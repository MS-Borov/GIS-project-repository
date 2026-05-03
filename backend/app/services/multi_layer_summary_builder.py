def build_multi_layer_summary(match_result: dict, output_evaluations: list[dict]) -> dict:
    """
    Собирает общую сводку по многослойной проверке задания.
    """
    unmatched_expected_outputs = match_result.get("unmatched_expected_outputs", [])
    unmatched_assets = match_result.get("unmatched_assets", [])

    failed_count = sum(1 for item in output_evaluations if item["status"] == "failed")
    warning_count = sum(1 for item in output_evaluations if item["status"] == "warning")
    passed_count = sum(1 for item in output_evaluations if item["status"] == "passed")

    problems = []
    warnings = []
    info = []

    for expected in unmatched_expected_outputs:
        problems.append({
            "code": "expected_output_missing",
            "message": f"Не найден слой для ожидаемого output '{expected.get('name')}'.",
            "expected_output": expected,
        })

    for asset in unmatched_assets:
        info.append({
            "code": "unmatched_asset",
            "message": f"Найден слой '{asset.asset_name}', который не был сопоставлен ни с одним ожидаемым output.",
            "asset_id": asset.id,
            "asset_name": asset.asset_name,
        })

    if problems or failed_count > 0:
        status = "failed"
    elif warnings or warning_count > 0:
        status = "warning"
    else:
        status = "passed"

    message_parts = [
        f"Сопоставлено outputs: {len(output_evaluations)}.",
        f"Passed: {passed_count}, warning: {warning_count}, failed: {failed_count}.",
    ]

    if unmatched_expected_outputs:
        message_parts.append(f"Не найдены ожидаемые outputs: {len(unmatched_expected_outputs)}.")
    if unmatched_assets:
        message_parts.append(f"Есть несопоставленные assets: {len(unmatched_assets)}.")

    return {
        "status": status,
        "message": " ".join(message_parts),
        "result_json": {
            "mode": "multi_layer_summary",
            "match_result": {
                "matches": match_result.get("matches", []),
                "unmatched_expected_outputs": unmatched_expected_outputs,
                "unmatched_assets": [
                    {
                        "id": asset.id,
                        "asset_name": asset.asset_name,
                        "detected_format": asset.detected_format,
                    }
                    for asset in unmatched_assets
                ],
            },
            "output_evaluations": output_evaluations,
            "problems": problems,
            "warnings": warnings,
            "info": info,
            "counts": {
                "passed": passed_count,
                "warning": warning_count,
                "failed": failed_count,
            },
        },
    }
