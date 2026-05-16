import type { CSSProperties } from "react";
import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";

export type ClassificationMethod = "equal_interval" | "quantile" | "natural_breaks";

export type LayerLegendMode = "graduated_color" | "unique_value" | "graduated_symbol";

export type GeoJsonGeometry = {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
};

export type GeoJsonFeature = {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, unknown> | null;
};

export type GeoJsonPreview = {
  asset_id: number;
  asset_name: string;
  detected_format: string;
  source_crs?: string | null;
  crs: string;
  feature_count: number;
  original_feature_count?: number;
  bbox_filter?: number[] | null;
  preview_feature_count: number;
  truncated: boolean;
  geojson: {
    type: "FeatureCollection";
    features: GeoJsonFeature[];
  };
};

export type SubmissionAsset = {
  id: number;
  submission_id: number;
  asset_name: string;
  asset_type: string;
  detected_format: string;
  status: string;
  message: string;
};

export type LayerPreviewState = {
  asset: SubmissionAsset;
  preview: GeoJsonPreview;
  visible: boolean;
  labelsVisible: boolean;
  labelField: string | null;
};

export type LayerClassificationClass = {
  min?: number;
  max?: number;
  value?: string;
  label: string;
  color: string;
  size?: number;
  strokeWidth?: number;
  lineStyle?: string | null;
  fillOpacity?: number;
  symbolType?: string | null;
  symbolLayers?: SymbolLayerSettings[];
};

export type SymbolLayerSettings = {
  id: string;
  type: "simple_line" | "marker_line" | "simple_marker" | "fill";
  color: string;
  strokeWidth: number;
  lineStyle?: string | null;
  offset?: number;
  fillOpacity?: number;
};

export type LayerClassificationSettings = {
  mode?: LayerLegendMode;
  field: string;
  classCount: number;
  scheme: string;
  method: ClassificationMethod;
  classes: LayerClassificationClass[];
};

export type LayerStyleSettings = {
  strokeColor: string;
  fillColor: string;
  fillOpacity: number;
  strokeWidth: number;
  pointRadius: number;
  lineStyle?: string | null;
  symbolType?: string | null;
  symbolLayers?: SymbolLayerSettings[];
  classification?: LayerClassificationSettings | null;
};

export type RenderCoordinate = number[] | RenderCoordinate[];

export const LAYER_COLORS = ["#176f6b", "#c77326", "#3867a6", "#7c5aa6", "#6f8f2e", "#b33f62"];
export const CLASSIFICATION_SCHEMES: Record<string, { label: string; colors: string[] }> = {
  yellowRed: { label: "Жёлтый - красный", colors: ["#fff4a3", "#f7cf5d", "#e99a35", "#c85a2a", "#7f1d1d"] },
  blue: { label: "Голубой - синий", colors: ["#d9f0ff", "#9ed0f0", "#5aa2d1", "#276ca8", "#173b73"] },
  green: { label: "Светло-зелёный - тёмный", colors: ["#e4f7c6", "#b9df8a", "#78b957", "#358642", "#14532d"] },
  purple: { label: "Светлый - фиолетовый", colors: ["#efe6ff", "#cdb8f2", "#9b7ad0", "#6c4aa2", "#3f236b"] },
};
export const CLASSIFICATION_METHODS: Record<ClassificationMethod, string> = {
  equal_interval: "Равные интервалы",
  quantile: "Квантиль",
  natural_breaks: "Естественные интервалы",
};
export const LAYER_LEGEND_MODES: Record<LayerLegendMode, string> = {
  graduated_color: "Градуированный цвет",
  unique_value: "Уникальные значения",
  graduated_symbol: "Градуированный символ",
};
export const SYMBOL_PRESETS = [
  { type: "line", label: "Простая линия", lineStyle: null },
  { type: "dash-line", label: "Пунктир", lineStyle: "dash" },
  { type: "dot-line", label: "Точечная линия", lineStyle: "dot" },
  { type: "rail", label: "Ж/д", lineStyle: null },
  { type: "rail-single", label: "Ж/д одноколейка", lineStyle: null },
  { type: "cased-road", label: "Дорога с покрытием", lineStyle: null },
  { type: "dirt-road", label: "Грунтовая дорога", lineStyle: null },
  { type: "local-road", label: "Проселочная", lineStyle: null },
  { type: "track-road", label: "Полевая / лесная", lineStyle: "dash" },
  { type: "clearing-line", label: "Просека", lineStyle: "dot" },
  { type: "river-line", label: "Река", lineStyle: null },
  { type: "canal-line", label: "Канал", lineStyle: null },
  { type: "dry-water", label: "Пересыхающее русло", lineStyle: "dot" },
  { type: "point", label: "Точка", lineStyle: null },
  { type: "polygon", label: "Полигон", lineStyle: null },
] as const;

