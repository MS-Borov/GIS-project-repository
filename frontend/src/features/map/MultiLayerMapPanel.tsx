import { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import Draw, { createBox } from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import Snap from "ol/interaction/Snap";
import type { Segmenters } from "ol/interaction/Snap";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import { transform, transformExtent } from "ol/proj";
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
import { DraftPropertiesPanel } from "./DraftPropertiesPanel";
import { MapToolbar } from "./MapToolbar";

type EditMode = "select" | "point" | "line" | "polygon" | "aiBox";

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

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "http://localhost:8000";

const AUTH_STORAGE_KEY = "gis_edu_auth";

const RUSSIA_VIEW_EXTENT_LONLAT = [5, 34, 190, 86];

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
    const parsed = JSON.parse(savedAuth) as AuthResponse;
    return parsed.user.role;
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

function russiaViewExtentForProjection(projection: CoordinateProjectionCode) {
  return transformExtentSafe(RUSSIA_VIEW_EXTENT_LONLAT, "EPSG:4326", projection) ?? undefined;
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

export function MultiLayerMapPanel(props: {
  layers: LayerPreviewState[];
  layerStyles: Record<number, LayerStyleSettings>;
  assignmentId: number | null;
  activeEditableLayerId: number | null;
  activeEditableLayerName: string | null;
  autoLoadDraft?: boolean;
  isDraftEditingEnabled: boolean;
  onDraftEditingEnabledChange: (enabled: boolean) => void;
  zoomToLayerId: number | null;
  zoomToLayerTick: number;
  tableLayerId: number | null;
  layerAliases: Record<number, string>;
  isTableWindowOpen: boolean;
  selectedFeature: SelectedLayerFeature;
  onFeatureSelect: (feature: SelectedLayerFeature) => void;
  onLayerFeatureAttributeChange: (assetId: number, featureIndex: number, field: string, value: string) => void;
  onLayerAttributeFieldAdd: (assetId: number, field: string) => void;
  onLayerAttributeFieldRemove: (assetId: number, field: string) => void;
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
  const vectorLayerRefs = useRef<VectorLayer<VectorSource>[]>([]);
  const draftSourceRef = useRef(new VectorSource());
  const drawInteractionRef = useRef<Draw | null>(null);
  const mapViewStateRef = useRef<MapViewState | null>(null);
  const coordinateProjectionRef = useRef<CoordinateProjectionCode>("EPSG:4326");
  const mapProjectionRef = useRef<CoordinateProjectionCode>("EPSG:4326");
  const lastFitKeyRef = useRef<string | null>(null);
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
  const [coordinateProjection, setCoordinateProjection] = useState<CoordinateProjectionCode>("EPSG:4326");
  const [isRussiaExtentLocked, setIsRussiaExtentLocked] = useState(true);
  const [basemapMode, setBasemapMode] = useState<BasemapMode>(props.hideBasemap ? "none" : "osm");
  const isBasemapVisible = basemapMode !== "none";
  const [cursorCoordinates, setCursorCoordinates] = useState("—");
  const [draftRevision, setDraftRevision] = useState(0);
  const [draftHistoryRevision, setDraftHistoryRevision] = useState(0);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("draft-layer");
  const [draftGeometryType, setDraftGeometryType] = useState("mixed");
  const [draftCrs, setDraftCrs] = useState("EPSG:4326");
  const [draftFieldsText, setDraftFieldsText] = useState("name\ndescription");
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
  const [isDraftPropertiesOpen, setIsDraftPropertiesOpen] = useState(false);
  const [isDraftTableOpen, setIsDraftTableOpen] = useState(false);
  const [selectedFeatureKeys, setSelectedFeatureKeys] = useState<Set<string>>(new Set());
  const [newDraftFieldName, setNewDraftFieldName] = useState("");
  const [attributeKey, setAttributeKey] = useState("");
  const [attributeValue, setAttributeValue] = useState("");
  const mapProjection = coordinateProjection;
  const visibleLayers = props.layers.filter((layer) => layer.visible);
  const canPersistDraft = Boolean(props.allowDraftSubmit) && storedUserRole() === "student" && Boolean(props.assignmentId);
  const canEditActiveLayer = props.isDraftEditingEnabled && props.activeEditableLayerId !== null;
  const editableDraftFeatures = draftSourceRef.current
    .getFeatures()
    .filter((feature) => feature.get("draft_layer_asset_id") === props.activeEditableLayerId);
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
    selectedFeatureKeysRef.current = selectedFeatureKeys;
    vectorLayerRefs.current.forEach((layer) => layer.changed());
  }, [selectedFeatureKeys]);

  useEffect(() => {
    if (!props.isDraftEditingEnabled && editMode !== "select") {
      setEditMode("select");
    }
  }, [props.isDraftEditingEnabled, editMode]);

  useEffect(() => {
    coordinateProjectionRef.current = coordinateProjection;
  }, [coordinateProjection]);

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
    setCursorCoordinates("вЂ”");
    setDraftRevision((revision) => revision + 1);
  }, [mapProjection]);

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
      if (event.key !== "Escape") {
        return;
      }
      drawInteractionRef.current?.abortDrawing();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function draftFields() {
    return Array.from(
      new Set(
        draftFieldsText
          .split(/[\n,;]+/)
          .map((field) => field.trim())
          .filter(Boolean),
      ),
    );
  }

  function captureDraftSnapshot(): DraftHistorySnapshot {
    const geojson = new GeoJSON().writeFeaturesObject(draftSourceRef.current.getFeatures(), {
      dataProjection: "EPSG:4326",
      featureProjection: mapProjection,
    }) as { type: "FeatureCollection"; features: GeoJsonFeature[] };
    return {
      geojson,
      draftFieldsText,
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
    aiSuggestionSourceRef.current.clear();
    setAiSuggestion(null);
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
    if (props.activeEditableLayerId !== null) {
      feature.set("draft_layer_asset_id", props.activeEditableLayerId);
      feature.set("draft_layer_name", props.activeEditableLayerName ?? `layer-${props.activeEditableLayerId}`);
    }
    Array.from(new Set([...draftFields(), ...layerSchemaFields])).forEach((field) => {
      if (feature.get(field) === undefined) {
        feature.set(field, "");
      }
    });
  }

  function setDraftFields(fields: string[]) {
    setDraftFieldsText(
      Array.from(new Set(fields.map((field) => field.trim()).filter(Boolean))).join("\n"),
    );
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
        feature.set(field, "");
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
        feature.set(field, "");
      }
    });
    setDraftStatus(`Поле «${field}» добавлено в схему слоя.`);
    setDraftRevision((revision) => revision + 1);
  }

  function removeDraftField(field: string) {
    rememberDraftState();
    setDraftFields(draftFields().filter((item) => item !== field));
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

    setIsAiSegmenting(true);
    setDraftStatus("AI-контур: отправляю фрагмент карты в сервис...");
    try {
      await new Promise<void>((resolve) => {
        map.once("rendercomplete", () => resolve());
        map.renderSync();
      });
      const capture = captureMapImageData(map);
      const result = await storedAuthFetchJson<AiSegmentBoxResponse>("/map-assistant/segment-box", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: props.assignmentId,
          image_data: capture.imageData,
          image_size: capture.imageSize.map((value) => Math.round(value)),
          image_extent: capture.imageExtent,
          bbox_pixels: bboxPixels,
          target_geometry_type: "polygon",
        }),
      });

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
      setEditMode("select");
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

    setIsAiSegmenting(true);
    setDraftStatus("AI-продолжение: анализирую выбранный объект...");
    try {
      await new Promise<void>((resolve) => {
        map.once("rendercomplete", () => resolve());
        map.renderSync();
      });
      const capture = captureMapImageData(map);
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
          target_geometry_type: targetGeometryType,
        }),
      });

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
      setEditMode("select");
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
    selectedDraftFeature.set(normalizedKey, value);
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
    justDrawnDraftFeaturesRef.current.delete(feature);
    selectedDraftFeatureRef.current = feature;
    setDraftRevision((revision) => revision + 1);
  }

  function updateDraftFeatureAttribute(index: number, key: string, value: string) {
    const feature = draftSourceRef.current.getFeatures()[index];
    if (!feature || !key.trim()) {
      return;
    }
    rememberDraftState();
    feature.set(key.trim(), value);
    selectedDraftFeatureRef.current = feature;
    setDraftRevision((revision) => revision + 1);
  }

  function selectDraftFeature(feature: Feature<Geometry>) {
    justDrawnDraftFeaturesRef.current.delete(feature);
    selectedDraftFeatureRef.current = feature;
    props.onFeatureSelect(null);
    setDraftRevision((revision) => revision + 1);
  }

  function updateDraftFeatureObjectAttribute(feature: Feature<Geometry>, key: string, value: string) {
    if (!feature || !key.trim()) {
      return;
    }
    rememberDraftState();
    feature.set(key.trim(), value);
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
        fields: draftFields(),
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
          style: normalizeLayerStyle(props.layerStyles[layer.asset.id], index),
        };
      }),
    };
  }

  function exportDraftLayer() {
    const geojson = buildDraftGeoJsonObject();
    const features = geojson.features;
    if (features.length === 0) {
      return;
    }

    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${props.activeEditableLayerName || draftName || "layer"}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
    setDraftStatus(`GeoJSON экспортирован: ${features.length} объектов.`);
  }

  async function exportShapefileArchive() {
    if (!props.assignmentId) {
      setDraftStatus("Нельзя экспортировать Shapefile ZIP: assignment_id неизвестен.");
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
        throw new Error(`Shapefile ZIP export вернул ${response.status}: ${text}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draftName.trim() || "draft-layers"}_shapefiles.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setDraftStatus(`SHP ZIP экспортирован: ${geojson.features.length} объектов.`);
    } catch (error) {
      setDraftStatus(error instanceof Error ? error.message : "Не удалось экспортировать SHP ZIP.");
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

      const loadedFeatures = new GeoJSON().readFeatures(draft.geojson, {
        dataProjection: "EPSG:4326",
        featureProjection: mapProjection,
      });
      const features = draft.geojson.properties?.includes_base_layers
        ? loadedFeatures.filter((feature) => feature.get("draft_feature") === true || feature.get("draft_layer_asset_id"))
        : loadedFeatures;
      draftSourceRef.current.clear();
      draftSourceRef.current.addFeatures(features);
      selectedDraftFeatureRef.current = null;
      clearDraftHistory();
      setDraftId(draft.id);
      setDraftName(draft.geojson.properties?.layer_name || draft.name);
      setDraftGeometryType(draft.geojson.properties?.geometry_type || draft.geometry_type || "mixed");
      setDraftCrs(draft.geojson.properties?.assigned_crs || "EPSG:4326");
      setDraftFieldsText((draft.geojson.properties?.fields ?? ["name", "description"]).join("\n"));
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

  async function submitDraftLayer() {
    const draft = await saveDraftLayer();
    if (!draft) {
      return;
    }

    setIsDraftBusy(true);
    try {
      const submission = await storedAuthFetchJson<Submission>(`/map-drafts/${draft.id}/submit`, {
        method: "POST",
      });
      setDraftStatus(`Черновик сдан как submission #${submission.id}.`);
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

    function handlePointerMove(event: PointerEvent) {
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!panelRect) {
        return;
      }
      const maxX = Math.max(8, panelRect.width - 320);
      const maxY = Math.max(8, panelRect.height - 180);
      const nextX = Math.min(Math.max(8, event.clientX - panelRect.left - activeDragOffset.x), maxX);
      const nextY = Math.min(Math.max(54, event.clientY - panelRect.top - activeDragOffset.y), maxY);
      setTableWindowPosition({ x: nextX, y: nextY });
    }

    function handlePointerUp() {
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

    function handlePointerMove(event: PointerEvent) {
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!panelRect) {
        return;
      }
      const maxX = Math.max(8, panelRect.width - 360);
      const maxY = Math.max(8, panelRect.height - 220);
      const nextX = Math.min(Math.max(8, event.clientX - panelRect.left - activeDragOffset.x), maxX);
      const nextY = Math.min(Math.max(54, event.clientY - panelRect.top - activeDragOffset.y), maxY);
      setDraftPropertiesPosition({ x: nextX, y: nextY });
    }

    function handlePointerUp() {
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
        const layerStyle = normalizeLayerStyle(props.layerStyles[layer.asset.id], props.layers.findIndex((item) => item.asset.id === layer.asset.id));
        const geoJsonFormat = new GeoJSON();
        const renderedFeatures = layer.preview.geojson.features.flatMap((geojsonFeature, featureIndex) => {
          if (!geojsonFeature.geometry) {
            return [];
          }
          const features = geoJsonFormat.readFeatures(
            { type: "FeatureCollection", features: [geojsonFeature] },
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
        const vectorLayer = new VectorLayer({
          source: vectorSource,
          style: (feature) => {
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
            return featureMapStyles(featureStyle, { selected: isSelected, labelValue });
          },
        });
        vectorLayerRefs.current.push(vectorLayer);
        return { assetId: layer.asset.id, vectorLayer, vectorSource };
      });

    const savedViewState = mapViewStateRef.current;
    const savedCenter =
      savedViewState?.center && savedViewState.projection !== mapProjection
        ? transformCoordinateSafe(savedViewState.center, savedViewState.projection, mapProjection)
        : savedViewState?.center;
    const map = new Map({
      target: mapElementRef.current,
      layers: [
        ...(basemapMode === "none"
          ? []
          : [
              new TileLayer({
                source:
                  basemapMode === "satellite"
                    ? new XYZ({
                        url: SATELLITE_TILE_URL,
                        crossOrigin: "anonymous",
                        maxZoom: 19,
                      })
                    : new OSM({ crossOrigin: "anonymous" }),
              }),
            ]),
        ...mapLayers.map((layer) => layer.vectorLayer),
      ],
      view: new View({
        projection: mapProjection,
        center: savedCenter ?? [0, 0],
        zoom: savedViewState?.zoom ?? 2,
        extent: isRussiaExtentLocked ? russiaViewExtentForProjection(mapProjection) : undefined,
      }),
    });
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

    const draftLayer = new VectorLayer({
      source: draftSourceRef.current,
      style: (feature) => {
        const isSelected = feature === selectedDraftFeatureRef.current;
        const useSelectionStyle = isSelected && !justDrawnDraftFeaturesRef.current.has(feature as Feature<Geometry>);
        const layerAssetId = Number(feature.get("draft_layer_asset_id"));
        const sourceLayerIndex = props.layers.findIndex((layer) => layer.asset.id === layerAssetId);
        const sourceStyle =
          Number.isFinite(layerAssetId) && sourceLayerIndex >= 0
            ? normalizeLayerStyle(props.layerStyles[layerAssetId], sourceLayerIndex)
            : {
                strokeColor: draftColor,
                fillColor: draftColor,
                fillOpacity: draftFillOpacity,
                strokeWidth: 2,
                pointRadius: 6,
                lineStyle: null,
                classification: null,
              };
        const featureStyle = classifiedStyleForFeature(sourceStyle, feature as Feature<Geometry>);
        return featureMapStyles(featureStyle, {
          selected: useSelectionStyle,
          selectionStrokeColor: "#b45f1c",
          selectionFillColor: "rgba(199, 115, 38, 0.35)",
          selectionPointFillColor: "rgba(199, 115, 38, 0.8)",
        });
      },
    });
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
    map.addLayer(aiSuggestionLayer);

    const modify = new Modify({ source: draftSourceRef.current });
    const selectDraft = new Select({ layers: [draftLayer] });
    const snapSources = [draftSourceRef.current, ...mapLayers.map((layer) => layer.vectorSource)];
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
      setDraftRevision((value) => value + 1);
    });
    if (canEditActiveLayer) {
      map.addInteraction(selectDraft);
      map.addInteraction(modify);
    }

    let draw: Draw | null = null;
    const drawTypeByMode: Partial<Record<EditMode, "Point" | "LineString" | "Polygon">> = {
      point: "Point",
      line: "LineString",
      polygon: "Polygon",
    };
    const drawType = drawTypeByMode[editMode];
    if (drawType && canEditActiveLayer) {
      draw = new Draw({
        source: draftSourceRef.current,
        type: drawType,
      });
      draw.on("drawstart", () => {
        rememberDraftState();
      });
      draw.on("drawend", (event) => {
        const feature = event.feature as Feature<Geometry>;
        selectedDraftFeatureRef.current = feature;
        justDrawnDraftFeaturesRef.current.add(feature);
        applyDraftFieldsToFeature(feature);
        event.feature.changed();
        setDraftRevision((value) => value + 1);
      });
      map.addInteraction(draw);
    }
    if (editMode === "aiBox" && canEditActiveLayer) {
      const aiBoxSource = new VectorSource();
      draw = new Draw({
        source: aiBoxSource,
        type: "Circle",
        geometryFunction: createBox(),
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
    if (canEditActiveLayer) {
      snapInteractions.forEach((snap) => map.addInteraction(snap));
    }
    drawInteractionRef.current = draw;
    modify.on("modifystart", () => {
      rememberDraftState();
    });
    modify.on("modifyend", () => {
      setDraftRevision((value) => value + 1);
    });

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
    if (Number.isFinite(extent[0]) && lastFitKeyRef.current !== fitKey) {
      map.getView().fit(extent, {
        padding: [35, 35, 35, 35],
        maxZoom: 16,
        duration: 200,
      });
      lastFitKeyRef.current = fitKey;
    }

    map.on("singleclick", (event) => {
      const hits: Feature<Geometry>[] = [];
      map.forEachFeatureAtPixel(
        event.pixel,
        (hit) => {
          hits.push(hit as Feature<Geometry>);
          return undefined;
        },
        { hitTolerance: 6 },
      );
      const feature = hits
        .map((hit, index) => ({ hit, score: featureSelectionScore(hit, index) }))
        .sort((left, right) => left.score - right.score)[0]?.hit;
      const assetId = feature?.get("layerAssetId");
      const featureIndex = feature?.get("featureIndex");
      if (typeof assetId === "number" && typeof featureIndex === "number") {
        if (selectedDraftFeatureRef.current) {
          selectedDraftFeatureRef.current = null;
          setDraftRevision((value) => value + 1);
        }
        setSelectedFeatureKeys(new Set([featureSelectionKey(assetId, featureIndex)]));
        props.onFeatureSelect({ assetId, featureIndex });
        return;
      }
      if (selectedDraftFeatureRef.current && !feature?.get("draft_layer_asset_id")) {
        selectedDraftFeatureRef.current = null;
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
      if (draw) {
        map.removeInteraction(draw);
      }
      if (drawInteractionRef.current === draw) {
        drawInteractionRef.current = null;
      }
      map.removeInteraction(selectDraft);
      map.removeInteraction(modify);
      snapInteractions.forEach((snap) => map.removeInteraction(snap));
      map.removeLayer(aiSuggestionLayer);
      map.removeLayer(draftLayer);
      map.getViewport().removeEventListener("mouseleave", handleMapMouseLeave);
      map.setTarget(undefined);
      mapRef.current = null;
      vectorLayerRefs.current = [];
    };
  }, [
    props.layers,
    props.layerStyles,
    props.zoomToLayerId,
    props.zoomToLayerTick,
    props.isDraftEditingEnabled,
    props.activeEditableLayerId,
    props.activeEditableLayerName,
    editMode,
    fitKey,
    draftColor,
    draftFillOpacity,
    draftFieldsText,
    draftRevision,
    isRussiaExtentLocked,
    snapSettings,
    props.projectExtent3857,
    props.hideBasemap,
    basemapMode,
    mapProjection,
  ]);

  return (
    <section className="layer-map-panel" ref={panelRef}>
      <div className="map-preview-heading">
        <div>
          <p className="eyebrow">Карта</p>
          <h3>Общая карта слоёв</h3>
        </div>
        <span>{visibleLayers.length} включено</span>
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
        snapSettings={snapSettings}
        canUndoDraft={canUndoDraft}
        canRedoDraft={canRedoDraft}
        canPersistDraft={canPersistDraft}
        isDraftBusy={isDraftBusy}
        basemapMode={basemapMode}
        mapZoom={mapZoom}
        mapScaleText={mapScaleText}
        isRussiaExtentLocked={isRussiaExtentLocked}
        coordinateProjection={coordinateProjection}
        coordinateProjections={props.coordinateProjections}
        cursorCoordinates={cursorCoordinates}
        onToggleDraftEditing={() => {
          if (!props.activeEditableLayerId) {
            setDraftStatus("Сначала включите редактирование конкретного слоя через меню слоя.");
            return;
          }
          props.onDraftEditingEnabledChange(!props.isDraftEditingEnabled);
        }}
        onContinueSelectedDraftFeatureWithAi={() => void continueSelectedDraftFeatureWithAi()}
        onEditModeChange={setEditMode}
        onZoomToSelection={() => zoomToSelectedObject()}
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
        onExportDraftLayer={exportDraftLayer}
        onExportShapefileArchive={() => void exportShapefileArchive()}
        onExportMapPng={() => void exportMapPng()}
        onBasemapModeChange={setBasemapMode}
        onLoadLatestDraft={() => void loadLatestDraft()}
        onSaveDraftLayer={() => void saveDraftLayer()}
        onSubmitDraftLayer={() => void submitDraftLayer()}
        onMapZoomChange={setMapZoomLevel}
        onMapScaleTextChange={setMapScaleText}
        onApplyMapScaleText={applyMapScaleText}
        onToggleRussiaExtentLock={() => setIsRussiaExtentLocked((value) => !value)}
        onCoordinateProjectionChange={setCoordinateProjection}
      />
      {aiSuggestion ? (
        <div className="ai-suggestion-panel">
          <div>
            <strong>AI-предложение</strong>
            <span>{Math.round(aiSuggestion.confidence * 100)}% · {aiSuggestion.message}</span>
          </div>
          <div>
            <button onClick={acceptAiSuggestion}>Принять</button>
            <button onClick={addAiSuggestionAsNewFeature}>Добавить как новый</button>
            <button onClick={rejectAiSuggestion}>Отклонить</button>
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
          detectedGeometryType={detectDraftGeometryType()}
          draftColor={draftColor}
          draftFillOpacity={draftFillOpacity}
          draftSchemaFields={draftSchemaFields}
          newDraftFieldName={newDraftFieldName}
          position={draftPropertiesPosition}
          zIndex={props.windowZIndexes.draftProperties}
          onFocus={() => props.onWindowFocus("draftProperties")}
          onDragStart={(event) => {
            props.onWindowFocus("draftProperties");
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
          onRemoveField={removeTableLayerAttributeField}
          onClose={props.onCloseTable}
          position={tableWindowPosition}
          zIndex={props.windowZIndexes.table}
          onFocus={() => props.onWindowFocus("table")}
          onDragStart={(event) => {
            props.onWindowFocus("table");
            const panelRect = panelRef.current?.getBoundingClientRect();
            if (!panelRect) {
              return;
            }
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
          features={draftFeatures}
          selectedFeature={selectedDraftFeature}
          onFeatureSelect={selectDraftFeatureByIndex}
          onAttributeChange={updateDraftFeatureAttribute}
          onAddField={addDraftFieldByName}
          onRemoveField={removeDraftField}
          onClose={() => setIsDraftTableOpen(false)}
          position={tableWindowPosition}
          zIndex={props.windowZIndexes.table}
          onFocus={() => props.onWindowFocus("table")}
          onDragStart={(event) => {
            props.onWindowFocus("table");
            const panelRect = panelRef.current?.getBoundingClientRect();
            if (!panelRect) {
              return;
            }
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
