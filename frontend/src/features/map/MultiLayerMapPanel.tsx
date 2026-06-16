import { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import LineString from "ol/geom/LineString";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import MultiLineString from "ol/geom/MultiLineString";
import MultiPoint from "ol/geom/MultiPoint";
import MultiPolygon from "ol/geom/MultiPolygon";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import Draw, { createBox } from "ol/interaction/Draw";
import DragPan from "ol/interaction/DragPan";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import Snap from "ol/interaction/Snap";
import type { Segmenters } from "ol/interaction/Snap";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorImageLayer from "ol/layer/VectorImage";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import { transform, transformExtent } from "ol/proj";
import { getLength } from "ol/sphere";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { featureSelectionKey } from "./selection";
import type { SelectedLayerFeature, ZoomSelectionTarget } from "./selection";
import {
  classifiedStyleForFeature,
  colorWithOpacity,
  featureMapStyles,
  geometryKindFromType,
  layerGeometryKind,
  normalizeLayerStyle,
  previewAttributeFields,
} from "./layerStyles";
import type { GeoJsonFeature, GeoJsonGeometry, GeoJsonPreview, LayerPreviewState, LayerStyleSettings } from "./layerStyles";
import { DraftFeatureTable, GisFeatureTable } from "../feature-table/FeatureTables";
import type { AttributeFieldType } from "../feature-table/FeatureTables";
import { DraftPropertiesPanel } from "./DraftPropertiesPanel";
import { MapToolbar } from "./MapToolbar";

type EditMode = "select" | "point" | "line" | "polygon" | "aiBox" | "measure";

// Тип геометрии слоя -> допустимый тип рисования.
// null = тип не задан (legacy "mixed"/пусто), ограничение не накладывается.
function lockedDrawTypeFromGeometry(
  geomType?: string | null,
): "Point" | "LineString" | "Polygon" | null {
  if (!geomType) return null;
  const value = geomType.toLowerCase();
  if (value === "mixed") return null;
  if (value.includes("line")) return "LineString";
  if (value.includes("point")) return "Point";
  if (value.includes("polygon")) return "Polygon";
  return null;
}

type BasemapMode = "osm" | "satellite" | "none";

type MapWindowKey = "layerProperties" | "table" | "draftProperties" | "symbolEditor";

type SnapSettings = {
  enabled: boolean;
  point: boolean;
  endpoint: boolean;
  vertex: boolean;
  edge: boolean;
  tolerance: number;
};

type UserRole = "admin" | "teacher" | "student";

type AuthResponse = {
  access_token: string;
  token_type: string;
  user: {
    id: number;
    email: string;
    full_name?: string | null;
    role: UserRole;
    is_active: boolean;
  };
};

type Submission = {
  id: number;
  assignment_id: number;
  student_id?: number | null;
  original_filename: string;
  status: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
};

type DraftHistorySnapshot = {
  geojson: {
    type: "FeatureCollection";
    features: GeoJsonFeature[];
  };
  draftFieldsText: string;
  draftFieldTypes: Record<string, AttributeFieldType>;
  draftName: string;
  draftGeometryType: string;
  draftCrs: string;
  draftColor: string;
  draftFillOpacity: number;
};

type CoordinateProjectionCode = string;

type MapViewState = {
  center: number[];
  zoom: number;
  projection: CoordinateProjectionCode;
};

type MapDraft = {
  id: number;
  assignment_id: number;
  student_id: number;
  last_submission_id?: number | null;
  name: string;
  geometry_type: string;
  geojson_storage_key: string;
  feature_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  geojson?: {
    type: "FeatureCollection";
    features: GeoJsonFeature[];
    properties?: {
      layer_name?: string;
      geometry_type?: string;
      assigned_crs?: string;
      includes_base_layers?: boolean;
      source_layer_count?: number;
      draft_feature_count?: number;
      fields?: string[];
      field_types?: Record<string, AttributeFieldType>;
      style?: {
        color?: string;
        fill_opacity?: number;
      };
    };
  } | null;
};

type AiSegmentBoxResponse = {
  status: string;
  geometry: GeoJsonGeometry;
  confidence: number;
  message: string;
  meta?: Record<string, unknown>;
};

type AiTargetSemanticType = "water" | "forest";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "/api";

const AUTH_STORAGE_KEY = "gis_edu_auth";

const LEGACY_DRAFT_DEFAULT_FIELDS = new Set(["name", "description"]);

// Тесная рамка для ВПИСЫВАНИЯ (полный охват / автоподгонка): запад 19°E (граница
// Калининграда), без широкого западного/южного океана, чтобы Россия вставала по
// центру, а не «прижатой на восток».
const RUSSIA_FIT_EXTENT_LONLAT = [19, 41, 180, 82];

const SATELLITE_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const POINT_ONLY_SNAP_SEGMENTERS: Segmenters = {
  LineString: null,
  Polygon: null,
  Circle: null,
  GeometryCollection: null,
  MultiLineString: null,
  MultiPolygon: null,
};

const LINE_ENDPOINT_SNAP_SEGMENTERS: Segmenters = {
  Point: null,
  Polygon: null,
  Circle: null,
  GeometryCollection: null,
  MultiPoint: null,
  MultiPolygon: null,
  LineString: (geometry) => {
    const coordinates = geometry.getCoordinates();
    return coordinates.length ? [[coordinates[0]], [coordinates[coordinates.length - 1]]] : [];
  },
  MultiLineString: (geometry) =>
    geometry.getCoordinates().flatMap((coordinates) =>
      coordinates.length ? [[coordinates[0]], [coordinates[coordinates.length - 1]]] : [],
    ),
};

const LINE_VERTEX_SNAP_SEGMENTERS: Segmenters = {
  Point: null,
  GeometryCollection: null,
  MultiPoint: null,
};

function isBlankAttributeValue(value: unknown) {
  return value === undefined || value === null || String(value).trim() === "";
}

function isLegacyDraftDefaultField(field: string) {
  return LEGACY_DRAFT_DEFAULT_FIELDS.has(field.trim().toLowerCase());
}

function hasNonBlankFeatureValue(features: Feature<Geometry>[], field: string) {
  return features.some((feature) => !isBlankAttributeValue(feature.get(field)));
}

function visibleDraftSchemaFieldsForFeatures(fields: string[], features: Feature<Geometry>[]) {
  return fields.filter((field) => !isLegacyDraftDefaultField(field) || hasNonBlankFeatureValue(features, field));
}

function pruneBlankLegacyDraftFields(features: Feature<Geometry>[]) {
  features.forEach((feature) => {
    LEGACY_DRAFT_DEFAULT_FIELDS.forEach((field) => {
      if (isBlankAttributeValue(feature.get(field))) {
        feature.unset(field, true);
      }
    });
  });
}

function mapPointerButton(event: MapBrowserEvent) {
  const originalEvent = event.originalEvent;
  return originalEvent instanceof MouseEvent || originalEvent instanceof PointerEvent ? originalEvent.button : 0;
}

function primaryMapButton(event: MapBrowserEvent) {
  return mapPointerButton(event) === 0;
}

function middleMapButton(event: MapBrowserEvent) {
  return mapPointerButton(event) === 1;
}

function secondaryMapButton(event: MapBrowserEvent) {
  return mapPointerButton(event) === 2;
}

function layerDisplayName(assetName: string) {
  return assetName.replace(/\.(zip|geojson|shp)$/i, "");
}

function storedAuthHeaders(): HeadersInit {
  const savedAuth = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!savedAuth) {
    return {};
  }
  try {
    const parsed = JSON.parse(savedAuth) as AuthResponse;
    return parsed.access_token ? { Authorization: `Bearer ${parsed.access_token}` } : {};
  } catch {
    return {};
  }
}

function storedUserRole(): UserRole | null {
  const savedAuth = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!savedAuth) {
    return null;
  }
  try {
    const parsed = JSON.parse(savedAuth) as Partial<AuthResponse>;
    return parsed?.user?.role ?? null;
  } catch {
    return null;
  }
}

async function storedAuthFetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...storedAuthHeaders(),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} вернул ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const responseText = await response.text();
  return (responseText ? JSON.parse(responseText) : undefined) as T;
}

function featureSelectionScore(feature: Feature<Geometry>, order: number) {
  const geometry = feature.getGeometry();
  const type = geometry?.getType() ?? "";
  const priority: Record<string, number> = {
    Point: 0,
    MultiPoint: 0,
    LineString: 1,
    MultiLineString: 1,
    Polygon: 2,
    MultiPolygon: 2,
  };
  const extent = geometry?.getExtent();
  const area =
    extent && Number.isFinite(extent[0])
      ? Math.max(0, extent[2] - extent[0]) * Math.max(0, extent[3] - extent[1])
      : 0;
  return (priority[type] ?? 3) * 1_000_000_000_000 + area + order * 0.0001;
}

function squaredDistanceToSegment(point: number[], start: number[], end: number[]) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  }
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  const closestX = start[0] + ratio * dx;
  const closestY = start[1] + ratio * dy;
  return (point[0] - closestX) ** 2 + (point[1] - closestY) ** 2;
}

function squaredDistanceToLineCoordinates(point: number[], coordinates: number[][]) {
  if (coordinates.length === 0) {
    return Infinity;
  }
  if (coordinates.length === 1) {
    return (point[0] - coordinates[0][0]) ** 2 + (point[1] - coordinates[0][1]) ** 2;
  }
  return coordinates.slice(1).reduce((minimum, coordinate, index) => {
    const previous = coordinates[index];
    return Math.min(minimum, squaredDistanceToSegment(point, previous, coordinate));
  }, Infinity);
}

function squaredDistanceToLineGeometry(point: number[], geometry: Geometry | undefined) {
  if (geometry instanceof LineString) {
    return squaredDistanceToLineCoordinates(point, geometry.getCoordinates());
  }
  if (geometry instanceof MultiLineString) {
    return geometry
      .getCoordinates()
      .reduce((minimum, coordinates) => Math.min(minimum, squaredDistanceToLineCoordinates(point, coordinates)), Infinity);
  }
  return Infinity;
}

function coordinatesMatch(left: number[], right: number[]) {
  return left.length >= 2 && right.length >= 2 && left[0] === right[0] && left[1] === right[1];
}

function ringVertexCoordinates(ring: number[][]) {
  if (ring.length > 1 && coordinatesMatch(ring[0], ring[ring.length - 1])) {
    return ring.slice(0, -1);
  }
  return ring;
}

function geometryVertexCoordinates(geometry: Geometry | undefined): number[][] {
  if (!geometry) {
    return [];
  }
  if (geometry instanceof Point) {
    return [geometry.getCoordinates()];
  }
  if (geometry instanceof MultiPoint) {
    return geometry.getCoordinates();
  }
  if (geometry instanceof LineString) {
    return geometry.getCoordinates();
  }
  if (geometry instanceof MultiLineString) {
    return geometry.getCoordinates().flat();
  }
  if (geometry instanceof Polygon) {
    return geometry.getCoordinates().flatMap(ringVertexCoordinates);
  }
  if (geometry instanceof MultiPolygon) {
    return geometry.getCoordinates().flatMap((polygon) => polygon.flatMap(ringVertexCoordinates));
  }
  return [];
}

function asStyleArray(styles: Style | Style[]) {
  return Array.isArray(styles) ? styles : [styles];
}

function selectedVertexStyle(feature: Feature<Geometry>) {
  const coordinates = geometryVertexCoordinates(feature.getGeometry());
  if (coordinates.length === 0) {
    return null;
  }

  return new Style({
    geometry: new MultiPoint(coordinates),
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: "#f8fafc" }),
      stroke: new Stroke({ color: "#0f766e", width: 2 }),
    }),
  });
}

function selectedFeatureOverlayStyles(feature: Feature<Geometry>) {
  const styles: Style[] = [
    new Style({
      image: new CircleStyle({
        radius: 9,
        fill: new Fill({ color: "rgba(255, 255, 255, 0.12)" }),
        stroke: new Stroke({ color: "#0f766e", width: 2, lineDash: [7, 4] }),
      }),
      fill: new Fill({ color: "rgba(15, 118, 110, 0.04)" }),
      stroke: new Stroke({ color: "#0f766e", width: 2, lineDash: [7, 4] }),
    }),
  ];
  const vertexStyle = selectedVertexStyle(feature);
  if (vertexStyle) {
    styles.push(vertexStyle);
  }
  return styles;
}

function transparentDraftPreviewStyles(featureStyle: LayerStyleSettings) {
  const strokeColor = colorWithOpacity(featureStyle.strokeColor, 0.35);
  return new Style({
    image: new CircleStyle({
      radius: featureStyle.pointRadius,
      fill: new Fill({ color: colorWithOpacity(featureStyle.fillColor, 0.14) }),
      stroke: new Stroke({ color: strokeColor, width: Math.max(1, featureStyle.strokeWidth) }),
    }),
    fill: new Fill({ color: colorWithOpacity(featureStyle.fillColor, 0.1) }),
    stroke: new Stroke({
      color: strokeColor,
      width: Math.max(1, featureStyle.strokeWidth),
      lineDash: [8, 5],
    }),
  });
}

function zoomToScaleDenominator(zoom: number) {
  return Math.max(1, Math.round(591657550.5 / 2 ** zoom));
}

function scaleDenominatorToZoom(denominator: number) {
  return Math.log2(591657550.5 / Math.max(1, denominator));
}

function formatMapScale(zoom: number) {
  return `1:${zoomToScaleDenominator(zoom).toLocaleString("ru-RU")}`;
}

function parseMapScale(value: string) {
  const normalized = value.replace(/\s/g, "").replace(/^1[:/]/i, "");
  const denominator = Number(normalized.replace(",", "."));
  return Number.isFinite(denominator) && denominator > 0 ? denominator : null;
}

function formatDistanceMeters(distance: number) {
  if (!Number.isFinite(distance)) {
    return "0 м";
  }
  if (distance >= 1000) {
    return `${(distance / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} км`;
  }
  return `${distance.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} м`;
}

function transformCoordinateSafe(
  coordinate: number[] | null | undefined,
  sourceProjection: CoordinateProjectionCode,
  targetProjection: CoordinateProjectionCode,
) {
  if (!coordinate) {
    return null;
  }
  if (sourceProjection === targetProjection) {
    return [...coordinate];
  }
  try {
    return transform(coordinate, sourceProjection, targetProjection);
  } catch {
    return null;
  }
}

function transformExtentSafe(
  extent: number[] | null | undefined,
  sourceProjection: CoordinateProjectionCode,
  targetProjection: CoordinateProjectionCode,
) {
  if (!extent || !extent.every(Number.isFinite)) {
    return null;
  }
  if (sourceProjection === targetProjection) {
    return [...extent];
  }
  try {
    return transformExtent(extent, sourceProjection, targetProjection);
  } catch {
    return null;
  }
}