export function defaultLayerStyle(index: number): LayerStyleSettings {
  const color = LAYER_COLORS[Math.max(0, index) % LAYER_COLORS.length] ?? "#176f6b";
  return {
    strokeColor: color,
    fillColor: color,
    fillOpacity: 0.2,
    strokeWidth: 2,
    pointRadius: 5,
    lineStyle: null,
  };
}

export function normalizeLayerStyle(style: Partial<LayerStyleSettings> | undefined, index: number): LayerStyleSettings {
  const fallback = defaultLayerStyle(index);
  return {
    strokeColor: style?.strokeColor || fallback.strokeColor,
    fillColor: style?.fillColor || fallback.fillColor,
    fillOpacity: Math.min(1, Math.max(0, Number(style?.fillOpacity ?? fallback.fillOpacity))),
    strokeWidth: Math.min(12, Math.max(1, Number(style?.strokeWidth ?? fallback.strokeWidth))),
    pointRadius: Math.min(24, Math.max(2, Number(style?.pointRadius ?? fallback.pointRadius))),
    lineStyle: style?.lineStyle ?? fallback.lineStyle ?? null,
    symbolType: style?.symbolType ?? fallback.symbolType ?? null,
    symbolLayers: style?.symbolLayers ?? fallback.symbolLayers,
    classification: style?.classification ?? null,
  };
}

export function lineDashForStyle(lineStyle?: string | null) {
  const normalized = (lineStyle ?? "").toLowerCase();
  if (normalized === "dash") {
    return [8, 5];
  }
  if (normalized === "dot") {
    return [1, 5];
  }
  return undefined;
}

