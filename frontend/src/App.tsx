import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Map from "ol/Map";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import Draw, { createBox } from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import Snap from "ol/interaction/Snap";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { transform } from "ol/proj";
import { register } from "ol/proj/proj4";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import proj4 from "proj4";
import "ol/ol.css";
import "./App.css";

type UserRole = "admin" | "teacher" | "student";
type AuthMode = "login" | "register";
type CourseTab = "stream" | "assignments" | "submissions" | "layers" | "requirements" | "people";
type ThemeMode = "light" | "dark";
type EditMode = "select" | "point" | "line" | "polygon" | "aiBox";
type MapWindowKey = "layerProperties" | "table" | "draftProperties";
type LayerPropertiesTab = "info" | "labels" | "style";
type SortDirection = "asc" | "desc";

type Course = {
  id: number;
  title: string;
  description?: string | null;
  teacher_id?: number | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

type CourseMember = {
  id: number;
  course_id: number;
  user_id: number;
  role: "teacher" | "student";
  created_at: string;
  user: User;
};

type User = {
  id: number;
  email: string;
  full_name?: string | null;
  role: UserRole;
  is_active: boolean;
};

type AuthResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

type Assignment = {
  id: number;
  course_id?: number | null;
  title: string;
  description?: string | null;
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

type SubmissionAsset = {
  id: number;
  submission_id: number;
  asset_name: string;
  asset_type: string;
  detected_format: string;
  status: string;
  message: string;
};

type AssignmentMaterial = {
  id: number;
  assignment_id: number;
  material_name: string;
  material_type: string;
  detected_format: string;
  status: string;
  message: string;
  storage_key: string;
  created_at: string;
  updated_at: string;
  download_url?: string | null;
};

type SubmissionCheck = {
  id: number;
  submission_id: number;
  submission_asset_id?: number | null;
  status: string;
  file_type: string;
  message: string;
  result_json?: Record<string, unknown> | null;
  created_at: string;
};

type GeoJsonGeometry = {
  type: string;
  coordinates?: unknown;
  geometries?: GeoJsonGeometry[];
};

type GeoJsonFeature = {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties?: Record<string, unknown> | null;
};

type GeoJsonPreview = {
  asset_id: number;
  asset_name: string;
  detected_format: string;
  source_crs?: string | null;
  crs: string;
  feature_count: number;
  preview_feature_count: number;
  truncated: boolean;
  geojson: {
    type: "FeatureCollection";
    features: GeoJsonFeature[];
  };
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

type ArchivePreviewResponse = {
  preview_token?: string;
  source_filename: string;
  assignment_id: number;
  assets: SubmissionAsset[];
  previews: GeoJsonPreview[];
  layer_count: number;
  layer_summaries?: ArchivePreviewLayerSummary[];
  warnings: string[];
};

type ArchivePreviewLayerSummary = {
  asset_id: number;
  asset_name: string;
  detected_format: string;
  status?: string | null;
  message?: string | null;
  feature_count?: number | null;
  geometry_types?: string[];
  crs?: string | null;
  attribute_fields?: string[];
  invalid_geometry_count?: number | null;
  has_prj?: boolean | null;
};

type LayerPreviewState = {
  asset: SubmissionAsset;
  preview: GeoJsonPreview;
  visible: boolean;
  labelsVisible: boolean;
  labelField: string | null;
};

type LayerStyleSettings = {
  strokeColor: string;
  fillColor: string;
  fillOpacity: number;
  strokeWidth: number;
  pointRadius: number;
};

type LayerLayoutSnapshot = {
  layers: LayerPreviewState[];
  hiddenLayerIds: number[];
  removedLayerIds: number[];
  layerGroupNames: string[];
  layerGroups: Record<number, string>;
  collapsedLayerGroups: string[];
  layerAliases: Record<number, string>;
  assignedLayerCrs: Record<number, string>;
  layerStyles: Record<number, LayerStyleSettings>;
};

type CoordinateProjectionCode = string;

type SelectedLayerFeature = {
  assetId: number;
  featureIndex: number;
} | null;

type AiReviewResponse = {
  ai_review?: {
    status?: string;
    message?: string;
    review_text?: string;
  };
  warnings?: string[];
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

type Requirements = {
  id?: number;
  assignment_id?: number;
  source_doc_name?: string | null;
  source_text?: string | null;
  submission_format?: string | null;
  deliverable_format?: string | null;
  expected_geometry_types?: string[] | null;
  expected_crs?: string | null;
  required_attributes?: string[] | null;
  topology_rules?: string[] | null;
  expected_outputs_json?: Record<string, unknown>[] | null;
  needs_reference_layer?: boolean | null;
  report_required?: boolean | null;
  auto_checkable?: boolean | null;
  extraction_status?: string | null;
  extraction_notes?: string | null;
  created_at?: string;
  updated_at?: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "http://localhost:8000";

const AUTH_STORAGE_KEY = "gis_edu_auth";
const THEME_STORAGE_KEY = "gis_edu_theme";
const ARCHIVE_PREVIEW_STORAGE_PREFIX = "gis_edu_archive_preview:";
const LAYER_COLORS = ["#176f6b", "#c77326", "#3867a6", "#7c5aa6", "#6f8f2e", "#b33f62"];
const SHAPEFILE_PART_EXTENSIONS = new Set([".shp", ".dbf", ".shx", ".prj", ".cpg", ".qix", ".sbn", ".sbx"]);
const DEFAULT_LAYER_GROUP = "Слои";
const LOCAL_LAYER_GROUP = "Локальные слои";

function defaultLayerStyle(index: number): LayerStyleSettings {
  const color = LAYER_COLORS[Math.max(0, index) % LAYER_COLORS.length] ?? "#176f6b";
  return {
    strokeColor: color,
    fillColor: color,
    fillOpacity: 0.2,
    strokeWidth: 2,
    pointRadius: 5,
  };
}

function normalizeLayerStyle(style: Partial<LayerStyleSettings> | undefined, index: number): LayerStyleSettings {
  const fallback = defaultLayerStyle(index);
  return {
    strokeColor: style?.strokeColor || fallback.strokeColor,
    fillColor: style?.fillColor || fallback.fillColor,
    fillOpacity: Math.min(1, Math.max(0, Number(style?.fillOpacity ?? fallback.fillOpacity))),
    strokeWidth: Math.min(12, Math.max(1, Number(style?.strokeWidth ?? fallback.strokeWidth))),
    pointRadius: Math.min(24, Math.max(2, Number(style?.pointRadius ?? fallback.pointRadius))),
  };
}

function colorWithOpacity(color: string, opacity: number) {
  const normalized = color.trim();
  if (/^#[\da-f]{6}$/i.test(normalized)) {
    const red = parseInt(normalized.slice(1, 3), 16);
    const green = parseInt(normalized.slice(3, 5), 16);
    const blue = parseInt(normalized.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, opacity))})`;
  }
  return normalized;
}

const emptyRequirements: Requirements = {
  source_doc_name: null,
  source_text: null,
  submission_format: "archive",
  deliverable_format: null,
  expected_geometry_types: null,
  expected_crs: null,
  required_attributes: null,
  topology_rules: null,
  expected_outputs_json: null,
  needs_reference_layer: false,
  report_required: true,
  auto_checkable: true,
  extraction_status: "teacher_draft",
  extraction_notes: null,
};

function formatJson(value: unknown) {
  return value === null || value === undefined ? "null" : JSON.stringify(value, null, 2);
}

function parseJsonField<T>(label: string, value: string): T | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${label}: некорректный JSON`);
  }
}

function parseJsonArrayField<T>(label: string, value: string): T[] | null {
  const parsed = parseJsonField<T[]>(label, value);
  if (parsed !== null && !Array.isArray(parsed)) {
    throw new Error(`${label}: ожидается массив или null`);
  }
  return parsed;
}

function stringOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function layerDisplayName(assetName: string) {
  return assetName.replace(/\.(zip|geojson|shp)$/i, "");
}

function fileExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
}

function geometryKindFromType(type: string | null | undefined): "point" | "line" | "polygon" | "mixed" | "unknown" {
  const normalized = String(type ?? "").toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("point")) return "point";
  if (normalized.includes("line")) return "line";
  if (normalized.includes("polygon")) return "polygon";
  if (normalized.includes("collection")) return "mixed";
  return "unknown";
}

function layerGeometryKind(preview?: GeoJsonPreview | null): "point" | "line" | "polygon" | "mixed" | "unknown" {
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

function mapViewerUrl(submissionId: number) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "map");
  url.searchParams.set("submission_id", String(submissionId));
  return url.toString();
}

function openMapViewer(submissionId: number) {
  window.open(mapViewerUrl(submissionId), "_blank", "noopener,noreferrer");
}

function assignmentWorkspaceUrl(assignmentId: number, options: { loadDraft?: boolean } = {}) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "workspace");
  url.searchParams.set("assignment_id", String(assignmentId));
  if (options.loadDraft) {
    url.searchParams.set("draft", "latest");
  }
  return url.toString();
}

function openAssignmentWorkspace(assignmentId: number, options: { loadDraft?: boolean } = {}) {
  window.open(assignmentWorkspaceUrl(assignmentId, options), "_blank", "noopener,noreferrer");
}

function archivePreviewUrl(previewKey: string) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "archive_preview");
  url.searchParams.set("preview_key", previewKey);
  return url.toString();
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

function previewAttributeFields(preview: GeoJsonPreview) {
  const fields = new Set<string>();
  preview.geojson.features.forEach((feature) => {
    Object.keys(feature.properties ?? {}).forEach((key) => fields.add(key));
  });
  return Array.from(fields).sort((left, right) => left.localeCompare(right));
}