function russiaFitExtentForProjection(projection: CoordinateProjectionCode) {
  return transformExtentSafe(RUSSIA_FIT_EXTENT_LONLAT, "EPSG:4326", projection) ?? undefined;
}

function isLonLatPosition(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

function unwrapAntimeridianRing(ring: unknown): unknown {
  if (!Array.isArray(ring) || !ring.every(isLonLatPosition)) {
    return ring;
  }
  let offset = 0;
  let previousLon = ring[0][0];
  return ring.map((position, index) => {
    const lon = position[0];
    if (index > 0) {
      const delta = lon + offset - previousLon;
      if (delta > 180) {
        offset -= 360;
      } else if (delta < -180) {
        offset += 360;
      }
    }
    const nextLon = lon + offset;
    previousLon = nextLon;
    return [nextLon, position[1], ...position.slice(2)];
  });
}

function unwrapAntimeridianGeometry(geometry: GeoJsonGeometry | null): GeoJsonGeometry | null {
  if (!geometry?.coordinates && !geometry?.geometries) {
    return geometry;
  }
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map(unwrapAntimeridianRing),
    };
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        Array.isArray(polygon) ? polygon.map(unwrapAntimeridianRing) : polygon,
      ),
    };
  }
  if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    return {
      ...geometry,
      geometries: geometry.geometries.map(unwrapAntimeridianGeometry).filter(Boolean) as GeoJsonGeometry[],
    };
  }
  return geometry;
}

function geoJsonFeatureForMap(feature: GeoJsonFeature): GeoJsonFeature {
  if (!feature.geometry) {
    return feature;
  }
  const geometry = unwrapAntimeridianGeometry(feature.geometry);
  return geometry === feature.geometry ? feature : { ...feature, geometry };
}

function formatMapCoordinate(
  coordinate: number[] | null,
  sourceProjection: CoordinateProjectionCode,
  targetProjection: CoordinateProjectionCode,
) {
  if (!coordinate) {
    return "—";
  }
  try {
    const [x, y] = sourceProjection === targetProjection ? coordinate : transform(coordinate, sourceProjection, targetProjection);
    const fractionDigits = targetProjection === "EPSG:4326" ? 6 : 2;
    return `${x.toFixed(fractionDigits)}, ${y.toFixed(fractionDigits)}`;
  } catch {
    return "СК не поддерживается";
  }
}

type RestoredDraftLayer = {
  assetId: number;
  name: string;
  groupName?: string | null;
  style?: Partial<LayerStyleSettings> | null;
  fieldTypes?: Record<string, AttributeFieldType>;
  fields?: string[];
  geometryType?: string | null;
  crs?: string | null;
};