export function createSymbolLayerId() {
  return `symbol-layer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function defaultSymbolLayer(
  type: SymbolLayerSettings["type"],
  color = "#1f2933",
  strokeWidth = 2,
): SymbolLayerSettings {
  return {
    id: createSymbolLayerId(),
    type,
    color,
    strokeWidth,
    lineStyle: type === "marker_line" ? "dash" : null,
    offset: 0,
    fillOpacity: type === "fill" ? 0.25 : 1,
  };
}

export function symbolLayersForPreset(
  symbolType: string | null | undefined,
  color: string,
  strokeWidth: number,
  lineStyle?: string | null,
  fillOpacity?: number,
): SymbolLayerSettings[] {
  const normalized = symbolType ?? "line";
  if (normalized === "cased-road") {
    return [
      { ...defaultSymbolLayer("simple_line", "#2b1d13", strokeWidth + 3), id: createSymbolLayerId() },
      { ...defaultSymbolLayer("simple_line", color, Math.max(1, strokeWidth)), id: createSymbolLayerId() },
    ];
  }
  if (normalized === "rail" || normalized === "rail-single") {
    return [
      { ...defaultSymbolLayer("simple_line", "#1b1b1b", strokeWidth + 2), id: createSymbolLayerId() },
      {
        ...defaultSymbolLayer("marker_line", "#f8fafc", Math.max(1, strokeWidth)),
        id: createSymbolLayerId(),
        lineStyle: normalized === "rail-single" ? "dash" : "dot",
      },
    ];
  }
  if (normalized === "river-line" || normalized === "canal-line" || normalized === "dry-water") {
    return [
      {
        ...defaultSymbolLayer("simple_line", color, Math.max(1, strokeWidth)),
        id: createSymbolLayerId(),
        lineStyle: normalized === "dry-water" ? "dot" : normalized === "canal-line" ? "dash" : lineStyle ?? null,
      },
    ];
  }
  if (normalized === "polygon" || normalized === "mixed") {
    return [
      {
        ...defaultSymbolLayer("fill", color, Math.max(1, strokeWidth)),
        id: createSymbolLayerId(),
        fillOpacity: fillOpacity ?? 0.25,
      },
    ];
  }
  if (normalized === "point") {
    return [{ ...defaultSymbolLayer("simple_marker", color, Math.max(1, strokeWidth)), id: createSymbolLayerId() }];
  }
  return [
    {
      ...defaultSymbolLayer("simple_line", color, Math.max(1, strokeWidth)),
      id: createSymbolLayerId(),
      lineStyle: lineStyle ?? null,
    },
  ];
}

export function colorWithOpacity(color: string, opacity: number) {
  const normalized = color.trim();
  if (/^#[\da-f]{6}$/i.test(normalized)) {
    const red = parseInt(normalized.slice(1, 3), 16);
    const green = parseInt(normalized.slice(3, 5), 16);
    const blue = parseInt(normalized.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, opacity))})`;
  }
  return normalized;
}

export function parseNumericAttribute(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, "").replace(",", ".");
    if (!normalized) {
      return null;
    }
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

export function formatClassBoundary(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

export function colorFromScheme(scheme: string, index: number, count: number) {
  const colors = CLASSIFICATION_SCHEMES[scheme]?.colors ?? CLASSIFICATION_SCHEMES.yellowRed.colors;
  if (count <= 1) {
    return colors[colors.length - 1] ?? "#176f6b";
  }
  const colorIndex = Math.round((index / (count - 1)) * (colors.length - 1));
  return colors[Math.min(colors.length - 1, Math.max(0, colorIndex))] ?? "#176f6b";
}

export function numericFieldsForPreview(preview: GeoJsonPreview) {
  return previewAttributeFields(preview).filter((field) =>
    preview.geojson.features.some((feature) => parseNumericAttribute(feature.properties?.[field]) !== null),
  );
}

export function equalIntervalClasses(values: number[], count: number, scheme: string) {
  const min = values[0];
  const max = values[values.length - 1];
  if (min === max) {
    return [{ min, max, label: formatClassBoundary(min), color: colorFromScheme(scheme, 0, 1) }];
  }
  const step = (max - min) / count;
  return Array.from({ length: count }, (_, index) => {
    const rangeMin = index === 0 ? min : min + step * index;
    const rangeMax = index === count - 1 ? max : min + step * (index + 1);
    return {
      min: rangeMin,
      max: rangeMax,
      label: `${formatClassBoundary(rangeMin)} - ${formatClassBoundary(rangeMax)}`,
      color: colorFromScheme(scheme, index, count),
    };
  });
}

export function quantileClasses(values: number[], count: number, scheme: string) {
  if (values[0] === values[values.length - 1]) {
    return equalIntervalClasses(values, 1, scheme);
  }
  const classes: LayerClassificationClass[] = [];
  for (let index = 0; index < count; index += 1) {
    const startIndex = Math.floor((values.length * index) / count);
    const endIndex = Math.min(values.length - 1, Math.floor((values.length * (index + 1)) / count) - 1);
    const min = values[startIndex];
    const max = values[endIndex];
    if (min === undefined || max === undefined) {
      continue;
    }
    classes.push({
      min,
      max,
      label: `${formatClassBoundary(min)} - ${formatClassBoundary(max)}`,
      color: colorFromScheme(scheme, classes.length, count),
    });
  }
  return classes.length > 0 ? classes : equalIntervalClasses(values, count, scheme);
}

export function naturalBreakClasses(values: number[], count: number, scheme: string) {
  if (values[0] === values[values.length - 1]) {
    return equalIntervalClasses(values, 1, scheme);
  }
  let centers = Array.from({ length: count }, (_, index) => {
    const valueIndex = Math.round((index / Math.max(1, count - 1)) * (values.length - 1));
    return values[valueIndex];
  });
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const clusters = centers.map(() => [] as number[]);
    values.forEach((value) => {
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      centers.forEach((center, centerIndex) => {
        const distance = Math.abs(value - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = centerIndex;
        }
      });
      clusters[nearestIndex].push(value);
    });
    const nextCenters = centers.map((center, index) => {
      const cluster = clusters[index];
      return cluster.length ? cluster.reduce((sum, value) => sum + value, 0) / cluster.length : center;
    });
    if (nextCenters.every((center, index) => Math.abs(center - centers[index]) < 1e-9)) {
      break;
    }
    centers = nextCenters;
  }
  const clusters = centers.map(() => [] as number[]);
  values.forEach((value) => {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    centers.forEach((center, centerIndex) => {
      const distance = Math.abs(value - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = centerIndex;
      }
    });
    clusters[nearestIndex].push(value);
  });
  const ranges = clusters
    .filter((cluster) => cluster.length > 0)
    .map((cluster) => ({ min: Math.min(...cluster), max: Math.max(...cluster) }))
    .sort((left, right) => left.min - right.min);
  return ranges.map((range, index) => ({
    ...range,
    label: `${formatClassBoundary(range.min)} - ${formatClassBoundary(range.max)}`,
    color: colorFromScheme(scheme, index, ranges.length),
  }));
}