function defaultLabelField(preview: GeoJsonPreview) {
  const fields = previewAttributeFields(preview);
  const preferred = ["name", "Name", "NAME", "title", "Title", "TITLE", "label", "Label", "LABEL"];
  return preferred.find((field) => fields.includes(field)) ?? fields[0] ?? null;
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

const WGS84_UTM_NORTH_PROJECTIONS = Array.from({ length: 10 }, (_, index) => {
  const zone = index + 37;
  return {
    code: `EPSG:${32600 + zone}`,
    label: `EPSG:${32600 + zone} WGS 84 / UTM zone ${zone}N`,
    definition: `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs +type=crs`,
  };
});

const PULKOVO_1942_GAUSS_KRUGER_PROJECTIONS = Array.from({ length: 22 }, (_, index) => {
  const zone = index + 4;
  return {
    code: `EPSG:${28400 + zone}`,
    label: `EPSG:${28400 + zone} СК-42 / Гаусс-Крюгер, зона ${zone}`,
    definition: [
      "+proj=tmerc",
      "+lat_0=0",
      `+lon_0=${zone * 6 - 3}`,
      "+k=1",
      `+x_0=${zone * 1_000_000 + 500_000}`,
      "+y_0=0",
      "+ellps=krass",
      "+towgs84=23.57,-140.95,-79.8,0,0.35,0.79,-0.22",
      "+units=m",
      "+no_defs",
      "+type=crs",
    ].join(" "),
  };
});

const MAP_COORDINATE_PROJECTIONS: Array<{ code: CoordinateProjectionCode; label: string; definition?: string }> = [
  { code: "EPSG:4326", label: "EPSG:4326 WGS 84, градусы" },
  { code: "EPSG:3857", label: "EPSG:3857 Web Mercator, м" },
  {
    code: "EPSG:3395",
    label: "EPSG:3395 WGS 84 / World Mercator, м",
    definition: "+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:3576",
    label: "EPSG:3576 WGS 84 / North Pole LAEA Russia, м",
    definition: "+proj=laea +lat_0=90 +lon_0=90 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs",
  },
  ...WGS84_UTM_NORTH_PROJECTIONS,
  ...PULKOVO_1942_GAUSS_KRUGER_PROJECTIONS,
];

MAP_COORDINATE_PROJECTIONS.forEach((projection) => {
  if (projection.definition) {
    proj4.defs(projection.code, projection.definition);
  }
});
register(proj4);

function formatMapCoordinate(coordinate: number[] | null, projection: CoordinateProjectionCode) {
  if (!coordinate) {
    return "—";
  }
  try {
    const [x, y] = transform(coordinate, "EPSG:3857", projection);
    const fractionDigits = projection === "EPSG:4326" ? 6 : 2;
    return `${x.toFixed(fractionDigits)}, ${y.toFixed(fractionDigits)}`;
  } catch {
    return "СК не поддерживается";
  }
}

function compareTableValues(left: unknown, right: unknown, direction: SortDirection) {
  const leftNumber = Number(String(left ?? "").replace(",", "."));
  const rightNumber = Number(String(right ?? "").replace(",", "."));
  const result =
    Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : String(left ?? "").localeCompare(String(right ?? ""), "ru", { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function nextSortDirection(current: SortDirection | null) {
  return current === "asc" ? "desc" : "asc";
}

function roleLabel(role: UserRole) {
  const labels: Record<UserRole, string> = {
    admin: "Администратор",
    teacher: "Преподаватель",
    student: "Студент",
  };
  return labels[role];
}

function statusLabel(status: string) {
  const value = status.toLowerCase();
  if (value === "passed") return "Пройдено";
  if (value === "warning") return "Есть замечания";
  if (value === "failed") return "Ошибка";
  if (value === "uploaded") return "Загружено";
  if (value === "unknown") return "Неизвестно";
  return status;
}

function isPreviewableAsset(asset: SubmissionAsset) {
  return asset.asset_type === "layer" && ["geojson", "shapefile_zip"].includes(asset.detected_format);
}

function normalizeGeoJsonFeatureCollection(value: unknown): GeoJsonPreview["geojson"] {
  const candidate = value as { type?: string; features?: GeoJsonFeature[] };
  if (candidate?.type === "FeatureCollection" && Array.isArray(candidate.features)) {
    return candidate as GeoJsonPreview["geojson"];
  }
  if ((value as GeoJsonFeature)?.type === "Feature") {
    return {
      type: "FeatureCollection",
      features: [value as GeoJsonFeature],
    };
  }
  throw new Error("Файл не похож на GeoJSON FeatureCollection или Feature.");
}

function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const mapViewerSubmissionId = Number(searchParams.get("submission_id"));
  const workspaceAssignmentId = Number(searchParams.get("assignment_id"));
  const archivePreviewKey = searchParams.get("preview_key");
  if (searchParams.get("view") === "archive_preview" && archivePreviewKey) {
    return <StandaloneArchivePreview previewKey={archivePreviewKey} />;
  }
  if (searchParams.get("view") === "workspace" && Number.isInteger(workspaceAssignmentId) && workspaceAssignmentId > 0) {
    return <StandaloneAssignmentWorkspace assignmentId={workspaceAssignmentId} autoLoadDraft={searchParams.get("draft") === "latest"} />;
  }
  if (searchParams.get("view") === "map" && Number.isInteger(mapViewerSubmissionId) && mapViewerSubmissionId > 0) {
    return <StandaloneMapViewer submissionId={mapViewerSubmissionId} />;
  }

  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authFullName, setAuthFullName] = useState("");
  const [authMessage, setAuthMessage] = useState("Войдите, чтобы открыть рабочее пространство.");
  const [activeTab, setActiveTab] = useState<CourseTab>("stream");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseMembers, setCourseMembers] = useState<CourseMember[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(null);
  const [showArchivedCourses, setShowArchivedCourses] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [newCourseTitle, setNewCourseTitle] = useState("");
  const [newCourseDescription, setNewCourseDescription] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"student" | "teacher">("student");

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null);
  const [newAssignmentTitle, setNewAssignmentTitle] = useState("");
  const [newAssignmentDescription, setNewAssignmentDescription] = useState("");

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [assets, setAssets] = useState<SubmissionAsset[]>([]);
  const [checks, setChecks] = useState<SubmissionCheck[]>([]);
  const [aiReview, setAiReview] = useState<AiReviewResponse | null>(null);
  const [mapPreview, setMapPreview] = useState<GeoJsonPreview | null>(null);
  const [selectedMapFeatureIndex, setSelectedMapFeatureIndex] = useState<number | null>(null);

  const [requirements, setRequirements] = useState<Requirements>(emptyRequirements);
  const [expectedGeometryTypesText, setExpectedGeometryTypesText] = useState("null");
  const [requiredAttributesText, setRequiredAttributesText] = useState("null");
  const [topologyRulesText, setTopologyRulesText] = useState("null");
  const [expectedOutputsText, setExpectedOutputsText] = useState("null");
  const [assignmentFile, setAssignmentFile] = useState<File | null>(null);

  const [statusMessage, setStatusMessage] = useState("Выберите действие.");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parsedAssignmentId = useMemo(() => selectedAssignmentId ?? 0, [selectedAssignmentId]);
  const selectedAssignment = assignments.find((assignment) => assignment.id === selectedAssignmentId) ?? null;
  const hasExpectedOutputs = expectedOutputsText.trim() !== "" && expectedOutputsText.trim() !== "null";
  const canEditRequirements = currentUser?.role === "teacher" || currentUser?.role === "admin";
  const activeCourses = courses.filter((course) => !course.archived);
  const archivedCourses = courses.filter((course) => course.archived);
  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      setThemeMode(savedTheme);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const savedAuth = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!savedAuth) {
      return;
    }

    try {
      const parsed = JSON.parse(savedAuth) as AuthResponse;
      setAuthToken(parsed.access_token);
      setCurrentUser(parsed.user);
      setAuthMessage(`Вы вошли как ${roleLabel(parsed.user.role)}.`);
      void loadCourses(parsed.access_token);
      void loadAssignments(parsed.access_token);
      void loadSubmissions(parsed.access_token);
    } catch {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, []);

  function authHeaders(token = authToken): HeadersInit {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function fetchJson<T>(path: string, init: RequestInit = {}, token = authToken): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...authHeaders(token),
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

  function persistAuth(data: AuthResponse) {
    setAuthToken(data.access_token);
    setCurrentUser(data.user);
    setActiveTab("stream");
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
    setAuthMessage(`Вы вошли как ${roleLabel(data.user.role)}.`);
    void loadCourses(data.access_token);
    void loadAssignments(data.access_token);
    void loadSubmissions(data.access_token);
  }

  async function submitAuthForm() {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const payload =
        authMode === "login"
          ? { email: authEmail, password: authPassword }
          : {
              email: authEmail,
              password: authPassword,
              full_name: stringOrNull(authFullName),
              role: "student",
            };

      const data = await fetchJson<AuthResponse>(
        `/auth/${authMode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        null,
      );
      persistAuth(data);
      setAuthPassword("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось выполнить вход.");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshCurrentUser() {
    if (!authToken) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const user = await fetchJson<User>("/auth/me");
      setCurrentUser(user);
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          access_token: authToken,
          token_type: "bearer",
          user,
        }),
      );
      setAuthMessage(`Сессия активна: ${roleLabel(user.role)}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось проверить сессию.");
    } finally {
      setIsLoading(false);
    }
  }

  function logout() {
    setAuthToken(null);
    setCurrentUser(null);
    setActiveTab("stream");
    setSelectedCourseId(null);
    setAssignments([]);
    setCourses([]);
    setSubmissions([]);
    setSelectedAssignmentId(null);
    setSelectedSubmissionId(null);
    setCourseMembers([]);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuthMessage("Вы вышли из системы.");
  }

  function openCourseHome() {
    setSelectedCourseId(null);
    setCourseMembers([]);
    setActiveTab("stream");
    void loadCourses();
    void loadAssignments();
  }

  function selectCourse(courseId: number) {
    setSelectedCourseId(courseId);
    setSelectedAssignmentId(null);
    setSelectedSubmissionId(null);
    setSubmissions([]);
    setAssets([]);
    setChecks([]);
    setAiReview(null);
    setMapPreview(null);
    setSelectedMapFeatureIndex(null);
    setActiveTab("stream");
    setStatusMessage("Курс открыт.");
    void loadAssignments(authToken, courseId);
    void loadCourseMembers(courseId);
  }

  async function loadCourses(token = authToken, includeArchived = true) {
    if (!token) return;

    try {
      const data = await fetchJson<Course[]>(`/courses/?include_archived=${includeArchived}`, {}, token);
      setCourses(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить курсы.");
    }
  }

  async function loadCourseMembers(courseId = selectedCourseId) {
    if (!courseId) {
      setCourseMembers([]);
      return;
    }

    try {
      const data = await fetchJson<CourseMember[]>(`/courses/${courseId}/members`);
      setCourseMembers(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить участников курса.");
    }
  }

  async function addCourseMember() {
    if (!selectedCourseId) {
      setErrorMessage("Выберите курс.");
      return;
    }

    const email = memberEmail.trim();
    if (!email) {
      setErrorMessage("Email участника обязателен.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      await fetchJson<CourseMember>(`/courses/${selectedCourseId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: memberRole }),
      });
      setMemberEmail("");
      setMemberRole("student");
      await loadCourseMembers(selectedCourseId);
      setStatusMessage("Участник добавлен в курс.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось добавить участника.");
    } finally {
      setIsLoading(false);
    }
  }

  async function removeCourseMember(memberId: number) {
    if (!selectedCourseId) {
      setErrorMessage("Выберите курс.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      await fetchJson<void>(`/courses/${selectedCourseId}/members/${memberId}`, {
        method: "DELETE",
      });
      await loadCourseMembers(selectedCourseId);
      setStatusMessage("Участник удалён из курса.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось удалить участника.");
    } finally {
      setIsLoading(false);
    }
  }

  async function createCourse() {
    if (!canEditRequirements) {
      setErrorMessage("Создавать курсы может преподаватель или администратор.");
      return;
    }

    const title = newCourseTitle.trim();
    if (!title) {
      setErrorMessage("Название курса обязательно.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const course = await fetchJson<Course>("/courses/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: stringOrNull(newCourseDescription),
        }),
      });
      setNewCourseTitle("");
      setNewCourseDescription("");
      await loadCourses();
      selectCourse(course.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось создать курс.");
    } finally {
      setIsLoading(false);
    }
  }

  async function archiveCourse(courseId: number) {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      await fetchJson<Course>(`/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      await loadCourses();
      if (selectedCourseId === courseId) {
        setSelectedCourseId(null);
      }
      setStatusMessage("Курс перемещён в архив.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось архивировать курс.");
    } finally {
      setIsLoading(false);
    }
  }

  async function restoreCourse(courseId: number) {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      await fetchJson<Course>(`/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      await loadCourses();
      setStatusMessage("Курс восстановлен из архива.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось восстановить курс.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadAssignments(token = authToken, courseId = selectedCourseId) {
    if (!token) return;

    try {
      const query = courseId ? `?course_id=${courseId}` : "";
      const data = await fetchJson<Assignment[]>(`/assignments/${query}`, {}, token);
      setAssignments(data);
      if ((!selectedAssignmentId || courseId !== selectedCourseId) && data[0]) {
        setSelectedAssignmentId(data[0].id);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить задания.");
    }
  }

  async function createAssignment() {
    if (!newAssignmentTitle.trim()) {
      setErrorMessage("Название задания обязательно.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const assignment = await fetchJson<Assignment>("/assignments/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newAssignmentTitle.trim(),
          description: stringOrNull(newAssignmentDescription),
          course_id: selectedCourseId,
        }),
      });
      setNewAssignmentTitle("");
      setNewAssignmentDescription("");
      setSelectedAssignmentId(assignment.id);
      setStatusMessage(`Задание «${assignment.title}» создано.`);
      await loadAssignments();
      await loadSubmissions();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось создать задание.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSubmissions(token = authToken, assignmentId = selectedAssignmentId) {
    if (!token) return;

    try {
      const query = assignmentId ? `?assignment_id=${assignmentId}` : "";
      const data = await fetchJson<Submission[]>(`/submissions/${query}`, {}, token);
      setSubmissions(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить сдачи.");
    }
  }

  async function selectAssignment(assignmentId: number) {
    setSelectedAssignmentId(assignmentId);
    setSelectedSubmissionId(null);
    setAssets([]);
    setChecks([]);
    setAiReview(null);
    setMapPreview(null);
    setSelectedMapFeatureIndex(null);
    await loadSubmissions(authToken, assignmentId);
    if (canEditRequirements) {
      await loadRequirements(assignmentId);
    }
  }

  async function uploadSubmission() {
    if (!selectedAssignmentId) {
      setErrorMessage("Выберите задание.");
      return;
    }
    if (!submissionFile) {
      setErrorMessage("Выберите архив для сдачи.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("assignment_id", String(selectedAssignmentId));
      formData.append("file", submissionFile);

      const submission = await fetchJson<Submission>("/submissions/", {
        method: "POST",
        body: formData,
      });
      setSubmissionFile(null);
      setSelectedSubmissionId(submission.id);
      setStatusMessage(`Работа «${submission.original_filename}» загружена и проверена.`);
      await loadSubmissions();
      await loadSubmissionDetails(submission.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить работу.");
    } finally {
      setIsLoading(false);
    }
  }

  async function previewSubmissionArchive() {
    if (!selectedAssignmentId) {
      setErrorMessage("Выберите задание.");
      return;
    }
    if (!submissionFile) {
      setErrorMessage("Выберите ZIP-архив для предпросмотра.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("assignment_id", String(selectedAssignmentId));
      formData.append("file", submissionFile);

      const preview = await fetchJson<ArchivePreviewResponse>("/submissions/archive-preview", {
        method: "POST",
        body: formData,
      });
      const previewKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(`${ARCHIVE_PREVIEW_STORAGE_PREFIX}${previewKey}`, JSON.stringify(preview));
      setStatusMessage(`Предпросмотр архива готов: ${preview.layer_count} ГИС-слоёв.`);
      window.open(archivePreviewUrl(previewKey), "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось подготовить предпросмотр архива.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSubmissionDetails(submissionId: number) {
    setSelectedSubmissionId(submissionId);
    setAiReview(null);
    setMapPreview(null);
    setSelectedMapFeatureIndex(null);
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [nextAssets, nextChecks] = await Promise.all([
        fetchJson<SubmissionAsset[]>(`/submissions/${submissionId}/assets`),
        fetchJson<SubmissionCheck[]>(`/submissions/${submissionId}/checks`),
      ]);
      setAssets(nextAssets);
      setChecks(nextChecks);
      setStatusMessage(`Детали submission #${submissionId} загружены.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить детали сдачи.");
    } finally {
      setIsLoading(false);
    }
  }

  async function generateAiReview() {
    if (!selectedSubmissionId) {
      setErrorMessage("Выберите submission.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchJson<AiReviewResponse>(`/submissions/${selectedSubmissionId}/ai-review`, {
        method: "POST",
      });
      setAiReview(data);
      setStatusMessage(`AI-review для submission #${selectedSubmissionId} получен.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось получить AI-review.");
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchAssetGeojsonPreview(assetId: number) {
    return fetchJson<GeoJsonPreview>(`/downloads/submission-assets/${assetId}/geojson-preview`);
  }

  async function loadAssetGeojsonPreview(assetId: number) {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchAssetGeojsonPreview(assetId);
      setMapPreview(data);
      setSelectedMapFeatureIndex(data.geojson.features.length > 0 ? 0 : null);
      setStatusMessage(`Предпросмотр карты для слоя #${assetId} загружен.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить preview слоя.");
    } finally {
      setIsLoading(false);
    }
  }

  function applyLoadedRequirements(next: Requirements) {
    setRequirements({
      ...emptyRequirements,
      ...next,
    });
    setExpectedGeometryTypesText(formatJson(next.expected_geometry_types ?? null));
    setRequiredAttributesText(formatJson(next.required_attributes ?? null));
    setTopologyRulesText(formatJson(next.topology_rules ?? null));
    setExpectedOutputsText(formatJson(next.expected_outputs_json ?? null));
  }

  async function loadRequirements(assignmentId = parsedAssignmentId) {
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      setErrorMessage("Выберите задание.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchJson<Requirements>(`/assignments/${assignmentId}/requirements`);
      applyLoadedRequirements(data);
      setStatusMessage(`Требования загружены для задания #${assignmentId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить требования.";
      if (message.includes("404")) {
        applyLoadedRequirements({ ...emptyRequirements, assignment_id: assignmentId });
        setStatusMessage("Требования пока не созданы. Можно загрузить файл задания или заполнить поля.");
      } else {
        setErrorMessage(message);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function saveRequirements() {
    if (!canEditRequirements) {
      setErrorMessage("Редактировать требования может только преподаватель или администратор.");
      return;
    }
    if (!parsedAssignmentId) {
      setErrorMessage("Выберите задание.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const payload = {
        source_doc_name: stringOrNull(requirements.source_doc_name ?? ""),
        source_text: requirements.source_text ?? null,
        submission_format: stringOrNull(requirements.submission_format ?? "") || "archive",
        deliverable_format: stringOrNull(requirements.deliverable_format ?? ""),
        expected_geometry_types: parseJsonArrayField<string>("Типы геометрии", expectedGeometryTypesText),
        expected_crs: stringOrNull(requirements.expected_crs ?? ""),
        required_attributes: parseJsonArrayField<string>("Обязательные поля", requiredAttributesText),
        topology_rules: parseJsonArrayField<string>("Топологические правила", topologyRulesText),
        expected_outputs_json: parseJsonArrayField<Record<string, unknown>>("Ожидаемые результаты", expectedOutputsText),
        needs_reference_layer: Boolean(requirements.needs_reference_layer),
        report_required: Boolean(requirements.report_required),
        auto_checkable: Boolean(requirements.auto_checkable),
        extraction_status: stringOrNull(requirements.extraction_status ?? ""),
        extraction_notes: stringOrNull(requirements.extraction_notes ?? ""),
      };

      const data = await fetchJson<Requirements>(`/assignments/${parsedAssignmentId}/requirements`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      applyLoadedRequirements(data);
      setStatusMessage(`Требования сохранены. Обновлено: ${new Date().toLocaleTimeString()}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось сохранить требования.");
    } finally {
      setIsLoading(false);
    }
  }

  async function extractRequirementsFromFile() {
    if (!canEditRequirements) {
      setErrorMessage("Извлекать требования может только преподаватель или администратор.");
      return;
    }
    if (!parsedAssignmentId) {
      setErrorMessage("Выберите задание.");
      return;
    }
    if (!assignmentFile) {
      setErrorMessage("Выберите DOCX/DOC/TXT файл задания.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", assignmentFile);

      const data = await fetchJson<Requirements>(
        `/assignments/${parsedAssignmentId}/requirements/extract-from-file`,
        {
          method: "POST",
          body: formData,
        },
      );
      applyLoadedRequirements(data);
      setStatusMessage(`Требования извлечены из файла «${assignmentFile.name}». Проверьте и сохраните правки.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось извлечь требования из файла.");
    } finally {
      setIsLoading(false);
    }
  }

  function clearExpectedOutputs() {
    setExpectedOutputsText("null");
    setRequirements((current) => ({
      ...current,
      extraction_notes:
        current.extraction_notes ||
        "Проверено преподавателем: перечисленные слои являются исходными/учебными данными, а не сдаваемыми outputs.",
    }));
    setStatusMessage("Ожидаемые результаты очищены локально. Нажмите «Сохранить», чтобы записать в backend.");
  }

  return (
    <main className="app-shell">
      <section className="toolbar">
        <div className="brand-block">
          {currentUser ? (
            <button
              className="icon-button"
              onClick={() => setIsSidebarCollapsed((value) => !value)}
              aria-label={isSidebarCollapsed ? "Развернуть боковую панель" : "Свернуть боковую панель"}
              title={isSidebarCollapsed ? "Развернуть боковую панель" : "Свернуть боковую панель"}
            >
              ☰
            </button>
          ) : null}
          <div>
            <p className="eyebrow">ГИС-класс MVP</p>
            <h1>{currentUser ? "Рабочее пространство" : "Вход в систему"}</h1>
          </div>
        </div>

        <div className="toolbar-actions">
          {currentUser ? (
            <div className="user-panel">
              <div>
                <strong>{currentUser.full_name || currentUser.email}</strong>
                <span>{roleLabel(currentUser.role)}</span>
              </div>
              <button onClick={() => void refreshCurrentUser()} disabled={isLoading}>
                Проверить сессию
              </button>
              <button onClick={logout} disabled={isLoading}>
                Выйти
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {!currentUser ? (
        <>
          <section className="status-band">
            <span>{authMessage}</span>
            {errorMessage ? <strong>{errorMessage}</strong> : null}
          </section>
          <AuthPanel
            authMode={authMode}
            authEmail={authEmail}
            authPassword={authPassword}
            authFullName={authFullName}
            isLoading={isLoading}
            onModeChange={setAuthMode}
            onEmailChange={setAuthEmail}
            onPasswordChange={setAuthPassword}
            onFullNameChange={setAuthFullName}
            onSubmit={() => void submitAuthForm()}
          />
        </>
      ) : (
        <section className={isSidebarCollapsed ? "classroom-layout sidebar-collapsed" : "classroom-layout"}>
          <ClassroomSidebar
            currentUser={currentUser}
            activeCourses={activeCourses}
            archivedCoursesCount={archivedCourses.length}
            selectedCourseId={selectedCourseId}
            selectedCourse={selectedCourse}
            activeTab={activeTab}
            themeMode={themeMode}
            isLoading={isLoading}
            isCollapsed={isSidebarCollapsed}
            onCourseHome={openCourseHome}
            onCourseSelect={selectCourse}
            onAssignmentsOpen={() => {
              if (selectedCourse) {
                setActiveTab("assignments");
              }
            }}
            onArchiveOpen={() => {
              setShowArchivedCourses(true);
              openCourseHome();
            }}
            onThemeToggle={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
          />

          <div className="classroom-content">
            <section className="status-band">
              <span>{statusMessage}</span>
              {errorMessage ? <strong>{errorMessage}</strong> : null}
            </section>

            {!selectedCourse ? (
              <CourseHome
                currentUser={currentUser}
                activeCourses={activeCourses}
                archivedCourses={archivedCourses}
                showArchivedCourses={showArchivedCourses}
                newCourseTitle={newCourseTitle}
                newCourseDescription={newCourseDescription}
                isLoading={isLoading}
                onCourseSelect={selectCourse}
                onCourseArchive={archiveCourse}
                onCourseRestore={restoreCourse}
                onCreateCourse={createCourse}
                onTitleChange={setNewCourseTitle}
                onDescriptionChange={setNewCourseDescription}
                onToggleArchived={() => setShowArchivedCourses((value) => !value)}
              />
            ) : null}

            {selectedCourse && canEditRequirements ? (
              <TeacherWorkspace
                course={selectedCourse}
                courses={activeCourses}
                selectedCourseId={selectedCourseId}
                assignments={assignments}
                selectedAssignment={selectedAssignment}
                selectedAssignmentId={selectedAssignmentId}
                newAssignmentTitle={newAssignmentTitle}
                newAssignmentDescription={newAssignmentDescription}
                submissions={submissions}
                courseMembers={courseMembers}
                memberEmail={memberEmail}
                memberRole={memberRole}
                selectedSubmissionId={selectedSubmissionId}
                assets={assets}
                checks={checks}
                aiReview={aiReview}
                mapPreview={mapPreview}
                selectedMapFeatureIndex={selectedMapFeatureIndex}
                requirements={requirements}
                expectedGeometryTypesText={expectedGeometryTypesText}
                requiredAttributesText={requiredAttributesText}
                topologyRulesText={topologyRulesText}
                expectedOutputsText={expectedOutputsText}
                hasExpectedOutputs={hasExpectedOutputs}
                activeTab={activeTab}
                isLoading={isLoading}
                onCourseHome={openCourseHome}
                onCourseSelect={selectCourse}
                onCourseArchive={archiveCourse}
                onTabChange={setActiveTab}
                onAssignmentSelect={(id) => void selectAssignment(id)}
                onAssignmentsReload={() => void loadAssignments()}
                onCreateAssignment={() => void createAssignment()}
                onTitleChange={setNewAssignmentTitle}
                onDescriptionChange={setNewAssignmentDescription}
                onLoadRequirements={() => void loadRequirements()}
                onSaveRequirements={() => void saveRequirements()}
                onAssignmentFileChange={setAssignmentFile}
                onExtractRequirements={() => void extractRequirementsFromFile()}
                onClearExpectedOutputs={clearExpectedOutputs}
                onRequirementsChange={setRequirements}
                onExpectedGeometryTypesChange={setExpectedGeometryTypesText}
                onRequiredAttributesChange={setRequiredAttributesText}
                onTopologyRulesChange={setTopologyRulesText}
                onExpectedOutputsChange={setExpectedOutputsText}
                onLoadSubmissions={() => void loadSubmissions()}
                onLoadCourseMembers={() => void loadCourseMembers()}
                onAddCourseMember={() => void addCourseMember()}
                onRemoveCourseMember={(id) => void removeCourseMember(id)}
                onMemberEmailChange={setMemberEmail}
                onMemberRoleChange={setMemberRole}
                onSubmissionSelect={(id) => void loadSubmissionDetails(id)}
                onGenerateAiReview={() => void generateAiReview()}
                onLoadAssetPreview={(id) => void loadAssetGeojsonPreview(id)}
                onFetchAssetPreview={fetchAssetGeojsonPreview}
                onMapFeatureSelect={setSelectedMapFeatureIndex}
                onDraftSubmitted={async (submission) => {
                  setSelectedAssignmentId(submission.assignment_id);
                  await loadSubmissions(authToken, submission.assignment_id);
                  await loadSubmissionDetails(submission.id);
                  setActiveTab("submissions");
                  setStatusMessage(`Черновик сдан как работа #${submission.id}.`);
                }}
              />
            ) : null}

            {selectedCourse && !canEditRequirements ? (
              <StudentWorkspace
                course={selectedCourse}
                courses={activeCourses}
                selectedCourseId={selectedCourseId}
                assignments={assignments}
                selectedAssignment={selectedAssignment}
                selectedAssignmentId={selectedAssignmentId}
                submissions={submissions}
                courseMembers={courseMembers}
                selectedSubmissionId={selectedSubmissionId}
                assets={assets}
                checks={checks}
                aiReview={aiReview}
                mapPreview={mapPreview}
                selectedMapFeatureIndex={selectedMapFeatureIndex}
                hasSubmissionFile={Boolean(submissionFile)}
                activeTab={activeTab}
                isLoading={isLoading}
                onCourseHome={openCourseHome}
                onCourseSelect={selectCourse}
                onTabChange={setActiveTab}
                onAssignmentSelect={(id) => void selectAssignment(id)}
                onAssignmentsReload={() => void loadAssignments()}
                onLoadCourseMembers={() => void loadCourseMembers()}
                onSubmissionFileChange={setSubmissionFile}
                onUploadSubmission={() => void uploadSubmission()}
                onPreviewSubmissionArchive={() => void previewSubmissionArchive()}
                onSubmissionSelect={(id) => void loadSubmissionDetails(id)}
                onGenerateAiReview={() => void generateAiReview()}
                onLoadAssetPreview={(id) => void loadAssetGeojsonPreview(id)}
                onFetchAssetPreview={fetchAssetGeojsonPreview}
                onMapFeatureSelect={setSelectedMapFeatureIndex}
              />
            ) : null}
          </div>
        </section>
      )}
    </main>
  );
}

function ClassroomSidebar(props: {
  currentUser: User;
  activeCourses: Course[];
  archivedCoursesCount: number;
  selectedCourseId: number | null;
  selectedCourse: Course | null;
  activeTab: CourseTab;
  themeMode: ThemeMode;
  isLoading: boolean;
  isCollapsed: boolean;
  onCourseHome: () => void;
  onCourseSelect: (courseId: number) => void;
  onAssignmentsOpen: () => void;
  onArchiveOpen: () => void;
  onThemeToggle: () => void;
}) {
  return (
    <aside
      className={props.isCollapsed ? "classroom-sidebar collapsed" : "classroom-sidebar"}
      aria-label="Главная навигация"
    >
      <button
        className={!props.selectedCourseId ? "sidebar-item active" : "sidebar-item"}
        onClick={props.onCourseHome}
        disabled={props.isLoading}
        title="Главная страница"
      >
        <span className="sidebar-icon">⌂</span>
        <span>Главная страница</span>
      </button>

      <button
        className={props.selectedCourse && props.activeTab === "assignments" ? "sidebar-item active" : "sidebar-item"}
        onClick={props.onAssignmentsOpen}
        disabled={props.isLoading || !props.selectedCourse}
        title="Список заданий"
      >
        <span className="sidebar-icon">☑</span>
        <span>Список заданий</span>
      </button>

      <div className="sidebar-section">
        <div className="sidebar-section-title">
          <span className="sidebar-icon">◈</span>
          <span>{props.currentUser.role === "student" ? "Мои курсы" : "Курсы преподавателя"}</span>
        </div>
        <div className="sidebar-course-list">
          {props.activeCourses.map((course) => (
            <button
              key={course.id}
              className={course.id === props.selectedCourseId ? "sidebar-course active" : "sidebar-course"}
              onClick={() => props.onCourseSelect(course.id)}
              disabled={props.isLoading}
              title={course.title}
            >
              <span>{course.title.slice(0, 1).toUpperCase()}</span>
              <strong>{course.title}</strong>
            </button>
          ))}
        </div>
      </div>

      <button className="sidebar-item" onClick={props.onArchiveOpen} disabled={props.isLoading} title="Архив курсов">
        <span className="sidebar-icon">▣</span>
        <span>Архив курсов</span>
        <small>{props.archivedCoursesCount}</small>
      </button>

      <button
        className="sidebar-item"
        onClick={props.onThemeToggle}
        title={props.themeMode === "dark" ? "Светлая тема" : "Тёмная тема"}
      >
        <span className="sidebar-icon">◐</span>
        <span>{props.themeMode === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
      </button>
    </aside>
  );
}

function CourseHome(props: {
  currentUser: User;
  activeCourses: Course[];
  archivedCourses: Course[];
  showArchivedCourses: boolean;
  newCourseTitle: string;
  newCourseDescription: string;
  isLoading: boolean;
  onCourseSelect: (courseId: number) => void;
  onCourseArchive: (courseId: number) => void;
  onCourseRestore: (courseId: number) => void;
  onCreateCourse: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onToggleArchived: () => void;
}) {
  const canManageCourses = props.currentUser.role === "teacher" || props.currentUser.role === "admin";

  return (
    <section className="course-home">
      <div className="course-home-header">
        <div>
          <p className="eyebrow">Главное меню</p>
          <h2>Курсы</h2>
          <p>Выберите учебную группу, откройте задания или создайте новый курс для лабораторных работ.</p>
        </div>
        <div className="course-home-meta">
          <span>{props.activeCourses.length} активных</span>
          <span>{props.archivedCourses.length} в архиве</span>
        </div>
      </div>

      {canManageCourses ? (
        <section className="course-create-panel">
          <div>
            <p className="eyebrow">Create class</p>
            <h3>Новый курс / группа</h3>
          </div>
          <label>
            Название
            <input
              value={props.newCourseTitle}
              onChange={(event) => props.onTitleChange(event.target.value)}
              placeholder="Например: КУГИС, группа 421"
            />
          </label>
          <label>
            Описание
            <textarea
              value={props.newCourseDescription}
              onChange={(event) => props.onDescriptionChange(event.target.value)}
              placeholder="Кратко: предмет, семестр, формат сдачи"
            />
          </label>
          <button className="primary" onClick={props.onCreateCourse} disabled={props.isLoading}>
            Создать курс
          </button>
        </section>
      ) : null}

      <section className="course-card-grid">
        {props.activeCourses.map((course) => (
          <article className="course-card" key={course.id}>
            <div>
              <p className="eyebrow">Активный курс</p>
              <h3>{course.title}</h3>
              <p>{course.description}</p>
            </div>
            <div className="course-actions">
              <button className="primary" onClick={() => props.onCourseSelect(course.id)}>
                Открыть
              </button>
              {canManageCourses ? (
                <button onClick={() => props.onCourseArchive(course.id)} disabled={props.isLoading}>
                  В архив
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      <section className="archived-courses">
        <button onClick={props.onToggleArchived}>
          {props.showArchivedCourses ? "Скрыть архив курсов" : "Показать архив курсов"}
        </button>
        {props.showArchivedCourses ? (
          <div className="course-card-grid compact">
            {props.archivedCourses.length === 0 ? <p className="muted">Архив пока пуст.</p> : null}
            {props.archivedCourses.map((course) => (
              <article className="course-card archived" key={course.id}>
                <div>
                  <p className="eyebrow">Архив</p>
                  <h3>{course.title}</h3>
                  <p>{course.description}</p>
                </div>
                {canManageCourses ? (
                  <button onClick={() => props.onCourseRestore(course.id)} disabled={props.isLoading}>
                    Восстановить
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}

function AuthPanel(props: {
  authMode: AuthMode;
  authEmail: string;
  authPassword: string;
  authFullName: string;
  isLoading: boolean;
  onModeChange: (mode: AuthMode) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onFullNameChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="auth-layout">
      <div className="auth-panel">
        <div className="auth-tabs">
          <button
            className={props.authMode === "login" ? "primary" : ""}
            onClick={() => props.onModeChange("login")}
            disabled={props.isLoading}
          >
            Вход
          </button>
          <button
            className={props.authMode === "register" ? "primary" : ""}
            onClick={() => props.onModeChange("register")}
            disabled={props.isLoading}
          >
            Регистрация
          </button>
        </div>

        <label>
          Email
          <input
            type="email"
            value={props.authEmail}
            onChange={(event) => props.onEmailChange(event.target.value)}
            autoComplete="email"
            placeholder="student@example.com"
          />
        </label>

        {props.authMode === "register" ? (
          <label>
            Имя
            <input
              value={props.authFullName}
              onChange={(event) => props.onFullNameChange(event.target.value)}
              autoComplete="name"
              placeholder="Иван Петров"
            />
          </label>
        ) : null}

        <label>
          Пароль
          <input
            type="password"
            value={props.authPassword}
            onChange={(event) => props.onPasswordChange(event.target.value)}
            autoComplete={props.authMode === "login" ? "current-password" : "new-password"}
            placeholder="Минимум 6 символов"
          />
        </label>

        <button className="primary" onClick={props.onSubmit} disabled={props.isLoading}>
          {props.authMode === "login" ? "Войти" : "Создать аккаунт студента"}
        </button>

        <p className="auth-note">
          Публичная регистрация создаёт только студента. Преподавателя и администратора создаёт admin.
        </p>
      </div>
    </section>
  );
}

function TeacherWorkspace(props: {
  course: Course;
  courses: Course[];
  selectedCourseId: number | null;
  assignments: Assignment[];
  selectedAssignment: Assignment | null;
  selectedAssignmentId: number | null;
  newAssignmentTitle: string;
  newAssignmentDescription: string;
  submissions: Submission[];
  courseMembers: CourseMember[];
  memberEmail: string;
  memberRole: "student" | "teacher";
  selectedSubmissionId: number | null;
  assets: SubmissionAsset[];
  checks: SubmissionCheck[];
  aiReview: AiReviewResponse | null;
  mapPreview: GeoJsonPreview | null;
  selectedMapFeatureIndex: number | null;
  requirements: Requirements;
  expectedGeometryTypesText: string;
  requiredAttributesText: string;
  topologyRulesText: string;
  expectedOutputsText: string;
  hasExpectedOutputs: boolean;
  activeTab: CourseTab;
  isLoading: boolean;
  onCourseHome: () => void;
  onCourseSelect: (courseId: number) => void;
  onCourseArchive: (courseId: number) => void;
  onTabChange: (tab: CourseTab) => void;
  onAssignmentSelect: (id: number) => void;
  onAssignmentsReload: () => void;
  onCreateAssignment: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onLoadRequirements: () => void;
  onSaveRequirements: () => void;
  onAssignmentFileChange: (file: File | null) => void;
  onExtractRequirements: () => void;
  onClearExpectedOutputs: () => void;
  onRequirementsChange: (value: Requirements | ((current: Requirements) => Requirements)) => void;
  onExpectedGeometryTypesChange: (value: string) => void;
  onRequiredAttributesChange: (value: string) => void;
  onTopologyRulesChange: (value: string) => void;
  onExpectedOutputsChange: (value: string) => void;
  onLoadSubmissions: () => void;
  onLoadCourseMembers: () => void;
  onAddCourseMember: () => void;
  onRemoveCourseMember: (memberId: number) => void;
  onMemberEmailChange: (value: string) => void;
  onMemberRoleChange: (value: "student" | "teacher") => void;
  onSubmissionSelect: (id: number) => void;
  onGenerateAiReview: () => void;
  onLoadAssetPreview: (assetId: number) => void;
  onFetchAssetPreview: (assetId: number) => Promise<GeoJsonPreview>;
  onMapFeatureSelect: (index: number | null) => void;
  onDraftSubmitted: (submission: Submission) => void | Promise<void>;
}) {
  return (
    <section className="workspace-grid">
      <section className="main-workspace">
        <CourseHeader
          course={props.course}
          role="teacher"
          selectedAssignment={props.selectedAssignment}
          assignmentsCount={props.assignments.length}
          submissionsCount={props.submissions.length}
          activeTab={props.activeTab}
          onTabChange={props.onTabChange}
        />

        {props.activeTab === "stream" ? (
          <ClassStream
            role="teacher"
            selectedAssignment={props.selectedAssignment}
            submissionsCount={props.submissions.length}
            hasExpectedOutputs={props.hasExpectedOutputs}
          />
        ) : null}

        {props.activeTab === "assignments" ? (
          <section className="content-grid compact">
            <AssignmentOverview
              mode="teacher"
              assignments={props.assignments}
              selectedAssignmentId={props.selectedAssignmentId}
              onAssignmentSelect={props.onAssignmentSelect}
              isLoading={props.isLoading}
            />
            <section className="section-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Create</p>
                  <h2>Новое задание</h2>
                </div>
              </div>
              <div className="create-box embedded">
                <label>
                  Название
                  <input value={props.newAssignmentTitle} onChange={(event) => props.onTitleChange(event.target.value)} />
                </label>
                <label>
                  Описание
                  <textarea
                    value={props.newAssignmentDescription}
                    onChange={(event) => props.onDescriptionChange(event.target.value)}
                  />
                </label>
                <button className="primary" onClick={props.onCreateAssignment} disabled={props.isLoading}>
                  Создать задание
                </button>
              </div>
              {props.selectedAssignment ? <AssignmentMaterialsBox assignment={props.selectedAssignment} /> : null}
            </section>
          </section>
        ) : null}

        {props.activeTab === "requirements" && props.selectedAssignmentId ? (
          <RequirementsEditor {...props} />
        ) : null}

        {props.activeTab === "submissions" && props.selectedAssignmentId ? (
          <SubmissionPanel {...props} mode="teacher" onRefresh={props.onLoadSubmissions} />
        ) : null}

        {props.activeTab === "layers" && props.selectedAssignmentId ? (
          <LayerWorkspace {...props} />
        ) : null}

        {props.activeTab === "people" ? (
          <PeoplePanel
            mode="teacher"
            courseMembers={props.courseMembers}
            memberEmail={props.memberEmail}
            memberRole={props.memberRole}
            isLoading={props.isLoading}
            onLoadCourseMembers={props.onLoadCourseMembers}
            onAddCourseMember={props.onAddCourseMember}
            onRemoveCourseMember={props.onRemoveCourseMember}
            onMemberEmailChange={props.onMemberEmailChange}
            onMemberRoleChange={props.onMemberRoleChange}
          />
        ) : null}
      </section>
    </section>
  );
}

function StudentWorkspace(props: {
  course: Course;
  courses: Course[];
  selectedCourseId: number | null;
  assignments: Assignment[];
  selectedAssignment: Assignment | null;
  selectedAssignmentId: number | null;
  submissions: Submission[];
  courseMembers: CourseMember[];
  selectedSubmissionId: number | null;
  assets: SubmissionAsset[];
  checks: SubmissionCheck[];
  aiReview: AiReviewResponse | null;
  mapPreview: GeoJsonPreview | null;
  selectedMapFeatureIndex: number | null;
  hasSubmissionFile: boolean;
  activeTab: CourseTab;
  isLoading: boolean;
  onCourseHome: () => void;
  onCourseSelect: (courseId: number) => void;
  onTabChange: (tab: CourseTab) => void;
  onAssignmentSelect: (id: number) => void;
  onAssignmentsReload: () => void;
  onLoadCourseMembers: () => void;
  onSubmissionFileChange: (file: File | null) => void;
  onUploadSubmission: () => void;
  onPreviewSubmissionArchive: () => void;
  onSubmissionSelect: (id: number) => void;
  onGenerateAiReview: () => void;
  onLoadAssetPreview: (assetId: number) => void;
  onFetchAssetPreview: (assetId: number) => Promise<GeoJsonPreview>;
  onMapFeatureSelect: (index: number | null) => void;
}) {
  return (
    <section className="workspace-grid">
      <section className="main-workspace">
        <CourseHeader
          course={props.course}
          role="student"
          selectedAssignment={props.selectedAssignment}
          assignmentsCount={props.assignments.length}
          submissionsCount={props.submissions.length}
          activeTab={props.activeTab}
          onTabChange={props.onTabChange}
        />

        {props.activeTab === "stream" ? (
          <ClassStream
            role="student"
            selectedAssignment={props.selectedAssignment}
            submissionsCount={props.submissions.length}
            hasExpectedOutputs={false}
          />
        ) : null}

        {props.activeTab === "assignments" ? (
          <section className="content-grid compact">
            <AssignmentOverview
              mode="student"
              assignments={props.assignments}
              selectedAssignmentId={props.selectedAssignmentId}
              onAssignmentSelect={props.onAssignmentSelect}
              isLoading={props.isLoading}
              onOpenWorkspace={(assignmentId) => openAssignmentWorkspace(assignmentId)}
              onContinueDraft={(assignmentId) => openAssignmentWorkspace(assignmentId, { loadDraft: true })}
            />
            <section className="section-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Сдача</p>
                  <h2>Сдать работу</h2>
                </div>
              </div>
              {props.selectedAssignment?.description ? <p className="muted">{props.selectedAssignment.description}</p> : null}
              {props.selectedAssignmentId ? (
                <div className="upload-row">
                  <label>
                    Архив работы
                    <input
                      type="file"
                      accept=".zip,.doc,.docx,.txt,.geojson"
                      onChange={(event) => props.onSubmissionFileChange(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <button className="primary" onClick={props.onUploadSubmission} disabled={props.isLoading}>
                    Сдать работу
                  </button>
                  <button onClick={props.onPreviewSubmissionArchive} disabled={props.isLoading || !props.hasSubmissionFile}>
                    Проверить на карте
                  </button>
                </div>
              ) : null}
            </section>
          </section>
        ) : null}

        {props.activeTab === "submissions" ? (
          <SubmissionPanel {...props} mode="student" />
        ) : null}

        {props.activeTab === "layers" ? (
          <LayerWorkspace {...props} allowDraftSubmit onDraftSubmitted={props.onDraftSubmitted} />
        ) : null}

        {props.activeTab === "people" ? (
          <PeoplePanel
            mode="student"
            courseMembers={props.courseMembers}
            isLoading={props.isLoading}
            onLoadCourseMembers={props.onLoadCourseMembers}
          />
        ) : null}
      </section>
    </section>
  );
}

function CourseHeader(props: {
  course: Course;
  role: "teacher" | "student";
  selectedAssignment: Assignment | null;
  assignmentsCount: number;
  submissionsCount: number;
  activeTab: CourseTab;
  onTabChange: (tab: CourseTab) => void;
}) {
  const tabs: { id: CourseTab; label: string }[] = [
    { id: "stream", label: "Лента" },
    { id: "assignments", label: "Задания" },
    { id: "submissions", label: props.role === "teacher" ? "Сдачи" : "Мои работы" },
    { id: "layers", label: "Слои" },
    { id: "people", label: "Участники" },
  ];

  if (props.role === "teacher") {
    tabs.push({ id: "requirements", label: "Требования" });
  }

  return (
    <section className="course-shell">
      <div className="course-banner">
        <div>
          <p className="eyebrow">{props.role === "teacher" ? "Класс преподавателя" : "Класс студента"}</p>
          <h2>{props.course.title}</h2>
          <p>
            {props.course.description ||
              "Учебное пространство для выдачи ГИС-заданий, сдачи архивов и автоматической проверки отчётов и слоёв."}
          </p>
          {props.selectedAssignment ? <small>Текущее задание: {props.selectedAssignment.title}</small> : null}
        </div>
        <div className="course-stats">
          <span>{props.assignmentsCount} заданий</span>
          <span>{props.submissionsCount} сдач</span>
          <span>{props.role === "teacher" ? "Преподаватель" : "Студент"}</span>
        </div>
      </div>

      <nav className="course-tabs" aria-label="Разделы курса">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={props.activeTab === tab.id ? "active" : ""}
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </section>
  );
}

function ClassStream(props: {
  role: "teacher" | "student";
  selectedAssignment: Assignment | null;
  submissionsCount: number;
  hasExpectedOutputs: boolean;
}) {
  return (
    <section className="stream-grid">
      <aside className="upcoming-panel">
        <h3>Ближайшее</h3>
        <p>{props.selectedAssignment ? "Выбрано текущее задание курса." : "Выберите задание слева."}</p>
        <strong>{props.selectedAssignment?.title ?? "Нет выбранного задания"}</strong>
      </aside>

      <div className="stream-list">
        <article className="stream-card">
          <div className="stream-icon">GIS</div>
          <div>
            <h3>{props.selectedAssignment?.title ?? "Задание курса"}</h3>
            <p>
              {props.role === "teacher"
                ? "Загрузите файл задания, проверьте извлечённые требования и откройте сдачи студентов."
                : "Откройте задание, прикрепите архив с отчётом и ГИС-файлами, затем посмотрите автоматическую обратную связь."}
            </p>
          </div>
        </article>

        <article className="stream-card">
          <div className="stream-icon">AI</div>
          <div>
            <h3>Автоматическая проверка</h3>
            <p>
              {props.hasExpectedOutputs
                ? "Для задания есть формальные ГИС-результаты: система сверяет слои, форматы, геометрию, систему координат и атрибуты."
                : "Если явных ГИС-результатов нет, система анализирует отчёт, вложенные файлы и ограничения проверки."}
            </p>
          </div>
        </article>

        <article className="stream-card">
          <div className="stream-icon">{props.submissionsCount}</div>
          <div>
            <h3>{props.role === "teacher" ? "Сданные работы" : "Мои отправки"}</h3>
            <p>Сейчас в выбранном контексте отображается {props.submissionsCount} submission.</p>
          </div>
        </article>
      </div>
    </section>
  );
}

function AssignmentOverview(props: {
  mode: "teacher" | "student";
  assignments: Assignment[];
  selectedAssignmentId: number | null;
  isLoading: boolean;
  onAssignmentSelect: (id: number) => void;
  onOpenWorkspace?: (id: number) => void;
  onContinueDraft?: (id: number) => void;
}) {
  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Задания</p>
          <h2>Задания курса</h2>
        </div>
      </div>
      <div className="classwork-list">
        {props.assignments.length === 0 ? <p className="muted">Пока нет созданных заданий.</p> : null}
        {props.assignments.map((assignment) => (
          <article
            key={assignment.id}
            className={assignment.id === props.selectedAssignmentId ? "classwork-item active" : "classwork-item"}
          >
            <button
              className="classwork-main"
              onClick={() => props.onAssignmentSelect(assignment.id)}
              disabled={props.isLoading}
            >
              <span className="classwork-dot">#</span>
              <span>
                <strong>{assignment.title}</strong>
                <small>{assignment.description || `Задание #${assignment.id}`}</small>
              </span>
            </button>
            {props.mode === "student" ? (
              <div className="classwork-actions">
                <button onClick={() => props.onOpenWorkspace?.(assignment.id)} disabled={props.isLoading}>
                  Открыть карту
                </button>
                <button onClick={() => props.onContinueDraft?.(assignment.id)} disabled={props.isLoading}>
                  Продолжить черновик
                </button>
                <button onClick={() => props.onAssignmentSelect(assignment.id)} disabled={props.isLoading}>
                  Сдать архив
                </button>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function PeoplePanel(props: {
  mode: "teacher" | "student";
  courseMembers: CourseMember[];
  memberEmail?: string;
  memberRole?: "student" | "teacher";
  isLoading: boolean;
  onLoadCourseMembers: () => void;
  onAddCourseMember?: () => void;
  onRemoveCourseMember?: (memberId: number) => void;
  onMemberEmailChange?: (value: string) => void;
  onMemberRoleChange?: (value: "student" | "teacher") => void;
}) {
  const teachers = props.courseMembers.filter((member) => member.role === "teacher");
  const students = props.courseMembers.filter((member) => member.role === "student");

  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">People</p>
          <h2>Участники курса</h2>
        </div>
        <button onClick={props.onLoadCourseMembers} disabled={props.isLoading}>
          Обновить
        </button>
      </div>

      {props.mode === "teacher" ? (
        <div className="people-add-panel">
          <label>
            Email участника
            <input
              type="email"
              value={props.memberEmail ?? ""}
              onChange={(event) => props.onMemberEmailChange?.(event.target.value)}
              placeholder="student@example.com"
            />
          </label>
          <label>
            Роль
            <select
              value={props.memberRole ?? "student"}
              onChange={(event) => props.onMemberRoleChange?.(event.target.value as "student" | "teacher")}
            >
              <option value="student">Студент</option>
              <option value="teacher">Преподаватель</option>
            </select>
          </label>
          <button className="primary" onClick={props.onAddCourseMember} disabled={props.isLoading}>
            Добавить
          </button>
        </div>
      ) : null}

      <div className="people-groups">
        <PeopleGroup
          title="Преподаватели"
          members={teachers}
          mode={props.mode}
          isLoading={props.isLoading}
          onRemoveCourseMember={props.onRemoveCourseMember}
        />
        <PeopleGroup
          title="Студенты"
          members={students}
          mode={props.mode}
          isLoading={props.isLoading}
          onRemoveCourseMember={props.onRemoveCourseMember}
        />
      </div>
    </section>
  );
}

function PeopleGroup(props: {
  title: string;
  members: CourseMember[];
  mode: "teacher" | "student";
  isLoading: boolean;
  onRemoveCourseMember?: (memberId: number) => void;
}) {
  return (
    <section className="people-group">
      <div className="people-group-heading">
        <h3>{props.title}</h3>
        <span>{props.members.length}</span>
      </div>
      <div className="people-list">
        {props.members.length === 0 ? <p className="muted">Пока никого нет.</p> : null}
        {props.members.map((member) => (
          <div key={member.id} className="people-row">
            <div className="people-avatar">{(member.user.full_name || member.user.email).slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{member.user.full_name || member.user.email}</strong>
              <span>{member.user.email}</span>
            </div>
            {props.mode === "teacher" && props.onRemoveCourseMember ? (
              <button className="danger slim" onClick={() => props.onRemoveCourseMember?.(member.id)} disabled={props.isLoading}>
                Удалить
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function AssignmentMaterialsBox(props: { assignment: Assignment }) {
  const [materials, setMaterials] = useState<AssignmentMaterial[]>([]);
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [message, setMessage] = useState("Исходные слои задания можно открыть в workspace.");
  const [isBusy, setIsBusy] = useState(false);

  async function loadMaterials() {
    setIsBusy(true);
    try {
      const data = await storedAuthFetchJson<AssignmentMaterial[]>(`/assignments/${props.assignment.id}/materials`);
      setMaterials(data);
      setMessage(`Материалов: ${data.length}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить материалы.");
    } finally {
      setIsBusy(false);
    }
  }

  async function uploadMaterial() {
    if (!materialFile) {
      setMessage("Выберите GeoJSON или ZIP со слоями.");
      return;
    }

    const formData = new FormData();
    formData.append("file", materialFile);
    setIsBusy(true);
    try {
      const createdMaterials = await storedAuthFetchJson<AssignmentMaterial[]>(`/assignments/${props.assignment.id}/materials`, {
        method: "POST",
        body: formData,
      });
      setMaterialFile(null);
      await loadMaterials();
      setMessage(`Материалы загружены: ${createdMaterials.length} слоёв.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить материал.");
    } finally {
      setIsBusy(false);
    }
  }

  useEffect(() => {
    void loadMaterials();
  }, [props.assignment.id]);

  return (
    <section className="materials-box">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Материалы карты</p>
          <h3>Исходные слои задания</h3>
        </div>
        <button onClick={() => openAssignmentWorkspace(props.assignment.id)}>Открыть карту</button>
      </div>
      <div className="upload-row">
        <label>
          GeoJSON / ZIP со слоями
          <input
            type="file"
            accept=".geojson,.zip"
            onChange={(event) => setMaterialFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button onClick={uploadMaterial} disabled={isBusy || !materialFile}>
          Загрузить
        </button>
      </div>
      <p className="muted">{message}</p>
      <div className="table-like compact-list">
        {materials.map((material) => (
          <div key={material.id}>
            <strong>{layerDisplayName(material.material_name)}</strong>
            <span>
              {material.detected_format} · {statusLabel(material.status)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function materialToLayerAsset(material: AssignmentMaterial): SubmissionAsset {
  return {
    id: material.id,
    submission_id: 0,
    asset_name: material.material_name,
    asset_type: material.material_type,
    detected_format: material.detected_format,
    status: material.status,
    message: material.message,
  };
}

function StandaloneArchivePreview(props: { previewKey: string }) {
  const [preview, setPreview] = useState<ArchivePreviewResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    document.documentElement.dataset.theme = savedTheme === "dark" ? "dark" : "light";
  }, []);

  useEffect(() => {
    try {
      const rawPreview = localStorage.getItem(`${ARCHIVE_PREVIEW_STORAGE_PREFIX}${props.previewKey}`);
      if (!rawPreview) {
        setErrorMessage("Предпросмотр архива не найден. Выберите ZIP ещё раз в основной вкладке.");
        return;
      }
      setPreview(JSON.parse(rawPreview) as ArchivePreviewResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось открыть предпросмотр архива.");
    }
  }, [props.previewKey]);

  async function fetchPreloadedPreview(assetId: number) {
    const layerPreview = preview?.previews.find((item) => item.asset_id === assetId);
    if (layerPreview) {
      return layerPreview;
    }
    if (preview?.preview_token) {
      return storedAuthFetchJson<GeoJsonPreview>(
        `/submissions/archive-preview/${preview.preview_token}/assets/${assetId}/geojson-preview`,
      );
    }
    throw new Error(`Preview для слоя #${assetId} не найден.`);
  }

  return (
    <main className="map-viewer-shell">
      {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
      {preview ? (
        <>
          {preview.warnings.length > 0 ? <div className="alert">{preview.warnings.slice(0, 5).join(" ")}</div> : null}
          <ArchivePreviewReport preview={preview} />
          <LayerWorkspace
            selectedSubmissionId={0}
            workspaceTitle={`Предпросмотр: ${preview.source_filename}`}
            submissions={[]}
            assets={preview.assets}
            preloadedPreviews={preview.previews}
            isLoading={false}
            onSubmissionSelect={() => undefined}
            onFetchAssetPreview={fetchPreloadedPreview}
            isStandalone
            autoLoadLayers
            hideHeader
          />
        </>
      ) : null}
    </main>
  );
}

function ArchivePreviewReport(props: { preview: ArchivePreviewResponse }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const summaries = props.preview.layer_summaries ?? [];
  const warningCount = summaries.filter((item) => item.status === "warning").length;
  const failedCount = summaries.filter((item) => item.status === "failed").length;
  const missingCrsCount = summaries.filter((item) => !item.crs).length;
  const invalidGeometryCount = summaries.reduce((sum, item) => sum + (item.invalid_geometry_count ?? 0), 0);

  return (
    <section className="archive-preview-report">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Предварительная проверка</p>
          <h2>Состав архива</h2>
        </div>
        <div className="archive-preview-stats">
          <span>{props.preview.layer_count} слоёв</span>
          <span>{warningCount} замечаний</span>
          <span>{failedCount} ошибок</span>
          <button
            className="archive-preview-toggle"
            onClick={() => setIsExpanded((value) => !value)}
          >
            {isExpanded ? "Свернуть состав" : "Показать состав"}
          </button>
        </div>
      </div>
      <div className="archive-preview-summary">
        <span>Без СК: {missingCrsCount}</span>
        <span>Невалидных геометрий: {invalidGeometryCount}</span>
        <span>Файл: {props.preview.source_filename}</span>
      </div>
      {isExpanded ? <div className="archive-layer-table-wrap">
        <table className="archive-layer-table">
          <thead>
            <tr>
              <th>Слой</th>
              <th>Статус</th>
              <th>Объекты</th>
              <th>Геометрия</th>
              <th>СК</th>
              <th>Поля</th>
            </tr>
          </thead>
          <tbody>
            {summaries.length === 0 ? (
              <tr>
                <td colSpan={6}>ГИС-слои не найдены.</td>
              </tr>
            ) : null}
            {summaries.map((summary) => (
              <tr key={summary.asset_id}>
                <td>
                  <strong>{layerDisplayName(summary.asset_name)}</strong>
                  <span>{summary.detected_format}</span>
                </td>
                <td>
                  <strong>{statusLabel(summary.status ?? "unknown")}</strong>
                  {summary.message ? <span>{summary.message}</span> : null}
                </td>
                <td>{summary.feature_count ?? "—"}</td>
                <td>{summary.geometry_types?.join(", ") || "—"}</td>
                <td>{summary.crs || "не задана"}</td>
                <td>{summary.attribute_fields?.slice(0, 6).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : null}
    </section>
  );
}

function StandaloneAssignmentWorkspace(props: { assignmentId: number; autoLoadDraft?: boolean }) {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [materials, setMaterials] = useState<AssignmentMaterial[]>([]);
  const [submittedSubmission, setSubmittedSubmission] = useState<Submission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    document.documentElement.dataset.theme = savedTheme === "dark" ? "dark" : "light";
  }, []);

  useEffect(() => {
    async function loadWorkspace() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const [nextAssignment, nextMaterials] = await Promise.all([
          storedAuthFetchJson<Assignment>(`/assignments/${props.assignmentId}`),
          storedAuthFetchJson<AssignmentMaterial[]>(`/assignments/${props.assignmentId}/materials`),
        ]);
        setAssignment(nextAssignment);
        setMaterials(nextMaterials);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось открыть workspace задания.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadWorkspace();
  }, [props.assignmentId]);

  async function fetchMaterialPreview(materialId: number) {
    return storedAuthFetchJson<GeoJsonPreview>(`/downloads/assignment-materials/${materialId}/geojson-preview`);
  }

  return (
    <main className="map-viewer-shell">
      {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
      {submittedSubmission ? (
        <div className="alert success">
          Черновик сдан как работа #{submittedSubmission.id}. Проверки доступны в курсе во вкладке «Мои работы».
        </div>
      ) : null}
      <LayerWorkspace
        selectedSubmissionId={null}
        workspaceAssignment={assignment}
        submissions={[]}
        assets={materials.map(materialToLayerAsset)}
        isLoading={isLoading}
        onSubmissionSelect={() => undefined}
        onFetchAssetPreview={fetchMaterialPreview}
        isStandalone
        isAssignmentWorkspace
        autoLoadLayers
        autoLoadDraft={props.autoLoadDraft}
        allowDraftSubmit={storedUserRole() === "student"}
        onDraftSubmitted={setSubmittedSubmission}
      />
    </main>
  );
}

function StandaloneMapViewer(props: { submissionId: number }) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [assets, setAssets] = useState<SubmissionAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    document.documentElement.dataset.theme = savedTheme === "dark" ? "dark" : "light";
  }, []);

  function viewerAuthHeaders(): HeadersInit {
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

  async function viewerFetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: viewerAuthHeaders(),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${path} вернул ${response.status}: ${text}`);
    }
    return (await response.json()) as T;
  }

  useEffect(() => {
    async function loadAssets() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const [nextSubmission, nextAssets] = await Promise.all([
          storedAuthFetchJson<Submission>(`/submissions/${props.submissionId}`),
          storedAuthFetchJson<SubmissionAsset[]>(`/submissions/${props.submissionId}/assets`),
        ]);
        setSubmission(nextSubmission);
        setAssets(nextAssets);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить слои сдачи.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadAssets();
  }, [props.submissionId]);

  async function fetchAssetPreview(assetId: number) {
    return storedAuthFetchJson<GeoJsonPreview>(`/downloads/submission-assets/${assetId}/geojson-preview`);
  }

  return (
    <main className="map-viewer-shell">
      {false ? <header className="map-viewer-header">
        <div>
          <p className="eyebrow">Просмотр ГИС-слоёв</p>
          <h1>Карта сдачи #{props.submissionId}</h1>
        </div>
        <button onClick={() => window.close()}>Закрыть вкладку</button>
      </header> : null}
      {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
      <LayerWorkspace
        selectedSubmissionId={props.submissionId}
        submissions={submission ? [submission] : []}
        assets={assets}
        isLoading={isLoading}
        onSubmissionSelect={() => undefined}
        onFetchAssetPreview={fetchAssetPreview}
        isStandalone
        autoLoadLayers
      />
    </main>
  );
}

function LayerWorkspace(props: {
  selectedSubmissionId: number | null;
  workspaceAssignment?: Assignment | null;
  workspaceTitle?: string;
  submissions: Submission[];
  assets: SubmissionAsset[];
  preloadedPreviews?: GeoJsonPreview[];
  isLoading: boolean;
  onSubmissionSelect: (id: number) => void;
  onFetchAssetPreview: (assetId: number) => Promise<GeoJsonPreview>;
  isStandalone?: boolean;
  isAssignmentWorkspace?: boolean;
  autoLoadLayers?: boolean;
  autoLoadDraft?: boolean;
  hideHeader?: boolean;
  allowDraftSubmit?: boolean;
  onDraftSubmitted?: (submission: Submission) => void | Promise<void>;
}) {
  const localLayerInputRef = useRef<HTMLInputElement | null>(null);
  const localLayerFolderInputRef = useRef<HTMLInputElement | null>(null);
  const [layers, setLayers] = useState<LayerPreviewState[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<SelectedLayerFeature>(null);
  const [loadingLayerIds, setLoadingLayerIds] = useState<number[]>([]);
  const [layerErrors, setLayerErrors] = useState<Record<number, string>>({});
  const [draggedLayerId, setDraggedLayerId] = useState<number | null>(null);
  const [layerMenuId, setLayerMenuId] = useState<number | null>(null);
  const [layerMenuPosition, setLayerMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [groupMenuName, setGroupMenuName] = useState<string | null>(null);
  const [groupMenuPosition, setGroupMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [layerPropertiesId, setLayerPropertiesId] = useState<number | null>(null);
  const [layerPropertiesPosition, setLayerPropertiesPosition] = useState({ x: 390, y: 70 });
  const [layerPropertiesDragOffset, setLayerPropertiesDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [expandedLayerId] = useState<number | null>(null);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<number[]>([]);
  const [removedLayerIds, setRemovedLayerIds] = useState<number[]>([]);
  const [tableLayerId, setTableLayerId] = useState<number | null>(null);
  const [isTableWindowOpen, setIsTableWindowOpen] = useState(false);
  const [isDraftEditingEnabled, setIsDraftEditingEnabled] = useState(false);
  const [activeEditableLayerId, setActiveEditableLayerId] = useState<number | null>(null);
  const [zoomToLayerId, setZoomToLayerId] = useState<number | null>(null);
  const [zoomToLayerTick, setZoomToLayerTick] = useState(0);
  const [localLayerStatus, setLocalLayerStatus] = useState<string | null>(null);
  const [layerGroupNames, setLayerGroupNames] = useState<string[]>([DEFAULT_LAYER_GROUP]);
  const [layerGroups, setLayerGroups] = useState<Record<number, string>>({});
  const [collapsedLayerGroups, setCollapsedLayerGroups] = useState<string[]>([]);
  const [editingGroupName, setEditingGroupName] = useState<string | null>(null);
  const [editingGroupDraft, setEditingGroupDraft] = useState("");
  const [newLayerGroupName, setNewLayerGroupName] = useState("");
  const [renamingLayerId, setRenamingLayerId] = useState<number | null>(null);
  const [layerAliases, setLayerAliases] = useState<Record<number, string>>({});
  const [assignedLayerCrs, setAssignedLayerCrs] = useState<Record<number, string>>({});
  const [layerStyles, setLayerStyles] = useState<Record<number, LayerStyleSettings>>({});
  const [layerLayoutHistory, setLayerLayoutHistory] = useState<LayerLayoutSnapshot[]>([]);
  const [layerLayoutFuture, setLayerLayoutFuture] = useState<LayerLayoutSnapshot[]>([]);
  const [windowZIndexes, setWindowZIndexes] = useState<Record<MapWindowKey, number>>({
    layerProperties: 22,
    table: 23,
    draftProperties: 24,
  });
  const nextWindowZIndexRef = useRef(30);
  const groupRenameInputRef = useRef<HTMLInputElement | null>(null);
  const autoLoadedLayersKeyRef = useRef<string | null>(null);
  const previewableAssets = props.assets.filter(isPreviewableAsset);
  const visiblePreviewableAssets = previewableAssets.filter(
    (asset) => !hiddenLayerIds.includes(asset.id) && !removedLayerIds.includes(asset.id),
  );
  const previewableAssetKey = previewableAssets.map((asset) => asset.id).join(",");
  const loadedLayerIds = new Set(layers.map((layer) => layer.asset.id));
  const orderedAssets = [
    ...layers
      .filter((layer) => !hiddenLayerIds.includes(layer.asset.id) && !removedLayerIds.includes(layer.asset.id))
      .map((layer) => layer.asset),
    ...visiblePreviewableAssets.filter((asset) => !loadedLayerIds.has(asset.id)),
  ];
  const selectedSubmission = props.submissions.find((submission) => submission.id === props.selectedSubmissionId) ?? null;
  const workspaceAssignmentId = props.workspaceAssignment?.id ?? selectedSubmission?.assignment_id ?? null;
  const layerGroupStorageKey = [
    "gis_edu_layer_groups",
    props.isAssignmentWorkspace ? "assignment" : props.selectedSubmissionId ? "submission" : "workspace",
    props.workspaceAssignment?.id ?? props.selectedSubmissionId ?? props.workspaceTitle ?? "default",
  ].join(":");
  const workspaceIsOpen = Boolean(
    props.selectedSubmissionId ||
      props.workspaceAssignment ||
      props.workspaceTitle ||
      props.preloadedPreviews?.length,
  );
  const propertiesLayer = layerPropertiesId
    ? layers.find((layer) => layer.asset.id === layerPropertiesId) ?? null
    : null;
  const allLoadedLayersVisible = layers.length > 0 && layers.every((layer) => layer.visible);
  const activeEditableLayer = activeEditableLayerId
    ? layers.find((layer) => layer.asset.id === activeEditableLayerId) ?? null
    : null;
  const allLayerGroupNames = Array.from(
    new Set([DEFAULT_LAYER_GROUP, ...layerGroupNames, ...orderedAssets.map((asset) => layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP)]),
  );
  const groupedAssets = allLayerGroupNames
    .map((groupName) => ({
      groupName,
      assets: orderedAssets.filter((asset) => (layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP) === groupName),
    }))
    .filter((group) => group.assets.length > 0 || group.groupName !== DEFAULT_LAYER_GROUP);

  useEffect(() => {
    setLayers([]);
    setSelectedFeature(null);
    setLayerErrors({});
    setLoadingLayerIds([]);
    setDraggedLayerId(null);
    setLayerMenuId(null);
    setLayerMenuPosition(null);
    setGroupMenuName(null);
    setGroupMenuPosition(null);
    setLayerPropertiesId(null);
    setLayerPropertiesDragOffset(null);
    setHiddenLayerIds([]);
    setRemovedLayerIds([]);
    setTableLayerId(null);
    setIsTableWindowOpen(false);
    setIsDraftEditingEnabled(false);
    setActiveEditableLayerId(null);
    setZoomToLayerId(null);
    setZoomToLayerTick(0);
    setLocalLayerStatus(null);
    try {
      const savedGroups = JSON.parse(localStorage.getItem(layerGroupStorageKey) ?? "{}") as {
        names?: string[];
        assignments?: Record<number, string>;
        collapsed?: string[];
        aliases?: Record<number, string>;
        assignedCrs?: Record<number, string>;
        styles?: Record<number, LayerStyleSettings>;
      };
      setLayerGroupNames(savedGroups.names?.length ? Array.from(new Set([DEFAULT_LAYER_GROUP, ...savedGroups.names])) : [DEFAULT_LAYER_GROUP]);
      setLayerGroups(savedGroups.assignments ?? {});
      setCollapsedLayerGroups(savedGroups.collapsed ?? []);
      setLayerAliases(savedGroups.aliases ?? {});
      setAssignedLayerCrs(savedGroups.assignedCrs ?? {});
      setLayerStyles(savedGroups.styles ?? {});
    } catch {
      setLayerGroupNames([DEFAULT_LAYER_GROUP]);
      setLayerGroups({});
      setCollapsedLayerGroups([]);
      setLayerAliases({});
      setAssignedLayerCrs({});
      setLayerStyles({});
    }
    setEditingGroupName(null);
    setEditingGroupDraft("");
    setRenamingLayerId(null);
    setLayerLayoutHistory([]);
    setLayerLayoutFuture([]);
    autoLoadedLayersKeyRef.current = null;
  }, [props.selectedSubmissionId, layerGroupStorageKey]);

  useEffect(() => {
    if (!workspaceIsOpen) {
      return;
    }
    localStorage.setItem(
      layerGroupStorageKey,
      JSON.stringify({
        names: layerGroupNames,
        assignments: layerGroups,
        collapsed: collapsedLayerGroups,
        aliases: layerAliases,
        assignedCrs: assignedLayerCrs,
        styles: layerStyles,
      }),
    );
  }, [workspaceIsOpen, layerGroupStorageKey, layerGroupNames, layerGroups, collapsedLayerGroups, layerAliases, assignedLayerCrs, layerStyles]);

  useEffect(() => {
    if (!editingGroupName) {
      return;
    }
    groupRenameInputRef.current?.focus();
    groupRenameInputRef.current?.select();
  }, [editingGroupName]);

  async function loadLayer(asset: SubmissionAsset) {
    if (layers.some((layer) => layer.asset.id === asset.id)) {
      setLayers((current) =>
        current.map((layer) => (layer.asset.id === asset.id ? { ...layer, visible: true } : layer)),
      );
      return;
    }

    setLoadingLayerIds((current) => [...current, asset.id]);
    setLayerErrors((current) => {
      const next = { ...current };
      delete next[asset.id];
      return next;
    });

    try {
      const preview =
        props.preloadedPreviews?.find((item) => item.asset_id === asset.id) ??
        (await props.onFetchAssetPreview(asset.id));
      setLayers((current) => [
        ...current,
        {
          asset,
          preview,
          visible: true,
          labelsVisible: false,
          labelField: defaultLabelField(preview),
        },
      ]);
      if (preview.geojson.features.length > 0) {
        setSelectedFeature({ assetId: asset.id, featureIndex: 0 });
      }
    } catch (error) {
      setLayerErrors((current) => ({
        ...current,
        [asset.id]: error instanceof Error ? error.message : "Не удалось открыть слой.",
      }));
    } finally {
      setLoadingLayerIds((current) => current.filter((id) => id !== asset.id));
    }
  }

  async function loadAllLayers() {
    for (const asset of visiblePreviewableAssets) {
      if (!layers.some((layer) => layer.asset.id === asset.id)) {
        await loadLayer(asset);
      }
    }
  }

  useEffect(() => {
    if (!props.autoLoadLayers || !workspaceIsOpen || previewableAssets.length === 0) {
      return;
    }
    if (autoLoadedLayersKeyRef.current === previewableAssetKey) {
      return;
    }
    autoLoadedLayersKeyRef.current = previewableAssetKey;
    void loadAllLayers();
  }, [props.autoLoadLayers, workspaceIsOpen, previewableAssetKey]);

  function toggleLayer(assetId: number) {
    rememberLayerLayout();
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId ? { ...layer, visible: !layer.visible } : layer,
      ),
    );
  }

  function toggleAllLoadedLayers() {
    const nextVisible = !allLoadedLayersVisible;
    rememberLayerLayout();
    setLayers((current) => current.map((layer) => ({ ...layer, visible: nextVisible })));
  }

  function toggleLayerGroupVisibility(groupName: string) {
    const groupLayerIds = layers
      .filter((layer) => (layerGroups[layer.asset.id] ?? DEFAULT_LAYER_GROUP) === groupName)
      .map((layer) => layer.asset.id);
    if (groupLayerIds.length === 0) {
      return;
    }
    rememberLayerLayout();
    const groupIsVisible = layers
      .filter((layer) => groupLayerIds.includes(layer.asset.id))
      .every((layer) => layer.visible);
    setLayers((current) =>
      current.map((layer) =>
        groupLayerIds.includes(layer.asset.id) ? { ...layer, visible: !groupIsVisible } : layer,
      ),
    );
  }

  function uniqueLayerGroupName(baseName: string) {
    let index = 1;
    let candidate = baseName;
    while (layerGroupNames.includes(candidate)) {
      index += 1;
      candidate = `${baseName} ${index}`;
    }
    return candidate;
  }

  function addLayerGroup() {
    rememberLayerLayout();
    const groupName = uniqueLayerGroupName("Новая группа");
    setLayerGroupNames((current) => [...current, groupName]);
    setCollapsedLayerGroups((current) => current.filter((name) => name !== groupName));
    setEditingGroupName(groupName);
    setEditingGroupDraft(groupName);
  }

  function commitLayerGroupRename() {
    if (!editingGroupName) {
      return;
    }
    const nextName = editingGroupDraft.trim() || editingGroupName;
    const duplicate = layerGroupNames.some((name) => name !== editingGroupName && name === nextName);
    if (duplicate || nextName === editingGroupName) {
      setEditingGroupName(null);
      setEditingGroupDraft("");
      return;
    }
    rememberLayerLayout();
    setLayerGroupNames((current) => current.map((name) => (name === editingGroupName ? nextName : name)));
    setLayerGroups((current) =>
      Object.fromEntries(
        Object.entries(current).map(([assetId, groupName]) => [
          assetId,
          groupName === editingGroupName ? nextName : groupName,
        ]),
      ),
    );
    setCollapsedLayerGroups((current) => current.map((name) => (name === editingGroupName ? nextName : name)));
    setEditingGroupName(null);
    setEditingGroupDraft("");
  }

  function toggleLayerGroupCollapse(groupName: string) {
    rememberLayerLayout();
    setCollapsedLayerGroups((current) =>
      current.includes(groupName)
        ? current.filter((name) => name !== groupName)
        : [...current, groupName],
    );
  }

  function deleteLayerGroup(groupName: string) {
    if (groupName === DEFAULT_LAYER_GROUP) {
      closeGroupMenu();
      return;
    }
    const groupAssetIds = orderedAssets
      .filter((asset) => (layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP) === groupName)
      .map((asset) => asset.id);
    rememberLayerLayout();
    setLayers((current) => current.filter((layer) => !groupAssetIds.includes(layer.asset.id)));
    setRemovedLayerIds((current) => Array.from(new Set([...current, ...groupAssetIds])));
    setHiddenLayerIds((current) => current.filter((assetId) => !groupAssetIds.includes(assetId)));
    setLayerGroupNames((current) => current.filter((name) => name !== groupName));
    setLayerGroups((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        delete next[assetId];
      });
      return next;
    });
    setLayerAliases((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        delete next[assetId];
      });
      return next;
    });
    setAssignedLayerCrs((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        delete next[assetId];
      });
      return next;
    });
    setLayerStyles((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        delete next[assetId];
      });
      return next;
    });
    setCollapsedLayerGroups((current) => current.filter((name) => name !== groupName));
    if (editingGroupName === groupName) {
      setEditingGroupName(null);
      setEditingGroupDraft("");
    }
    closeGroupMenu();
  }

  function setAssetLayerGroup(assetId: number, groupName: string) {
    rememberLayerLayout();
    setLayerGroupNames((current) => (current.includes(groupName) ? current : [...current, groupName]));
    setLayerGroups((current) => ({ ...current, [assetId]: groupName || DEFAULT_LAYER_GROUP }));
  }

  function setLayerAssignedCrs(assetId: number, crs: string) {
    rememberLayerLayout();
    setAssignedLayerCrs((current) => {
      const next = { ...current };
      if (crs) {
        next[assetId] = crs;
      } else {
        delete next[assetId];
      }
      return next;
    });
  }

  function setLayerStyle(assetId: number, patch: Partial<LayerStyleSettings>) {
    const layerIndex = Math.max(0, layers.findIndex((layer) => layer.asset.id === assetId));
    rememberLayerLayout();
    setLayerStyles((current) => ({
      ...current,
      [assetId]: normalizeLayerStyle({ ...(current[assetId] ?? defaultLayerStyle(layerIndex)), ...patch }, layerIndex),
    }));
  }

  function groupAssignedCrsValue(groupName: string) {
    const groupAssetIds = orderedAssets
      .filter((asset) => (layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP) === groupName)
      .map((asset) => asset.id);
    const assignedValues = Array.from(
      new Set(groupAssetIds.map((assetId) => assignedLayerCrs[assetId]).filter(Boolean)),
    );
    if (assignedValues.length === 0) {
      return "";
    }
    return assignedValues.length === 1 ? assignedValues[0] : "__mixed__";
  }

  function setGroupAssignedCrs(groupName: string, crs: string) {
    if (crs === "__mixed__") {
      return;
    }
    const groupAssetIds = orderedAssets
      .filter((asset) => (layerGroups[asset.id] ?? DEFAULT_LAYER_GROUP) === groupName)
      .map((asset) => asset.id);
    if (groupAssetIds.length === 0) {
      return;
    }
    rememberLayerLayout();
    setAssignedLayerCrs((current) => {
      const next = { ...current };
      groupAssetIds.forEach((assetId) => {
        if (crs) {
          next[assetId] = crs;
        } else {
          delete next[assetId];
        }
      });
      return next;
    });
  }

  function dropLayerIntoGroup(groupName: string) {
    if (!draggedLayerId) {
      return;
    }
    setAssetLayerGroup(draggedLayerId, groupName);
    setDraggedLayerId(null);
  }

  function commitLayerAlias(assetId: number, value: string) {
    const alias = value.trim();
    rememberLayerLayout();
    setLayerAliases((current) => {
      const next = { ...current };
      if (alias) {
        next[assetId] = alias;
      } else {
        delete next[assetId];
      }
      return next;
    });
    setRenamingLayerId(null);
  }

  function hideLayer(assetId: number) {
    rememberLayerLayout();
    setLayers((current) => current.filter((layer) => layer.asset.id !== assetId));
    setRemovedLayerIds((current) => (current.includes(assetId) ? current : [...current, assetId]));
    setHiddenLayerIds((current) => current.filter((id) => id !== assetId));
    setSelectedFeature((current) => (current?.assetId === assetId ? null : current));
    setLayerPropertiesId((current) => (current === assetId ? null : current));
    setTableLayerId((current) => (current === assetId ? null : current));
    setLayerMenuId((current) => (current === assetId ? null : current));
    if (activeEditableLayerId === assetId) {
      setActiveEditableLayerId(null);
      setIsDraftEditingEnabled(false);
    }
    setLayerGroups((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
    setAssignedLayerCrs((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
    setLayerStyles((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
  }

  function hideLayerFromList(assetId: number) {
    rememberLayerLayout();
    setHiddenLayerIds((current) => (current.includes(assetId) ? current : [...current, assetId]));
    setLayers((current) =>
      current.map((layer) => (layer.asset.id === assetId ? { ...layer, visible: false } : layer)),
    );
    setSelectedFeature((current) => (current?.assetId === assetId ? null : current));
    setLayerPropertiesId((current) => (current === assetId ? null : current));
    setTableLayerId((current) => (current === assetId ? null : current));
    setLayerMenuId((current) => (current === assetId ? null : current));
    if (activeEditableLayerId === assetId) {
      setActiveEditableLayerId(null);
      setIsDraftEditingEnabled(false);
    }
  }

  function addLocalPreviewLayer(asset: SubmissionAsset, preview: GeoJsonPreview, groupName = LOCAL_LAYER_GROUP) {
    rememberLayerLayout();
    setLayerGroupNames((current) => (current.includes(groupName) ? current : [...current, groupName]));
    setLayerGroups((current) => ({ ...current, [asset.id]: groupName }));
    setRemovedLayerIds((current) => current.filter((id) => id !== asset.id));
    setLayers((current) => [
      ...current.filter((layer) => layer.asset.id !== asset.id),
      {
        asset,
        preview,
        visible: true,
        labelsVisible: false,
        labelField: defaultLabelField(preview),
      },
    ]);
    setHiddenLayerIds((current) => current.filter((id) => id !== asset.id));
    if (preview.geojson.features.length > 0) {
      setSelectedFeature({ assetId: asset.id, featureIndex: 0 });
    }
  }

  function createEmptyEditableLayer() {
    if (!workspaceIsOpen) {
      return;
    }
    const name = window.prompt("Название нового слоя", "Новый слой")?.trim();
    if (!name) {
      return;
    }
    const availableGroups = allLayerGroupNames.length > 0 ? allLayerGroupNames : [DEFAULT_LAYER_GROUP];
    const groupInput = window.prompt(
      `Группа слоя (${availableGroups.join(", ")})`,
      availableGroups[0] ?? DEFAULT_LAYER_GROUP,
    )?.trim();
    const groupName = groupInput || DEFAULT_LAYER_GROUP;
    const assetId = -Date.now();
    const asset: SubmissionAsset = {
      id: assetId,
      submission_id: 0,
      asset_name: `${name}.geojson`,
      asset_type: "layer",
      detected_format: "geojson",
      status: "uploaded",
      message: "Пустой слой создан в рабочей карте.",
    };
    const preview: GeoJsonPreview = {
      asset_id: assetId,
      asset_name: asset.asset_name,
      detected_format: "geojson",
      source_crs: "EPSG:4326",
      crs: "EPSG:4326",
      feature_count: 0,
      preview_feature_count: 0,
      truncated: false,
      geojson: { type: "FeatureCollection", features: [] },
    };
    addLocalPreviewLayer(asset, preview, groupName);
    setLayerAliases((current) => ({ ...current, [assetId]: name }));
    setActiveEditableLayerId(assetId);
    setIsDraftEditingEnabled(true);
    setTableLayerId(assetId);
    setIsTableWindowOpen(true);
    bringWindowToFront("table");
    setLocalLayerStatus(`Создан пустой слой «${name}».`);
  }

  async function loadLocalLayerFile(file: File) {
    setLocalLayerStatus(`Загрузка слоя «${file.name}»...`);
    try {
      if (file.name.toLowerCase().endsWith(".geojson") || file.type.includes("json")) {
        const geojson = normalizeGeoJsonFeatureCollection(JSON.parse(await file.text()));
        const assetId = -Date.now();
        const asset: SubmissionAsset = {
          id: assetId,
          submission_id: 0,
          asset_name: file.name,
          asset_type: "layer",
          detected_format: "geojson",
          status: "uploaded",
          message: "Локальный GeoJSON загружен в рабочую карту.",
        };
        const preview: GeoJsonPreview = {
          asset_id: assetId,
          asset_name: file.name,
          detected_format: "geojson",
          source_crs: "EPSG:4326",
          crs: "EPSG:4326",
          feature_count: geojson.features.length,
          preview_feature_count: geojson.features.length,
          truncated: false,
          geojson,
        };
        addLocalPreviewLayer(asset, preview);
        setLocalLayerStatus(`Локальный GeoJSON загружен: ${geojson.features.length} объектов.`);
        return;
      }

      if (!file.name.toLowerCase().endsWith(".zip")) {
        throw new Error("Пока поддерживаются GeoJSON и ZIP с GIS-слоями.");
      }
      if (!workspaceAssignmentId) {
        throw new Error("Для ZIP-preview нужен открытый workspace задания.");
      }

      const formData = new FormData();
      formData.append("assignment_id", String(workspaceAssignmentId));
      formData.append("file", file);
      const archivePreview = await storedAuthFetchJson<ArchivePreviewResponse>("/submissions/archive-preview", {
        method: "POST",
        body: formData,
      });

      let loadedCount = 0;
      for (const asset of archivePreview.assets.filter(isPreviewableAsset)) {
        const tempPreview = await storedAuthFetchJson<GeoJsonPreview>(
          `/submissions/archive-preview/${archivePreview.preview_token}/assets/${asset.id}/geojson-preview`,
        );
        const assetId = -(Date.now() + asset.id + loadedCount);
        const localAsset = {
          ...asset,
          id: assetId,
          submission_id: 0,
          asset_name: layerDisplayName(asset.asset_name),
          status: "uploaded",
          message: "Локальный ZIP-слой загружен в рабочую карту.",
        };
        addLocalPreviewLayer(localAsset, {
          ...tempPreview,
          asset_id: assetId,
          asset_name: localAsset.asset_name,
        });
        loadedCount += 1;
      }
      setLocalLayerStatus(`Из локального ZIP загружено слоёв: ${loadedCount}.`);
    } catch (error) {
      setLocalLayerStatus(error instanceof Error ? error.message : "Не удалось загрузить локальный слой.");
    }
  }

  async function loadLocalLayerFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0) {
      return;
    }

    if (files.length === 1 && !SHAPEFILE_PART_EXTENSIONS.has(fileExtension(files[0].name))) {
      await loadLocalLayerFile(files[0]);
      return;
    }

    const shapefileParts = files.filter((file) => SHAPEFILE_PART_EXTENSIONS.has(fileExtension(file.name)));
    const directFiles = files.filter((file) => !SHAPEFILE_PART_EXTENSIONS.has(fileExtension(file.name)));

    for (const file of directFiles) {
      if (file.name.toLowerCase().endsWith(".geojson") || file.name.toLowerCase().endsWith(".json") || file.name.toLowerCase().endsWith(".zip")) {
        await loadLocalLayerFile(file);
      }
    }

    if (shapefileParts.length === 0) {
      return;
    }

    const hasShp = shapefileParts.some((file) => fileExtension(file.name) === ".shp");
    if (!hasShp) {
      setLocalLayerStatus("Выберите .shp вместе с файлами комплекта (.dbf, .shx, .prj).");
      return;
    }

    setLocalLayerStatus(`Загрузка shapefile-комплекта: ${shapefileParts.length} файлов...`);
    try {
      const formData = new FormData();
      for (const file of shapefileParts) {
        formData.append("files", file);
      }

      const response = await storedAuthFetchJson<ArchivePreviewResponse>("/submissions/local-layer-preview", {
        method: "POST",
        body: formData,
      });

      let loadedCount = 0;
      for (const preview of response.previews ?? []) {
        const asset = response.assets.find((item) => item.id === preview.asset_id);
        if (!asset) {
          continue;
        }
        const assetId = -(Date.now() + asset.id + loadedCount);
        const localAsset = {
          ...asset,
          id: assetId,
          submission_id: 0,
          asset_name: layerDisplayName(asset.asset_name),
          status: "uploaded",
          message: "Локальный shapefile-комплект загружен в рабочую карту.",
        };
        addLocalPreviewLayer(localAsset, {
          ...preview,
          asset_id: assetId,
          asset_name: localAsset.asset_name,
        });
        loadedCount += 1;
      }

      const warningText = response.warnings?.length ? ` Предупреждений: ${response.warnings.length}.` : "";
      setLocalLayerStatus(`Из выбранных shapefile-файлов загружено слоёв: ${loadedCount}.${warningText}`);
    } catch (error) {
      setLocalLayerStatus(error instanceof Error ? error.message : "Не удалось загрузить shapefile-комплект.");
    }
  }

  function dropLayer(targetAssetId: number) {
    if (!draggedLayerId || draggedLayerId === targetAssetId) {
      setDraggedLayerId(null);
      return;
    }

    rememberLayerLayout();
    setLayers((current) => {
      const sourceIndex = current.findIndex((layer) => layer.asset.id === draggedLayerId);
      const targetIndex = current.findIndex((layer) => layer.asset.id === targetAssetId);
      if (sourceIndex < 0 || targetIndex < 0) {
        return current;
      }
      const next = [...current];
      const [movedLayer] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, movedLayer);
      return next;
    });
    setDraggedLayerId(null);
  }

  function setLayerLabelField(assetId: number, labelField: string | null) {
    rememberLayerLayout();
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId ? { ...layer, labelField, labelsVisible: Boolean(labelField) } : layer,
      ),
    );
  }

  function toggleLayerLabels(assetId: number) {
    rememberLayerLayout();
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId ? { ...layer, labelsVisible: !layer.labelsVisible } : layer,
      ),
    );
  }

  function bringWindowToFront(windowKey: MapWindowKey) {
    nextWindowZIndexRef.current += 1;
    const nextZIndex = nextWindowZIndexRef.current;
    setWindowZIndexes((current) => ({
      ...current,
      [windowKey]: nextZIndex,
    }));
  }

  function currentLayerLayoutSnapshot(): LayerLayoutSnapshot {
    return {
      layers,
      hiddenLayerIds,
      removedLayerIds,
      layerGroupNames,
      layerGroups,
      collapsedLayerGroups,
      layerAliases,
      assignedLayerCrs,
      layerStyles,
    };
  }

  function rememberLayerLayout() {
    const snapshot = currentLayerLayoutSnapshot();
    setLayerLayoutHistory((current) => [...current.slice(-19), snapshot]);
    setLayerLayoutFuture([]);
  }

  function restoreLayerLayout(snapshot: LayerLayoutSnapshot) {
    setLayers(snapshot.layers);
    setHiddenLayerIds(snapshot.hiddenLayerIds);
    setRemovedLayerIds(snapshot.removedLayerIds);
    setLayerGroupNames(snapshot.layerGroupNames);
    setLayerGroups(snapshot.layerGroups);
    setCollapsedLayerGroups(snapshot.collapsedLayerGroups);
    setLayerAliases(snapshot.layerAliases);
    setAssignedLayerCrs(snapshot.assignedLayerCrs);
    setLayerStyles(snapshot.layerStyles);
    setLayerMenuId(null);
    setGroupMenuName(null);
  }

  function undoLayerLayoutChange() {
    const snapshot = layerLayoutHistory[layerLayoutHistory.length - 1];
    if (!snapshot) {
      return;
    }
    setLayerLayoutFuture((current) => [...current.slice(-19), currentLayerLayoutSnapshot()]);
    setLayerLayoutHistory((current) => current.slice(0, -1));
    restoreLayerLayout(snapshot);
  }

  function redoLayerLayoutChange() {
    const snapshot = layerLayoutFuture[layerLayoutFuture.length - 1];
    if (!snapshot) {
      return;
    }
    setLayerLayoutHistory((current) => [...current.slice(-19), currentLayerLayoutSnapshot()]);
    setLayerLayoutFuture((current) => current.slice(0, -1));
    restoreLayerLayout(snapshot);
  }

  function updateLayerFeatureAttribute(assetId: number, featureIndex: number, field: string, value: string) {
    const normalizedField = field.trim();
    if (!normalizedField) {
      return;
    }
    setLayers((current) =>
      current.map((layer) => {
        if (layer.asset.id !== assetId) {
          return layer;
        }
        const features = layer.preview.geojson.features.map((feature, index) =>
          index === featureIndex
            ? {
                ...feature,
                properties: {
                  ...(feature.properties ?? {}),
                  [normalizedField]: value,
                },
              }
            : feature,
        );
        return {
          ...layer,
          preview: {
            ...layer.preview,
            geojson: {
              ...layer.preview.geojson,
              features,
            },
          },
        };
      }),
    );
  }

  function addLayerAttributeField(assetId: number, field: string) {
    const normalizedField = field.trim();
    if (!normalizedField) {
      return;
    }
    setLayers((current) =>
      current.map((layer) => {
        if (layer.asset.id !== assetId) {
          return layer;
        }
        const features = layer.preview.geojson.features.map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            [normalizedField]: feature.properties?.[normalizedField] ?? "",
          },
        }));
        const nextFeatures =
          features.length > 0
            ? features
            : [
                {
                  type: "Feature" as const,
                  geometry: null,
                  properties: { [normalizedField]: "" },
                },
              ];
        return {
          ...layer,
          preview: {
            ...layer.preview,
            geojson: {
              ...layer.preview.geojson,
              features: nextFeatures,
            },
          },
        };
      }),
    );
  }

  function removeLayerAttributeField(assetId: number, field: string) {
    const normalizedField = field.trim();
    if (!normalizedField) {
      return;
    }
    setLayers((current) =>
      current.map((layer) => {
        if (layer.asset.id !== assetId) {
          return layer;
        }
        const features = layer.preview.geojson.features.map((feature) => {
          const properties = { ...(feature.properties ?? {}) };
          delete properties[normalizedField];
          return { ...feature, properties };
        });
        return {
          ...layer,
          labelField: layer.labelField === normalizedField ? defaultLabelField({ ...layer.preview, geojson: { ...layer.preview.geojson, features } }) : layer.labelField,
          preview: {
            ...layer.preview,
            geojson: {
              ...layer.preview.geojson,
              features,
            },
          },
        };
      }),
    );
  }

  function openLayerMenu(assetId: number, x?: number, y?: number) {
    setLayerMenuId(assetId);
    setGroupMenuName(null);
    setGroupMenuPosition(null);
    setLayerMenuPosition(
      typeof x === "number" && typeof y === "number" ? { x, y } : null,
    );
  }

  function closeLayerMenu() {
    setLayerMenuId(null);
    setLayerMenuPosition(null);
  }

  function openGroupMenu(groupName: string, x: number, y: number) {
    setGroupMenuName(groupName);
    setGroupMenuPosition({ x, y });
    setLayerMenuId(null);
    setLayerMenuPosition(null);
  }

  function closeGroupMenu() {
    setGroupMenuName(null);
    setGroupMenuPosition(null);
  }

  useEffect(() => {
    if (!layerPropertiesDragOffset) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const nextX = Math.min(Math.max(8, event.clientX - layerPropertiesDragOffset.x), Math.max(8, window.innerWidth - 340));
      const nextY = Math.min(Math.max(8, event.clientY - layerPropertiesDragOffset.y), Math.max(8, window.innerHeight - 160));
      setLayerPropertiesPosition({ x: nextX, y: nextY });
    }

    function handlePointerUp() {
      setLayerPropertiesDragOffset(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [layerPropertiesDragOffset]);

  useEffect(() => {
    if (!layerMenuId && !groupMenuName) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".layer-action-menu") || target?.closest(".layer-row-tools") || target?.closest(".layer-group-heading")) {
        return;
      }
      closeLayerMenu();
      closeGroupMenu();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [layerMenuId, groupMenuName]);

  return (
    <section className="section-panel">
      {!props.hideHeader ? (
        <div className="section-heading">
          <div>
            <p className="eyebrow">{props.isAssignmentWorkspace ? "Рабочая карта" : "Просмотр ГИС-слоёв"}</p>
            <h2>{props.workspaceTitle ?? (props.isAssignmentWorkspace ? "Рабочая карта задания" : "Слои выбранной сдачи")}</h2>
          </div>
          <div className="button-row">
            {props.selectedSubmissionId && !props.isStandalone ? (
              <button onClick={() => openMapViewer(props.selectedSubmissionId!)}>Открыть карту в новой вкладке</button>
            ) : null}
            <input
              ref={localLayerInputRef}
              type="file"
              className="visually-hidden"
              accept=".geojson,.json,.zip,.shp,.dbf,.shx,.prj,.cpg,.qix,.sbn,.sbx"
              multiple
              onChange={(event) => {
                if (event.target.files?.length) {
                  void loadLocalLayerFiles(event.target.files);
                }
                event.target.value = "";
              }}
            />
            <input
              ref={localLayerFolderInputRef}
              type="file"
              className="visually-hidden"
              multiple
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(event) => {
                if (event.target.files?.length) {
                  void loadLocalLayerFiles(event.target.files);
                }
                event.target.value = "";
              }}
            />
            <button onClick={() => localLayerInputRef.current?.click()} disabled={!workspaceIsOpen}>
              Загрузить слой...
            </button>
            <button onClick={() => localLayerFolderInputRef.current?.click()} disabled={!workspaceIsOpen}>
              Загрузить папку...
            </button>
            <button onClick={() => void loadAllLayers()} disabled={props.isLoading || !workspaceIsOpen || visiblePreviewableAssets.length === 0}>
              Загрузить все слои
            </button>
          </div>
        </div>
      ) : null}

      {!workspaceIsOpen ? (
        <div className="empty-state">
          <h2>Выберите сдачу</h2>
          <p>Откройте работу студента во вкладке сдач, затем здесь можно будет просмотреть все ГИС-слои на одной карте.</p>
        </div>
      ) : null}

      {workspaceIsOpen ? (
        <div className="layer-workspace">
          <aside className="layer-list">
            <div className="layer-list-heading">
              <div>
                <strong>
                  {props.workspaceTitle ?? props.workspaceAssignment?.title ?? selectedSubmission?.original_filename ?? `Сдача #${props.selectedSubmissionId}`}
                </strong>
                <span>{previewableAssets.length} ГИС-слоёв найдено</span>
              </div>
              <div className="layer-list-actions">
                <button className="slim icon" onClick={addLayerGroup} title="Создать группу слоёв" data-tooltip="Создать группу слоёв">
                  ▣+
                </button>
                <button className="slim icon" onClick={createEmptyEditableLayer} title="Создать новый слой" data-tooltip="Создать новый слой">
                  ◆+
                </button>
                <button
                  className="slim icon"
                  onClick={undoLayerLayoutChange}
                  disabled={layerLayoutHistory.length === 0}
                  title="Отменить изменение списка слоёв"
                  data-tooltip="Отменить изменение списка слоёв"
                >
                  ↶
                </button>
                <button
                  className="slim icon"
                  onClick={redoLayerLayoutChange}
                  disabled={layerLayoutFuture.length === 0}
                  title="Вернуть изменение списка слоёв"
                  data-tooltip="Вернуть изменение списка слоёв"
                >
                  ↷
                </button>
                <button
                  className="slim icon"
                  onClick={toggleAllLoadedLayers}
                  disabled={layers.length === 0}
                  title={allLoadedLayersVisible ? "Выключить все слои" : "Включить все слои"}
                  data-tooltip={allLoadedLayersVisible ? "Выключить все слои" : "Включить все слои"}
                >
                  {allLoadedLayersVisible ? "☑" : "☐"}
                </button>
              </div>
              {hiddenLayerIds.length > 0 ? (
                <button
                  className="slim icon"
                  onClick={() => setHiddenLayerIds([])}
                  title="Показать скрытые слои"
                  data-tooltip="Показать скрытые слои"
                >
                  ◌
                </button>
              ) : null}
            </div>
            {localLayerStatus ? <p className="layer-status">{localLayerStatus}</p> : null}

            {previewableAssets.length === 0 ? (
              <p className="muted">В выбранной сдаче нет GeoJSON или Shapefile ZIP-слоёв для карты.</p>
            ) : null}
            {previewableAssets.length > 0 && visiblePreviewableAssets.length === 0 ? (
              <p className="muted">Все слои скрыты из текущего списка.</p>
            ) : null}

            <div className="layer-group-create hidden">
              <input
                value={editingGroupDraft}
                onChange={(event) => setEditingGroupDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addLayerGroup();
                  }
                }}
                placeholder="Новая группа"
              />
              <button onClick={addLayerGroup} disabled={!newLayerGroupName.trim()} title="Создать группу">
                +
              </button>
            </div>

            {groupedAssets.map(({ groupName, assets: groupAssets }) => {
              const collapsed = collapsedLayerGroups.includes(groupName);
              const loadedInGroup = layers.filter(
                (layer) => (layerGroups[layer.asset.id] ?? DEFAULT_LAYER_GROUP) === groupName,
              );
              const groupVisible = loadedInGroup.length > 0 && loadedInGroup.every((layer) => layer.visible);
              return (
                <section className="layer-group" key={groupName}>
                  <div
                    className={draggedLayerId ? "layer-group-heading drop-target" : "layer-group-heading"}
                    onDragOver={(event) => {
                      if (draggedLayerId) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      dropLayerIntoGroup(groupName);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openGroupMenu(groupName, event.clientX, event.clientY);
                    }}
                  >
                    <button onClick={() => toggleLayerGroupCollapse(groupName)} title={collapsed ? "Развернуть группу" : "Свернуть группу"}>
                      {collapsed ? "▸" : "▾"}
                    </button>
                    {editingGroupName === groupName ? (
                      <input
                        ref={groupRenameInputRef}
                        className="layer-group-name-input"
                        value={editingGroupDraft}
                        onChange={(event) => setEditingGroupDraft(event.target.value)}
                        onBlur={commitLayerGroupRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitLayerGroupRename();
                          }
                          if (event.key === "Escape") {
                            setEditingGroupName(null);
                            setEditingGroupDraft("");
                          }
                        }}
                      />
                    ) : (
                      <strong
                        onDoubleClick={() => {
                          setEditingGroupName(groupName);
                          setEditingGroupDraft(groupName);
                        }}
                      >
                        {groupName}
                      </strong>
                    )}
                    <span>{groupAssets.length}</span>
                    <button onClick={() => toggleLayerGroupVisibility(groupName)} disabled={loadedInGroup.length === 0}>
                      {groupVisible ? "Скрыть" : "Показать"}
                    </button>
                    {groupMenuName === groupName ? (
                      <div
                        className="layer-action-menu fixed"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        style={
                          groupMenuPosition
                            ? { left: groupMenuPosition.x, top: groupMenuPosition.y }
                            : undefined
                        }
                      >
                        <button
                          onClick={() => {
                            setEditingGroupName(groupName);
                            setEditingGroupDraft(groupName);
                            closeGroupMenu();
                          }}
                        >
                          <span className="menu-icon" aria-hidden="true">abc</span>
                          Переименовать группу
                        </button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteLayerGroup(groupName);
                          }}
                          disabled={groupName === DEFAULT_LAYER_GROUP}
                        >
                          <span className="menu-icon" aria-hidden="true">×</span>
                          Удалить группу
                        </button>
                        <label className="layer-action-menu-field">
                          <span>СК группы</span>
                          <select
                            value={groupAssignedCrsValue(groupName)}
                            onChange={(event) => setGroupAssignedCrs(groupName, event.target.value)}
                          >
                            <option value="">Не задана</option>
                            <option value="__mixed__" disabled>Разные СК</option>
                            {MAP_COORDINATE_PROJECTIONS.map((projection) => (
                              <option key={projection.code} value={projection.code}>
                                {projection.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                  </div>
                  {!collapsed ? groupAssets.map((asset) => {
              const layer = layers.find((item) => item.asset.id === asset.id);
              const layerIndex = layers.findIndex((item) => item.asset.id === asset.id);
              const isLoadedLocalLayer = asset.submission_id === 0 || asset.id < 0;
              const layerStyle = normalizeLayerStyle(layerStyles[asset.id], layerIndex);
              const geometryKind = layerGeometryKind(layer?.preview);
              const isLoadingLayer = loadingLayerIds.includes(asset.id);
              const fields = layer ? previewAttributeFields(layer.preview) : [];
              const displayName = layerAliases[asset.id] || layerDisplayName(asset.asset_name);
              const isActiveEditableLayer = activeEditableLayerId === asset.id && isDraftEditingEnabled;
              return (
                <div
                  key={asset.id}
                  className={[
                    "layer-row",
                    layer?.visible ? "active" : "",
                    isActiveEditableLayer ? "editing" : "",
                    layer || isLoadedLocalLayer ? "draggable" : "",
                    draggedLayerId === asset.id ? "dragging" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={Boolean(layer) || isLoadedLocalLayer}
                  onDragStart={() => (layer || isLoadedLocalLayer ? setDraggedLayerId(asset.id) : undefined)}
                  onDragOver={(event) => {
                    if ((layer || isLoadedLocalLayer) && draggedLayerId) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={() => (layer || isLoadedLocalLayer ? dropLayer(asset.id) : undefined)}
                  onDragEnd={() => setDraggedLayerId(null)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!layer) {
                      void loadLayer(asset);
                      return;
                    }
                    openLayerMenu(asset.id, event.clientX, event.clientY);
                  }}
                >
                  <div className="layer-row-main">
                    <label className="layer-visibility-toggle" title="Видимость слоя">
                      <input
                        type="checkbox"
                        checked={Boolean(layer?.visible)}
                        onChange={() => (layer ? toggleLayer(asset.id) : void loadLayer(asset))}
                        disabled={isLoadingLayer}
                      />
                    </label>
                    <span
                      className={[
                        "layer-symbol",
                        `layer-symbol-${geometryKind}`,
                        layer ? "active" : "",
                      ].filter(Boolean).join(" ")}
                      style={{
                        borderColor: layerStyle.strokeColor,
                        background:
                          layer && geometryKind === "polygon"
                            ? colorWithOpacity(layerStyle.fillColor, Math.max(0.12, layerStyle.fillOpacity))
                            : "transparent",
                        color: layerStyle.strokeColor,
                      }}
                      aria-hidden="true"
                    />
                    <div className="layer-title">
                      {renamingLayerId === asset.id ? (
                        <input
                          className="layer-name-input"
                          defaultValue={displayName}
                          autoFocus
                          onFocus={(event) => event.currentTarget.select()}
                          onBlur={(event) => commitLayerAlias(asset.id, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitLayerAlias(asset.id, event.currentTarget.value);
                            }
                            if (event.key === "Escape") {
                              setRenamingLayerId(null);
                            }
                          }}
                        />
                      ) : (
                        <strong>{displayName}</strong>
                      )}
                      <small>{isActiveEditableLayer ? "Редактируется" : statusLabel(asset.status)}</small>
                    </div>
                    <div className="layer-row-tools">
                      <button onClick={() => void loadLayer(asset)} disabled={isLoadingLayer} title={layer ? "Обновить слой" : "Открыть слой"}>
                        {layer ? "↻" : isLoadingLayer ? "..." : "+"}
                      </button>
                      <button onClick={() => hideLayerFromList(asset.id)} title="Скрыть слой из списка">
                        ×
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          if (layerMenuId === asset.id) {
                            closeLayerMenu();
                            return;
                          }
                          const rect = event.currentTarget.getBoundingClientRect();
                          openLayerMenu(asset.id, Math.max(8, rect.right - 260), rect.bottom + 6);
                        }}
                        disabled={!layer}
                        title="Свойства слоя"
                      >
                        ⋮
                      </button>
                    </div>
                  </div>
                  {layer && layerMenuId === asset.id ? (
                    <div
                      className={layerMenuPosition ? "layer-action-menu fixed" : "layer-action-menu"}
                      style={
                        layerMenuPosition
                          ? { left: layerMenuPosition.x, top: layerMenuPosition.y }
                          : undefined
                      }
                    >
                      <button
                        onClick={() => {
                          setLayerPropertiesId(asset.id);
                          bringWindowToFront("layerProperties");
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">i</span>
                        Расширенная информация
                      </button>
                      <button
                        onClick={() => {
                          setZoomToLayerId(asset.id);
                          setZoomToLayerTick(Date.now());
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">⌕</span>
                        Увеличить до слоя
                      </button>
                      <button
                        onClick={() => {
                          setTableLayerId(asset.id);
                          setIsTableWindowOpen(true);
                          bringWindowToFront("table");
                          if (layer.preview.geojson.features.length > 0) {
                            setSelectedFeature({ assetId: asset.id, featureIndex: 0 });
                          }
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">▦</span>
                        Атрибутивная таблица
                      </button>
                      <button
                        onClick={() => {
                          setActiveEditableLayerId(asset.id);
                          setIsDraftEditingEnabled(true);
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">✎</span>
                        Включить редактирование
                      </button>
                      <button
                        onClick={() => {
                          setRenamingLayerId(asset.id);
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">abc</span>
                        Переименовать слой
                      </button>
                      <button
                        onClick={() => {
                          hideLayerFromList(asset.id);
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">◌</span>
                        Скрыть из списка
                      </button>
                      <button
                        onClick={() => {
                          hideLayer(asset.id);
                          closeLayerMenu();
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">×</span>
                        Удалить из рабочей карты
                      </button>
                    </div>
                  ) : null}
                  {layer && expandedLayerId === asset.id ? (
                    <section className="layer-properties">
                      <div className="layer-meta">
                        <span>СК: {layer.preview.crs}</span>
                        <span>Исходная: {layer.preview.source_crs || "не задана"}</span>
                        <span>{layer.preview.preview_feature_count}/{layer.preview.feature_count} объектов</span>
                      </div>
                    </section>
                  ) : null}
                  {layer ? (
                    <div className="layer-label-controls">
                      <label>
                        <input
                          type="checkbox"
                          checked={layer.labelsVisible}
                          onChange={() => toggleLayerLabels(asset.id)}
                          disabled={!layer.labelField}
                        />
                        Подписи
                      </label>
                      <select
                        value={layer.labelField ?? ""}
                        onChange={(event) => setLayerLabelField(asset.id, stringOrNull(event.target.value))}
                      >
                        <option value="">Поле подписи не выбрано</option>
                        {fields.map((field) => (
                          <option key={field} value={field}>
                            {field}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  {layerErrors[asset.id] ? <p className="layer-error">{layerErrors[asset.id]}</p> : null}
                </div>
              );
                  }) : null}
                </section>
              );
            })}
          </aside>

          {propertiesLayer ? (
            <LayerPropertiesWindow
              layer={propertiesLayer}
              assignedCrs={assignedLayerCrs[propertiesLayer.asset.id] ?? ""}
              layerStyle={normalizeLayerStyle(
                layerStyles[propertiesLayer.asset.id],
                layers.findIndex((layer) => layer.asset.id === propertiesLayer.asset.id),
              )}
              position={layerPropertiesPosition}
              zIndex={windowZIndexes.layerProperties}
              onFocus={() => bringWindowToFront("layerProperties")}
              onDragStart={(event) => {
                bringWindowToFront("layerProperties");
                setLayerPropertiesDragOffset({
                  x: event.clientX - layerPropertiesPosition.x,
                  y: event.clientY - layerPropertiesPosition.y,
                });
              }}
              onClose={() => setLayerPropertiesId(null)}
              onZoomToLayer={() => {
                setZoomToLayerId(propertiesLayer.asset.id);
                setZoomToLayerTick(Date.now());
              }}
              onOpenTable={() => {
                setTableLayerId(propertiesLayer.asset.id);
                setIsTableWindowOpen(true);
                bringWindowToFront("table");
                if (propertiesLayer.preview.geojson.features.length > 0) {
                  setSelectedFeature({ assetId: propertiesLayer.asset.id, featureIndex: 0 });
                }
              }}
              onToggleLabels={() => toggleLayerLabels(propertiesLayer.asset.id)}
              onLabelFieldChange={(field) => setLayerLabelField(propertiesLayer.asset.id, field)}
              onAssignedCrsChange={(crs) => setLayerAssignedCrs(propertiesLayer.asset.id, crs)}
              onLayerStyleChange={(patch) => setLayerStyle(propertiesLayer.asset.id, patch)}
            />
          ) : null}

          <MultiLayerMapPanel
            layers={layers}
            layerStyles={layerStyles}
            assignmentId={props.workspaceAssignment?.id ?? selectedSubmission?.assignment_id ?? null}
            activeEditableLayerId={activeEditableLayer?.asset.id ?? null}
            activeEditableLayerName={
              activeEditableLayer
                ? layerAliases[activeEditableLayer.asset.id] || layerDisplayName(activeEditableLayer.asset.asset_name)
                : null
            }
            isDraftEditingEnabled={isDraftEditingEnabled}
            onDraftEditingEnabledChange={setIsDraftEditingEnabled}
            zoomToLayerId={zoomToLayerId}
            zoomToLayerTick={zoomToLayerTick}
            tableLayerId={tableLayerId}
            isTableWindowOpen={isTableWindowOpen}
            selectedFeature={selectedFeature}
            onFeatureSelect={setSelectedFeature}
            onLayerFeatureAttributeChange={updateLayerFeatureAttribute}
            onLayerAttributeFieldAdd={addLayerAttributeField}
            onLayerAttributeFieldRemove={removeLayerAttributeField}
            windowZIndexes={windowZIndexes}
            onWindowFocus={bringWindowToFront}
            onCloseTable={() => setIsTableWindowOpen(false)}
            autoLoadDraft={props.autoLoadDraft}
            allowDraftSubmit={Boolean(props.allowDraftSubmit)}
            onDraftSubmitted={props.onDraftSubmitted}
          />
        </div>
      ) : null}
    </section>
  );
}

function LayerPropertiesWindow(props: {
  layer: LayerPreviewState;
  assignedCrs: string;
  layerStyle: LayerStyleSettings;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onClose: () => void;
  onZoomToLayer: () => void;
  onOpenTable: () => void;
  onToggleLabels: () => void;
  onLabelFieldChange: (field: string | null) => void;
  onAssignedCrsChange: (crs: string) => void;
  onLayerStyleChange: (patch: Partial<LayerStyleSettings>) => void;
}) {
  const fields = previewAttributeFields(props.layer.preview);
  const [activeTab, setActiveTab] = useState<LayerPropertiesTab>("info");

  useEffect(() => {
    setActiveTab("info");
  }, [props.layer.asset.id]);

  return (
    <section
      className="layer-properties-window"
      style={{ left: props.position.x, top: props.position.y, zIndex: props.zIndex }}
      onPointerDown={props.onFocus}
    >
      <div className="layer-properties-title draggable-title" onPointerDown={props.onDragStart}>
        <div>
          <p className="eyebrow">Свойства слоя</p>
          <h3>{layerDisplayName(props.layer.asset.asset_name)}</h3>
        </div>
        <button onClick={props.onClose} onPointerDown={(event) => event.stopPropagation()} title="Закрыть">×</button>
      </div>
      <div className="layer-properties-tabs" role="tablist" aria-label="Разделы свойств слоя">
        <button
          className={activeTab === "info" ? "active" : ""}
          onClick={() => setActiveTab("info")}
          type="button"
        >
          Информация
        </button>
        <button
          className={activeTab === "labels" ? "active" : ""}
          onClick={() => setActiveTab("labels")}
          type="button"
        >
          Подписи
        </button>
        <button
          className={activeTab === "style" ? "active" : ""}
          onClick={() => setActiveTab("style")}
          type="button"
        >
          Стиль
        </button>
      </div>
      {activeTab === "info" ? (
        <>
          <dl className="layer-properties-dl">
            <dt>Формат</dt>
            <dd>{props.layer.asset.detected_format}</dd>
            <dt>Система координат</dt>
            <dd>{props.layer.preview.crs}</dd>
            <dt>Исходная СК</dt>
            <dd>{props.layer.preview.source_crs || "не задана"}</dd>
            <dt>Назначенная СК</dt>
            <dd>{props.assignedCrs || "не задана"}</dd>
            <dt>Объекты</dt>
            <dd>{props.layer.preview.preview_feature_count}/{props.layer.preview.feature_count}</dd>
          </dl>
          <div className="layer-properties-form">
            <label>
              Назначить СК слоя
              <select
                value={props.assignedCrs}
                onChange={(event) => props.onAssignedCrsChange(event.target.value)}
              >
                <option value="">Не задана</option>
                {MAP_COORDINATE_PROJECTIONS.map((projection) => (
                  <option key={projection.code} value={projection.code}>
                    {projection.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : null}
      {activeTab === "labels" ? (
        <div className="layer-labels-editor">
          <label className="layer-labels-toggle">
            <input
              type="checkbox"
              checked={props.layer.labelsVisible}
              onChange={props.onToggleLabels}
              disabled={!props.layer.labelField}
            />
            <span>Подписи слоя</span>
          </label>
          <label className="layer-labels-field">
            <span>Поле подписи</span>
            <select
              value={props.layer.labelField ?? ""}
              onChange={(event) => props.onLabelFieldChange(stringOrNull(event.target.value))}
            >
              <option value="">Поле подписи не выбрано</option>
              {fields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {activeTab === "style" ? (
        <div className="layer-style-editor">
          <label>
            Цвет обводки
            <input
              type="color"
              value={props.layerStyle.strokeColor}
              onChange={(event) => props.onLayerStyleChange({ strokeColor: event.target.value })}
            />
          </label>
          <label>
            Цвет заливки
            <input
              type="color"
              value={props.layerStyle.fillColor}
              onChange={(event) => props.onLayerStyleChange({ fillColor: event.target.value })}
            />
          </label>
          <label>
            Прозрачность заливки
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={props.layerStyle.fillOpacity}
              onChange={(event) => props.onLayerStyleChange({ fillOpacity: Number(event.target.value) })}
            />
            <span>{Math.round(props.layerStyle.fillOpacity * 100)}%</span>
          </label>
          <label>
            Толщина линии
            <input
              type="number"
              min="1"
              max="12"
              value={props.layerStyle.strokeWidth}
              onChange={(event) => props.onLayerStyleChange({ strokeWidth: Number(event.target.value) })}
            />
          </label>
          <label>
            Размер точки
            <input
              type="number"
              min="2"
              max="24"
              value={props.layerStyle.pointRadius}
              onChange={(event) => props.onLayerStyleChange({ pointRadius: Number(event.target.value) })}
            />
          </label>
        </div>
      ) : null}
      <div className="layer-properties-actions">
        <button onClick={props.onZoomToLayer}>⌕ Приблизить</button>
        <button onClick={props.onOpenTable}>▦ Таблица</button>
      </div>
    </section>
  );
}

function MultiLayerMapPanel(props: {
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
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const selectedFeatureRef = useRef<SelectedLayerFeature>(props.selectedFeature);
  const vectorLayerRefs = useRef<VectorLayer<VectorSource>[]>([]);
  const draftSourceRef = useRef(new VectorSource());
  const drawInteractionRef = useRef<Draw | null>(null);
  const mapViewStateRef = useRef<{ center: number[]; zoom: number } | null>(null);
  const coordinateProjectionRef = useRef<CoordinateProjectionCode>("EPSG:4326");
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
  const [editMode, setEditMode] = useState<EditMode>("select");
  const [mapZoom, setMapZoom] = useState(mapViewStateRef.current?.zoom ?? 2);
  const [mapScaleText, setMapScaleText] = useState(formatMapScale(mapViewStateRef.current?.zoom ?? 2));
  const [coordinateProjection, setCoordinateProjection] = useState<CoordinateProjectionCode>("EPSG:4326");
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
  const [newDraftFieldName, setNewDraftFieldName] = useState("");
  const [attributeKey, setAttributeKey] = useState("");
  const [attributeValue, setAttributeValue] = useState("");
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
    if (!props.isDraftEditingEnabled && editMode !== "select") {
      setEditMode("select");
    }
  }, [props.isDraftEditingEnabled, editMode]);

  useEffect(() => {
    coordinateProjectionRef.current = coordinateProjection;
  }, [coordinateProjection]);

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
      featureProjection: "EPSG:3857",
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
      featureProjection: "EPSG:3857",
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
          dataProjection: "EPSG:3857",
          featureProjection: "EPSG:3857",
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
        dataProjection: "EPSG:3857",
        featureProjection: "EPSG:3857",
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
          dataProjection: "EPSG:3857",
          featureProjection: "EPSG:3857",
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
    applyDraftFieldsToFeature(aiSuggestion.targetFeature);
    selectedDraftFeatureRef.current = aiSuggestion.targetFeature;
    clearAiSuggestion();
    setDraftRevision((revision) => revision + 1);
    setDraftStatus("AI-предложение принято и заменило выбранный объект.");
  }

  function addAiSuggestionAsNewFeature() {
    if (!aiSuggestion) {
      return;
    }
    const suggestedFeature = aiSuggestion.feature.clone() as Feature<Geometry>;
    rememberDraftState();
    applyDraftFieldsToFeature(suggestedFeature);
    draftSourceRef.current.addFeature(suggestedFeature);
    selectedDraftFeatureRef.current = suggestedFeature;
    clearAiSuggestion();
    setDraftRevision((revision) => revision + 1);
    setDraftStatus("AI-предложение добавлено как новый объект.");
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
      featureProjection: "EPSG:3857",
    }) as Feature<Geometry>;
    importFeaturesToDraft([feature], `${layerDisplayName(selectedLayer.asset.asset_name)} / объект`);
  }

  function importSelectedLayerToDraft() {
    if (!selectedLayer) {
      return;
    }
    const features = new GeoJSON().readFeatures(selectedLayer.preview.geojson, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857",
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
    mapViewStateRef.current = { center: [...center], zoom: normalizedZoom };
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

  function zoomToSelectedObject() {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    let extent: number[] | null = null;
    if (selectedDraftFeature) {
      const draftExtent = selectedDraftFeature.getGeometry()?.getExtent();
      extent = draftExtent && Number.isFinite(draftExtent[0]) ? [...draftExtent] : null;
    } else if (selectedGeoJsonFeature) {
      const feature = new GeoJSON().readFeature(selectedGeoJsonFeature, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      }) as Feature<Geometry>;
      const featureExtent = feature.getGeometry()?.getExtent();
      extent = featureExtent && Number.isFinite(featureExtent[0]) ? [...featureExtent] : null;
    }

    if (!extent) {
      return;
    }
    map.getView().fit(extent, {
      padding: [70, 70, 70, 70],
      maxZoom: 18,
      duration: 220,
    });
  }

  function exportDraftLayer() {
    const features = draftSourceRef.current.getFeatures();
    if (features.length === 0) {
      return;
    }

    const geojson = new GeoJSON().writeFeaturesObject(features, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857",
    });
    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "draft-layer.geojson";
    link.click();
    URL.revokeObjectURL(url);
  }

  function buildDraftGeoJsonObject() {
    draftSourceRef.current.getFeatures().forEach((feature) => applyDraftFieldsToFeature(feature));
    const geojson = new GeoJSON().writeFeaturesObject(draftSourceRef.current.getFeatures(), {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857",
    }) as { type: "FeatureCollection"; features: GeoJsonFeature[] };
    return {
      ...geojson,
      properties: {
        layer_name: draftName,
        geometry_type: draftGeometryType,
        assigned_crs: draftCrs.trim() || "EPSG:4326",
        active_layer_id: props.activeEditableLayerId,
        active_layer_name: props.activeEditableLayerName,
        fields: draftFields(),
        style: {
          color: draftColor,
          fill_opacity: draftFillOpacity,
        },
      },
    };
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

      const features = new GeoJSON().readFeatures(draft.geojson, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      });
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
    if (!props.autoLoadDraft || autoLoadedDraftRef.current || !props.assignmentId) {
      return;
    }
    autoLoadedDraftRef.current = true;
    void loadLatestDraft();
  }, [props.autoLoadDraft, props.assignmentId]);

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

    function handlePointerMove(event: PointerEvent) {
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!panelRect) {
        return;
      }
      const maxX = Math.max(8, panelRect.width - 320);
      const maxY = Math.max(8, panelRect.height - 180);
      const nextX = Math.min(Math.max(8, event.clientX - panelRect.left - tableDragOffset.x), maxX);
      const nextY = Math.min(Math.max(54, event.clientY - panelRect.top - tableDragOffset.y), maxY);
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

    function handlePointerMove(event: PointerEvent) {
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!panelRect) {
        return;
      }
      const maxX = Math.max(8, panelRect.width - 360);
      const maxY = Math.max(8, panelRect.height - 220);
      const nextX = Math.min(Math.max(8, event.clientX - panelRect.left - draftPropertiesDragOffset.x), maxX);
      const nextY = Math.min(Math.max(54, event.clientY - panelRect.top - draftPropertiesDragOffset.y), maxY);
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
        const vectorSource = new VectorSource({
          features: new GeoJSON().readFeatures(layer.preview.geojson, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857",
          }),
        });
        vectorSource.getFeatures().forEach((feature, featureIndex) => {
          feature.set("layerAssetId", layer.asset.id);
          feature.set("featureIndex", featureIndex);
        });
        const vectorLayer = new VectorLayer({
          source: vectorSource,
          style: (feature) => {
            const selected = selectedFeatureRef.current;
            const isSelected =
              selected?.assetId === feature.get("layerAssetId") &&
              selected.featureIndex === feature.get("featureIndex");
            const labelValue =
              layer.labelsVisible && layer.labelField ? feature.get(layer.labelField) : null;
            return new Style({
              image: new CircleStyle({
                radius: isSelected ? layerStyle.pointRadius + 2 : layerStyle.pointRadius,
                fill: new Fill({ color: isSelected ? "rgba(199, 115, 38, 0.8)" : colorWithOpacity(layerStyle.fillColor, Math.max(0.35, layerStyle.fillOpacity)) }),
                stroke: new Stroke({ color: isSelected ? "#b45f1c" : layerStyle.strokeColor, width: isSelected ? layerStyle.strokeWidth + 1 : layerStyle.strokeWidth }),
              }),
              fill: new Fill({ color: isSelected ? "rgba(199, 115, 38, 0.35)" : colorWithOpacity(layerStyle.fillColor, layerStyle.fillOpacity) }),
              stroke: new Stroke({ color: isSelected ? "#b45f1c" : layerStyle.strokeColor, width: isSelected ? layerStyle.strokeWidth + 1 : layerStyle.strokeWidth }),
              text: labelValue
                ? new Text({
                    text: String(labelValue),
                    offsetY: -12,
                    font: "12px Inter, sans-serif",
                    fill: new Fill({ color: "#10212a" }),
                    stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 3 }),
                  })
                : undefined,
            });
          },
        });
        vectorLayerRefs.current.push(vectorLayer);
        return { assetId: layer.asset.id, vectorLayer, vectorSource };
      });

    const map = new Map({
      target: mapElementRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
        ...mapLayers.map((layer) => layer.vectorLayer),
      ],
      view: new View({
        center: mapViewStateRef.current?.center ?? [0, 0],
        zoom: mapViewStateRef.current?.zoom ?? 2,
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
        mapViewStateRef.current = { center: [...center], zoom };
        setMapZoom(zoom);
        setMapScaleText(formatMapScale(zoom));
      }
    });
    map.on("pointermove", (event) => {
      setCursorCoordinates(formatMapCoordinate(event.coordinate, coordinateProjectionRef.current));
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
              };
        const strokeColor = useSelectionStyle ? "#b45f1c" : sourceStyle.strokeColor;
        const fillColor = useSelectionStyle
          ? "rgba(199, 115, 38, 0.35)"
          : colorWithOpacity(sourceStyle.fillColor, sourceStyle.fillOpacity);
        const pointFillColor = useSelectionStyle
          ? "rgba(199, 115, 38, 0.8)"
          : colorWithOpacity(sourceStyle.fillColor, Math.max(0.65, sourceStyle.fillOpacity));
        return new Style({
          image: new CircleStyle({
            radius: useSelectionStyle ? sourceStyle.pointRadius + 2 : sourceStyle.pointRadius,
            fill: new Fill({ color: pointFillColor }),
            stroke: new Stroke({ color: strokeColor, width: useSelectionStyle ? sourceStyle.strokeWidth + 1 : sourceStyle.strokeWidth }),
          }),
          fill: new Fill({ color: fillColor }),
          stroke: new Stroke({ color: strokeColor, width: useSelectionStyle ? sourceStyle.strokeWidth + 1 : sourceStyle.strokeWidth }),
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
    const snap = new Snap({ source: draftSourceRef.current });
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
      map.addInteraction(snap);
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
    const sourcesForFit = focusedLayer ? [focusedLayer] : mapLayers;
    sourcesForFit.forEach(({ vectorSource }) => {
      const layerExtent = vectorSource.getExtent();
      if (Number.isFinite(layerExtent[0])) {
        extent[0] = Math.min(extent[0], layerExtent[0]);
        extent[1] = Math.min(extent[1], layerExtent[1]);
        extent[2] = Math.max(extent[2], layerExtent[2]);
        extent[3] = Math.max(extent[3], layerExtent[3]);
      }
    });
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
        props.onFeatureSelect({ assetId, featureIndex });
        return;
      }
      if (selectedDraftFeatureRef.current && !feature?.get("draft_layer_asset_id")) {
        selectedDraftFeatureRef.current = null;
        setDraftRevision((value) => value + 1);
      }
      props.onFeatureSelect(null);
    });

    return () => {
      const view = map.getView();
      const center = view.getCenter();
      const zoom = view.getZoom();
      if (center && typeof zoom === "number") {
        mapViewStateRef.current = { center: [...center], zoom };
      }
      if (draw) {
        map.removeInteraction(draw);
      }
      if (drawInteractionRef.current === draw) {
        drawInteractionRef.current = null;
      }
      map.removeInteraction(selectDraft);
      map.removeInteraction(modify);
      map.removeInteraction(snap);
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
      <div className="map-edit-toolbar" aria-label="Инструменты редактирования">
        <button
          className={props.isDraftEditingEnabled ? "active" : ""}
          onClick={() => {
            if (!props.activeEditableLayerId) {
              setDraftStatus("Сначала включите редактирование конкретного слоя через меню слоя.");
              return;
            }
            props.onDraftEditingEnabledChange(!props.isDraftEditingEnabled);
          }}
          title={props.isDraftEditingEnabled ? "Выключить редактирование" : "Включить редактирование"}
          data-tooltip={props.isDraftEditingEnabled ? "Выключить редактирование" : "Включить редактирование"}
        >
          ✎
        </button>
        <button
          onClick={() => void continueSelectedDraftFeatureWithAi()}
          disabled={!canEditActiveLayer || !selectedDraftFeature || isAiSegmenting}
          title="AI продолжить выбранный объект"
          data-tooltip="AI продолжить выбранный объект"
        >
          AI
        </button>
        <button className={editMode === "select" ? "active" : ""} onClick={() => setEditMode("select")} title="Выбор объекта" data-tooltip="Выбор объекта">
          ⌖
        </button>
        <button className={editMode === "point" ? "active" : ""} onClick={() => setEditMode("point")} disabled={!canEditActiveLayer} title="Создать точку" data-tooltip="Создать точку">
          ●
        </button>
        <button className={editMode === "line" ? "active" : ""} onClick={() => setEditMode("line")} disabled={!canEditActiveLayer} title="Создать линию" data-tooltip="Создать линию">
          ╱
        </button>
        <button className={editMode === "polygon" ? "active" : ""} onClick={() => setEditMode("polygon")} disabled={!canEditActiveLayer} title="Создать полигон" data-tooltip="Создать полигон">
          ▱
        </button>
        <button
          onClick={zoomToSelectedObject}
          disabled={!selectedGeoJsonFeature && !selectedDraftFeature}
          title="Увеличить до выделенного объекта"
          data-tooltip="Увеличить до выделенного объекта"
        >
          ⌕
        </button>
        <button onClick={deleteSelectedDraftFeature} disabled={!canEditActiveLayer} title="Удалить выбранный объект" data-tooltip="Удалить выбранный объект">⌫</button>
        <button onClick={clearDraftLayer} disabled={!canEditActiveLayer} title="Очистить черновик активного слоя" data-tooltip="Очистить черновик активного слоя">×</button>
        <button
          onClick={undoDraftChange}
          disabled={!canUndoDraft}
          title="Отменить изменение черновика"
          data-tooltip="Отменить изменение черновика"
        >
          ↶
        </button>
        <button
          onClick={redoDraftChange}
          disabled={!canRedoDraft}
          title="Вернуть изменение черновика"
          data-tooltip="Вернуть изменение черновика"
        >
          ↷
        </button>
        <button
          onClick={() => {
            setIsDraftPropertiesOpen((value) => !value);
            props.onWindowFocus("draftProperties");
          }}
          title="Свойства чернового слоя"
          data-tooltip="Свойства чернового слоя"
        >
          ⚙
        </button>
        <button
          onClick={() => {
            setIsDraftTableOpen((value) => !value);
            props.onWindowFocus("table");
          }}
          disabled={draftFeatureCount === 0}
          title="Таблица черновика"
          data-tooltip="Таблица черновика"
        >
          ▦
        </button>
        <button onClick={exportDraftLayer} disabled={draftFeatureCount === 0} title="Экспортировать GeoJSON" data-tooltip="Экспортировать GeoJSON">
          GeoJSON
        </button>
        <button onClick={() => void loadLatestDraft()} disabled={isDraftBusy || !canPersistDraft} title="Загрузить черновик" data-tooltip="Загрузить черновик">
          Загрузить черновик
        </button>
        <button onClick={() => void saveDraftLayer()} disabled={isDraftBusy || !canPersistDraft || draftFeatureCount === 0} title="Сохранить черновик" data-tooltip="Сохранить черновик">
          Сохранить
        </button>
        <button onClick={() => void submitDraftLayer()} disabled={isDraftBusy || !canPersistDraft || draftFeatureCount === 0} title="Сдать черновик" data-tooltip="Сдать черновик">
          Сдать
        </button>
        <div className="map-scale-controls" aria-label="Масштаб карты">
          <button onClick={() => setMapZoomLevel(mapZoom - 1)} title="Уменьшить масштаб" data-tooltip="Уменьшить масштаб">
            −
          </button>
          <label>
            Масштаб
            <input
              value={mapScaleText}
              onChange={(event) => setMapScaleText(event.target.value)}
              onBlur={applyMapScaleText}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  applyMapScaleText();
                }
              }}
              placeholder="1:10000"
            />
          </label>
          <button onClick={() => setMapZoomLevel(mapZoom + 1)} title="Увеличить масштаб" data-tooltip="Увеличить масштаб">
            +
          </button>
        </div>
        <div className="map-coordinate-controls" aria-label="Координаты курсора">
          <label>
            СК
            <select
              value={coordinateProjection}
              onChange={(event) => setCoordinateProjection(event.target.value as CoordinateProjectionCode)}
            >
              {MAP_COORDINATE_PROJECTIONS.map((projection) => (
                <option key={projection.code} value={projection.code}>
                  {projection.label}
                </option>
              ))}
            </select>
          </label>
          <output>{cursorCoordinates}</output>
        </div>
        <span>
          {props.activeEditableLayerName
            ? `Редактируемый слой: ${props.activeEditableLayerName} · ${activeDraftFeatureCount}/${draftFeatureCount}`
            : `Редактируемый слой не выбран · ${draftFeatureCount} объектов`}
        </span>
      </div>
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
      <section
        className="draft-properties-panel"
        style={{
          left: draftPropertiesPosition.x,
          top: draftPropertiesPosition.y,
          zIndex: props.windowZIndexes.draftProperties,
        }}
        onPointerDown={() => props.onWindowFocus("draftProperties")}
      >
        <div
          className="layer-properties-title draggable-title"
          onPointerDown={(event) => {
            props.onWindowFocus("draftProperties");
            setDraftPropertiesDragOffset({
              x: event.clientX - (panelRef.current?.getBoundingClientRect().left ?? 0) - draftPropertiesPosition.x,
              y: event.clientY - (panelRef.current?.getBoundingClientRect().top ?? 0) - draftPropertiesPosition.y,
            });
          }}
        >
          <div>
            <p className="eyebrow">Рабочий слой</p>
            <h3>Свойства черновика</h3>
          </div>
          <button onClick={() => setIsDraftPropertiesOpen(false)} onPointerDown={(event) => event.stopPropagation()} title="Закрыть">×</button>
        </div>
        <div className="draft-properties-summary">
          <span>{draftId ? `Черновик #${draftId}` : "Новый черновик"}</span>
          <span>{draftFeatureCount} объектов</span>
          <span>{draftCrs || "СК не задана"}</span>
        </div>
        <div className="draft-properties-grid">
          <label>
            Название чернового слоя
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="Например: Новые объекты"
            />
          </label>
          <label>
            Тип геометрии
            <select value={draftGeometryType} onChange={(event) => setDraftGeometryType(event.target.value)}>
              <option value="mixed">Авто / смешанный</option>
              <option value="Point">Точки</option>
              <option value="LineString">Линии</option>
              <option value="Polygon">Полигоны</option>
            </select>
          </label>
          <label>
            Назначенная СК
            <input
              value={draftCrs}
              onChange={(event) => setDraftCrs(event.target.value)}
              placeholder="Например EPSG:4326"
            />
          </label>
          <label>
            Цвет легенды
            <input type="color" value={draftColor} onChange={(event) => setDraftColor(event.target.value)} />
          </label>
          <label>
            Заливка
            <input
              type="range"
              min="0"
              max="0.7"
              step="0.05"
              value={draftFillOpacity}
              onChange={(event) => setDraftFillOpacity(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="draft-properties-block">
          <div className="draft-properties-block-heading">
            <strong>Поля атрибутов</strong>
            <button onClick={applyDraftFieldsToFeatures} disabled={draftFeatureCount === 0 || draftSchemaFields.length === 0}>
              Применить к объектам
            </button>
          </div>
          <div className="draft-field-list">
            {draftSchemaFields.length === 0 ? <span className="muted">Поля пока не заданы.</span> : null}
            {draftSchemaFields.map((field) => (
              <span className="draft-field-chip" key={field}>
                {field}
                <button onClick={() => removeDraftField(field)} title={`Удалить поле ${field}`}>×</button>
              </span>
            ))}
          </div>
          <div className="draft-field-add">
            <input
              value={newDraftFieldName}
              onChange={(event) => setNewDraftFieldName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addDraftField();
                }
              }}
              placeholder="Новое поле"
            />
            <button onClick={addDraftField}>Добавить поле</button>
          </div>
        </div>
        <div className="draft-properties-block">
          <strong>Легенда</strong>
          <div className="draft-legend-row">
            <span className="draft-legend-symbol" style={{ borderColor: draftColor, background: `${draftColor}33` }} />
            <strong>{draftName || "draft-layer"}</strong>
            <span>{draftGeometryType === "mixed" ? detectDraftGeometryType() : draftGeometryType}</span>
            <span>{Math.round(draftFillOpacity * 100)}% заливки</span>
          </div>
        </div>
      </section>
      ) : null}
      <div className="layer-map-canvas" ref={mapElementRef} />
      {tableLayer && props.isTableWindowOpen ? (
        <GisFeatureTable
          layer={tableLayer}
          draftFeatures={tableDraftFeatures}
          selectedDraftFeature={selectedDraftFeature}
          selectedFeature={props.selectedFeature}
          onFeatureSelect={props.onFeatureSelect}
          onDraftFeatureSelect={selectDraftFeature}
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

function DraftFeatureTable(props: {
  layerName: string;
  fields: string[];
  features: Feature<Geometry>[];
  selectedFeature: Feature<Geometry> | null;
  onFeatureSelect: (index: number) => void;
  onAttributeChange: (index: number, key: string, value: string) => void;
  onAddField: (field: string) => void;
  onRemoveField: (field: string) => void;
  onClose: () => void;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [filterText, setFilterText] = useState("");
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: SortDirection } | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [fieldOrder, setFieldOrder] = useState<string[]>([]);
  const orderedFields = [
    ...fieldOrder.filter((field) => props.fields.includes(field)),
    ...props.fields.filter((field) => !fieldOrder.includes(field)),
  ];
  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredRows = props.features
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature, index }) => {
      if (!normalizedFilter) {
        return true;
      }
      const values = [
        index + 1,
        feature.getGeometry()?.getType() ?? "",
        ...orderedFields.map((field) => feature.get(field) ?? ""),
      ];
      return values.some((value) => String(value).toLowerCase().includes(normalizedFilter));
    })
    .sort((left, right) =>
      sortConfig
        ? compareTableValues(left.feature.get(sortConfig.field), right.feature.get(sortConfig.field), sortConfig.direction)
        : left.index - right.index,
    );

  function addField() {
    const field = newFieldName.trim();
    if (!isEditing || !field) {
      return;
    }
    props.onAddField(field);
    setFieldOrder((current) => (current.includes(field) ? current : [...current, field]));
    setNewFieldName("");
  }

  function removeActiveField() {
    if (!isEditing || !sortConfig?.field) {
      return;
    }
    props.onRemoveField(sortConfig.field);
    setFieldOrder((current) => current.filter((field) => field !== sortConfig.field));
    setSortConfig(null);
  }

  function sortByField(field: string) {
    setSortConfig((current) => ({
      field,
      direction: current?.field === field ? nextSortDirection(current.direction) : "asc",
    }));
  }

  function toggleRowSelection(index: number) {
    setSelectedIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
    props.onFeatureSelect(index);
  }

  function selectAllRows() {
    setSelectedIndexes(new Set(filteredRows.map((row) => row.index)));
  }

  function clearSelection() {
    setSelectedIndexes(new Set());
  }

  function invertSelection() {
    const visibleIndexes = filteredRows.map((row) => row.index);
    setSelectedIndexes((current) => new Set(visibleIndexes.filter((index) => !current.has(index))));
  }

  function moveSortedField(direction: -1 | 1) {
    if (!sortConfig?.field) {
      return;
    }
    const fields = [...orderedFields];
    const currentIndex = fields.indexOf(sortConfig.field);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= fields.length) {
      return;
    }
    [fields[currentIndex], fields[nextIndex]] = [fields[nextIndex], fields[currentIndex]];
    setFieldOrder(fields);
  }

  return (
    <section
      className="feature-table-window draft-feature-table-window"
      style={{ left: props.position.x, top: props.position.y, zIndex: props.zIndex }}
      onPointerDown={props.onFocus}
    >
      <div className="feature-table-heading" onPointerDown={props.onDragStart}>
        <div>
          <p className="eyebrow">Атрибутивная таблица</p>
          <h3>{props.layerName}</h3>
        </div>
        <div className="feature-table-actions">
          <span>{props.features.length} объектов</span>
          <button
            onClick={props.onClose}
            onPointerDown={(event) => event.stopPropagation()}
            title="Закрыть таблицу"
          >
            ×
          </button>
        </div>
      </div>
      <div className="feature-table-toolbar">
        <div className="feature-table-tool-group" aria-label="Инструменты таблицы">
          <button
            className={isEditing ? "active" : ""}
            onClick={() => setIsEditing((value) => !value)}
            title={isEditing ? "Выключить редактирование" : "Включить редактирование"}
            data-tooltip={isEditing ? "Выключить редактирование" : "Включить редактирование"}
          >
            ✎
          </button>
          <button
            onClick={selectAllRows}
            disabled={filteredRows.length === 0}
            title="Выделить все"
            data-tooltip="Выделить все"
          >
            ▣
          </button>
          <button onClick={clearSelection} disabled={selectedIndexes.size === 0} title="Снять выделение" data-tooltip="Снять выделение">
            □
          </button>
          <button onClick={invertSelection} disabled={filteredRows.length === 0} title="Инвертировать выделение" data-tooltip="Инвертировать выделение">
            ◩
          </button>
          <button onClick={() => moveSortedField(-1)} disabled={!sortConfig} title="Поле левее" data-tooltip="Поле левее">
            ←
          </button>
          <button onClick={() => moveSortedField(1)} disabled={!sortConfig} title="Поле правее" data-tooltip="Поле правее">
            →
          </button>
          <button onClick={removeActiveField} disabled={!isEditing || !sortConfig} title="Удалить выбранное поле" data-tooltip="Удалить выбранное поле">
            ⊟
          </button>
        </div>
        <label className="feature-table-search">
          Фильтр
          <input
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Поиск по атрибутам"
          />
        </label>
      </div>
      <div className="feature-table-field-add compact">
        <input
          value={newFieldName}
          onChange={(event) => setNewFieldName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addField();
            }
          }}
          disabled={!isEditing}
          placeholder="Новое поле"
        />
        <button onClick={addField} disabled={!isEditing || !newFieldName.trim()}>Добавить поле</button>
      </div>
      {props.fields.length === 0 ? (
        <p className="muted">Добавьте поля в свойствах чернового слоя, чтобы редактировать таблицу.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table editable-feature-table gis-feature-table">
            <thead>
              <tr>
                <th className="row-index">#</th>
                <th>Геометрия</th>
                {orderedFields.map((field) => (
                  <th key={field}>
                    <button className="feature-table-sort" onClick={() => sortByField(field)}>
                      {field}
                      {sortConfig?.field === field ? (sortConfig.direction === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ feature, index }) => (
                <tr
                  key={`draft-${index}`}
                  className={[props.selectedFeature === feature ? "selected" : "", selectedIndexes.has(index) ? "multi-selected" : ""].filter(Boolean).join(" ")}
                  onClick={() => toggleRowSelection(index)}
                >
                  <td>{index + 1}</td>
                  <td>{feature.getGeometry()?.getType() ?? "—"}</td>
                  {orderedFields.map((field) => (
                    <td key={field}>
                      <input
                        value={String(feature.get(field) ?? "")}
                        onChange={(event) => props.onAttributeChange(index, field, event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        disabled={!isEditing}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="feature-table-statusbar">
        <span>{filteredRows.length}/{props.features.length} объектов показано</span>
        <span>{props.fields.length} полей</span>
        <span>{selectedIndexes.size} выделено</span>
        <span>{props.selectedFeature ? `Выбран объект #${props.features.indexOf(props.selectedFeature) + 1}` : "Нет выбранного объекта"}</span>
      </div>
    </section>
  );
}

function FeatureTable(props: {
  layer: LayerPreviewState;
  selectedFeature: SelectedLayerFeature;
  onFeatureSelect: (feature: SelectedLayerFeature) => void;
  onAttributeChange: (assetId: number, featureIndex: number, field: string, value: string) => void;
  onAddField: (assetId: number, field: string) => void;
  onRemoveField: (assetId: number, field: string) => void;
  onClose: () => void;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [filterText, setFilterText] = useState("");
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: SortDirection } | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [fieldOrder, setFieldOrder] = useState<string[]>([]);
  const fields = previewAttributeFields(props.layer.preview);
  const orderedFields = [
    ...fieldOrder.filter((field) => fields.includes(field)),
    ...fields.filter((field) => !fieldOrder.includes(field)),
  ];
  const rows = props.layer.preview.geojson.features;
  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredRows = rows
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature, index }) => {
      if (!normalizedFilter) {
        return true;
      }
      const values = [
        index + 1,
        feature.geometry?.type ?? "",
        ...orderedFields.map((field) => feature.properties?.[field] ?? ""),
      ];
      return values.some((value) => String(value).toLowerCase().includes(normalizedFilter));
    })
    .sort((left, right) =>
      sortConfig
        ? compareTableValues(
            left.feature.properties?.[sortConfig.field],
            right.feature.properties?.[sortConfig.field],
            sortConfig.direction,
          )
        : left.index - right.index,
    );

  function addField() {
    const field = newFieldName.trim();
    if (!isEditing || !field) {
      return;
    }
    props.onAddField(props.layer.asset.id, field);
    setFieldOrder((current) => (current.includes(field) ? current : [...current, field]));
    setNewFieldName("");
  }

  function removeActiveField() {
    if (!isEditing || !sortConfig?.field) {
      return;
    }
    props.onRemoveField(props.layer.asset.id, sortConfig.field);
    setFieldOrder((current) => current.filter((field) => field !== sortConfig.field));
    setSortConfig(null);
  }

  function sortByField(field: string) {
    setSortConfig((current) => ({
      field,
      direction: current?.field === field ? nextSortDirection(current.direction) : "asc",
    }));
  }

  function toggleRowSelection(index: number) {
    setSelectedIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
    props.onFeatureSelect({ assetId: props.layer.asset.id, featureIndex: index });
  }

  function selectAllRows() {
    setSelectedIndexes(new Set(filteredRows.map((row) => row.index)));
  }

  function clearSelection() {
    setSelectedIndexes(new Set());
  }

  function invertSelection() {
    const visibleIndexes = filteredRows.map((row) => row.index);
    setSelectedIndexes((current) => new Set(visibleIndexes.filter((index) => !current.has(index))));
  }

  function moveSortedField(direction: -1 | 1) {
    if (!sortConfig?.field) {
      return;
    }
    const nextFields = [...orderedFields];
    const currentIndex = nextFields.indexOf(sortConfig.field);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= nextFields.length) {
      return;
    }
    [nextFields[currentIndex], nextFields[nextIndex]] = [nextFields[nextIndex], nextFields[currentIndex]];
    setFieldOrder(nextFields);
  }

  return (
    <section
      className="feature-table-window"
      style={{ left: props.position.x, top: props.position.y, zIndex: props.zIndex }}
      onPointerDown={props.onFocus}
    >
      <div className="feature-table-heading" onPointerDown={props.onDragStart}>
        <div>
          <p className="eyebrow">Атрибутивная таблица</p>
          <h3>{layerDisplayName(props.layer.asset.asset_name)}</h3>
        </div>
        <div className="feature-table-actions">
          <span>{rows.length}/{props.layer.preview.feature_count} объектов</span>
          <button
            onClick={props.onClose}
            onPointerDown={(event) => event.stopPropagation()}
            title="Закрыть таблицу"
          >
            ×
          </button>
        </div>
      </div>
      <div className="feature-table-field-add">
        <input
          value={newFieldName}
          onChange={(event) => setNewFieldName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addField();
            }
          }}
          placeholder="Новое поле"
        />
        <button onClick={addField}>Добавить поле</button>
      </div>
      <div className="feature-table-toolbar">
        <div className="feature-table-tool-group" aria-label="Инструменты таблицы">
          <span className="feature-table-badge">Preview</span>
          <button
            onClick={() =>
              props.selectedFeature
                ? props.onFeatureSelect(props.selectedFeature)
                : filteredRows[0]
                  ? props.onFeatureSelect({ assetId: props.layer.asset.id, featureIndex: filteredRows[0].index })
                  : undefined
            }
            disabled={filteredRows.length === 0}
            title="Выбрать строку"
            data-tooltip="Выбрать строку"
          >
            ⊙
          </button>
        </div>
        <label className="feature-table-search">
          Фильтр
          <input
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Поиск по атрибутам"
          />
        </label>
      </div>
      {fields.length === 0 ? (
        <p className="muted">У слоя нет атрибутивных полей для таблицы.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table editable-feature-table gis-feature-table">
            <thead>
              <tr>
                <th className="row-index">#</th>
                <th>Геометрия</th>
                {fields.map((field) => (
                  <th key={field}>{field}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ feature, index }) => (
                <tr
                  key={`${props.layer.asset.id}-${index}`}
                  className={
                    props.selectedFeature?.assetId === props.layer.asset.id &&
                    props.selectedFeature.featureIndex === index
                      ? "selected"
                      : ""
                  }
                  onClick={() => props.onFeatureSelect({ assetId: props.layer.asset.id, featureIndex: index })}
                >
                  <td>{index + 1}</td>
                  <td>{feature.geometry?.type ?? "—"}</td>
                  {fields.map((field) => (
                    <td key={field}>
                      <input
                        value={String(feature.properties?.[field] ?? "")}
                        onChange={(event) =>
                          props.onAttributeChange(props.layer.asset.id, index, field, event.target.value)
                        }
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="feature-table-statusbar">
        <span>{filteredRows.length}/{rows.length} объектов показано</span>
        <span>{fields.length} полей</span>
        <span>
          {props.selectedFeature?.assetId === props.layer.asset.id
            ? `Выбран объект #${props.selectedFeature.featureIndex + 1}`
            : "Нет выбранного объекта"}
        </span>
      </div>
    </section>
  );
}

function GisFeatureTable(props: {
  layer: LayerPreviewState;
  draftFeatures: Feature<Geometry>[];
  selectedDraftFeature: Feature<Geometry> | null;
  selectedFeature: SelectedLayerFeature;
  onFeatureSelect: (feature: SelectedLayerFeature) => void;
  onDraftFeatureSelect: (feature: Feature<Geometry>) => void;
  onAttributeChange: (assetId: number, featureIndex: number, field: string, value: string) => void;
  onDraftAttributeChange: (feature: Feature<Geometry>, field: string, value: string) => void;
  onAddField: (assetId: number, field: string) => void;
  onRemoveField: (assetId: number, field: string) => void;
  onClose: () => void;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [filterText, setFilterText] = useState("");
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: SortDirection } | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [fieldOrder, setFieldOrder] = useState<string[]>([]);
  const draftFields = new Set<string>();
  props.draftFeatures.forEach((feature) => {
    Object.keys(feature.getProperties()).forEach((key) => {
      if (
        key !== "geometry" &&
        key !== "draft_layer_asset_id" &&
        key !== "draft_layer_name" &&
        !key.startsWith("layer")
      ) {
        draftFields.add(key);
      }
    });
  });
  const fields = Array.from(new Set([...previewAttributeFields(props.layer.preview), ...draftFields]));
  const emptyLayerFields = props.layer.preview.geojson.features[0]?.properties
    ? Object.keys(props.layer.preview.geojson.features[0].properties ?? {})
    : [];
  const schemaFields = fields.length > 0 ? fields : emptyLayerFields;
  const orderedFields = [
    ...fieldOrder.filter((field) => schemaFields.includes(field)),
    ...schemaFields.filter((field) => !fieldOrder.includes(field)),
  ];
  const sourceRows = props.layer.preview.geojson.features.filter((feature) => feature.geometry !== null);
  const rows = [
    ...sourceRows.map((feature, index) => ({
      kind: "source" as const,
      feature,
      index,
      rowId: `source-${index}`,
    })),
    ...props.draftFeatures.map((feature, index) => ({
      kind: "draft" as const,
      feature,
      index,
      rowId: `draft-${index}`,
    })),
  ];
  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredRows = rows
    .filter((row) => {
      if (!normalizedFilter) {
        return true;
      }
      const values = [
        row.index + 1,
        row.kind === "source" ? row.feature.geometry?.type ?? "" : row.feature.getGeometry()?.getType() ?? "",
        ...orderedFields.map((field) =>
          row.kind === "source" ? row.feature.properties?.[field] ?? "" : row.feature.get(field) ?? "",
        ),
      ];
      return values.some((value) => String(value).toLowerCase().includes(normalizedFilter));
    })
    .sort((left, right) =>
      sortConfig
        ? compareTableValues(
            left.kind === "source" ? left.feature.properties?.[sortConfig.field] : left.feature.get(sortConfig.field),
            right.kind === "source" ? right.feature.properties?.[sortConfig.field] : right.feature.get(sortConfig.field),
            sortConfig.direction,
          )
        : left.index - right.index,
    );

  function addField() {
    const field = newFieldName.trim();
    if (!isEditing || !field) {
      return;
    }
    props.onAddField(props.layer.asset.id, field);
    setFieldOrder((current) => (current.includes(field) ? current : [...current, field]));
    setNewFieldName("");
  }

  function removeActiveField() {
    if (!isEditing || !sortConfig?.field) {
      return;
    }
    props.onRemoveField(props.layer.asset.id, sortConfig.field);
    setFieldOrder((current) => current.filter((field) => field !== sortConfig.field));
    setSortConfig(null);
  }

  function sortByField(field: string) {
    setSortConfig((current) => ({
      field,
      direction: current?.field === field ? nextSortDirection(current.direction) : "asc",
    }));
  }

  function toggleRowSelection(row: (typeof rows)[number]) {
    const selectionIndex = row.kind === "source" ? row.index : props.layer.preview.geojson.features.length + row.index;
    setSelectedIndexes((current) => {
      const next = new Set(current);
      if (next.has(selectionIndex)) {
        next.delete(selectionIndex);
      } else {
        next.add(selectionIndex);
      }
      return next;
    });
    if (row.kind === "source") {
      props.onFeatureSelect({ assetId: props.layer.asset.id, featureIndex: row.index });
    } else {
      props.onDraftFeatureSelect(row.feature);
    }
  }

  function selectAllRows() {
    setSelectedIndexes(new Set(filteredRows.map((row) => (row.kind === "source" ? row.index : sourceRows.length + row.index))));
  }

  function clearSelection() {
    setSelectedIndexes(new Set());
  }

  function invertSelection() {
    const visibleIndexes = filteredRows.map((row) => (row.kind === "source" ? row.index : sourceRows.length + row.index));
    setSelectedIndexes((current) => new Set(visibleIndexes.filter((index) => !current.has(index))));
  }

  function moveSortedField(direction: -1 | 1) {
    if (!sortConfig?.field) {
      return;
    }
    const nextFields = [...orderedFields];
    const currentIndex = nextFields.indexOf(sortConfig.field);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= nextFields.length) {
      return;
    }
    [nextFields[currentIndex], nextFields[nextIndex]] = [nextFields[nextIndex], nextFields[currentIndex]];
    setFieldOrder(nextFields);
  }

  return (
    <section
      className="feature-table-window"
      style={{ left: props.position.x, top: props.position.y, zIndex: props.zIndex }}
      onPointerDown={props.onFocus}
    >
      <div className="feature-table-heading" onPointerDown={props.onDragStart}>
        <div>
          <p className="eyebrow">Атрибутивная таблица</p>
          <h3>{layerDisplayName(props.layer.asset.asset_name)}</h3>
        </div>
        <div className="feature-table-actions">
          <span>{rows.length}/{props.layer.preview.feature_count + props.draftFeatures.length} объектов</span>
          <button onClick={props.onClose} onPointerDown={(event) => event.stopPropagation()} title="Закрыть таблицу">
            ×
          </button>
        </div>
      </div>
      <div className="feature-table-toolbar compact">
        <div className="feature-table-tool-group" aria-label="Инструменты таблицы">
          <button className={isEditing ? "active" : ""} onClick={() => setIsEditing((value) => !value)} title="Режим редактирования" data-tooltip="Режим редактирования">✎</button>
          <button onClick={selectAllRows} disabled={filteredRows.length === 0} title="Выделить все" data-tooltip="Выделить все">▣</button>
          <button onClick={clearSelection} disabled={selectedIndexes.size === 0} title="Снять выделение" data-tooltip="Снять выделение">□</button>
          <button onClick={invertSelection} disabled={filteredRows.length === 0} title="Инвертировать выделение" data-tooltip="Инвертировать выделение">◩</button>
          <button onClick={() => moveSortedField(-1)} disabled={!sortConfig} title="Поле левее" data-tooltip="Поле левее">←</button>
          <button onClick={() => moveSortedField(1)} disabled={!sortConfig} title="Поле правее" data-tooltip="Поле правее">→</button>
          <button onClick={removeActiveField} disabled={!isEditing || !sortConfig} title="Удалить выбранное поле" data-tooltip="Удалить выбранное поле">⊟</button>
        </div>
        <label className="feature-table-search">
          <span>Фильтр</span>
          <input value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="Поиск" />
        </label>
      </div>
      <div className="feature-table-field-add compact">
        <input
          value={newFieldName}
          onChange={(event) => setNewFieldName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addField();
            }
          }}
          disabled={!isEditing}
          placeholder="Новое поле"
        />
        <button onClick={addField} disabled={!isEditing || !newFieldName.trim()}>Добавить поле</button>
      </div>
      {orderedFields.length === 0 ? (
        <p className="muted">У слоя нет атрибутивных полей. Включите редактирование и добавьте поле.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table editable-feature-table gis-feature-table">
            <thead>
              <tr>
                <th className="row-index">#</th>
                <th>Геометрия</th>
                {orderedFields.map((field) => (
                  <th key={field}>
                    <button className="feature-table-sort" onClick={() => sortByField(field)}>
                      {field}
                      {sortConfig?.field === field ? (sortConfig.direction === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const selectionIndex = row.kind === "source" ? row.index : sourceRows.length + row.index;
                const geometryType =
                  row.kind === "source"
                    ? row.feature.geometry?.type ?? "—"
                    : row.feature.getGeometry()?.getType() ?? "—";
                const isSelected =
                  row.kind === "source"
                    ? props.selectedFeature?.assetId === props.layer.asset.id &&
                      props.selectedFeature.featureIndex === row.index
                    : props.selectedDraftFeature === row.feature;
                return (
                <tr
                  key={`${props.layer.asset.id}-${row.rowId}`}
                  className={[
                    isSelected ? "selected" : "",
                    selectedIndexes.has(selectionIndex) ? "multi-selected" : "",
                    row.kind === "draft" ? "draft-row" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => toggleRowSelection(row)}
                >
                  <td>{selectionIndex + 1}</td>
                  <td>{geometryType}{row.kind === "draft" ? " · черновик" : ""}</td>
                  {orderedFields.map((field) => (
                    <td key={field}>
                      <input
                        value={String(row.kind === "source" ? row.feature.properties?.[field] ?? "" : row.feature.get(field) ?? "")}
                        onChange={(event) => {
                          if (row.kind === "source") {
                            props.onAttributeChange(props.layer.asset.id, row.index, field, event.target.value);
                          } else {
                            props.onDraftAttributeChange(row.feature, field, event.target.value);
                          }
                        }}
                        onClick={(event) => event.stopPropagation()}
                        disabled={!isEditing}
                      />
                    </td>
                  ))}
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="feature-table-statusbar">
        <span>{isEditing ? "Редактирование включено" : "Просмотр"}</span>
        <span>{filteredRows.length}/{rows.length} объектов показано</span>
        <span>{orderedFields.length} полей</span>
        <span>{selectedIndexes.size} выделено</span>
      </div>
    </section>
  );
}

function RequirementsEditor(props: {
  requirements: Requirements;
  expectedGeometryTypesText: string;
  requiredAttributesText: string;
  topologyRulesText: string;
  expectedOutputsText: string;
  hasExpectedOutputs: boolean;
  isLoading: boolean;
  onLoadRequirements: () => void;
  onSaveRequirements: () => void;
  onAssignmentFileChange: (file: File | null) => void;
  onExtractRequirements: () => void;
  onClearExpectedOutputs: () => void;
  onRequirementsChange: (value: Requirements | ((current: Requirements) => Requirements)) => void;
  onExpectedGeometryTypesChange: (value: string) => void;
  onRequiredAttributesChange: (value: string) => void;
  onTopologyRulesChange: (value: string) => void;
  onExpectedOutputsChange: (value: string) => void;
}) {
  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Требования</p>
          <h2>Автоизвлечение и правка</h2>
        </div>
        <div className="button-row">
          <button onClick={props.onLoadRequirements} disabled={props.isLoading}>
            Загрузить
          </button>
          <button className="primary" onClick={props.onSaveRequirements} disabled={props.isLoading}>
            Сохранить
          </button>
        </div>
      </div>

      <section className={`mode-panel ${props.hasExpectedOutputs ? "strict-mode" : "report-mode"}`}>
        <div>
          <p className="eyebrow">Режим проверки</p>
          <h2>{props.hasExpectedOutputs ? "Формальная проверка ГИС-результатов" : "Проверка отчёта и вопросов"}</h2>
        </div>
        <pre>{props.requirements.extraction_notes || "Пока нет данных автоизвлечения."}</pre>
      </section>

      <div className="upload-row">
        <label>
          Файл задания
          <input
            type="file"
            accept=".doc,.docx,.txt"
            onChange={(event) => props.onAssignmentFileChange(event.target.files?.[0] ?? null)}
            disabled={props.isLoading}
          />
        </label>
        <button onClick={props.onExtractRequirements} disabled={props.isLoading}>
          Извлечь
        </button>
        <button className="danger slim" onClick={props.onClearExpectedOutputs} disabled={props.isLoading}>
          Очистить результаты
        </button>
      </div>

      <div className="field-row two">
        <label>
          Формат сдачи
          <select
            value={props.requirements.submission_format ?? "archive"}
            onChange={(event) =>
              props.onRequirementsChange((current) => ({ ...current, submission_format: event.target.value }))
            }
          >
            <option value="archive">Архив с отчётом и ГИС-файлами</option>
            <option value="report_only">Только отчёт</option>
            <option value="online_workspace">Работа в онлайн-карте</option>
          </select>
        </label>

        <label>
          Формат результата
          <select
            value={props.requirements.deliverable_format ?? ""}
            onChange={(event) =>
              props.onRequirementsChange((current) => ({
                ...current,
                deliverable_format: stringOrNull(event.target.value),
              }))
            }
          >
            <option value="">Не задан</option>
            <option value="shapefile_zip">Shapefile ZIP</option>
            <option value="geojson">GeoJSON</option>
            <option value="docx">DOCX</option>
            <option value="txt">TXT</option>
          </select>
        </label>
      </div>

      <div className="field-row two">
        <label>
          Ожидаемая СК
          <input
            value={props.requirements.expected_crs ?? ""}
            onChange={(event) =>
              props.onRequirementsChange((current) => ({ ...current, expected_crs: event.target.value }))
            }
            placeholder="Например EPSG:4326"
          />
        </label>
        <label>
          Файл задания
          <input
            value={props.requirements.source_doc_name ?? ""}
            onChange={(event) =>
              props.onRequirementsChange((current) => ({ ...current, source_doc_name: event.target.value }))
            }
            placeholder="Zadanie_1_2.docx"
          />
        </label>
      </div>

      <div className="toggles">
        <label>
          <input
            type="checkbox"
            checked={Boolean(props.requirements.report_required)}
            onChange={(event) =>
              props.onRequirementsChange((current) => ({ ...current, report_required: event.target.checked }))
            }
          />
          Отчёт обязателен
        </label>
        <label>
          <input
            type="checkbox"
            checked={Boolean(props.requirements.auto_checkable)}
            onChange={(event) =>
              props.onRequirementsChange((current) => ({ ...current, auto_checkable: event.target.checked }))
            }
          />
          Автопроверка
        </label>
      </div>

      <div className="field-row two">
        <label>
          Типы геометрии JSON
          <textarea
            value={props.expectedGeometryTypesText}
            onChange={(event) => props.onExpectedGeometryTypesChange(event.target.value)}
            spellCheck={false}
          />
        </label>
        <label>
          Обязательные поля JSON
          <textarea
            value={props.requiredAttributesText}
            onChange={(event) => props.onRequiredAttributesChange(event.target.value)}
            spellCheck={false}
          />
        </label>
      </div>

      <label>
        Ожидаемые результаты JSON
        <textarea
          className="large"
          value={props.expectedOutputsText}
          onChange={(event) => props.onExpectedOutputsChange(event.target.value)}
          spellCheck={false}
        />
      </label>

      <div className="field-row two">
        <label>
          Топологические правила JSON
          <textarea
            value={props.topologyRulesText}
            onChange={(event) => props.onTopologyRulesChange(event.target.value)}
            spellCheck={false}
          />
        </label>
        <label>
          Заметки
          <textarea
            value={props.requirements.extraction_notes ?? ""}
            onChange={(event) =>
              props.onRequirementsChange((current) => ({ ...current, extraction_notes: event.target.value }))
            }
          />
        </label>
      </div>
    </section>
  );
}

function SubmissionPanel(props: {
  submissions: Submission[];
  selectedSubmissionId: number | null;
  assets: SubmissionAsset[];
  checks: SubmissionCheck[];
  aiReview: AiReviewResponse | null;
  mapPreview: GeoJsonPreview | null;
  selectedMapFeatureIndex: number | null;
  isLoading: boolean;
  mode: "teacher" | "student";
  onRefresh?: () => void;
  onSubmissionSelect: (id: number) => void;
  onGenerateAiReview: () => void;
  onLoadAssetPreview: (assetId: number) => void;
  onFetchAssetPreview: (assetId: number) => Promise<GeoJsonPreview>;
  onMapFeatureSelect: (index: number | null) => void;
}) {
  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{props.mode === "teacher" ? "Сдачи" : "Обратная связь"}</p>
          <h2>{props.mode === "teacher" ? "Сданные работы" : "Мои сдачи"}</h2>
        </div>
        <div className="button-row">
          {props.onRefresh ? (
            <button onClick={props.onRefresh} disabled={props.isLoading}>
              Обновить
            </button>
          ) : null}
          {props.selectedSubmissionId ? (
            <button onClick={() => openMapViewer(props.selectedSubmissionId!)} disabled={props.isLoading}>
              Слои в новой вкладке
            </button>
          ) : null}
          <button onClick={props.onGenerateAiReview} disabled={props.isLoading || !props.selectedSubmissionId}>
            AI-review
          </button>
        </div>
      </div>

      <div className="submission-layout">
        <div className="list-stack">
          {props.submissions.length === 0 ? <p className="muted">Пока нет загруженных работ.</p> : null}
          {props.submissions.map((submission) => (
            <button
              key={submission.id}
              className={submission.id === props.selectedSubmissionId ? "list-item active" : "list-item"}
              onClick={() => props.onSubmissionSelect(submission.id)}
              disabled={props.isLoading}
            >
              <strong>{submission.original_filename}</strong>
              <span>
                #{submission.id} · {statusLabel(submission.status)} ·{" "}
                {new Date(submission.created_at).toLocaleString()}
              </span>
            </button>
          ))}
        </div>

        <div className="details-panel">
          {props.aiReview ? (
            <div className="review-box">
              <div className="review-heading">
                <h3>AI-review</h3>
                <span>{props.aiReview.ai_review?.status || "response"}</span>
              </div>
              <pre className="review-text">
                {props.aiReview.ai_review?.review_text || props.aiReview.ai_review?.message || formatJson(props.aiReview)}
              </pre>
              {props.aiReview.warnings?.length ? (
                <div className="warning-list">
                  {props.aiReview.warnings.map((warning, index) => (
                    <span key={`${warning}-${index}`}>{warning}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : props.selectedSubmissionId ? (
            <p className="muted">AI-review ещё не запрошен для выбранной сдачи.</p>
          ) : null}

          {props.mapPreview ? (
            <MapPreviewPanel
              preview={props.mapPreview}
              selectedFeatureIndex={props.selectedMapFeatureIndex}
              onFeatureSelect={props.onMapFeatureSelect}
            />
          ) : null}

          <h3>Файлы</h3>
          <div className="table-like">
            {props.assets.map((asset) => (
              <div key={asset.id}>
                <strong>{layerDisplayName(asset.asset_name)}</strong>
                <span>
                  {asset.asset_type} · {asset.detected_format} · {statusLabel(asset.status)}
                </span>
                {isPreviewableAsset(asset) ? (
                  <button onClick={() => props.onLoadAssetPreview(asset.id)} disabled={props.isLoading}>
                    {props.mapPreview?.asset_id === asset.id ? "Карта открыта" : "Карта"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <h3>Проверки</h3>
          <div className="table-like">
            {props.checks.map((check) => (
              <div key={check.id}>
                <strong>
                  {check.file_type} · {statusLabel(check.status)}
                </strong>
                <span>{check.message}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </section>
  );
}

function MapPreviewPanel(props: {
  preview: GeoJsonPreview;
  selectedFeatureIndex: number | null;
  onFeatureSelect: (index: number | null) => void;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const vectorLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const selectedFeatureIndexRef = useRef<number | null>(props.selectedFeatureIndex);
  const features = props.preview.geojson.features;
  const selectedFeature =
    props.selectedFeatureIndex !== null ? features[props.selectedFeatureIndex] ?? null : null;

  useEffect(() => {
    if (!mapElementRef.current) {
      return;
    }

    const normalStyle = new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({ color: "rgba(23, 111, 107, 0.65)" }),
        stroke: new Stroke({ color: "#176f6b", width: 2 }),
      }),
      fill: new Fill({ color: "rgba(23, 111, 107, 0.25)" }),
      stroke: new Stroke({ color: "#176f6b", width: 2 }),
    });
    const selectedStyle = new Style({
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({ color: "rgba(199, 115, 38, 0.75)" }),
        stroke: new Stroke({ color: "#b45f1c", width: 3 }),
      }),
      fill: new Fill({ color: "rgba(199, 115, 38, 0.35)" }),
      stroke: new Stroke({ color: "#b45f1c", width: 3 }),
    });

    const vectorSource = new VectorSource({
      features: new GeoJSON().readFeatures(props.preview.geojson, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      }),
    });
    vectorSource.getFeatures().forEach((feature, index) => {
      feature.set("previewIndex", index);
    });

    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: (feature) =>
        feature.get("previewIndex") === selectedFeatureIndexRef.current ? selectedStyle : normalStyle,
    });
    vectorLayerRef.current = vectorLayer;

    const map = new Map({
      target: mapElementRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
        vectorLayer,
      ],
      view: new View({
        center: [0, 0],
        zoom: 2,
      }),
    });
    mapRef.current = map;

    const extent = vectorSource.getExtent();
    if (Number.isFinite(extent[0])) {
      map.getView().fit(extent, {
        padding: [30, 30, 30, 30],
        maxZoom: 16,
        duration: 200,
      });
    }

    map.on("singleclick", (event) => {
      const feature = map.forEachFeatureAtPixel(event.pixel, (hit) => hit);
      const index = typeof feature?.get("previewIndex") === "number" ? feature.get("previewIndex") : null;
      props.onFeatureSelect(index);
    });

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
      vectorLayerRef.current = null;
    };
  }, [props.preview]);

  useEffect(() => {
    selectedFeatureIndexRef.current = props.selectedFeatureIndex;
    vectorLayerRef.current?.changed();
  }, [props.selectedFeatureIndex]);

  return (
    <section className="map-preview-panel">
      <div className="map-preview-heading">
        <div>
          <p className="eyebrow">Предпросмотр карты</p>
          <h3>{layerDisplayName(props.preview.asset_name)}</h3>
        </div>
        <span>
          {props.preview.preview_feature_count}/{props.preview.feature_count} объектов · {props.preview.crs}
        </span>
      </div>

      <div className="map-preview-grid">
        <div className="map-canvas" ref={mapElementRef} />

        <aside className="feature-panel">
          <h3>Атрибуты</h3>
          {props.preview.truncated ? (
            <p className="muted">Preview ограничен первыми {props.preview.preview_feature_count} объектами.</p>
          ) : null}
          {selectedFeature ? (
            <div className="feature-properties">
              {Object.entries(selectedFeature.properties ?? {}).length === 0 ? (
                <p className="muted">У объекта нет атрибутов.</p>
              ) : null}
              {Object.entries(selectedFeature.properties ?? {}).map(([key, value]) => (
                <div key={key}>
                  <strong>{key}</strong>
                  <span>{String(value ?? "")}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Кликните по объекту на карте.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

export default App;
