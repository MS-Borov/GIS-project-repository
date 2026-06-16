import io
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


def _strip_namespace(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _iter_named(element: ET.Element, name: str):
    for child in element.iter():
        if _strip_namespace(child.tag) == name:
            yield child


def _first_named(element: ET.Element, name: str) -> ET.Element | None:
    return next(_iter_named(element, name), None)


def _children_named(element: ET.Element, name: str):
    for child in list(element):
        if _strip_namespace(child.tag) == name:
            yield child


def _float_or_none(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _rgba_to_hex(value: str | None, fallback: str = "#176f6b") -> tuple[str, float]:
    if not value:
        return fallback, 1.0
    parts = [part.strip() for part in value.split(",")]
    if len(parts) < 3:
        return fallback, 1.0
    try:
        red, green, blue = (max(0, min(255, int(float(parts[index])))) for index in range(3))
        alpha = max(0.0, min(1.0, float(parts[3]) / 255.0)) if len(parts) >= 4 else 1.0
    except (TypeError, ValueError):
        return fallback, 1.0
    return f"#{red:02x}{green:02x}{blue:02x}", alpha


def _option_map(element: ET.Element | None) -> dict[str, str]:
    if element is None:
        return {}
    options: dict[str, str] = {}
    for option in _iter_named(element, "Option"):
        name = option.attrib.get("name")
        value = option.attrib.get("value")
        if name and value is not None:
            options[name] = value
    for prop in _iter_named(element, "prop"):
        key = prop.attrib.get("k")
        value = prop.attrib.get("v")
        if key and value is not None:
            options[key] = value
    return options


def _line_style(value: str | None) -> str | None:
    normalized = (value or "").strip().lower()
    if normalized in {"dash", "dash line", "dashline"}:
        return "dash"
    if normalized in {"dot", "dot line", "dotline"}:
        return "dot"
    return None


def _symbol_style(symbol: ET.Element | None) -> dict:
    if symbol is None:
        return {}
    symbol_type = (symbol.attrib.get("type") or "").lower()
    options = _option_map(symbol)
    color, alpha = _rgba_to_hex(
        options.get("line_color")
        or options.get("outline_color")
        or options.get("color")
        or options.get("fill_color")
    )
    fill_color, fill_alpha = _rgba_to_hex(options.get("color") or options.get("fill_color"), color)
    stroke_width = (
        _float_or_none(options.get("line_width"))
        or _float_or_none(options.get("outline_width"))
        or _float_or_none(options.get("width"))
        or 1.0
    )
    point_radius = (
        _float_or_none(options.get("size"))
        or _float_or_none(options.get("diameter"))
        or 5.0
    )
    style = {
        "strokeColor": color,
        "fillColor": fill_color if symbol_type != "line" else color,
        "fillOpacity": fill_alpha if symbol_type in {"fill", "marker"} else 0.15,
        "strokeWidth": max(1.0, min(12.0, stroke_width * 2.0)),
        "pointRadius": max(2.0, min(24.0, point_radius)),
    }
    qgis_line_style = _line_style(options.get("line_style") or options.get("outline_style"))
    if qgis_line_style:
        style["lineStyle"] = qgis_line_style
    if alpha < 1.0 and symbol_type == "line":
        style["fillOpacity"] = alpha
    return style


def _symbols_by_name(renderer: ET.Element) -> dict[str, ET.Element]:
    symbols: dict[str, ET.Element] = {}
    for symbol in _iter_named(renderer, "symbol"):
        name = symbol.attrib.get("name")
        if name is not None:
            symbols[name] = symbol
    return symbols


def _single_renderer_style(renderer: ET.Element) -> dict:
    symbols = _symbols_by_name(renderer)
    symbol = symbols.get("0") or next(iter(symbols.values()), None)
    return _symbol_style(symbol)


def _categorized_renderer_style(renderer: ET.Element) -> dict:
    attr = renderer.attrib.get("attr") or renderer.attrib.get("classattribute") or ""
    symbols = _symbols_by_name(renderer)
    classes = []
    base_style: dict = {}
    for index, category in enumerate(_iter_named(renderer, "category")):
        symbol_name = category.attrib.get("symbol") or str(index)
        symbol_style = _symbol_style(symbols.get(symbol_name))
        if not base_style and symbol_style:
            base_style = {key: value for key, value in symbol_style.items() if key != "lineStyle"}
        classes.append(
            {
                "value": category.attrib.get("value", ""),
                "label": category.attrib.get("label") or category.attrib.get("value") or "(empty)",
                "color": symbol_style.get("strokeColor") or symbol_style.get("fillColor") or "#176f6b",
                "strokeWidth": symbol_style.get("strokeWidth"),
                "lineStyle": symbol_style.get("lineStyle"),
                "fillOpacity": symbol_style.get("fillOpacity"),
            }
        )
    style = base_style or {"strokeColor": "#176f6b", "fillColor": "#176f6b", "fillOpacity": 0.2, "strokeWidth": 2, "pointRadius": 5}
    if attr and classes:
        style["classification"] = {
            "mode": "unique_value",
            "field": attr,
            "classCount": len(classes),
            "scheme": "qgis",
            "method": "equal_interval",
            "classes": classes,
        }
    return style


def _layer_style(layer: ET.Element) -> dict | None:
    renderer = _first_named(layer, "renderer-v2")
    if renderer is None:
        return None
    renderer_type = (renderer.attrib.get("type") or "").lower()
    if renderer_type == "categorizedsymbol":
        return _categorized_renderer_style(renderer)
    if renderer_type in {"singlesymbol", "single"}:
        return _single_renderer_style(renderer)
    return None


def _layer_source_basename(source: str | None) -> str | None:
    if not source:
        return None
    clean_source = source.split("|", 1)[0].replace("\\", "/")
    return Path(clean_source).stem.lower()


def _project_crs(root: ET.Element) -> str | None:
    project_crs = _first_named(root, "projectCrs")
    if project_crs is None:
        return None
    authid = _first_named(project_crs, "authid")
    value = (authid.text or "").strip() if authid is not None else ""
    return value or None


def _read_qgs_from_qgz(data: bytes) -> tuple[str, bytes] | None:
    with zipfile.ZipFile(io.BytesIO(data)) as qgz:
        qgs_names = [name for name in qgz.namelist() if name.lower().endswith(".qgs")]
        if not qgs_names:
            return None
        qgs_name = sorted(qgs_names, key=len)[0]
        return qgs_name, qgz.read(qgs_name)


def _find_project_xml(file_bytes: bytes) -> tuple[str, bytes] | None:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            names = archive.namelist()
            qgz_names = [name for name in names if name.lower().endswith(".qgz")]
            qgs_names = [name for name in names if name.lower().endswith(".qgs")]
            if qgz_names:
                qgz_name = sorted(qgz_names, key=len)[0]
                qgs = _read_qgs_from_qgz(archive.read(qgz_name))
                if qgs:
                    return qgz_name, qgs[1]
            if qgs_names:
                qgs_name = sorted(qgs_names, key=len)[0]
                return qgs_name, archive.read(qgs_name)
    except zipfile.BadZipFile:
        if file_bytes.lstrip().startswith(b"<"):
            return "project.qgs", file_bytes
    return None


def _project_extent(root: ET.Element, crs: str | None) -> dict | None:
    extent = _first_named(root, "extent")
    if extent is None:
        return None
    values = {
        child_name: _float_or_none(_first_named(extent, child_name).text if _first_named(extent, child_name) is not None else None)
        for child_name in ("xmin", "ymin", "xmax", "ymax")
    }
    if any(value is None for value in values.values()):
        return None
    return {**values, "crs": crs or "EPSG:4326"}


def _layer_tree_layers(root: ET.Element):
    root_group = _first_named(root, "layer-tree-group")
    if root_group is None:
        yield from _iter_named(root, "layer-tree-layer")
        return

    def walk(group: ET.Element, group_path: list[str]):
        for child in list(group):
            tag = _strip_namespace(child.tag)
            if tag == "layer-tree-group":
                group_name = (child.attrib.get("name") or "").strip()
                next_path = [*group_path, group_name] if group_name else group_path
                yield from walk(child, next_path)
            elif tag == "layer-tree-layer":
                yield child, group_path

    yield from walk(root_group, [])


def extract_qgis_project_metadata_from_archive(file_bytes: bytes) -> dict | None:
    project = _find_project_xml(file_bytes)
    if not project:
        return None
    source_name, qgs_bytes = project
    try:
        root = ET.fromstring(qgs_bytes)
    except ET.ParseError:
        return None

    map_layers_by_id: dict[str, ET.Element] = {}
    for map_layer in _iter_named(root, "maplayer"):
        layer_id = (_first_named(map_layer, "id").text or "").strip() if _first_named(map_layer, "id") is not None else ""
        if layer_id:
            map_layers_by_id[layer_id] = map_layer

    project_crs = _project_crs(root)

    tree_layers = []
    for order, tree_item in enumerate(_layer_tree_layers(root)):
        if isinstance(tree_item, tuple):
            tree_layer, group_path = tree_item
        else:
            tree_layer, group_path = tree_item, []
        layer_id = tree_layer.attrib.get("id")
        map_layer = map_layers_by_id.get(layer_id or "")
        source = None
        if map_layer is not None:
            source_el = _first_named(map_layer, "datasource")
            source = source_el.text if source_el is not None else None
        tree_layers.append(
            {
                "id": layer_id,
                "name": tree_layer.attrib.get("name") or (tree_layer.attrib.get("source") or ""),
                "source": source or tree_layer.attrib.get("source") or "",
                "source_basename": _layer_source_basename(source or tree_layer.attrib.get("source")),
                "visible": tree_layer.attrib.get("checked", "Qt::Checked") != "Qt::Unchecked",
                "order": order,
                "group_name": group_path[-1] if group_path else None,
                "group_path": group_path,
                "style": _layer_style(map_layer) if map_layer is not None else None,
            }
        )

    if not tree_layers:
        for order, map_layer in enumerate(map_layers_by_id.values()):
            name_el = _first_named(map_layer, "layername")
            source_el = _first_named(map_layer, "datasource")
            source = source_el.text if source_el is not None else ""
            tree_layers.append(
                {
                    "id": (_first_named(map_layer, "id").text or "").strip() if _first_named(map_layer, "id") is not None else "",
                    "name": name_el.text if name_el is not None else _layer_source_basename(source) or f"layer-{order + 1}",
                    "source": source,
                    "source_basename": _layer_source_basename(source),
                    "visible": True,
                    "order": order,
                    "group_name": None,
                    "group_path": [],
                    "style": _layer_style(map_layer),
                }
            )

    return {
        "project_name": Path(source_name).stem,
        "source": source_name,
        "hide_basemap": True,
        "background": "white",
        "crs": project_crs,
        "extent": _project_extent(root, project_crs),
        "layers": tree_layers,
    }