export function buildLayerClassification(
  preview: GeoJsonPreview,
  field: string,
  classCount: number,
  scheme: string,
  method: ClassificationMethod,
  mode: LayerLegendMode = "graduated_color",
): LayerClassificationSettings | null {
  if (mode === "unique_value") {
    const values = Array.from(
      new Set(
        preview.geojson.features
          .map((feature) => feature.properties?.[field])
          .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
          .map((value) => String(value)),
      ),
    ).sort((left, right) => left.localeCompare(right));
    if (!field || values.length === 0) {
      return null;
    }
    const visibleValues = values.slice(0, 30);
    return {
      mode,
      field,
      classCount: visibleValues.length,
      scheme,
      method,
      classes: visibleValues.map((value, index) => ({
        value,
        label: value,
        color: colorFromScheme(scheme, index, Math.max(1, visibleValues.length)),
      })),
    };
  }

  const values = preview.geojson.features
    .map((feature) => parseNumericAttribute(feature.properties?.[field]))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (!field || values.length === 0) {
    return null;
  }

  const normalizedClassCount = Math.min(9, Math.max(1, Math.floor(classCount)));
  const classes =
    method === "quantile"
      ? quantileClasses(values, normalizedClassCount, scheme)
      : method === "natural_breaks"
        ? naturalBreakClasses(values, normalizedClassCount, scheme)
        : equalIntervalClasses(values, normalizedClassCount, scheme);
  return {
    mode,
    field,
    classCount: classes.length,
    scheme,
    method,
    classes:
      mode === "graduated_symbol"
        ? classes.map((item, index) => ({
            ...item,
            size: Math.round(5 + (index / Math.max(1, classes.length - 1)) * 13),
          }))
        : classes,
  };
}

export function normalizeClassValue(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/ё/g, "е")
    .toLowerCase();
}

