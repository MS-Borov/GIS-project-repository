import { transformExtent } from "ol/proj";
import { previewAttributeFields } from "./layerStyles";
import type { GeoJsonFeature, GeoJsonPreview, LayerPreviewState, LayerStyleSettings, SubmissionAsset } from "./layerStyles";
export type { GeoJsonFeature, GeoJsonPreview, LayerPreviewState, LayerStyleSettings, SubmissionAsset } from "./layerStyles";

export type UserRole = "admin" | "teacher" | "student";
export type ThemeMode = "light" | "dark";
export type MapWindowKey = "layerProperties" | "table" | "draftProperties" | "symbolEditor";
export type CoordinateProjectionCode = string;

export type User = {
  id: number;
  email: string;
  full_name?: string | null;
  role: UserRole;
  is_active: boolean;
};

export type AuthResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

export type Assignment = {
  id: number;
  course_id?: number | null;
  title: string;
  description?: string | null;
};

export type Submission = {
  id: number;
  assignment_id: number;
  student_id?: number | null;
  original_filename: string;
  status: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
};

export type AssignmentMaterial = {
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

export type QgisProjectLayer = {
  id?: string | null;
  name: string;
  source?: string | null;
  source_basename?: string | null;
  visible?: boolean;
  order?: number;
  group_name?: string | null;
  group_path?: string[];
  style?: Partial<LayerStyleSettings> | null;
};

export type QgisProjectMetadata = {
  project_name?: string | null;
  source?: string | null;
  crs?: string | null;
  hide_basemap?: boolean;
  background?: string | null;
  extent?: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    crs?: string | null;
  } | null;
  layers?: QgisProjectLayer[];
};