export function MultiLayerMapPanel(props: {
  layers: LayerPreviewState[];
  layerStyles: Record<number, LayerStyleSettings>;
  assignmentId: number | null;
  activeEditableLayerId: number | null;
  activeEditableLayerName: string | null;
  autoLoadDraft?: boolean;
  isDraftEditingEnabled: boolean;
  onDraftEditingEnabledChange: (enabled: boolean) => void;
  onRequestSelectedLayerEditing?: () => void | Promise<void>;
  selectedLayerForEditingId?: number | null;
  selectedLayerForEditingName?: string | null;
  onRestoreDraftLayers?: (layers: RestoredDraftLayer[]) => void;
  zoomToLayerId: number | null;
  zoomToLayerTick: number;
  tableLayerId: number | null;
  layerAliases: Record<number, string>;
  layerGroups?: Record<number, string>;
  isTableWindowOpen: boolean;
  selectedFeature: SelectedLayerFeature;
  onFeatureSelect: (feature: SelectedLayerFeature) => void;
  onLayerFeatureAttributeChange: (assetId: number, featureIndex: number, field: string, value: string) => void;
  onLayerAttributeFieldAdd: (assetId: number, field: string) => void;
  onLayerAttributeFieldRemove: (assetId: number, field: string) => void;
  removedLayerIds?: number[];
  windowZIndexes: Record<MapWindowKey, number>;
  onWindowFocus: (windowKey: MapWindowKey) => void;
  onCloseTable: () => void;
  allowDraftSubmit?: boolean;
  onDraftSubmitted?: (submission: Submission) => void | Promise<void>;
  projectExtent3857?: number[] | null;
  hideBasemap?: boolean;
  coordinateProjections: Array<{ code: string; label: string; definition?: string }>;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const selectedFeatureRef = useRef<SelectedLayerFeature>(props.selectedFeature);
  const selectedFeatureKeysRef = useRef<Set<string>>(new Set());
  // Слои-источники рендерим как VectorImage (растрируются в картинку) — это
  // резко ускоряет панораму/зум при большом числе объектов. Редактируемые слои
  // (черновик, AI, измерение) остаются интерактивными VectorLayer.
  const vectorLayerRefs = useRef<Array<VectorLayer<VectorSource> | VectorImageLayer<VectorSource>>>([]);
  const basemapLayerRef = useRef<TileLayer<OSM | XYZ> | null>(null);
  const draftLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const aiSuggestionLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const measureLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const mapLayerSourcesRef = useRef<VectorSource[]>([]);
  const draftSourceRef = useRef(new VectorSource());
  const measureSourceRef = useRef(new VectorSource());
  const layersRef = useRef(props.layers);
  const layerStylesRef = useRef(props.layerStyles);
  // Кэш нормализованного стиля по слою: чтобы не пересчитывать normalizeLayerStyle
  // для каждого объекта на каждый кадр. Сбрасывается, когда меняется сам стиль слоя.
  // NB: Map в этом файле — это ol/Map, поэтому кэш на обычном объекте.
  const normalizedLayerStyleCacheRef = useRef<
    Record<number, { source: LayerStyleSettings | undefined; normalized: ReturnType<typeof normalizeLayerStyle> }>
  >({});
  const draftStyleRef = useRef({ color: "#d83f3f", fillOpacity: 0.2 });
  const drawInteractionRef = useRef<Draw | null>(null);
  const mapViewStateRef = useRef<MapViewState | null>(null);
  const coordinateProjectionRef = useRef<CoordinateProjectionCode>("EPSG:3857");
  const mapProjectionRef = useRef<CoordinateProjectionCode>("EPSG:3857");
  const editModeRef = useRef<EditMode>("select");
  const lastFitKeyRef = useRef<string | null>(null);
  // DOM-узел перетаскиваемого окна: во время drag двигаем его напрямую через
  // style, чтобы не ререндерить тяжёлую панель (карта + таблица) на каждый
  // pointermove. В React-стейт позицию коммитим один раз на pointerup.
  const draggedWindowElRef = useRef<HTMLElement | null>(null);
  // Предыдущее состояние режима редактирования — чтобы поймать переход вкл→выкл
  // и автосохранить черновик при завершении редактирования.
  const wasDraftEditingRef = useRef(props.isDraftEditingEnabled);
  // Актуальные действия для горячих клавиш: keydown-эффект вешается один раз
  // (deps []), поэтому читаем функции через ref, чтобы не словить устаревшее
  // замыкание (например старый activeEditableLayerId при удалении).
  const keyboardActionsRef = useRef<{ deleteSelected: () => void; clearSelection: () => void }>({
    deleteSelected: () => {},
    clearSelection: () => {},
  });
  const lastZoomToLayerTickRef = useRef(props.zoomToLayerTick);
  const autoLoadedDraftRef = useRef(false);
  const selectedDraftFeatureRef = useRef<Feature<Geometry> | null>(null);
  const justDrawnDraftFeaturesRef = useRef(new WeakSet<Feature<Geometry>>());
  const draftHistoryRef = useRef<DraftHistorySnapshot[]>([]);
  const draftFutureRef = useRef<DraftHistorySnapshot[]>([]);
  const aiSuggestionSourceRef = useRef(new VectorSource());
  const [tableWindowPosition, setTableWindowPosition] = useState({ x: 28, y: 88 });
  const [tableDragOffset, setTableDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [draftPropertiesPosition, setDraftPropertiesPosition] = useState({ x: 620, y: 112 });
  const [draftPropertiesDragOffset, setDraftPropertiesDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [snapSettings, setSnapSettings] = useState<SnapSettings>({
    enabled: true,
    point: true,
    endpoint: true,
    vertex: true,
    edge: true,
    tolerance: 14,
  });
  const [editMode, setEditMode] = useState<EditMode>("select");
  const [mapZoom, setMapZoom] = useState(mapViewStateRef.current?.zoom ?? 2);
  const [mapScaleText, setMapScaleText] = useState(formatMapScale(mapViewStateRef.current?.zoom ?? 2));
  const [measureDistanceText, setMeasureDistanceText] = useState("");
  const [measureEndpoints, setMeasureEndpoints] = useState<{ start: string; end: string } | null>(null);
  const [coordinateProjection, setCoordinateProjection] = useState<CoordinateProjectionCode>("EPSG:3857");
  const [basemapMode, setBasemapMode] = useState<BasemapMode>(props.hideBasemap ? "none" : "osm");
  const isBasemapVisible = basemapMode !== "none";
  const [cursorCoordinates, setCursorCoordinates] = useState("—");
  const [draftRevision, setDraftRevision] = useState(0);
  const [draftHistoryRevision, setDraftHistoryRevision] = useState(0);
  const [draftId, setDraftId] = useState<number | null>(null);
  // Необязательный отчёт (DOCX/PDF), прикладываемый к сдаче прямо из карты.
  const [submitReportFile, setSubmitReportFile] = useState<File | null>(null);
  const [draftName, setDraftName] = useState("draft-layer");
  const [draftGeometryType, setDraftGeometryType] = useState("mixed");
  const [draftCrs, setDraftCrs] = useState("EPSG:4326");
  const [draftFieldsText, setDraftFieldsText] = useState("");
  const [draftFieldTypes, setDraftFieldTypes] = useState<Record<string, AttributeFieldType>>({});
  const [draftColor, setDraftColor] = useState("#d83f3f");
  const [draftFillOpacity, setDraftFillOpacity] = useState(0.2);
  const [draftStatus, setDraftStatus] = useState("Черновик не сохранён.");
  const [isDraftBusy, setIsDraftBusy] = useState(false);
  const [isAiSegmenting, setIsAiSegmenting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{
    feature: Feature<Geometry>;
    targetFeature: Feature<Geometry>;
    confidence: number;
    message: string;
  } | null>(null);
  const aiSuggestionRef = useRef<typeof aiSuggestion>(null);
  const [lastAiRequest, setLastAiRequest] = useState<
    | { kind: "box"; boxFeature: Feature<Geometry> }
    | { kind: "continue"; targetFeature: Feature<Geometry> }
    | null
  >(null);
  const [isDraftPropertiesOpen, setIsDraftPropertiesOpen] = useState(false);
  const [isDraftTableOpen, setIsDraftTableOpen] = useState(false);
  const [selectedFeatureKeys, setSelectedFeatureKeys] = useState<Set<string>>(new Set());
  const [newDraftFieldName, setNewDraftFieldName] = useState("");
  const [attributeKey, setAttributeKey] = useState("");
  const [attributeValue, setAttributeValue] = useState("");
  // СК-селектор задаёт проекцию ВИДА карты: при смене СК карта реально
  // перепроицируется — слои перечитываются с новым featureProjection, View
  // пересоздаётся (эффект-перестроитель карты зависит от mapProjection),
  // черновики/AI трансформируются (эффект ниже), а координаты курсора
  // показываются в этой же СК.
  const mapProjection: CoordinateProjectionCode = coordinateProjection;
  const removedLayerKey = (props.removedLayerIds ?? []).join(",");
  const visibleLayers = props.layers.filter((layer) => layer.visible);
  const canPersistDraft = Boolean(props.allowDraftSubmit) && storedUserRole() === "student" && Boolean(props.assignmentId);
  const canEditActiveLayer = props.isDraftEditingEnabled && props.activeEditableLayerId !== null;
  const editableDraftFeatures = draftSourceRef.current
    .getFeatures()
    .filter((feature) => feature.get("draft_layer_asset_id") === props.activeEditableLayerId);
  // Тип геометрии, которым ограничиваем рисование в активном слое.
  // Для существующего слоя берём ЕГО реальный тип (preview.geometry_types),
  // для нового черновика — выбранный в свойствах (draftGeometryType).
  // Неопределённость (0 или несколько типов) → "mixed" = без ограничения,
  // чтобы случайно не запретить рисование в уже существующем слое.
  const activeEditableLayer =
    props.activeEditableLayerId !== null
      ? props.layers.find((layer) => layer.asset.id === props.activeEditableLayerId)
      : undefined;
  const activeLayerStyle =
    props.activeEditableLayerId !== null ? props.layerStyles[props.activeEditableLayerId] : undefined;
  // Тип геометрии слоя: сначала явный выбор «Тип слоя» (стиль), затем тип по объектам слоя.
  const activeLayerKind =
    activeLayerStyle?.geometryKind ??
    (activeEditableLayer ? layerGeometryKind(activeEditableLayer.preview) : undefined);
  // Если тип определён (point/line/polygon) — ограничиваем им; иначе берём выбор из свойств черновика.
  const lockGeometryType =
    activeLayerKind === "point" || activeLayerKind === "line" || activeLayerKind === "polygon"
      ? activeLayerKind
      : draftGeometryType;
  const fitKey = [
    visibleLayers.map((layer) => `${layer.asset.id}:${layer.preview.preview_feature_count}`).join(","),
    props.zoomToLayerId ?? "all",
    props.zoomToLayerTick,
    props.projectExtent3857?.join(",") ?? "no-project-extent",
  ].join("|");
  const draftFeatureCount = draftRevision >= 0 ? draftSourceRef.current.getFeatures().length : 0;
  const activeDraftFeatureCount = draftRevision >= 0 ? editableDraftFeatures.length : 0;
  const canUndoDraft = draftHistoryRevision >= 0 && draftHistoryRef.current.length > 0;
  const canRedoDraft = draftHistoryRevision >= 0 && draftFutureRef.current.length > 0;
  const draftFeatures = draftSourceRef.current.getFeatures();
  const selectedDraftFeature = selectedDraftFeatureRef.current;
  const selectedDraftProperties = selectedDraftFeature?.getProperties() ?? {};
  const draftSchemaFields = draftFields();
  const selectedDraftExtraAttributeEntries = Object.entries(selectedDraftProperties).filter(
    ([key]) => key !== "geometry" && !draftSchemaFields.includes(key),
  );
  const selectedLayer = props.selectedFeature
    ? props.layers.find((layer) => layer.asset.id === props.selectedFeature?.assetId) ?? null
    : null;
  const selectedGeoJsonFeature =
    selectedLayer && props.selectedFeature
      ? selectedLayer.preview.geojson.features[props.selectedFeature.featureIndex] ?? null
      : null;
  const tableLayer = props.tableLayerId
    ? props.layers.find((layer) => layer.asset.id === props.tableLayerId) ?? null
    : null;
  const tableLayerId = tableLayer?.asset.id ?? null;
  const tableDraftFeatures = tableLayer
    ? draftSourceRef.current
        .getFeatures()
        .filter((feature) => feature.get("draft_layer_asset_id") === tableLayer.asset.id)
    : [];

  useEffect(() => {
    selectedFeatureRef.current = props.selectedFeature;
    vectorLayerRefs.current.forEach((layer) => layer.changed());
  }, [props.selectedFeature]);

  useEffect(() => {
    layersRef.current = props.layers;
    layerStylesRef.current = props.layerStyles;
    vectorLayerRefs.current.forEach((layer) => layer.changed());
    draftLayerRef.current?.changed();
  }, [props.layers, props.layerStyles]);

  useEffect(() => {
    draftStyleRef.current = { color: draftColor, fillOpacity: draftFillOpacity };
    draftLayerRef.current?.changed();
  }, [draftColor, draftFillOpacity]);

  useEffect(() => {
    aiSuggestionRef.current = aiSuggestion;
    aiSuggestion?.targetFeature.changed();
    draftLayerRef.current?.changed();
  }, [aiSuggestion]);

  useEffect(() => {
    selectedFeatureKeysRef.current = selectedFeatureKeys;
    vectorLayerRefs.current.forEach((layer) => layer.changed());
  }, [selectedFeatureKeys]);

  useEffect(() => {
    if (!props.isDraftEditingEnabled && editMode !== "select" && editMode !== "measure") {
      setEditMode("select");
    }
  }, [props.isDraftEditingEnabled, editMode]);

  // Если активный слой имеет конкретный тип геометрии, а выбран инструмент рисования
  // другого типа — сбрасываем на «выбор», чтобы нельзя было рисовать не тот тип.
  useEffect(() => {
    const locked = lockedDrawTypeFromGeometry(lockGeometryType);
    if (!locked) return;
    if (editMode === "point" || editMode === "line" || editMode === "polygon") {
      const lockedMode: EditMode =
        locked === "Point" ? "point" : locked === "LineString" ? "line" : "polygon";
      if (editMode !== lockedMode) {
        setEditMode("select");
      }
    }
  }, [lockGeometryType, editMode]);

  useEffect(() => {
    coordinateProjectionRef.current = coordinateProjection;
  }, [coordinateProjection]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  useEffect(() => {
    const removedIds = new Set(props.removedLayerIds ?? []);
    if (removedIds.size === 0) {
      return;
    }
    let removedDraftFeature = false;
    draftSourceRef.current.getFeatures().forEach((feature) => {
      const layerAssetId = Number(feature.get("draft_layer_asset_id"));
      if (Number.isFinite(layerAssetId) && removedIds.has(layerAssetId)) {
        if (selectedDraftFeatureRef.current === feature) {
          selectedDraftFeatureRef.current = null;
        }
        draftSourceRef.current.removeFeature(feature);
        removedDraftFeature = true;
      }
    });
    if (removedDraftFeature) {
      setDraftRevision((revision) => revision + 1);
      draftLayerRef.current?.changed();
    }
  }, [removedLayerKey]);

  useEffect(() => {
    const previousProjection = mapProjectionRef.current;
    if (previousProjection === mapProjection) {
      return;
    }

    draftSourceRef.current.getFeatures().forEach((feature) => {
      feature.getGeometry()?.transform(previousProjection, mapProjection);
    });
    aiSuggestionSourceRef.current.getFeatures().forEach((feature) => {
      feature.getGeometry()?.transform(previousProjection, mapProjection);
    });
    const currentViewState = mapViewStateRef.current;
    if (currentViewState?.center) {
      const nextCenter = transformCoordinateSafe(currentViewState.center, previousProjection, mapProjection);
      if (nextCenter) {
        mapViewStateRef.current = {
          center: nextCenter,
          zoom: currentViewState.zoom,
          projection: mapProjection,
        };
      }
    }
    mapProjectionRef.current = mapProjection;
    setCursorCoordinates("—");
    setDraftRevision((revision) => revision + 1);
  }, [mapProjection]);

  useEffect(() => {
    // При выборе любого другого инструмента убираем замер — и подпись «Линейка: …»,
    // и саму линию замера с карты.
    if (editMode !== "measure") {
      setMeasureDistanceText("");
      setMeasureEndpoints(null);
      measureSourceRef.current.clear();
    }
  }, [editMode]);

  useEffect(() => {
    setBasemapMode(props.hideBasemap ? "none" : "osm");
  }, [props.hideBasemap]);

  useEffect(() => {
    if (props.activeEditableLayerName) {
      setDraftName(props.activeEditableLayerName);
    }
  }, [props.activeEditableLayerName]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const isFormField =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(target?.isContentEditable);
      const isInteractive = isFormField || tag === "BUTTON" || tag === "A";

      if (event.key === "Escape") {
        // Прерываем текущее рисование и снимаем выделение (в полях ввода
        // выделение не трогаем — Escape там «отменить ввод»).
        try {
          drawInteractionRef.current?.abortDrawing();
        } catch {
          /* нет активного эскиза */
        }
        if (!isFormField) {
          keyboardActionsRef.current.clearSelection();
        }
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && !isFormField) {
        event.preventDefault();
        keyboardActionsRef.current.deleteSelected();
        return;
      }

      if (event.key === "Enter" && !isInteractive) {
        // Завершить создание текущего объекта (как двойной клик).
        event.preventDefault();
        try {
          drawInteractionRef.current?.finishDrawing();
        } catch {
          /* нечего завершать */
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function draftFields() {
    const currentFeatures = draftSourceRef.current.getFeatures();
    return Array.from(
      new Set(
        draftFieldsText
          .split(/[\n,;]+/)
          .map((field) => field.trim())
          .filter(Boolean)
          .filter((field) => !isLegacyDraftDefaultField(field) || hasNonBlankFeatureValue(currentFeatures, field)),
      ),
    );
  }

  function fieldType(field: string): AttributeFieldType {
    return draftFieldTypes[field] ?? "text";
  }

  function defaultValueForFieldType(type: AttributeFieldType) {
    if (type === "boolean") {
      return false;
    }
    return "";
  }

  function coerceAttributeValue(value: string, type: AttributeFieldType) {
    if (value === "") {
      return "";
    }
    if (type === "number") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    if (type === "integer") {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : value;
    }
    if (type === "boolean") {
      return value === "true" || value === "1" || value === "yes" || value === "on";
    }
    return value;
  }

  function captureDraftSnapshot(): DraftHistorySnapshot {
    const geojson = new GeoJSON().writeFeaturesObject(draftSourceRef.current.getFeatures(), {
      dataProjection: "EPSG:4326",
      featureProjection: mapProjection,
    }) as { type: "FeatureCollection"; features: GeoJsonFeature[] };
    return {
      geojson,
      draftFieldsText,
      draftFieldTypes,
      draftName,
      draftGeometryType,
      draftCrs,
      draftColor,
      draftFillOpacity,
    };
  }

  function rememberDraftState() {
    draftHistoryRef.current = [...draftHistoryRef.current.slice(-29), captureDraftSnapshot()];
    draftFutureRef.current = [];
    setDraftHistoryRevision((revision) => revision + 1);
  }

  function clearDraftHistory() {
    draftHistoryRef.current = [];
    draftFutureRef.current = [];
    setDraftHistoryRevision((revision) => revision + 1);
  }

  function clearAiSuggestion() {
    const targetFeature = aiSuggestionRef.current?.targetFeature;
    aiSuggestionSourceRef.current.clear();
    setAiSuggestion(null);
    setLastAiRequest(null);
    targetFeature?.changed();
    draftLayerRef.current?.changed();
  }

  function restoreDraftSnapshot(snapshot: DraftHistorySnapshot, status: string) {
    const features = new GeoJSON().readFeatures(snapshot.geojson, {
      dataProjection: "EPSG:4326",
      featureProjection: mapProjection,
    }) as Feature<Geometry>[];
    draftSourceRef.current.clear();
    draftSourceRef.current.addFeatures(features);
    selectedDraftFeatureRef.current = null;
    setDraftFieldsText(snapshot.draftFieldsText);
    setDraftFieldTypes(snapshot.draftFieldTypes);
    setDraftName(snapshot.draftName);
    setDraftGeometryType(snapshot.draftGeometryType);
    setDraftCrs(snapshot.draftCrs);
    setDraftColor(snapshot.draftColor);
    setDraftFillOpacity(snapshot.draftFillOpacity);
    setDraftStatus(status);
    setDraftRevision((revision) => revision + 1);
    setDraftHistoryRevision((revision) => revision + 1);
  }

  function undoDraftChange() {
    const snapshot = draftHistoryRef.current.pop();
    if (!snapshot) {
      return;
    }
    draftFutureRef.current = [...draftFutureRef.current.slice(-29), captureDraftSnapshot()];
    restoreDraftSnapshot(snapshot, "Изменение черновика отменено.");
  }

  function redoDraftChange() {
    const snapshot = draftFutureRef.current.pop();
    if (!snapshot) {
      return;
    }
    draftHistoryRef.current = [...draftHistoryRef.current.slice(-29), captureDraftSnapshot()];
    restoreDraftSnapshot(snapshot, "Изменение черновика возвращено.");
  }

  function applyDraftFieldsToFeature(feature: Feature<Geometry>) {
    const layerSchemaFields =
      props.activeEditableLayerId !== null
        ? previewAttributeFields(
            props.layers.find((layer) => layer.asset.id === props.activeEditableLayerId)?.preview ?? {
              asset_id: props.activeEditableLayerId,
              asset_name: "",
              detected_format: "geojson",
              crs: "EPSG:4326",
              feature_count: 0,
              preview_feature_count: 0,
              truncated: false,
              geojson: { type: "FeatureCollection", features: [] },
            },
          )
        : [];
    // Привязку к слою ставим ТОЛЬКО для нового объекта (у которого её ещё нет).
    // Иначе массовые вызовы (экспорт, «применить поля ко всем») перетегировали
    // бы уже нарисованные объекты активным слоем — и объекты одного слоя
    // утекали в другой (например линии из границы → в water при экспорте).
    if (props.activeEditableLayerId !== null && feature.get("draft_layer_asset_id") === undefined) {
      feature.set("draft_layer_asset_id", props.activeEditableLayerId);
      feature.set("draft_layer_name", props.activeEditableLayerName ?? `layer-${props.activeEditableLayerId}`);
    }
    Array.from(new Set([...draftFields(), ...layerSchemaFields])).forEach((field) => {
      if (feature.get(field) === undefined) {
        feature.set(field, defaultValueForFieldType(fieldType(field)));
      }
    });
  }

  function setDraftFields(fields: string[]) {
    const nextFields = Array.from(new Set(fields.map((field) => field.trim()).filter(Boolean)));
    setDraftFieldsText(nextFields.join("\n"));
    setDraftFieldTypes((current) => {
      const next: Record<string, AttributeFieldType> = {};
      nextFields.forEach((field) => {
        next[field] = current[field] ?? "text";
      });
      return next;
    });
  }

  function setDraftFieldType(field: string, type: AttributeFieldType) {
    const normalizedField = field.trim();
    if (!normalizedField) {
      return;
    }
    rememberDraftState();
    setDraftFieldTypes((current) => ({ ...current, [normalizedField]: type }));
    draftSourceRef.current.getFeatures().forEach((feature) => {
      feature.set(normalizedField, coerceAttributeValue(String(feature.get(normalizedField) ?? ""), type));
    });
    setDraftStatus(`Тип поля «${normalizedField}» изменён.`);
    setDraftRevision((revision) => revision + 1);
  }

  function addDraftFieldWithType(fieldName: string, type: AttributeFieldType) {
    const field = fieldName.trim();
    if (!field) {
      return;
    }
    const currentFields = draftFields();
    rememberDraftState();
    if (!currentFields.includes(field)) {
      setDraftFields([...currentFields, field]);
    }
    setDraftFieldTypes((current) => ({ ...current, [field]: type }));
    draftSourceRef.current.getFeatures().forEach((feature) => {
      if (feature.get(field) === undefined) {
        feature.set(field, defaultValueForFieldType(type));
      }
    });
    setDraftStatus(`Поле «${field}» (${type}) добавлено в схему слоя.`);
    setDraftRevision((revision) => revision + 1);
  }

  function addDraftField() {
    const field = newDraftFieldName.trim();
    if (!field) {
      return;
    }
    if (draftFields().includes(field)) {
      setNewDraftFieldName("");
      return;
    }
    rememberDraftState();
    setDraftFields([...draftFields(), field]);
    draftSourceRef.current.getFeatures().forEach((feature) => {
      if (feature.get(field) === undefined) {
        feature.set(field, defaultValueForFieldType(fieldType(field)));
      }
    });
    setNewDraftFieldName("");
    setDraftStatus(`Поле «${field}» добавлено в схему слоя.`);
    setDraftRevision((revision) => revision + 1);
  }

  function addDraftFieldByName(fieldName: string) {
    const field = fieldName.trim();
    if (!field || draftFields().includes(field)) {
      return;
    }
    rememberDraftState();
    setDraftFields([...draftFields(), field]);
    draftSourceRef.current.getFeatures().forEach((feature) => {
      if (feature.get(field) === undefined) {
        feature.set(field, defaultValueForFieldType(fieldType(field)));
      }
    });
    setDraftStatus(`Поле «${field}» добавлено в схему слоя.`);
    setDraftRevision((revision) => revision + 1);
  }

  function removeDraftField(field: string) {
    rememberDraftState();
    setDraftFields(draftFields().filter((item) => item !== field));
    setDraftFieldTypes((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    draftSourceRef.current.getFeatures().forEach((feature) => {
      feature.unset(field);
    });
    setDraftStatus(`Поле «${field}» удалено из схемы слоя.`);
    setDraftRevision((revision) => revision + 1);
  }

  function applyDraftFieldsToFeatures() {
    rememberDraftState();
    draftSourceRef.current.getFeatures().forEach((feature) => applyDraftFieldsToFeature(feature));
    setDraftStatus(`Схема полей применена: ${draftFields().length} полей.`);
    setDraftRevision((revision) => revision + 1);
  }

  function importFeaturesToDraft(features: Feature<Geometry>[], sourceName: string) {
    if (features.length === 0) {
      return;
    }
    if (props.activeEditableLayerId === null) {
      setDraftStatus("Сначала включите редактирование слоя, куда нужно импортировать объекты.");
      return;
    }
    rememberDraftState();
    const importedFields = features.flatMap((feature) =>
      Object.keys(feature.getProperties()).filter((key) => key !== "geometry" && !key.startsWith("layer")),
    );
    const nextFields = Array.from(new Set([...draftFields(), ...importedFields]));
    setDraftFields(nextFields);
    features.forEach((feature) => {
      nextFields.forEach((field) => {
        if (feature.get(field) === undefined) {
          feature.set(field, "");
        }
      });
    });
    draftSourceRef.current.addFeatures(features);
    selectedDraftFeatureRef.current = features[0] ?? null;
    props.onDraftEditingEnabledChange(true);
    setDraftStatus(`Импортировано из «${sourceName}»: ${features.length} объектов.`);
    setDraftRevision((revision) => revision + 1);
  }

  function captureMapImageData(map: Map) {
    const size = map.getSize();
    if (!size) {
      throw new Error("Размер карты пока не определён.");
    }

    const mapCanvas = document.createElement("canvas");
    mapCanvas.width = size[0];
    mapCanvas.height = size[1];
    const mapContext = mapCanvas.getContext("2d");
    if (!mapContext) {
      throw new Error("Не удалось подготовить снимок карты.");
    }

    const canvases = map.getViewport().querySelectorAll<HTMLCanvasElement>(".ol-layer canvas, canvas.ol-layer");
    canvases.forEach((canvas) => {
      if (canvas.width === 0 || canvas.height === 0) {
        return;
      }
      const parent = canvas.parentElement as HTMLElement | null;
      const opacity = parent?.style.opacity || canvas.style.opacity;
      mapContext.globalAlpha = opacity ? Number(opacity) : 1;
      const transformValue = canvas.style.transform;
      const matrix = transformValue.match(/^matrix\(([^\)]*)\)$/)?.[1]
        .split(",")
        .map(Number);
      if (matrix && matrix.length === 6) {
        mapContext.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
      } else {
        mapContext.setTransform(1, 0, 0, 1, 0, 0);
      }
      mapContext.drawImage(canvas, 0, 0);
    });
    mapContext.setTransform(1, 0, 0, 1, 0, 0);
    mapContext.globalAlpha = 1;

    return {
      imageData: mapCanvas.toDataURL("image/png"),
      imageSize: size,
      imageExtent: map.getView().calculateExtent(size),
    };
  }

  async function captureCleanMapImageDataForAi(map: Map) {
    const hiddenLayers = [...vectorLayerRefs.current, draftLayerRef.current, aiSuggestionLayerRef.current].filter(
      (layer): layer is VectorLayer<VectorSource> | VectorImageLayer<VectorSource> => Boolean(layer),
    );
    const previousVisibility = hiddenLayers.map((layer) => layer.getVisible());
    hiddenLayers.forEach((layer) => layer.setVisible(false));

    try {
      await new Promise<void>((resolve) => {
        map.once("rendercomplete", () => resolve());
        map.renderSync();
      });
      return captureMapImageData(map);
    } finally {
      hiddenLayers.forEach((layer, index) => layer.setVisible(previousVisibility[index] ?? true));
      map.renderSync();
    }
  }

  async function requestAiSegmentBox(boxFeature: Feature<Geometry>) {
    const map = mapRef.current;
    const geometry = boxFeature.getGeometry();
    if (!map || !geometry) {
      return;
    }

    const size = map.getSize();
    if (!size) {
      setDraftStatus("AI-контур: карта ещё не готова.");
      return;
    }

    const extent = geometry.getExtent();
    const topLeft = map.getPixelFromCoordinate([extent[0], extent[3]]);
    const bottomRight = map.getPixelFromCoordinate([extent[2], extent[1]]);
    const bboxPixels = [
      Math.max(0, Math.min(topLeft[0], bottomRight[0])),
      Math.max(0, Math.min(topLeft[1], bottomRight[1])),
      Math.min(size[0], Math.max(topLeft[0], bottomRight[0])),
      Math.min(size[1], Math.max(topLeft[1], bottomRight[1])),
    ];

    if (bboxPixels[2] - bboxPixels[0] < 8 || bboxPixels[3] - bboxPixels[1] < 8) {
      setDraftStatus("AI-контур: выделенная рамка слишком маленькая.");
      return;
    }

    const previousEditMode = editModeRef.current;
    setLastAiRequest({ kind: "box", boxFeature });
    setIsAiSegmenting(true);
    setDraftStatus("AI-контур: отправляю фрагмент карты в сервис...");
    try {
      const capture = await captureCleanMapImageDataForAi(map);
      const result = await storedAuthFetchJson<AiSegmentBoxResponse>("/map-assistant/segment-box", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: props.assignmentId,
          image_data: capture.imageData,
          image_size: capture.imageSize.map((value) => Math.round(value)),
          image_extent: capture.imageExtent,
          bbox_pixels: bboxPixels,
          target_layer_name: props.activeEditableLayerName,
          target_semantic_type: aiTargetSemanticType(),
          target_geometry_type: "polygon",
        }),
      });
      if (result.status !== "passed") {
        clearAiSuggestion();
        setDraftStatus(`AI-контур не добавлен: ${result.message} Confidence: ${Math.round(result.confidence * 100)}%.`);
        return;
      }

      const feature = new GeoJSON().readFeature(
        {
          type: "Feature",
          geometry: result.geometry,
          properties: {
            source: "ai_digitizer",
            confidence: result.confidence,
          },
        },
        {
          dataProjection: mapProjection,
          featureProjection: mapProjection,
        },
      ) as Feature<Geometry>;
      applyDraftFieldsToFeature(feature);
      rememberDraftState();
      draftSourceRef.current.addFeature(feature);
      selectedDraftFeatureRef.current = feature;
      props.onDraftEditingEnabledChange(true);
      setDraftRevision((revision) => revision + 1);
      setDraftStatus(`AI-контур добавлен: ${result.message} Confidence: ${Math.round(result.confidence * 100)}%.`);
    } catch (error) {
      setDraftStatus(error instanceof Error ? `AI-контур: ${error.message}` : "AI-контур не удалось построить.");
    } finally {
      setIsAiSegmenting(false);
      setEditMode(previousEditMode);
    }
  }

  function selectedDraftTargetGeometryType(geometry: Geometry) {
    const geometryType = geometry.getType().toLowerCase();
    if (geometryType.includes("line")) {
      return "line";
    }
    if (geometryType.includes("point")) {
      return "point";
    }
    return "polygon";
  }

  function aiTargetSemanticType(): AiTargetSemanticType | undefined {
    const layerName = (props.activeEditableLayerName ?? "").toLowerCase();
    if (/(hydro|water|river|lake|pond|reservoir|гидр|вод|рек|озер|озёр|пруд)/i.test(layerName)) {
      return "water";
    }
    if (/(forest|wood|woods|tree|trees|vegetation|landuse_forest|natural_wood|les|лес|леса|лесн|древ|растит)/i.test(layerName)) {
      return "forest";
    }
    return undefined;
  }

  function paddedPixelBboxForGeometry(map: Map, geometry: Geometry, size: number[]) {
    const extent = geometry.getExtent();
    const topLeft = map.getPixelFromCoordinate([extent[0], extent[3]]);
    const bottomRight = map.getPixelFromCoordinate([extent[2], extent[1]]);
    const left = Math.min(topLeft[0], bottomRight[0]);
    const right = Math.max(topLeft[0], bottomRight[0]);
    const top = Math.min(topLeft[1], bottomRight[1]);
    const bottom = Math.max(topLeft[1], bottomRight[1]);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const padding = Math.max(40, Math.min(180, Math.max(width, height) * 0.8));
    return [
      Math.max(0, left - padding),
      Math.max(0, top - padding),
      Math.min(size[0], right + padding),
      Math.min(size[1], bottom + padding),
    ];
  }

  async function continueSelectedDraftFeatureWithAi() {
    const map = mapRef.current;
    const selectedFeature = selectedDraftFeatureRef.current;
    const geometry = selectedFeature?.getGeometry();
    if (!map || !selectedFeature || !geometry) {
      setDraftStatus("AI-продолжение: выберите черновой объект на карте.");
      return;
    }
    if (selectedFeature.get("draft_layer_asset_id") !== props.activeEditableLayerId) {
      setDraftStatus("AI-продолжение: выбранный объект относится к другому слою.");
      return;
    }

    const targetGeometryType = selectedDraftTargetGeometryType(geometry);
    if (targetGeometryType !== "polygon") {
      setDraftStatus("AI-продолжение сейчас работает для полигонов. Линии добавим отдельным режимом для дорог.");
      return;
    }

    const size = map.getSize();
    if (!size) {
      setDraftStatus("AI-продолжение: карта ещё не готова.");
      return;
    }

    const bboxPixels = paddedPixelBboxForGeometry(map, geometry, size);
    if (bboxPixels[2] - bboxPixels[0] < 8 || bboxPixels[3] - bboxPixels[1] < 8) {
      setDraftStatus("AI-продолжение: объект слишком маленький для анализа.");
      return;
    }

    const previousEditMode = editModeRef.current;
    setLastAiRequest({ kind: "continue", targetFeature: selectedFeature });
    setIsAiSegmenting(true);
    setDraftStatus("AI-продолжение: анализирую выбранный объект...");
    try {
      const capture = await captureCleanMapImageDataForAi(map);
      const promptGeometry = new GeoJSON().writeGeometryObject(geometry, {
        dataProjection: mapProjection,
        featureProjection: mapProjection,
      });
      const result = await storedAuthFetchJson<AiSegmentBoxResponse>("/map-assistant/segment-box", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: props.assignmentId,
          image_data: capture.imageData,
          image_size: capture.imageSize.map((value) => Math.round(value)),
          image_extent: capture.imageExtent,
          bbox_pixels: bboxPixels,
          prompt_geometry: promptGeometry,
          target_layer_name: props.activeEditableLayerName,
          target_semantic_type: aiTargetSemanticType(),
          target_geometry_type: targetGeometryType,
        }),
      });
      if (result.status !== "passed") {
        clearAiSuggestion();
        setDraftStatus(`AI не смог надежно улучшить контур: ${result.message} Confidence: ${Math.round(result.confidence * 100)}%.`);
        return;
      }

      const suggestedFeature = new GeoJSON().readFeature(
        {
          type: "Feature",
          geometry: result.geometry,
          properties: {},
        },
        {
          dataProjection: mapProjection,
          featureProjection: mapProjection,
        },
      ) as Feature<Geometry>;
      const suggestedGeometry = suggestedFeature.getGeometry();
      if (!suggestedGeometry) {
        throw new Error("Сервис не вернул геометрию.");
      }

      suggestedFeature.set("source", "ai_digitizer");
      suggestedFeature.set("confidence", result.confidence);
      applyDraftFieldsToFeature(suggestedFeature);
      aiSuggestionSourceRef.current.clear();
      aiSuggestionSourceRef.current.addFeature(suggestedFeature);
      setAiSuggestion({
        feature: suggestedFeature,
        targetFeature: selectedFeature,
        confidence: result.confidence,
        message: result.message,
      });
      setDraftRevision((revision) => revision + 1);
      setDraftStatus(`AI предложил контур. Проверьте его и примите, добавьте как новый объект или отклоните.`);
    } catch (error) {
      setDraftStatus(error instanceof Error ? `AI-продолжение: ${error.message}` : "AI-продолжение не удалось построить.");
    } finally {
      setIsAiSegmenting(false);
      setEditMode(previousEditMode);
    }
  }

  async function regenerateAiSuggestion() {
    if (!lastAiRequest || isAiSegmenting) {
      return;
    }
    setDraftStatus("AI: запрашиваю новый вариант...");
    if (lastAiRequest.kind === "box") {
      await requestAiSegmentBox(lastAiRequest.boxFeature);
    } else {
      selectedDraftFeatureRef.current = lastAiRequest.targetFeature;
      await continueSelectedDraftFeatureWithAi();
    }
  }

  function acceptAiSuggestion() {
    if (!aiSuggestion) {
      return;
    }
    const suggestedGeometry = aiSuggestion.feature.getGeometry()?.clone();
    if (!suggestedGeometry) {
      clearAiSuggestion();
      return;
    }
    rememberDraftState();
    aiSuggestion.targetFeature.setGeometry(suggestedGeometry);
    aiSuggestion.targetFeature.set("source", "ai_digitizer");
    aiSuggestion.targetFeature.set("confidence", aiSuggestion.confidence);
    aiSuggestion.targetFeature.set("ai_suggestion_accepted", true);
    applyDraftFieldsToFeature(aiSuggestion.targetFeature);
    selectedDraftFeatureRef.current = aiSuggestion.targetFeature;
    props.onDraftEditingEnabledChange(true);
    clearAiSuggestion();
    setDraftRevision((revision) => revision + 1);
    setDraftStatus(`AI-предложение принято в слой "${props.activeEditableLayerName ?? draftName}".`);
  }

  function addAiSuggestionAsNewFeature() {
    if (!aiSuggestion) {
      return;
    }
    const suggestedFeature = aiSuggestion.feature.clone() as Feature<Geometry>;
    rememberDraftState();
    suggestedFeature.set("source", "ai_digitizer");
    suggestedFeature.set("confidence", aiSuggestion.confidence);
    suggestedFeature.set("ai_suggestion_accepted", true);
    applyDraftFieldsToFeature(suggestedFeature);
    draftSourceRef.current.addFeature(suggestedFeature);
    selectedDraftFeatureRef.current = suggestedFeature;
    props.onDraftEditingEnabledChange(true);
    clearAiSuggestion();
    setDraftRevision((revision) => revision + 1);
    setDraftStatus(`AI-предложение добавлено в слой "${props.activeEditableLayerName ?? draftName}".`);
  }

  function rejectAiSuggestion() {
    clearAiSuggestion();
    setDraftRevision((revision) => revision + 1);
    setDraftStatus("AI-предложение отклонено.");
  }

  function importSelectedObjectToDraft() {
    if (!selectedGeoJsonFeature || !selectedLayer) {
      return;
    }
    const feature = new GeoJSON().readFeature(selectedGeoJsonFeature, {
      dataProjection: "EPSG:4326",
      featureProjection: mapProjection,
    }) as Feature<Geometry>;
    importFeaturesToDraft([feature], `${layerDisplayName(selectedLayer.asset.asset_name)} / объект`);
  }

  function importSelectedLayerToDraft() {
    if (!selectedLayer) {
      return;
    }
    const features = new GeoJSON().readFeatures(selectedLayer.preview.geojson, {
      dataProjection: "EPSG:4326",
      featureProjection: mapProjection,
    }) as Feature<Geometry>[];
    importFeaturesToDraft(features, layerDisplayName(selectedLayer.asset.asset_name));
    if (selectedLayer.preview.truncated) {
      setDraftStatus(
        `Импортирован preview слоя «${layerDisplayName(selectedLayer.asset.asset_name)}»: ${features.length}/${selectedLayer.preview.feature_count} объектов.`,
      );
    }
  }

  function deleteSelectedDraftFeature() {
    const selectedFeature = selectedDraftFeatureRef.current;
    if (!selectedFeature) {
      return;
    }
    if (selectedFeature.get("draft_layer_asset_id") !== props.activeEditableLayerId) {
      setDraftStatus("Выбранный объект относится к другому слою. Включите редактирование нужного слоя.");
      return;
    }
    rememberDraftState();
    draftSourceRef.current.removeFeature(selectedFeature);
    selectedDraftFeatureRef.current = null;
    setDraftRevision((value) => value + 1);
  }

  function clearAllSelection() {
    // Снимает выделение и с черновых, и с исходных объектов (как клик по пустому).
    if (selectedDraftFeatureRef.current) {
      const previousFeature = selectedDraftFeatureRef.current;
      selectedDraftFeatureRef.current = null;
      previousFeature.changed();
      setDraftRevision((value) => value + 1);
    }
    draftLayerRef.current?.changed();
    setSelectedFeatureKeys(new Set());
    props.onFeatureSelect(null);
  }

  keyboardActionsRef.current.deleteSelected = deleteSelectedDraftFeature;
  keyboardActionsRef.current.clearSelection = clearAllSelection;

  function clearDraftLayer() {
    const featuresToRemove =
      props.activeEditableLayerId === null
        ? []
        : draftSourceRef.current
            .getFeatures()
            .filter((feature) => feature.get("draft_layer_asset_id") === props.activeEditableLayerId);
    if (featuresToRemove.length > 0) {
      rememberDraftState();
    }
    featuresToRemove.forEach((feature) => draftSourceRef.current.removeFeature(feature));
    if (
      selectedDraftFeatureRef.current &&
      selectedDraftFeatureRef.current.get("draft_layer_asset_id") === props.activeEditableLayerId
    ) {
      selectedDraftFeatureRef.current = null;
    }
    setIsDraftTableOpen(false);
    setDraftRevision((value) => value + 1);
    setDraftStatus(
      props.activeEditableLayerName
        ? `Очищены черновые объекты слоя «${props.activeEditableLayerName}».`
        : "Выберите редактируемый слой перед очисткой.",
    );
  }

  function updateSelectedDraftAttribute(key: string, value: string) {
    const normalizedKey = key.trim();
    if (!selectedDraftFeature || !normalizedKey) {
      return;
    }
    rememberDraftState();
    selectedDraftFeature.set(normalizedKey, coerceAttributeValue(value, fieldType(normalizedKey)));
    setAttributeKey("");
    setAttributeValue("");
    setDraftRevision((revision) => revision + 1);
  }

  function removeSelectedDraftAttribute(key: string) {
    if (!selectedDraftFeature) {
      return;
    }
    rememberDraftState();
    selectedDraftFeature.unset(key);
    setDraftRevision((revision) => revision + 1);
  }

  function selectDraftFeatureByIndex(index: number) {
    const feature = draftSourceRef.current.getFeatures()[index];
    if (!feature) {
      return;
    }
    const previousFeature = selectedDraftFeatureRef.current;
    justDrawnDraftFeaturesRef.current.delete(feature);
    selectedDraftFeatureRef.current = feature;
    previousFeature?.changed();
    feature.changed();
    draftLayerRef.current?.changed();
    setDraftRevision((revision) => revision + 1);
  }

  function updateDraftFeatureAttribute(index: number, key: string, value: string) {
    const feature = draftSourceRef.current.getFeatures()[index];
    if (!feature || !key.trim()) {
      return;
    }
    rememberDraftState();
    feature.set(key.trim(), coerceAttributeValue(value, fieldType(key.trim())));
    selectedDraftFeatureRef.current = feature;
    setDraftRevision((revision) => revision + 1);
  }

  function selectDraftFeature(feature: Feature<Geometry>) {
    const previousFeature = selectedDraftFeatureRef.current;
    justDrawnDraftFeaturesRef.current.delete(feature);
    selectedDraftFeatureRef.current = feature;
    props.onFeatureSelect(null);
    previousFeature?.changed();
    feature.changed();
    draftLayerRef.current?.changed();
    setDraftRevision((revision) => revision + 1);
  }

  function updateDraftFeatureObjectAttribute(feature: Feature<Geometry>, key: string, value: string) {
    if (!feature || !key.trim()) {
      return;
    }
    rememberDraftState();
    feature.set(key.trim(), coerceAttributeValue(value, fieldType(key.trim())));
    selectedDraftFeatureRef.current = feature;
    setDraftRevision((revision) => revision + 1);
  }

  function addTableLayerAttributeField(assetId: number, field: string) {
    const normalizedField = field.trim();
    if (!normalizedField) {
      return;
    }
    const layerDraftFeatures = draftSourceRef.current
      .getFeatures()
      .filter((feature) => feature.get("draft_layer_asset_id") === assetId);
    if (layerDraftFeatures.length > 0) {
      rememberDraftState();
      layerDraftFeatures.forEach((feature) => {
        if (feature.get(normalizedField) === undefined) {
          feature.set(normalizedField, "");
        }
      });
      setDraftRevision((revision) => revision + 1);
    }
    props.onLayerAttributeFieldAdd(assetId, normalizedField);
  }

  function removeTableLayerAttributeField(assetId: number, field: string) {
    const normalizedField = field.trim();
    if (!normalizedField) {
      return;
    }
    const layerDraftFeatures = draftSourceRef.current
      .getFeatures()
      .filter((feature) => feature.get("draft_layer_asset_id") === assetId);
    if (layerDraftFeatures.length > 0) {
      rememberDraftState();
      layerDraftFeatures.forEach((feature) => feature.unset(normalizedField));
      setDraftRevision((revision) => revision + 1);
    }
    props.onLayerAttributeFieldRemove(assetId, normalizedField);
  }

  function setMapZoomLevel(nextZoom: number) {
    const normalizedZoom = Math.min(22, Math.max(1, nextZoom));
    mapRef.current?.getView().animate({ zoom: normalizedZoom, duration: 140 });
    const center = mapRef.current?.getView().getCenter() ?? mapViewStateRef.current?.center ?? [0, 0];
    mapViewStateRef.current = { center: [...center], zoom: normalizedZoom, projection: mapProjection };
    setMapZoom(normalizedZoom);
    setMapScaleText(formatMapScale(normalizedZoom));
  }

  function applyMapScaleText() {
    const denominator = parseMapScale(mapScaleText);
    if (!denominator) {
      setMapScaleText(formatMapScale(mapZoom));
      return;
    }
    setMapZoomLevel(scaleDenominatorToZoom(denominator));
  }

  function toggleSnapSetting(key: keyof Pick<SnapSettings, "point" | "endpoint" | "vertex" | "edge">) {
    setSnapSettings((current) => ({ ...current, [key]: !current[key] }));
  }

  function zoomToSelectedObject(selection?: ZoomSelectionTarget) {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    let extent: number[] | null = null;
    const mergeExtent = (featureExtent?: number[]) => {
      if (!featureExtent?.every(Number.isFinite)) {
        return;
      }
      extent = extent
        ? [
            Math.min(extent[0], featureExtent[0]),
            Math.min(extent[1], featureExtent[1]),
            Math.max(extent[2], featureExtent[2]),
            Math.max(extent[3], featureExtent[3]),
          ]
        : [...featureExtent];
    };
    const mergeSourceFeature = (assetId: number, featureIndex: number) => {
      const renderedFeature = vectorLayerRefs.current
        .flatMap((layer) => layer.getSource()?.getFeatures() ?? [])
        .find(
          (feature) =>
            Number(feature.get("layerAssetId")) === assetId &&
            Number(feature.get("featureIndex")) === featureIndex,
        );
      const renderedExtent = renderedFeature?.getGeometry()?.getExtent();
      if (renderedExtent?.every(Number.isFinite)) {
        mergeExtent(renderedExtent);
        return;
      }

      const layer = props.layers.find((item) => item.asset.id === assetId);
      const geojsonFeature = layer?.preview.geojson.features[featureIndex];
      if (!geojsonFeature) {
        return;
      }
      const feature = new GeoJSON().readFeature(geojsonFeature, {
        dataProjection: "EPSG:4326",
        featureProjection: mapProjection,
      }) as Feature<Geometry>;
      mergeExtent(feature.getGeometry()?.getExtent());
    };

    const sourceKeys = selection?.sourceKeys ?? (selectedFeatureKeysRef.current.size > 0 ? selectedFeatureKeysRef.current : selectedFeatureKeys);
    sourceKeys.forEach((key) => {
      const [assetIdText, featureIndexText] = key.split(":");
      const assetId = Number(assetIdText);
      const featureIndex = Number(featureIndexText);
      if (Number.isFinite(assetId) && Number.isFinite(featureIndex)) {
        mergeSourceFeature(assetId, featureIndex);
      }
    });

    const singleSourceFeature = selection && "sourceFeature" in selection ? selection.sourceFeature : selectedFeatureRef.current ?? props.selectedFeature;
    if (sourceKeys.size === 0 && singleSourceFeature) {
      mergeSourceFeature(singleSourceFeature.assetId, singleSourceFeature.featureIndex);
    }

    const draftFeaturesToZoom = selection?.draftFeatures ?? (selectedDraftFeatureRef.current ? [selectedDraftFeatureRef.current] : []);
    draftFeaturesToZoom.forEach((feature) => mergeExtent(feature.getGeometry()?.getExtent()));

    if (!extent) {
      return;
    }

    if (extent[0] === extent[2] && extent[1] === extent[3]) {
      const padding = mapProjection === "EPSG:4326" ? 0.0005 : 60;
      extent = [extent[0] - padding, extent[1] - padding, extent[2] + padding, extent[3] + padding];
    }

    map.getView().fit(extent, {
      padding: [70, 70, 70, 70],
      maxZoom: 18,
      duration: 220,
    });
  }
  // Полный охват: вписываем в экран все объекты слоёв + черновика по центру.
  // Сырой bbox может «раздуться» на весь мир, если в слое есть геометрия,
  // обёрнутая через 180-й меридиан (Чукотка единым мультиполигоном даёт bbox
  // от −180° до +180°). Поэтому итог ОБРЕЗАЕМ рамкой России в текущей СК: для
  // обычных данных (⊂ России) обрезка ничего не меняет — вид остаётся тесным;
  // для «всемирного» bbox он схлопывается до России. Та же рамка у блокировки «РФ».
  function zoomToFullExtent() {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const extent = [Infinity, Infinity, -Infinity, -Infinity];
    const merge = (geomExtent?: number[] | null) => {
      if (!geomExtent?.every(Number.isFinite)) {
        return;
      }
      extent[0] = Math.min(extent[0], geomExtent[0]);
      extent[1] = Math.min(extent[1], geomExtent[1]);
      extent[2] = Math.max(extent[2], geomExtent[2]);
      extent[3] = Math.max(extent[3], geomExtent[3]);
    };
    mapLayerSourcesRef.current.forEach((source) => merge(source.getExtent()));
    draftSourceRef.current
      .getFeatures()
      .forEach((feature) => merge(feature.getGeometry()?.getExtent()));
    if (!Number.isFinite(extent[0])) {
      return;
    }

    let fitExtent = extent;
    const russia = russiaFitExtentForProjection(mapProjection);
    if (russia?.every(Number.isFinite)) {
      const clamped = [
        Math.max(extent[0], russia[0]),
        Math.max(extent[1], russia[1]),
        Math.min(extent[2], russia[2]),
        Math.min(extent[3], russia[3]),
      ];
      if (clamped[0] < clamped[2] && clamped[1] < clamped[3]) {
        fitExtent = clamped;
      }
    }

    if (fitExtent[0] === fitExtent[2] && fitExtent[1] === fitExtent[3]) {
      const padding = mapProjection === "EPSG:4326" ? 0.0005 : 60;
      fitExtent = [fitExtent[0] - padding, fitExtent[1] - padding, fitExtent[2] + padding, fitExtent[3] + padding];
    }

    map.getView().fit(fitExtent, {
      padding: [40, 40, 40, 40],
      maxZoom: 12,
      duration: 220,
    });
  }
  function buildCompleteDraftFeatures() {
    const geoJsonFormat = new GeoJSON();
    const baseFeatures = props.layers.flatMap((layer) => {
      const features = geoJsonFormat.readFeatures(layer.preview.geojson, {
        dataProjection: "EPSG:4326",
        featureProjection: mapProjection,
      }) as Feature<Geometry>[];
      features.forEach((feature) => {
        feature.set("source_layer_id", layer.asset.id);
        feature.set("source_layer_name", layerDisplayName(layer.asset.asset_name));
        feature.set("draft_feature", false);
      });
      return features;
    });
    const draftFeaturesForExport = draftSourceRef.current
      .getFeatures()
      .map((feature) => feature.clone() as Feature<Geometry>);
    draftFeaturesForExport.forEach((feature) => {
      applyDraftFieldsToFeature(feature);
      feature.set("draft_feature", true);
    });
    return [...baseFeatures, ...draftFeaturesForExport];
  }

  function buildDraftGeoJsonObject() {
    const features = buildCompleteDraftFeatures();
    const styleManifest = buildLayerStyleManifest();
    const geojson = new GeoJSON().writeFeaturesObject(features, {
      dataProjection: "EPSG:4326",
      featureProjection: mapProjection,
    }) as { type: "FeatureCollection"; features: GeoJsonFeature[] };
    return {
      ...geojson,
      properties: {
        layer_name: draftName,
        geometry_type: draftGeometryType,
        assigned_crs: draftCrs.trim() || "EPSG:4326",
        active_layer_id: props.activeEditableLayerId,
        active_layer_name: props.activeEditableLayerName,
        includes_base_layers: true,
        source_layer_count: props.layers.length,
        draft_feature_count: draftSourceRef.current.getFeatures().length,
        style_manifest: styleManifest,
        fields: draftFields(),
        field_types: draftFieldTypes,
        style: {
          color: draftColor,
          fill_opacity: draftFillOpacity,
        },
      },
    };
  }

  function buildLayerStyleManifest() {
    return {
      version: 1,
      layers: props.layers.map((layer, index) => {
        const alias = props.layerAliases[layer.asset.id] || layerDisplayName(layer.asset.asset_name);
        return {
          source_layer_id: layer.asset.id,
          source_layer_name: layerDisplayName(layer.asset.asset_name),
          asset_name: layer.asset.asset_name,
          alias,
          group_name: props.layerGroups?.[layer.asset.id] ?? null,
          style: normalizeLayerStyle(props.layerStyles[layer.asset.id], index),
        };
      }),
    };
  }

  function restoreMissingDraftLayersFromGeoJson(
    geojson: { type: "FeatureCollection"; features: GeoJsonFeature[]; properties?: Record<string, any> },
  ) {
    if (!props.onRestoreDraftLayers) {
      return;
    }

    const loadedLayerIds = new Set(props.layers.map((layer) => layer.asset.id));
    const styleManifest = geojson.properties?.style_manifest;
    const styleLayers = Array.isArray(styleManifest?.layers) ? styleManifest.layers : [];
    const fields = Array.isArray(geojson.properties?.fields)
      ? geojson.properties.fields.filter((field: unknown) => typeof field === "string")
      : [];
    const fieldTypes =
      typeof geojson.properties?.field_types === "object" && geojson.properties?.field_types
        ? geojson.properties.field_types
        : {};
    const restoredLayers: RestoredDraftLayer[] = [];
    const restoredIds = new Set<number>();

    geojson.features.forEach((feature) => {
      const properties = feature.properties ?? {};
      const layerAssetId = Number(properties.draft_layer_asset_id);
      if (!Number.isFinite(layerAssetId) || loadedLayerIds.has(layerAssetId) || restoredIds.has(layerAssetId)) {
        return;
      }
      const layerName =
        typeof properties.draft_layer_name === "string" && properties.draft_layer_name.trim()
          ? properties.draft_layer_name.trim()
          : `layer-${layerAssetId}`;
      const manifestLayer =
        styleLayers.find((layer: any) => Number(layer?.source_layer_id) === layerAssetId) ??
        styleLayers.find((layer: any) => layer?.source_layer_name === layerName || layer?.alias === layerName);
      restoredIds.add(layerAssetId);
      restoredLayers.push({
        assetId: layerAssetId,
        name: layerName,
        groupName: manifestLayer?.group_name ?? null,
        style: manifestLayer?.style ?? null,
        fields,
        fieldTypes,
        geometryType: geojson.properties?.geometry_type ?? null,
        crs: geojson.properties?.assigned_crs ?? null,
      });
    });

    if (restoredLayers.length > 0) {
      props.onRestoreDraftLayers(restoredLayers);
    }
  }

  async function exportShapefileArchive() {
    if (!props.assignmentId) {
      setDraftStatus("Нельзя экспортировать архив: assignment_id неизвестен.");
      return;
    }
    const geojson = buildDraftGeoJsonObject();
    if (geojson.features.length === 0) {
      setDraftStatus("Нечего экспортировать: на карте нет объектов.");
      return;
    }

    setIsDraftBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/map-drafts/export-shapefile-archive`, {
        method: "POST",
        headers: {
          ...storedAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assignment_id: props.assignmentId,
          name: draftName.trim() || "draft-layers",
          geojson,
          style_manifest: buildLayerStyleManifest(),
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Экспорт архива вернул ${response.status}: ${text}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draftName.trim() || "draft-layers"}_archive.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setDraftStatus(`Архив работы экспортирован: ${geojson.features.length} объектов.`);
    } catch (error) {
      setDraftStatus(error instanceof Error ? error.message : "Не удалось экспортировать архив работы.");
    } finally {
      setIsDraftBusy(false);
    }
  }

  async function exportMapPng() {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    try {
      setDraftStatus("Готовлю PNG текущей карты...");
      await new Promise<void>((resolve) => {
        map.once("rendercomplete", () => resolve());
        map.renderSync();
      });
      const capture = captureMapImageData(map);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = capture.imageData;
      link.download = `gis-map-${timestamp}.png`;
      link.click();
      setDraftStatus("PNG карты экспортирован.");
    } catch (error) {
      setDraftStatus(error instanceof Error ? `Не удалось экспортировать PNG: ${error.message}` : "Не удалось экспортировать PNG.");
    }
  }

    function detectDraftGeometryType() {
    const geometryTypes = new Set(
      draftSourceRef.current
        .getFeatures()
        .map((feature) => feature.getGeometry()?.getType())
        .filter(Boolean),
    );
    if (geometryTypes.size === 0) {
      return "mixed";
    }
    if (geometryTypes.size === 1) {
      return Array.from(geometryTypes)[0] ?? "mixed";
    }
    return "mixed";
  }

  async function loadLatestDraft() {
    if (!props.assignmentId) {
      setDraftStatus("Нельзя загрузить черновик: assignment_id неизвестен.");
      return;
    }

    setIsDraftBusy(true);
    try {
      const drafts = await storedAuthFetchJson<MapDraft[]>(
        `/map-drafts/?assignment_id=${props.assignmentId}&include_geojson=true`,
      );
      const draft = drafts[0];
      if (!draft?.geojson) {
        setDraftStatus("Сохранённых черновиков для этого задания пока нет.");
        return;
      }

      restoreMissingDraftLayersFromGeoJson(draft.geojson);
      const loadedFeatures = new GeoJSON().readFeatures(draft.geojson, {
        dataProjection: "EPSG:4326",
        featureProjection: mapProjection,
      });
      const features = draft.geojson.properties?.includes_base_layers
        ? loadedFeatures.filter((feature) => feature.get("draft_feature") === true || feature.get("draft_layer_asset_id"))
        : loadedFeatures;
      pruneBlankLegacyDraftFields(features);
      const loadedFields = visibleDraftSchemaFieldsForFeatures(draft.geojson.properties?.fields ?? [], features);
      const loadedFieldTypes = Object.fromEntries(
        Object.entries(draft.geojson.properties?.field_types ?? {}).filter(([field]) => loadedFields.includes(field)),
      );
      draftSourceRef.current.clear();
      draftSourceRef.current.addFeatures(features);
      selectedDraftFeatureRef.current = null;
      clearDraftHistory();
      setDraftId(draft.id);
      setDraftName(draft.geojson.properties?.layer_name || draft.name);
      setDraftGeometryType(draft.geojson.properties?.geometry_type || draft.geometry_type || "mixed");
      setDraftCrs(draft.geojson.properties?.assigned_crs || "EPSG:4326");
      setDraftFieldsText(loadedFields.join("\n"));
      setDraftFieldTypes(loadedFieldTypes);
      setDraftColor(draft.geojson.properties?.style?.color || "#d83f3f");
      setDraftFillOpacity(draft.geojson.properties?.style?.fill_opacity ?? 0.2);
      setDraftRevision((value) => value + 1);
      setDraftStatus(`Черновик #${draft.id} загружен: ${draft.feature_count} объектов.`);
    } catch (error) {
      setDraftStatus(error instanceof Error ? error.message : "Не удалось загрузить черновик.");
    } finally {
      setIsDraftBusy(false);
    }
  }

  useEffect(() => {
    if ((!props.autoLoadDraft && !canPersistDraft) || autoLoadedDraftRef.current || !props.assignmentId) {
      return;
    }
    autoLoadedDraftRef.current = true;
    void loadLatestDraft();
  }, [props.autoLoadDraft, props.assignmentId, canPersistDraft]);

  async function saveDraftLayer() {
    if (!props.assignmentId) {
      setDraftStatus("Нельзя сохранить: assignment_id неизвестен.");
      return null;
    }
    if (draftFeatureCount === 0) {
      setDraftStatus("Нечего сохранять: в черновике нет объектов.");
      return null;
    }

    setIsDraftBusy(true);
    try {
      const payload = {
        assignment_id: props.assignmentId,
        name: draftName.trim() || "draft-layer",
        geometry_type: draftGeometryType === "mixed" ? detectDraftGeometryType() : draftGeometryType,
        geojson: buildDraftGeoJsonObject(),
      };
      const draft = draftId
        ? await storedAuthFetchJson<MapDraft>(`/map-drafts/${draftId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await storedAuthFetchJson<MapDraft>("/map-drafts/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      setDraftId(draft.id);
      setDraftStatus(`Черновик #${draft.id} сохранён: ${draft.feature_count} объектов.`);
      return draft;
    } catch (error) {
      setDraftStatus(error instanceof Error ? error.message : "Не удалось сохранить черновик.");
      return null;
    } finally {
      setIsDraftBusy(false);
    }
  }

  // Завершение редактирования (тумблер «Редактировать» нажат повторно):
  // режим редактирования вкл→выкл → автосохранение черновика.
  useEffect(() => {
    const wasEditing = wasDraftEditingRef.current;
    wasDraftEditingRef.current = props.isDraftEditingEnabled;
    if (wasEditing && !props.isDraftEditingEnabled && canPersistDraft) {
      void saveDraftLayer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isDraftEditingEnabled]);

  async function submitDraftLayer() {
    const draft = await saveDraftLayer();
    if (!draft) {
      return;
    }

    setIsDraftBusy(true);
    try {
      const hadReport = Boolean(submitReportFile);
      const formData = new FormData();
      if (submitReportFile) {
        formData.append("report", submitReportFile);
      }
      const submission = await storedAuthFetchJson<Submission>(`/map-drafts/${draft.id}/submit`, {
        method: "POST",
        body: formData,
      });
      setSubmitReportFile(null);
      setDraftStatus(
        hadReport
          ? `Черновик и отчёт сданы как submission #${submission.id}.`
          : `Черновик сдан как submission #${submission.id}.`,
      );
      await props.onDraftSubmitted?.(submission);
    } catch (error) {
      setDraftStatus(error instanceof Error ? error.message : "Не удалось сдать черновик.");
    } finally {
      setIsDraftBusy(false);
    }
  }

  useEffect(() => {
    if (!tableDragOffset) {
      return;
    }
    const activeDragOffset = tableDragOffset;
    const draggedEl = draggedWindowElRef.current;
    let latest = tableWindowPosition;

    function handlePointerMove(event: PointerEvent) {
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!panelRect) {
        return;
      }
      const maxX = Math.max(8, panelRect.width - 320);
      const maxY = Math.max(8, panelRect.height - 180);
      const nextX = Math.min(Math.max(8, event.clientX - panelRect.left - activeDragOffset.x), maxX);
      const nextY = Math.min(Math.max(54, event.clientY - panelRect.top - activeDragOffset.y), maxY);
      latest = { x: nextX, y: nextY };
      // Двигаем окно напрямую — без setState, иначе на каждый pointermove
      // ререндерится вся панель с таблицей (тормоза до 3 fps).
      if (draggedEl) {
        draggedEl.style.left = `${nextX}px`;
        draggedEl.style.top = `${nextY}px`;
      } else {
        setTableWindowPosition(latest);
      }
    }

    function handlePointerUp() {
      setTableWindowPosition(latest);
      draggedWindowElRef.current = null;
      setTableDragOffset(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [tableDragOffset]);

  useEffect(() => {
    if (!draftPropertiesDragOffset) {
      return;
    }
    const activeDragOffset = draftPropertiesDragOffset;
    const draggedEl = draggedWindowElRef.current;
    let latest = draftPropertiesPosition;

    function handlePointerMove(event: PointerEvent) {
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!panelRect) {
        return;
      }
      const maxX = Math.max(8, panelRect.width - 360);
      const maxY = Math.max(8, panelRect.height - 220);
      const nextX = Math.min(Math.max(8, event.clientX - panelRect.left - activeDragOffset.x), maxX);
      const nextY = Math.min(Math.max(54, event.clientY - panelRect.top - activeDragOffset.y), maxY);
      latest = { x: nextX, y: nextY };
      if (draggedEl) {
        draggedEl.style.left = `${nextX}px`;
        draggedEl.style.top = `${nextY}px`;
      } else {
        setDraftPropertiesPosition(latest);
      }
    }

    function handlePointerUp() {
      setDraftPropertiesPosition(latest);
      draggedWindowElRef.current = null;
      setDraftPropertiesDragOffset(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draftPropertiesDragOffset]);

  useEffect(() => {
    if (!mapElementRef.current) {
      return;
    }

    vectorLayerRefs.current = [];
    const mapLayers = visibleLayers
      .slice()
      .reverse()
      .map((layer, index) => {
        const layerAssetId = layer.asset.id;
        const geoJsonFormat = new GeoJSON();
        const renderedFeatures = layer.preview.geojson.features.flatMap((geojsonFeature, featureIndex) => {
          if (!geojsonFeature.geometry) {
            return [];
          }
          const featureForMap = geoJsonFeatureForMap(geojsonFeature);
          const features = geoJsonFormat.readFeatures(
            { type: "FeatureCollection", features: [featureForMap] },
            {
              dataProjection: "EPSG:4326",
              featureProjection: mapProjection,
            },
          ) as Feature<Geometry>[];
          features.forEach((feature) => {
            feature.set("layerAssetId", layer.asset.id);
            feature.set("featureIndex", featureIndex);
          });
          return features;
        });
        const vectorSource = new VectorSource({
          features: renderedFeatures,
        });
        const vectorLayer = new VectorImageLayer({
          source: vectorSource,
          style: (feature) => {
            const sourceStyle = layerStylesRef.current[layerAssetId];
            const cache = normalizedLayerStyleCacheRef.current;
            let entry = cache[layerAssetId];
            if (!entry || entry.source !== sourceStyle) {
              const layerIndex = layersRef.current.findIndex((item) => item.asset.id === layerAssetId);
              entry = {
                source: sourceStyle,
                normalized: normalizeLayerStyle(sourceStyle, layerIndex >= 0 ? layerIndex : index),
              };
              cache[layerAssetId] = entry;
            }
            const layerStyle = entry.normalized;
            const featureStyle = classifiedStyleForFeature(layerStyle, feature as Feature<Geometry>);
            const selected = selectedFeatureRef.current;
            const selectionKey = featureSelectionKey(
              Number(feature.get("layerAssetId")),
              Number(feature.get("featureIndex")),
            );
            const isSelected =
              selectedFeatureKeysRef.current.has(selectionKey) ||
              (selected !== null &&
                selected.assetId === feature.get("layerAssetId") &&
                selected.featureIndex === feature.get("featureIndex"));
            const labelValue =
              layer.labelsVisible && layer.labelField ? feature.get(layer.labelField) : null;
            const baseStyles = featureMapStyles(featureStyle, { selected: false, labelValue });
            return isSelected
              ? [...asStyleArray(baseStyles), ...selectedFeatureOverlayStyles(feature as Feature<Geometry>)]
              : baseStyles;
          },
        });
        vectorLayerRefs.current.push(vectorLayer);
        return { assetId: layer.asset.id, vectorLayer, vectorSource };
      });
    mapLayerSourcesRef.current = mapLayers.map((layer) => layer.vectorSource);

    const savedViewState = mapViewStateRef.current;
    const savedCenter =
      savedViewState?.center && savedViewState.projection !== mapProjection
        ? transformCoordinateSafe(savedViewState.center, savedViewState.projection, mapProjection)
        : savedViewState?.center;
    const basemapLayer =
      basemapMode === "none"
        ? null
        : new TileLayer({
            source:
              basemapMode === "satellite"
                ? new XYZ({
                    url: SATELLITE_TILE_URL,
                    crossOrigin: "anonymous",
                    maxZoom: 19,
                  })
                : new OSM({ crossOrigin: "anonymous" }),
          });
    basemapLayerRef.current = basemapLayer;
    const map = new Map({
      target: mapElementRef.current,
      layers: [
        ...(basemapLayer ? [basemapLayer] : []),
        ...mapLayers.map((layer) => layer.vectorLayer),
      ],
      view: new View({
        projection: mapProjection,
        center: savedCenter ?? [0, 0],
        zoom: savedViewState?.zoom ?? 2,
      }),
    });
    const middleButtonDragPan = new DragPan({ condition: middleMapButton });
    map.addInteraction(middleButtonDragPan);
    mapRef.current = map;
    setMapZoom(map.getView().getZoom() ?? 2);
    setMapScaleText(formatMapScale(map.getView().getZoom() ?? 2));
    map.on("moveend", () => {
      const view = map.getView();
      const center = view.getCenter();
      const zoom = view.getZoom();
      if (center && typeof zoom === "number") {
        mapViewStateRef.current = { center: [...center], zoom, projection: mapProjection };
        setMapZoom(zoom);
        setMapScaleText(formatMapScale(zoom));
      }
    });
    map.on("pointermove", (event) => {
      setCursorCoordinates(formatMapCoordinate(event.coordinate, mapProjection, coordinateProjectionRef.current));
    });
    const handleMapMouseLeave = () => {
      setCursorCoordinates("—");
    };
    map.getViewport().addEventListener("mouseleave", handleMapMouseLeave);

    const visibleLayerIdSet = new Set(visibleLayers.map((layer) => layer.asset.id));
    const loadedLayerIdSet = new Set(props.layers.map((layer) => layer.asset.id));
    const draftLayer = new VectorLayer({
      source: draftSourceRef.current,
      style: (feature) => {
        const isSelected = feature === selectedDraftFeatureRef.current;
        const layerAssetId = Number(feature.get("draft_layer_asset_id"));
        if (Number.isFinite(layerAssetId) && loadedLayerIdSet.has(layerAssetId) && !visibleLayerIdSet.has(layerAssetId)) {
          return [];
        }
        const sourceLayerIndex = props.layers.findIndex((layer) => layer.asset.id === layerAssetId);
        const sourceLayer = sourceLayerIndex >= 0 ? props.layers[sourceLayerIndex] : null;
        const sourceStyle =
          Number.isFinite(layerAssetId) && sourceLayerIndex >= 0
            ? normalizeLayerStyle(layerStylesRef.current[layerAssetId], sourceLayerIndex)
            : {
                strokeColor: draftStyleRef.current.color,
                fillColor: draftStyleRef.current.color,
                fillOpacity: draftStyleRef.current.fillOpacity,
                strokeWidth: 2,
                pointRadius: 6,
                lineStyle: null,
                classification: null,
              };
        const featureStyle = classifiedStyleForFeature(sourceStyle, feature as Feature<Geometry>);
        const featureGeometry = feature as Feature<Geometry>;
        const hasAiSuggestionForFeature = aiSuggestionRef.current?.targetFeature === featureGeometry;
        const labelValue =
          sourceLayer?.labelsVisible && sourceLayer.labelField ? feature.get(sourceLayer.labelField) : null;
        const baseStyles = hasAiSuggestionForFeature
          ? transparentDraftPreviewStyles(featureStyle)
          : featureMapStyles(featureStyle, {
              selected: false,
              labelValue,
            });
        return isSelected || hasAiSuggestionForFeature
          ? [...asStyleArray(baseStyles), ...selectedFeatureOverlayStyles(featureGeometry)]
          : baseStyles;
      },
    });
    draftLayerRef.current = draftLayer;
    map.addLayer(draftLayer);

    const aiSuggestionLayer = new VectorLayer({
      source: aiSuggestionSourceRef.current,
      style: new Style({
        image: new CircleStyle({
          radius: 7,
          fill: new Fill({ color: "rgba(255, 196, 77, 0.45)" }),
          stroke: new Stroke({ color: "#ffb000", width: 3 }),
        }),
        fill: new Fill({ color: "rgba(255, 176, 0, 0.22)" }),
        stroke: new Stroke({ color: "#ffb000", width: 3, lineDash: [10, 7] }),
      }),
    });
    aiSuggestionLayerRef.current = aiSuggestionLayer;
    map.addLayer(aiSuggestionLayer);

    const measureLayer = new VectorLayer({
      source: measureSourceRef.current,
      style: new Style({
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: "rgba(255, 255, 255, 0.92)" }),
          stroke: new Stroke({ color: "#0f766e", width: 2 }),
        }),
        stroke: new Stroke({ color: "#0f766e", width: 3, lineDash: [8, 5] }),
      }),
    });
    measureLayerRef.current = measureLayer;
    map.addLayer(measureLayer);

    const extent = [Infinity, Infinity, -Infinity, -Infinity];
    const focusedLayer = props.zoomToLayerId
      ? mapLayers.find((layer) => layer.assetId === props.zoomToLayerId)
      : null;
    const projectExtentForMap = transformExtentSafe(props.projectExtent3857, "EPSG:3857", mapProjection);
    if (!focusedLayer && projectExtentForMap?.every(Number.isFinite)) {
      extent[0] = projectExtentForMap[0];
      extent[1] = projectExtentForMap[1];
      extent[2] = projectExtentForMap[2];
      extent[3] = projectExtentForMap[3];
    } else {
      const sourcesForFit = focusedLayer ? [focusedLayer] : mapLayers;
      sourcesForFit.forEach(({ vectorSource }) => {
        const layerExtent = vectorSource.getExtent();
        if (layerExtent && Number.isFinite(layerExtent[0])) {
          extent[0] = Math.min(extent[0], layerExtent[0]);
          extent[1] = Math.min(extent[1], layerExtent[1]);
          extent[2] = Math.max(extent[2], layerExtent[2]);
          extent[3] = Math.max(extent[3], layerExtent[3]);
        }
      });
    }
    // Обрезаем экстент рамкой России (та же, что у блокировки «РФ»): иначе один
    // мультиполигон Чукотки, обёрнутый через 180°, раздувает bbox на весь мир и
    // карта грузится на 1:144 млн. Для зума к конкретному слою не трогаем.
    if (!focusedLayer && Number.isFinite(extent[0])) {
      const russia = russiaFitExtentForProjection(mapProjection);
      if (russia?.every(Number.isFinite)) {
        const cx0 = Math.max(extent[0], russia[0]);
        const cy0 = Math.max(extent[1], russia[1]);
        const cx1 = Math.min(extent[2], russia[2]);
        const cy1 = Math.min(extent[3], russia[3]);
        if (cx0 < cx1 && cy0 < cy1) {
          extent[0] = cx0;
          extent[1] = cy0;
          extent[2] = cx1;
          extent[3] = cy1;
        }
      }
    }
    const zoomToLayerRequested = lastZoomToLayerTickRef.current !== props.zoomToLayerTick;
    const shouldAutoFit =
      Number.isFinite(extent[0]) &&
      lastFitKeyRef.current !== fitKey &&
      (!savedViewState || zoomToLayerRequested);
    if (shouldAutoFit) {
      map.getView().fit(extent, {
        padding: [35, 35, 35, 35],
        maxZoom: zoomToLayerRequested ? 16 : 12,
        duration: 200,
      });
      lastFitKeyRef.current = fitKey;
      lastZoomToLayerTickRef.current = props.zoomToLayerTick;
    } else if (Number.isFinite(extent[0]) && lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey;
      lastZoomToLayerTickRef.current = props.zoomToLayerTick;
    }

    map.on("singleclick", (event) => {
      if (!primaryMapButton(event) || editModeRef.current === "measure") {
        return;
      }
      const hitTolerance = 9;
      const hits: Feature<Geometry>[] = [];
      map.forEachFeatureAtPixel(
        event.pixel,
        (hit) => {
          hits.push(hit as Feature<Geometry>);
          return undefined;
        },
        { hitTolerance },
      );
      const clickedLineFeature = [
        ...mapLayers.flatMap((layer) => layer.vectorSource.getFeatures()),
        ...draftSourceRef.current.getFeatures().filter((candidate) => {
          const layerAssetId = Number(candidate.get("draft_layer_asset_id"));
          return !Number.isFinite(layerAssetId) || !loadedLayerIdSet.has(layerAssetId) || visibleLayerIdSet.has(layerAssetId);
        }),
      ]
        .map((candidate, index) => ({
          feature: candidate as Feature<Geometry>,
          distance: squaredDistanceToLineGeometry(event.coordinate, candidate.getGeometry()),
          score: featureSelectionScore(candidate as Feature<Geometry>, index),
        }))
        .filter((candidate) => candidate.distance <= (map.getView().getResolution() ?? 1) ** 2 * hitTolerance ** 2)
        .sort((left, right) => left.distance - right.distance || left.score - right.score)[0]?.feature;
      const pixelFeature = hits
        .map((hit, index) => ({ hit, score: featureSelectionScore(hit, index) }))
        .sort((left, right) => left.score - right.score)[0]?.hit;
      const feature = clickedLineFeature ?? pixelFeature;
      const assetId = feature?.get("layerAssetId");
      const featureIndex = feature?.get("featureIndex");
      if (typeof assetId === "number" && typeof featureIndex === "number") {
        if (selectedDraftFeatureRef.current) {
          const previousFeature = selectedDraftFeatureRef.current;
          selectedDraftFeatureRef.current = null;
          previousFeature.changed();
          draftLayer.changed();
          setDraftRevision((value) => value + 1);
        }
        setSelectedFeatureKeys(new Set([featureSelectionKey(assetId, featureIndex)]));
        props.onFeatureSelect({ assetId, featureIndex });
        return;
      }
      if (selectedDraftFeatureRef.current && !feature?.get("draft_layer_asset_id")) {
        const previousFeature = selectedDraftFeatureRef.current;
        selectedDraftFeatureRef.current = null;
        previousFeature.changed();
        draftLayer.changed();
        setDraftRevision((value) => value + 1);
      }
      setSelectedFeatureKeys(new Set());
      props.onFeatureSelect(null);
    });

    return () => {
      const view = map.getView();
      const center = view.getCenter();
      const zoom = view.getZoom();
      if (center && typeof zoom === "number") {
        mapViewStateRef.current = { center: [...center], zoom, projection: mapProjection };
      }
      map.removeLayer(aiSuggestionLayer);
      map.removeLayer(draftLayer);
      map.removeLayer(measureLayer);
      map.removeInteraction(middleButtonDragPan);
      if (aiSuggestionLayerRef.current === aiSuggestionLayer) {
        aiSuggestionLayerRef.current = null;
      }
      if (draftLayerRef.current === draftLayer) {
        draftLayerRef.current = null;
      }
      if (measureLayerRef.current === measureLayer) {
        measureLayerRef.current = null;
      }
      if (basemapLayerRef.current === basemapLayer) {
        basemapLayerRef.current = null;
      }
      map.getViewport().removeEventListener("mouseleave", handleMapMouseLeave);
      map.setTarget(undefined);
      mapRef.current = null;
      vectorLayerRefs.current = [];
      mapLayerSourcesRef.current = [];
    };
  }, [
    props.layers,
    props.zoomToLayerId,
    props.zoomToLayerTick,
    fitKey,
    props.projectExtent3857,
    props.hideBasemap,
    basemapMode,
    mapProjection,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const draftLayer = draftLayerRef.current;
    if (!map || !draftLayer) {
      return undefined;
    }

    const modify = new Modify({ source: draftSourceRef.current });
    const selectDraft = new Select({ layers: [draftLayer], style: null });
    const snapSources = [draftSourceRef.current, ...mapLayerSourcesRef.current];
    const snapInteractions =
      snapSettings.enabled && (snapSettings.point || snapSettings.endpoint || snapSettings.vertex || snapSettings.edge)
        ? snapSources.flatMap((source) => {
            const interactions: Snap[] = [];
            if (snapSettings.point) {
              interactions.push(
                new Snap({
                  source,
                  edge: false,
                  vertex: true,
                  pixelTolerance: snapSettings.tolerance,
                  segmenters: POINT_ONLY_SNAP_SEGMENTERS,
                }),
              );
            }
            if (snapSettings.endpoint) {
              interactions.push(
                new Snap({
                  source,
                  edge: false,
                  vertex: true,
                  pixelTolerance: snapSettings.tolerance,
                  segmenters: LINE_ENDPOINT_SNAP_SEGMENTERS,
                }),
              );
            }
            if (snapSettings.vertex) {
              interactions.push(
                new Snap({
                  source,
                  edge: false,
                  vertex: true,
                  pixelTolerance: snapSettings.tolerance,
                  segmenters: LINE_VERTEX_SNAP_SEGMENTERS,
                }),
              );
            }
            if (snapSettings.edge) {
              interactions.push(
                new Snap({
                  source,
                  edge: true,
                  vertex: false,
                  pixelTolerance: snapSettings.tolerance,
                  segmenters: LINE_VERTEX_SNAP_SEGMENTERS,
                }),
              );
            }
            return interactions;
          })
        : [];

    selectDraft.on("select", (event) => {
      const selectedFeature = (event.selected[0] as Feature<Geometry> | undefined) ?? null;
      if (selectedFeature) {
        justDrawnDraftFeaturesRef.current.delete(selectedFeature);
        props.onFeatureSelect(null);
      }
      selectedDraftFeatureRef.current = selectedFeature;
      event.deselected.forEach((feature) => feature.changed());
      event.selected.forEach((feature) => feature.changed());
      draftLayer.changed();
      setDraftRevision((value) => value + 1);
    });
    modify.on("modifystart", () => {
      rememberDraftState();
    });
    modify.on("modifyend", () => {
      setDraftRevision((value) => value + 1);
    });

    let draw: Draw | null = null;
    let measureDraw: Draw | null = null;
    const drawTypeByMode: Partial<Record<EditMode, "Point" | "LineString" | "Polygon">> = {
      point: "Point",
      line: "LineString",
      polygon: "Polygon",
    };
    const requestedDrawType = drawTypeByMode[editMode];
    const lockedDrawType = lockedDrawTypeFromGeometry(lockGeometryType);
    // Если у активного слоя задан конкретный тип геометрии — рисовать можно только им.
    const drawType =
      requestedDrawType && lockedDrawType && requestedDrawType !== lockedDrawType
        ? undefined
        : requestedDrawType;

    if (canEditActiveLayer) {
      map.addInteraction(selectDraft);
      map.addInteraction(modify);

      if (drawType) {
        draw = new Draw({
          source: draftSourceRef.current,
          type: drawType,
          condition: secondaryMapButton,
        });
        draw.on("drawstart", () => {
          rememberDraftState();
        });
        draw.on("drawend", (event) => {
          const feature = event.feature as Feature<Geometry>;
          const previousFeature = selectedDraftFeatureRef.current;
          selectedDraftFeatureRef.current = feature;
          justDrawnDraftFeaturesRef.current.delete(feature);
          applyDraftFieldsToFeature(feature);
          previousFeature?.changed();
          event.feature.changed();
          draftLayer.changed();
          setDraftRevision((value) => value + 1);
        });
        map.addInteraction(draw);
      }

      if (editMode === "aiBox") {
        const aiBoxSource = new VectorSource();
        draw = new Draw({
          source: aiBoxSource,
          type: "Circle",
          geometryFunction: createBox(),
          condition: secondaryMapButton,
        });
        draw.on("drawstart", () => {
          setDraftStatus("AI-контур: выделите рамкой объект на карте.");
        });
        draw.on("drawend", (event) => {
          aiBoxSource.clear();
          void requestAiSegmentBox(event.feature as Feature<Geometry>);
        });
        map.addInteraction(draw);
      }

      snapInteractions.forEach((snap) => map.addInteraction(snap));
    }

    if (editMode === "measure") {
      measureDraw = new Draw({
        source: measureSourceRef.current,
        type: "LineString",
        condition: primaryMapButton,
      });
      // Обновляет длину и координаты начальной/конечной точек по линии замера.
      const refreshMeasure = (geometry: LineString) => {
        setMeasureDistanceText(formatDistanceMeters(getLength(geometry, { projection: mapProjection })));
        const coordinates = geometry.getCoordinates();
        if (coordinates.length >= 1) {
          const start = coordinates[0];
          const end = coordinates[coordinates.length - 1];
          setMeasureEndpoints({
            start: formatMapCoordinate(start, mapProjection, coordinateProjectionRef.current),
            end: formatMapCoordinate(end, mapProjection, coordinateProjectionRef.current),
          });
        }
      };
      measureDraw.on("drawstart", (event) => {
        measureSourceRef.current.clear();
        setMeasureDistanceText("0 м");
        setMeasureEndpoints(null);
        const geometry = event.feature.getGeometry();
        geometry?.on("change", () => {
          if (geometry instanceof LineString) {
            refreshMeasure(geometry);
          }
        });
      });
      measureDraw.on("drawend", (event) => {
        const geometry = event.feature.getGeometry();
        if (geometry instanceof LineString) {
          refreshMeasure(geometry);
        }
      });
      // Esc (abortDrawing) — убираем недочерченную линию и подписи.
      measureDraw.on("drawabort", () => {
        measureSourceRef.current.clear();
        setMeasureDistanceText("");
        setMeasureEndpoints(null);
      });
      map.addInteraction(measureDraw);
    }

    // Хоткеи Enter/Esc работают через drawInteractionRef. В каждый момент активна
    // либо рисовалка объектов (draw), либо линейка (measureDraw) — кладём ту, что есть,
    // чтобы Enter «завершить» и Esc «прервать» работали и для линейки.
    const activeDrawInteraction = draw ?? measureDraw;
    drawInteractionRef.current = activeDrawInteraction;

    return () => {
      if (draw) {
        map.removeInteraction(draw);
      }
      if (measureDraw) {
        map.removeInteraction(measureDraw);
      }
      if (drawInteractionRef.current === activeDrawInteraction) {
        drawInteractionRef.current = null;
      }
      map.removeInteraction(selectDraft);
      map.removeInteraction(modify);
      snapInteractions.forEach((snap) => map.removeInteraction(snap));
    };
  }, [
    canEditActiveLayer,
    editMode,
    snapSettings,
    props.activeEditableLayerId,
    props.activeEditableLayerName,
    props.layers,
    lockGeometryType,
    draftFieldsText,
    mapProjection,
  ]);

  useEffect(() => {
    const viewport = mapRef.current?.getViewport();
    if (!viewport || !canEditActiveLayer || editMode === "select") {
      return;
    }
    const preventDrawingContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    viewport.addEventListener("contextmenu", preventDrawingContextMenu);
    return () => viewport.removeEventListener("contextmenu", preventDrawingContextMenu);
  }, [canEditActiveLayer, editMode, mapProjection]);

  return (
    <section className="layer-map-panel" ref={panelRef}>
      <div className="map-preview-heading">
        <div>
          <p className="eyebrow">Карта</p>
          <h3>Общая карта слоёв</h3>
        </div>
      </div>
      <MapToolbar
        isDraftEditingEnabled={props.isDraftEditingEnabled}
        activeEditableLayerId={props.activeEditableLayerId}
        activeEditableLayerName={props.activeEditableLayerName}
        activeDraftFeatureCount={activeDraftFeatureCount}
        draftFeatureCount={draftFeatureCount}
        canEditActiveLayer={canEditActiveLayer}
        hasSelectedDraftFeature={Boolean(selectedDraftFeature)}
        hasSelectedGeoJsonFeature={Boolean(selectedGeoJsonFeature)}
        selectedFeatureCount={selectedFeatureKeys.size}
        isAiSegmenting={isAiSegmenting}
        editMode={editMode}
        activeEditableLayerGeometryType={lockGeometryType}
        snapSettings={snapSettings}
        canUndoDraft={canUndoDraft}
        canRedoDraft={canRedoDraft}
        canPersistDraft={canPersistDraft}
        isDraftBusy={isDraftBusy}
        basemapMode={basemapMode}
        mapZoom={mapZoom}
        mapScaleText={mapScaleText}
        measureDistanceText={measureDistanceText}
        measureStartText={measureEndpoints?.start ?? ""}
        measureEndText={measureEndpoints?.end ?? ""}
        coordinateProjection={coordinateProjection}
        coordinateProjections={props.coordinateProjections}
        cursorCoordinates={cursorCoordinates}
        onToggleDraftEditing={() => {
          const selectedLayerDiffers =
            props.selectedLayerForEditingId !== null &&
            props.selectedLayerForEditingId !== undefined &&
            props.selectedLayerForEditingId !== props.activeEditableLayerId;
          if (selectedLayerDiffers && props.onRequestSelectedLayerEditing) {
            void props.onRequestSelectedLayerEditing();
            setDraftStatus(
              props.selectedLayerForEditingName
                ? `Переключаю редактирование на слой «${props.selectedLayerForEditingName}».`
                : "Переключаю редактируемый слой.",
            );
            return;
          }

          if (!props.activeEditableLayerId) {
            if (props.onRequestSelectedLayerEditing) {
              void props.onRequestSelectedLayerEditing();
              setDraftStatus(
                props.selectedLayerForEditingName
                  ? `Включаю редактирование слоя «${props.selectedLayerForEditingName}».`
                  : "Выберите слой в списке слева, затем включите редактирование.",
              );
              return;
            }
            setDraftStatus("Сначала выберите слой в списке слева или включите редактирование через меню слоя.");
            return;
          }
          props.onDraftEditingEnabledChange(!props.isDraftEditingEnabled);
        }}
        onContinueSelectedDraftFeatureWithAi={() => void continueSelectedDraftFeatureWithAi()}
        onEditModeChange={setEditMode}
        onZoomToSelection={() => zoomToSelectedObject()}
        onZoomToFullExtent={zoomToFullExtent}
        onDeleteSelectedDraftFeature={deleteSelectedDraftFeature}
        onClearDraftLayer={clearDraftLayer}
        onToggleSnapEnabled={() => setSnapSettings((current) => ({ ...current, enabled: !current.enabled }))}
        onToggleSnapSetting={toggleSnapSetting}
        onSnapToleranceChange={(value) =>
          setSnapSettings((current) => ({
            ...current,
            tolerance: Math.min(40, Math.max(2, value || 10)),
          }))
        }
        onUndoDraftChange={undoDraftChange}
        onRedoDraftChange={redoDraftChange}
        onToggleDraftProperties={() => {
          setIsDraftPropertiesOpen((value) => !value);
          props.onWindowFocus("draftProperties");
        }}
        onToggleDraftTable={() => {
          setIsDraftTableOpen((value) => !value);
          props.onWindowFocus("table");
        }}
        onExportShapefileArchive={() => void exportShapefileArchive()}
        onExportMapPng={() => void exportMapPng()}
        onBasemapModeChange={setBasemapMode}
        onLoadLatestDraft={() => void loadLatestDraft()}
        onSaveDraftLayer={() => void saveDraftLayer()}
        onSubmitDraftLayer={() => void submitDraftLayer()}
        submitReportFileName={submitReportFile?.name ?? null}
        onSubmitReportFileChange={setSubmitReportFile}
        onMapZoomChange={setMapZoomLevel}
        onMapScaleTextChange={setMapScaleText}
        onApplyMapScaleText={applyMapScaleText}
        onCoordinateProjectionChange={setCoordinateProjection}
      />
      {aiSuggestion ? (
        <div className="ai-suggestion-panel">
          <div>
            <strong>AI-предложение</strong>
            <span>{Math.round(aiSuggestion.confidence * 100)}% · {aiSuggestion.message}</span>
          </div>
          <div>
            <button onClick={acceptAiSuggestion} disabled={isAiSegmenting}>Принять</button>
            <button onClick={addAiSuggestionAsNewFeature} disabled={isAiSegmenting}>Добавить как новый</button>
            <button
              onClick={() => void regenerateAiSuggestion()}
              disabled={isAiSegmenting || !lastAiRequest}
              title="Запросить новый вариант от AI с тем же исходным контуром / рамкой"
            >
              {isAiSegmenting ? "Перерисовываю..." : "Перерисовать AI"}
            </button>
            <button onClick={rejectAiSuggestion} disabled={isAiSegmenting}>Отклонить</button>
          </div>
        </div>
      ) : null}
      <p className="draft-status">{draftStatus}</p>
      {isDraftPropertiesOpen ? (
        <DraftPropertiesPanel
          draftId={draftId}
          draftFeatureCount={draftFeatureCount}
          draftCrs={draftCrs}
          draftName={draftName}
          draftGeometryType={draftGeometryType}
          draftColor={draftColor}
          draftFillOpacity={draftFillOpacity}
          draftSchemaFields={draftSchemaFields}
          newDraftFieldName={newDraftFieldName}
          position={draftPropertiesPosition}
          zIndex={props.windowZIndexes.draftProperties}
          onFocus={() => props.onWindowFocus("draftProperties")}
          onDragStart={(event) => {
            props.onWindowFocus("draftProperties");
            draggedWindowElRef.current = (event.currentTarget as HTMLElement).closest("section");
            setDraftPropertiesDragOffset({
              x: event.clientX - (panelRef.current?.getBoundingClientRect().left ?? 0) - draftPropertiesPosition.x,
              y: event.clientY - (panelRef.current?.getBoundingClientRect().top ?? 0) - draftPropertiesPosition.y,
            });
          }}
          onClose={() => setIsDraftPropertiesOpen(false)}
          onDraftNameChange={setDraftName}
          onDraftGeometryTypeChange={setDraftGeometryType}
          onDraftCrsChange={setDraftCrs}
          onDraftColorChange={setDraftColor}
          onDraftFillOpacityChange={setDraftFillOpacity}
          onNewDraftFieldNameChange={setNewDraftFieldName}
          onAddDraftField={addDraftField}
          onAddDraftFieldWithType={addDraftFieldWithType}
          onRemoveDraftField={removeDraftField}
          onApplyDraftFieldsToFeatures={applyDraftFieldsToFeatures}
        />
      ) : null}
      <div className="map-canvas-wrap">
        <div className="layer-map-canvas" ref={mapElementRef} style={!isBasemapVisible ? { background: "#fff" } : undefined} />
      </div>
      {tableLayer && props.isTableWindowOpen ? (
        <GisFeatureTable
          layer={tableLayer}
          draftFeatures={tableDraftFeatures}
          draftSchemaFields={draftSchemaFields}
          draftFieldTypes={draftFieldTypes}
          selectedDraftFeature={selectedDraftFeature}
          selectedFeature={props.selectedFeature}
          onFeatureSelect={props.onFeatureSelect}
          onDraftFeatureSelect={selectDraftFeature}
          selectedFeatureKeys={selectedFeatureKeys}
          onFeatureSelectionChange={setSelectedFeatureKeys}
          onZoomToSelection={zoomToSelectedObject}
          onAttributeChange={props.onLayerFeatureAttributeChange}
          onDraftAttributeChange={updateDraftFeatureObjectAttribute}
          onAddField={addTableLayerAttributeField}
          onAddDraftFieldWithType={addDraftFieldWithType}
          onRemoveField={removeTableLayerAttributeField}
          onDraftFieldTypeChange={setDraftFieldType}
          onClose={props.onCloseTable}
          position={tableWindowPosition}
          zIndex={props.windowZIndexes.table}
          onFocus={() => props.onWindowFocus("table")}
          onResizeCommit={setTableWindowPosition}
          onDragStart={(event) => {
            props.onWindowFocus("table");
            const panelRect = panelRef.current?.getBoundingClientRect();
            if (!panelRect) {
              return;
            }
            draggedWindowElRef.current = (event.currentTarget as HTMLElement).closest("section");
            setTableDragOffset({
              x: event.clientX - panelRect.left - tableWindowPosition.x,
              y: event.clientY - panelRect.top - tableWindowPosition.y,
            });
          }}
        />
      ) : null}
      {isDraftTableOpen && draftFeatureCount > 0 ? (
        <DraftFeatureTable
          layerName={draftName || "draft-layer"}
          fields={draftSchemaFields}
          fieldTypes={draftFieldTypes}
          features={draftFeatures}
          selectedFeature={selectedDraftFeature}
          onFeatureSelect={selectDraftFeatureByIndex}
          onAttributeChange={updateDraftFeatureAttribute}
          onAddField={addDraftFieldByName}
          onAddFieldWithType={addDraftFieldWithType}
          onRemoveField={removeDraftField}
          onFieldTypeChange={setDraftFieldType}
          onClose={() => setIsDraftTableOpen(false)}
          position={tableWindowPosition}
          zIndex={props.windowZIndexes.table}
          onFocus={() => props.onWindowFocus("table")}
          onResizeCommit={setTableWindowPosition}
          onDragStart={(event) => {
            props.onWindowFocus("table");
            const panelRect = panelRef.current?.getBoundingClientRect();
            if (!panelRect) {
              return;
            }
            draggedWindowElRef.current = (event.currentTarget as HTMLElement).closest("section");
            setTableDragOffset({
              x: event.clientX - panelRect.left - tableWindowPosition.x,
              y: event.clientY - panelRect.top - tableWindowPosition.y,
            });
          }}
        />
      ) : null}
    </section>
  );
}