export function featureValueForField(feature: Feature<Geometry>, field: string) {
  const exactValue = feature.get(field);
  if (exactValue !== undefined) {
    return exactValue;
  }
  const normalizedField = field.toLowerCase();
  const entry = Object.entries(feature.getProperties()).find(([key]) => key.toLowerCase() === normalizedField);
  return entry?.[1];
}

export function classifiedStyleForFeature(style: LayerStyleSettings, feature: Feature<Geometry>) {
  const classification = style.classification;
  if (!classification?.classes.length) {
    return style;
  }
  const mode = classification.mode ?? "graduated_color";
  const matchedClass =
    mode === "unique_value"
      ? (() => {
          const value = normalizeClassValue(featureValueForField(feature, classification.field));
          return (
            classification.classes.find((item) =>
              [item.value, item.label].some((candidate) => normalizeClassValue(candidate) === value),
            ) ?? null
          );
        })()
      : (() => {
          const value = parseNumericAttribute(featureValueForField(feature, classification.field));
          if (value === null) {
            return null;
          }
          return (
            classification.classes.find((item, index) => {
              if (item.min === undefined || item.max === undefined) {
                return false;
              }
              return index === classification.classes.length - 1
                ? value >= item.min && value <= item.max
                : value >= item.min && value < item.max;
            }) ?? null
          );
        })();
  if (!matchedClass) {
    return style;
  }
  const geometryKind = geometryKindFromType(feature.getGeometry()?.getType());
  const matchedSymbolType = legendSymbolType(geometryKind, matchedClass);
  if (mode === "graduated_symbol") {
    const size = matchedClass.size ?? style.pointRadius;
    return {
      ...style,
      pointRadius: size,
      strokeWidth: Math.max(1, Math.min(10, size / 2)),
      strokeColor: matchedClass.color,
      fillColor: matchedClass.color,
      fillOpacity: matchedClass.fillOpacity ?? style.fillOpacity,
      lineStyle: matchedClass.lineStyle ?? style.lineStyle ?? null,
      symbolType: matchedSymbolType,
      symbolLayers: matchedClass.symbolLayers,
    };
  }
  return {
    ...style,
    strokeColor: matchedClass.color,
    fillColor: matchedClass.color,
    fillOpacity: matchedClass.fillOpacity ?? style.fillOpacity,
    strokeWidth: matchedClass.strokeWidth ?? style.strokeWidth,
    lineStyle: matchedClass.lineStyle ?? style.lineStyle ?? null,
    symbolType: matchedSymbolType,
    symbolLayers: matchedClass.symbolLayers,
  };
}

export function isPixelCoordinate(value: RenderCoordinate): value is number[] {
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number";
}

export function collectLineCoordinateGroups(coordinates: RenderCoordinate): number[][][] {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return [];
  }
  if (isPixelCoordinate(coordinates)) {
    return [];
  }
  if (coordinates.every((item) => Array.isArray(item) && isPixelCoordinate(item as RenderCoordinate))) {
    return [coordinates as number[][]];
  }
  return (coordinates as RenderCoordinate[]).flatMap((item) => collectLineCoordinateGroups(item));
}