export type ArchivePreviewLayerSummary = {
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

export type ArchivePreviewResponse = {
  preview_token?: string;
  source_filename: string;
  assignment_id: number;
  assets: SubmissionAsset[];
  previews: GeoJsonPreview[];
  layer_count: number;
  layer_summaries?: ArchivePreviewLayerSummary[];
  qgis_project?: QgisProjectMetadata | null;
  style_manifest?: LayerStyleManifest | null;
  warnings: string[];
};

export type LayerStyleManifestLayer = {
  source_layer_id?: string | number | null;
  source_layer_name?: string | null;
  asset_name?: string | null;
  export_stem?: string | null;
  alias?: string | null;
  group_name?: string | null;
  group_path?: string[];
  style?: Partial<LayerStyleSettings> | null;
};

export type LayerStyleManifest = {
  version: number;
  layers: LayerStyleManifestLayer[];
};

export type LayerLayoutSnapshot = {
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

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "/api";
export const AUTH_STORAGE_KEY = "gis_edu_auth";
export const THEME_STORAGE_KEY = "gis_edu_theme";
export const ARCHIVE_PREVIEW_STORAGE_PREFIX = "gis_edu_archive_preview:";
export const REPORT_PREVIEW_STORAGE_PREFIX = "gis_edu_report_preview:";
export const SHAPEFILE_PART_EXTENSIONS = new Set([".shp", ".dbf", ".shx", ".prj", ".cpg", ".qix", ".sbn", ".sbx"]);
export const RUSSIA_PREVIEW_BBOX = "19,41,180,82";
export const RUSSIA_PREVIEW_QUERY = `bbox=${encodeURIComponent(RUSSIA_PREVIEW_BBOX)}`;
export const DEFAULT_LAYER_GROUP = "Слои";
export const LOCAL_LAYER_GROUP = "Локальные слои";

const WGS84_UTM_NORTH_PROJECTIONS = Array.from({ length: 27 }, (_, index) => {
  const zone = 34 + index;
  return {
    code: `EPSG:${32600 + zone}`,
    label: `EPSG:${32600 + zone} WGS 84 / UTM zone ${zone}N`,
  };
});

const PULKOVO_1942_GAUSS_KRUGER_PROJECTIONS = Array.from({ length: 28 }, (_, index) => {
  const zone = 3 + index;
  const epsg = 28400 + zone;
  const lon0 = zone * 6 - 3;
  return {
    code: `EPSG:${epsg}`,
    label: `EPSG:${epsg} Pulkovo 1942 / Gauss-Kruger zone ${zone}`,
    definition: `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=1 +x_0=${zone * 1000000 + 500000} +y_0=0 +ellps=krass +towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12 +units=m +no_defs +type=crs`,
  };
});

export const MAP_COORDINATE_PROJECTIONS: Array<{ code: CoordinateProjectionCode; label: string; definition?: string }> = [
  { code: "EPSG:4326", label: "EPSG:4326 WGS 84, градусы" },
  { code: "EPSG:3857", label: "EPSG:3857 Web Mercator, метры" },
  {
    code: "EPSG:4284",
    label: "EPSG:4284 Pulkovo 1942, градусы",
    definition: "+proj=longlat +ellps=krass +towgs84=23.92,-141.27,-80.9,0,0.35,0.82,-0.12 +no_defs +type=crs",
  },
  ...WGS84_UTM_NORTH_PROJECTIONS,
  ...PULKOVO_1942_GAUSS_KRUGER_PROJECTIONS,
];

export function stringOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function layerDisplayName(assetName: string) {
  return assetName.replace(/\.(zip|geojson|shp)$/i, "");
}

export function layerMatchKey(value: string | null | undefined) {
  return layerDisplayName(String(value ?? ""))
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .trim()
    .toLowerCase();
}

export function qgisLayerForAsset(project: QgisProjectMetadata | null | undefined, asset: SubmissionAsset) {
  if (!project?.layers?.length) {
    return null;
  }
  const assetKey = layerMatchKey(asset.asset_name);
  return project.layers.find((layer) =>
    [layer.source_basename, layer.name, layer.source].map(layerMatchKey).includes(assetKey),
  ) ?? null;
}

export function qgisLayerOrder(project: QgisProjectMetadata | null | undefined, asset: SubmissionAsset) {
  const layer = qgisLayerForAsset(project, asset);
  return typeof layer?.order === "number" ? layer.order : Number.MAX_SAFE_INTEGER;
}

function isLocalLayerAsset(asset: SubmissionAsset) {
  return asset.submission_id === 0 || asset.id < 0;
}

export function uniqueLayerAssets(assets: SubmissionAsset[], project: QgisProjectMetadata | null | undefined) {
  const seen = new Set<string>();
  const projectKeys = new Set(
    (project?.layers ?? [])
      .flatMap((layer) => [layer.source_basename, layer.name, layer.source])
      .map(layerMatchKey)
      .filter(Boolean),
  );
  const sourceAssets = projectKeys.size > 0
    ? assets.filter((asset) => isLocalLayerAsset(asset) || projectKeys.has(layerMatchKey(asset.asset_name)))
    : assets;
  return sourceAssets
    .slice()
    .sort((left, right) => qgisLayerOrder(project, left) - qgisLayerOrder(project, right))
    .filter((asset) => {
      const key = layerMatchKey(asset.asset_name);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

export function qgisProjectExtent3857(project: QgisProjectMetadata | null | undefined) {
  const extent = project?.extent;
  if (!extent) {
    return null;
  }
  const values = [extent.xmin, extent.ymin, extent.xmax, extent.ymax];
  if (!values.every(Number.isFinite)) {
    return null;
  }
  try {
    return transformExtent(values, extent.crs || "EPSG:4326", "EPSG:3857");
  } catch {
    return null;
  }
}

export function fileExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
}

export function mapViewerUrl(submissionId: number) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("view", "map");
  url.searchParams.set("submission_id", String(submissionId));
  return url.toString();
}

export function openMapViewer(submissionId: number) {
  window.open(mapViewerUrl(submissionId), "_blank", "noopener,noreferrer");
}

export function storedAuthHeaders(): HeadersInit {
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

export function storedUserRole(): UserRole | null {
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

export async function storedAuthFetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export function defaultLabelField(preview: GeoJsonPreview) {
  const fields = previewAttributeFields(preview);
  const preferred = ["name", "Name", "NAME", "title", "Title", "TITLE", "label", "Label", "LABEL"];
  return preferred.find((field) => fields.includes(field)) ?? fields[0] ?? null;
}

export function statusLabel(status: string) {
  const value = status.toLowerCase();
  if (value === "passed") return "Пройдено";
  if (value === "warning") return "Есть замечания";
  if (value === "failed") return "Ошибка";
  if (value === "uploaded") return "Загружено";
  if (value === "unknown") return "Неизвестно";
  return status;
}

export function isPreviewableAsset(asset: SubmissionAsset) {
  return asset.asset_type === "layer" && ["geojson", "shapefile_zip"].includes(asset.detected_format);
}

export function normalizeGeoJsonFeatureCollection(value: unknown): GeoJsonPreview["geojson"] {
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
  throw new Error("Файл не похож на поддерживаемую коллекцию объектов.");
}

export function toggleStoredTheme(currentTheme: ThemeMode, onChange: (theme: ThemeMode) => void) {
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  document.documentElement.dataset.theme = nextTheme;
  onChange(nextTheme);
}

export function ThemeIconButton(props: { themeMode: ThemeMode; onToggle: () => void; className?: string }) {
  return (
    <button
      className={["theme-switch-button", props.themeMode === "dark" ? "dark" : "light", props.className].filter(Boolean).join(" ")}
      onClick={props.onToggle}
      title={props.themeMode === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
      aria-label={props.themeMode === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
      type="button"
    >
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-knob" />
      </span>
    </button>
  );
}