export function drawLinePath(context: CanvasRenderingContext2D, lines: number[][][]) {
  context.beginPath();
  lines.forEach((line) => {
    line.forEach((coordinate, index) => {
      const [x, y] = coordinate;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
  });
  context.stroke();
}

export function drawRailwayTies(context: CanvasRenderingContext2D, lines: number[][][], spacing: number, tieLength: number) {
  lines.forEach((line) => {
    let distanceUntilNextTie = spacing;
    for (let index = 1; index < line.length; index += 1) {
      const previous = line[index - 1];
      const current = line[index];
      const dx = current[0] - previous[0];
      const dy = current[1] - previous[1];
      const segmentLength = Math.hypot(dx, dy);
      if (segmentLength < 1) {
        continue;
      }
      const normalX = -dy / segmentLength;
      const normalY = dx / segmentLength;
      let travelled = distanceUntilNextTie;
      while (travelled <= segmentLength) {
        const ratio = travelled / segmentLength;
        const x = previous[0] + dx * ratio;
        const y = previous[1] + dy * ratio;
        context.beginPath();
        context.moveTo(x - normalX * tieLength * 0.5, y - normalY * tieLength * 0.5);
        context.lineTo(x + normalX * tieLength * 0.5, y + normalY * tieLength * 0.5);
        context.stroke();
        travelled += spacing;
      }
      distanceUntilNextTie = travelled - segmentLength;
    }
  });
}

export function railwayStyle(symbolType: string, strokeWidth: number, text?: Text) {
  const width = Math.max(1.5, strokeWidth);
  const isSingleTrack = symbolType === "rail-single";
  const renderer = (coordinates: RenderCoordinate, state: { context: CanvasRenderingContext2D }) => {
    const lines = collectLineCoordinateGroups(coordinates);
    if (lines.length === 0) {
      return;
    }
    const context = state.context;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";

    context.strokeStyle = "#111827";
    context.lineWidth = isSingleTrack ? width : width + 2;
    drawLinePath(context, lines);

    if (!isSingleTrack) {
      context.strokeStyle = "#f8fafc";
      context.lineWidth = Math.max(1, width - 0.5);
      drawLinePath(context, lines);
    }

    context.lineCap = "butt";
    context.strokeStyle = "#111827";
    context.lineWidth = Math.max(1, width * 0.75);
    drawRailwayTies(context, lines, isSingleTrack ? 13 : 10, Math.max(8, width + 7));
    context.restore();
  };

  return [
    new Style({ renderer }),
    ...(text ? [new Style({ text })] : []),
  ];
}

export function featureMapStyles(
  featureStyle: LayerStyleSettings,
  options: {
    selected: boolean;
    labelValue?: unknown;
    selectionStrokeColor?: string;
    selectionFillColor?: string;
    selectionPointFillColor?: string;
  },
) {
  const selectedStrokeColor = options.selectionStrokeColor ?? "#ff7a00";
  const selectedFillColor = options.selectionFillColor ?? "rgba(255, 196, 0, 0.45)";
  const selectedPointFillColor = options.selectionPointFillColor ?? "rgba(255, 210, 61, 0.95)";
  const strokeColor = options.selected ? selectedStrokeColor : featureStyle.strokeColor;
  const fillColor = options.selected ? selectedFillColor : colorWithOpacity(featureStyle.fillColor, featureStyle.fillOpacity);
  const pointFillColor = options.selected
    ? selectedPointFillColor
    : colorWithOpacity(featureStyle.fillColor, Math.max(0.35, featureStyle.fillOpacity));
  const strokeWidth = options.selected ? Math.max(4, featureStyle.strokeWidth + 3) : featureStyle.strokeWidth;
  const text = options.labelValue
    ? new Text({
        text: String(options.labelValue),
        offsetY: -12,
        font: "12px Inter, sans-serif",
        fill: new Fill({ color: "#10212a" }),
        stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 3 }),
      })
    : undefined;

  if (!options.selected && featureStyle.symbolType === "cased-road") {
    return [
      new Style({
        stroke: new Stroke({ color: "#2b1d13", width: featureStyle.strokeWidth + 3 }),
        text,
      }),
      new Style({
        stroke: new Stroke({ color: featureStyle.strokeColor, width: Math.max(1, featureStyle.strokeWidth) }),
      }),
    ];
  }

  if (!options.selected && (featureStyle.symbolType === "rail" || featureStyle.symbolType === "rail-single")) {
    return railwayStyle(featureStyle.symbolType, featureStyle.strokeWidth, text);
  }

  return new Style({
    image: new CircleStyle({
      radius: options.selected ? featureStyle.pointRadius + 5 : featureStyle.pointRadius,
      fill: new Fill({ color: pointFillColor }),
      stroke: new Stroke({
        color: strokeColor,
        width: strokeWidth,
        lineDash: options.selected ? undefined : lineDashForStyle(featureStyle.lineStyle),
      }),
    }),
    fill: new Fill({ color: fillColor }),
    stroke: new Stroke({
      color: strokeColor,
      width: strokeWidth,
      lineDash: options.selected ? undefined : lineDashForStyle(featureStyle.lineStyle),
    }),
    text,
  });
}

export function legendSymbolType(
  geometryKind: "point" | "line" | "polygon" | "mixed" | "unknown",
  classItem?: LayerClassificationClass | null,
) {
  if (classItem?.symbolType) {
    return classItem.symbolType;
  }
  const label = normalizeClassValue(`${classItem?.label ?? ""} ${classItem?.value ?? ""}`);
  if (geometryKind === "line") {
    if (label.includes("одноколей")) {
      return "rail-single";
    }
    if (label.includes("ж/д") || label.includes("желез")) {
      return "rail";
    }
    if (label.includes("с покрытием") || label.includes("асфальт")) {
      return "cased-road";
    }
    if (label.includes("грунтов")) {
      return "dirt-road";
    }
    if (label.includes("просел")) {
      return "local-road";
    }
    if (label.includes("полевая") || label.includes("лесная")) {
      return "track-road";
    }
    if (label.includes("просек")) {
      return "clearing-line";
    }
    if (label.includes("dry up") || label.includes("пересых")) {
      return "dry-water";
    }
    if (label.includes("river") || label.includes("река")) {
      return "river-line";
    }
    if (label.includes("chan") || label.includes("канал")) {
      return "canal-line";
    }
    if (classItem?.lineStyle === "dot") {
      return "dot-line";
    }
    if (classItem?.lineStyle === "dash") {
      return "dash-line";
    }
    return "line";
  }
  if (geometryKind === "point") {
    return "point";
  }
  if (geometryKind === "polygon") {
    return "polygon";
  }
  return "mixed";
}

export function LegendClassSymbol(props: {
  geometryKind: "point" | "line" | "polygon" | "mixed" | "unknown";
  classItem?: LayerClassificationClass | null;
  color: string;
  fillOpacity?: number;
}) {
  const symbolType = legendSymbolType(props.geometryKind, props.classItem);
  const style = {
    "--symbol-color": props.color,
    "--symbol-fill": colorWithOpacity(props.color, props.fillOpacity ?? 0.25),
  } as CSSProperties;
  return (
    <span
      className={["qgis-class-symbol", `qgis-class-symbol-${symbolType}`].join(" ")}
      style={style}
      aria-hidden="true"
    />
  );
}

export function geometryKindFromType(type: string | null | undefined): "point" | "line" | "polygon" | "mixed" | "unknown" {
  const normalized = String(type ?? "").toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("point")) return "point";
  if (normalized.includes("line")) return "line";
  if (normalized.includes("polygon")) return "polygon";
  if (normalized.includes("collection")) return "mixed";
  return "unknown";
}

export function layerGeometryKind(preview?: GeoJsonPreview | null): "point" | "line" | "polygon" | "mixed" | "unknown" {
  if (!preview) return "unknown";
  const kinds = new Set(
    preview.geojson.features
      .map((feature) => geometryKindFromType(feature.geometry?.type))
      .filter((kind) => kind !== "unknown"),
  );
  if (kinds.size === 0) return "unknown";
  if (kinds.size === 1) return Array.from(kinds)[0] ?? "unknown";
  return "mixed";
}

export function previewAttributeFields(preview: GeoJsonPreview) {
  const fields = new Set<string>();
  preview.geojson.features.forEach((feature) => {
    Object.keys(feature.properties ?? {}).forEach((key) => fields.add(key));
  });
  return Array.from(fields).sort((left, right) => left.localeCompare(right));
}
