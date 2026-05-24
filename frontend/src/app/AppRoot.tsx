import { useEffect, useMemo, useRef, useState } from "react";
import { register } from "ol/proj/proj4";
import proj4 from "proj4";
import "ol/ol.css";
import "./AppRoot.css";
import type { LayerStyleSettings } from "../features/map/layerStyles";
import { RequirementsEditor } from "../features/requirements/RequirementsEditor";
import { SubmissionPanel } from "../features/submissions/SubmissionPanel";
import { AssignmentOverview, ClassStream, CourseHeader, PeoplePanel } from "../features/course/CoursePanels";
import { LayerWorkspace } from "../features/map/LayerWorkspace";
import { MAP_COORDINATE_PROJECTIONS } from "../features/map/mapWorkspaceUtils";
import type { LayerStyleManifest } from "../features/map/mapWorkspaceUtils";
import { StandaloneArchivePreview, StandaloneAssignmentWorkspace, StandaloneMapViewer } from "../features/map/StandaloneMapScreens";
import { ReportPreviewModal } from "../features/report-preview/ReportPreviewModal";
import type { ReportPreviewSource } from "../features/report-preview/ReportPreviewModal";
import { UserProfileMenu } from "../features/profile/UserProfileMenu";

type UserRole = "admin" | "teacher" | "student";
type AuthMode = "login" | "register";
type CourseTab = "stream" | "assignments" | "submissions" | "layers" | "requirements" | "people";
type ThemeMode = "light" | "dark";
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
  email_verified?: boolean;
  created_at?: string;
  updated_at?: string;
};

type AuthResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

type RegisterResponse = Partial<AuthResponse> & {
  verification_required?: boolean;
  email?: string | null;
  message?: string | null;
  dev_code?: string | null;
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
  original_feature_count?: number;
  bbox_filter?: number[] | null;
  preview_feature_count: number;
  truncated: boolean;
  geojson: {
    type: "FeatureCollection";
    features: GeoJsonFeature[];
  };
};

type QgisProjectLayer = {
  id?: string | null;
  name: string;
  source?: string | null;
  source_basename?: string | null;
  visible?: boolean;
  order?: number;
  style?: Partial<LayerStyleSettings> | null;
};

type QgisProjectMetadata = {
  project_name?: string | null;
  source?: string | null;
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

type ArchivePreviewResponse = {
  preview_token?: string;
  source_filename: string;
  assignment_id: number;
  assets: SubmissionAsset[];
  previews: GeoJsonPreview[];
  layer_count: number;
  layer_summaries?: ArchivePreviewLayerSummary[];
  qgis_project?: QgisProjectMetadata | null;
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

type AiReviewResponse = {
  ai_review?: {
    status?: string;
    message?: string;
    review_text?: string;
  };
  warnings?: string[];
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
  import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || "/api";

const AUTH_STORAGE_KEY = "gis_edu_auth";
const THEME_STORAGE_KEY = "gis_edu_theme";
const RESEND_COOLDOWN_SECONDS = 60;
const ARCHIVE_PREVIEW_STORAGE_PREFIX = "gis_edu_archive_preview:";
const RUSSIA_PREVIEW_BBOX = "19,41,180,82";
const RUSSIA_PREVIEW_QUERY = `bbox=${encodeURIComponent(RUSSIA_PREVIEW_BBOX)}&clip_boundary=russia`;
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

function formatDetectedFormat(format: string) {
  if (format === "geojson") return "Слой карты";
  if (format === "shapefile_zip") return "Архив слоёв";
  if (format === "qgis_project") return "QGIS-проект";
  if (format === "docx") return "Документ DOCX";
  if (format === "pdf") return "Документ PDF";
  return format.replace(/_/g, " ");
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

async function downloadAuthorizedFile(path: string, suggestedFilename: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: storedAuthHeaders(),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} вернул ${response.status}: ${text}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = suggestedFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
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

MAP_COORDINATE_PROJECTIONS.forEach((projection) => {
  if (projection.definition) {
    proj4.defs(projection.code, projection.definition);
  }
});
register(proj4);

function roleLabel(role: UserRole) {
  const labels: Record<UserRole, string> = {
    admin: "Администратор",
    teacher: "Преподаватель",
    student: "Студент",
  };
  return labels[role];
}

function themeIcon(themeMode: ThemeMode) {
  return themeMode === "dark" ? "☀" : "◐";
}

function toggleStoredTheme(currentTheme: ThemeMode, onChange: (theme: ThemeMode) => void) {
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  onChange(nextTheme);
}

function ThemeIconButton(props: { themeMode: ThemeMode; onToggle: () => void; className?: string }) {
  return (
    <button
      className={["theme-switch-button", props.themeMode === "dark" ? "dark" : "light", props.className ?? ""].filter(Boolean).join(" ")}
      onClick={props.onToggle}
      title={props.themeMode === "dark" ? "Светлая тема" : "Тёмная тема"}
      aria-label={props.themeMode === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
      type="button"
    >
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-knob" />
      </span>
    </button>
  );
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
  const [authVerificationEmail, setAuthVerificationEmail] = useState<string | null>(null);
  const [authVerificationCode, setAuthVerificationCode] = useState("");
  const [authResendCooldownSeconds, setAuthResendCooldownSeconds] = useState(0);
  const [reportPreviewSource, setReportPreviewSource] = useState<ReportPreviewSource | null>(null);
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
  const [submissionArchiveFile, setSubmissionArchiveFile] = useState<File | null>(null);
  const [submissionReportFile, setSubmissionReportFile] = useState<File | null>(null);
  const [assets, setAssets] = useState<SubmissionAsset[]>([]);
  const [submissionStyleManifest, setSubmissionStyleManifest] = useState<LayerStyleManifest | null>(null);
  const [checks, setChecks] = useState<SubmissionCheck[]>([]);
  const [aiReview, setAiReview] = useState<AiReviewResponse | null>(null);
  const [mapPreview, setMapPreview] = useState<GeoJsonPreview | null>(null);
  const [selectedMapFeatureIndex, setSelectedMapFeatureIndex] = useState<number | null>(null);
  const submissionFiles = [submissionArchiveFile, submissionReportFile].filter(Boolean) as File[];
  const submissionFileIsArchive = Boolean(submissionArchiveFile);

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
    if (authResendCooldownSeconds <= 0) {
      return;
    }
    const timerId = window.setTimeout(() => {
      setAuthResendCooldownSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearTimeout(timerId);
  }, [authResendCooldownSeconds]);

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
      const parsed = JSON.parse(savedAuth) as Partial<AuthResponse>;
      if (!parsed?.access_token || !parsed?.user?.role) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return;
      }
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
    setAuthVerificationEmail(null);
    setAuthVerificationCode("");
    setAuthResendCooldownSeconds(0);
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

      const data = await fetchJson<RegisterResponse>(
        `/auth/${authMode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        null,
      );
      if (data.access_token && data.user) {
        persistAuth(data as AuthResponse);
      } else if (data.verification_required) {
        const email = data.email ?? authEmail.trim();
        setAuthVerificationEmail(email);
        setAuthVerificationCode(data.dev_code ?? "");
        setAuthResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
        setAuthMessage(`Код подтверждения отправлен на ${email}.`);
      } else {
        throw new Error(data.message ?? "Регистрация не завершена.");
      }
      setAuthPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось выполнить вход.";
      applyCooldownFromErrorMessage(message);
      setErrorMessage(message);
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

  async function submitEmailVerification() {
    const email = authVerificationEmail ?? authEmail.trim();
    if (!email || !authVerificationCode.trim()) {
      setErrorMessage("Введите email и код подтверждения.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchJson<AuthResponse>(
        "/auth/verify-email",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code: authVerificationCode.trim() }),
        },
        null,
      );
      persistAuth(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось подтвердить почту.");
    } finally {
      setIsLoading(false);
    }
  }

  async function resendEmailVerification() {
    const email = authVerificationEmail ?? authEmail.trim();
    if (!email) {
      setErrorMessage("Введите email для повторной отправки кода.");
      return;
    }
    if (authResendCooldownSeconds > 0) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchJson<RegisterResponse>(
        "/auth/resend-verification",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
        null,
      );
      setAuthVerificationEmail(email);
      setAuthVerificationCode(data.dev_code ?? "");
      setAuthResendCooldownSeconds(RESEND_COOLDOWN_SECONDS);
      setAuthMessage(`Новый код отправлен на ${email}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось отправить код повторно.";
      applyCooldownFromErrorMessage(message);
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  function applyCooldownFromErrorMessage(message: string) {
    const match = message.match(/(\d+)\s*seconds/i);
    if (match) {
      const seconds = Number.parseInt(match[1], 10);
      if (Number.isFinite(seconds) && seconds > 0) {
        setAuthResendCooldownSeconds(seconds);
      }
    }
  }

  async function updateCurrentUserEmail(emailValue: string) {
    const email = emailValue.trim();
    if (!authToken || !currentUser || !email || email === currentUser.email) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const user = await fetchJson<User>("/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setCurrentUser(user);
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          access_token: authToken,
          token_type: "bearer",
          user,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось обновить почту.";
      setErrorMessage(message);
      throw error;
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
    setAuthVerificationEmail(null);
    setAuthVerificationCode("");
    setAuthResendCooldownSeconds(0);
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
    setSubmissionStyleManifest(null);
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
    setSubmissionStyleManifest(null);
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
    if (submissionFiles.length === 0) {
      setErrorMessage("Выберите архив для сдачи.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("assignment_id", String(selectedAssignmentId));
      submissionFiles.forEach((file) => formData.append("files", file));

      const submission = await fetchJson<Submission>("/submissions/", {
        method: "POST",
        body: formData,
      });
      setSubmissionArchiveFile(null);
      setSubmissionReportFile(null);
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
    if (!submissionArchiveFile) {
      setErrorMessage("Выберите ZIP-архив для предпросмотра.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("assignment_id", String(selectedAssignmentId));
      formData.append("file", submissionArchiveFile);

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
      const [nextAssets, nextChecks, nextStyleManifest] = await Promise.all([
        fetchJson<SubmissionAsset[]>(`/submissions/${submissionId}/assets`),
        fetchJson<SubmissionCheck[]>(`/submissions/${submissionId}/checks`),
        fetchJson<LayerStyleManifest | null>(`/submissions/${submissionId}/style-manifest`).catch(() => null),
      ]);
      setAssets(nextAssets);
      setChecks(nextChecks);
      setSubmissionStyleManifest(nextStyleManifest);
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
    return fetchJson<GeoJsonPreview>(`/downloads/submission-assets/${assetId}/geojson-preview?${RUSSIA_PREVIEW_QUERY}`);
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
              <UserProfileMenu
                user={currentUser}
                isLoading={isLoading}
                onUpdateEmail={updateCurrentUserEmail}
                onRefresh={refreshCurrentUser}
                onLogout={logout}
              />
              <ThemeIconButton themeMode={themeMode} onToggle={() => toggleStoredTheme(themeMode, setThemeMode)} />
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
            authVerificationEmail={authVerificationEmail}
            authVerificationCode={authVerificationCode}
            authResendCooldownSeconds={authResendCooldownSeconds}
            isLoading={isLoading}
            onModeChange={(mode) => {
              setAuthMode(mode);
              setAuthVerificationEmail(null);
              setAuthVerificationCode("");
              setAuthResendCooldownSeconds(0);
            }}
            onEmailChange={setAuthEmail}
            onPasswordChange={setAuthPassword}
            onFullNameChange={setAuthFullName}
            onVerificationCodeChange={setAuthVerificationCode}
            onSubmit={() => void submitAuthForm()}
            onVerifyEmail={() => void submitEmailVerification()}
            onResendVerification={() => void resendEmailVerification()}
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
                styleManifest={submissionStyleManifest}
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
                onPreviewReport={setReportPreviewSource}
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
                styleManifest={submissionStyleManifest}
                checks={checks}
                aiReview={aiReview}
                mapPreview={mapPreview}
                selectedMapFeatureIndex={selectedMapFeatureIndex}
                hasSubmissionFile={submissionFiles.length > 0}
                submissionFileIsArchive={submissionFileIsArchive}
                submissionArchiveFile={submissionArchiveFile}
                submissionReportFile={submissionReportFile}
                activeTab={activeTab}
                isLoading={isLoading}
                onCourseHome={openCourseHome}
                onCourseSelect={selectCourse}
                onTabChange={setActiveTab}
                onAssignmentSelect={(id) => void selectAssignment(id)}
                onAssignmentsReload={() => void loadAssignments()}
                onLoadCourseMembers={() => void loadCourseMembers()}
                onSubmissionArchiveFileChange={setSubmissionArchiveFile}
                onSubmissionReportFileChange={setSubmissionReportFile}
                onUploadSubmission={() => void uploadSubmission()}
                onPreviewSubmissionArchive={() => void previewSubmissionArchive()}
                onSubmissionSelect={(id) => void loadSubmissionDetails(id)}
                onGenerateAiReview={() => void generateAiReview()}
                onLoadAssetPreview={(id) => void loadAssetGeojsonPreview(id)}
                onFetchAssetPreview={fetchAssetGeojsonPreview}
                onMapFeatureSelect={setSelectedMapFeatureIndex}
                onPreviewReport={setReportPreviewSource}
              />
            ) : null}
          </div>
        </section>
      )}
      <ReportPreviewModal
        source={reportPreviewSource}
        onClose={() => setReportPreviewSource(null)}
      />
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
  authVerificationEmail: string | null;
  authVerificationCode: string;
  authResendCooldownSeconds: number;
  isLoading: boolean;
  onModeChange: (mode: AuthMode) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onFullNameChange: (value: string) => void;
  onVerificationCodeChange: (value: string) => void;
  onSubmit: () => void;
  onVerifyEmail: () => void;
  onResendVerification: () => void;
}) {
  const verificationEmail = props.authVerificationEmail ?? props.authEmail;
  const resendDisabled =
    props.isLoading || !verificationEmail || props.authResendCooldownSeconds > 0;
  const resendLabel =
    props.authResendCooldownSeconds > 0
      ? `Отправить ещё раз (${props.authResendCooldownSeconds} с)`
      : "Отправить ещё раз";

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

        {props.authVerificationEmail ? (
          <div className="verification-box">
            <label>
              Код из письма
              <input
                inputMode="numeric"
                value={props.authVerificationCode}
                onChange={(event) => props.onVerificationCodeChange(event.target.value)}
                autoComplete="one-time-code"
                placeholder="000000"
              />
            </label>
            <div className="verification-actions">
              <button className="primary" onClick={props.onVerifyEmail} disabled={props.isLoading}>
                Подтвердить почту
              </button>
              <button onClick={props.onResendVerification} disabled={resendDisabled}>
                {resendLabel}
              </button>
            </div>
          </div>
        ) : null}

        <p className="auth-note">
          Публичная регистрация создаёт только студента. Если включена проверка почты, код вводится один раз после регистрации.
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
  styleManifest?: LayerStyleManifest | null;
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
  onPreviewReport: (source: ReportPreviewSource) => void;
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
          <SubmissionPanel
            {...props}
            mode="teacher"
            onRefresh={props.onLoadSubmissions}
            onPreviewReport={(asset) => props.onPreviewReport({ kind: "asset", assetId: asset.id, name: asset.asset_name })}
          />
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
  styleManifest?: LayerStyleManifest | null;
  checks: SubmissionCheck[];
  aiReview: AiReviewResponse | null;
  mapPreview: GeoJsonPreview | null;
  selectedMapFeatureIndex: number | null;
  hasSubmissionFile: boolean;
  submissionFileIsArchive: boolean;
  submissionArchiveFile: File | null;
  submissionReportFile: File | null;
  activeTab: CourseTab;
  isLoading: boolean;
  onCourseHome: () => void;
  onCourseSelect: (courseId: number) => void;
  onTabChange: (tab: CourseTab) => void;
  onAssignmentSelect: (id: number) => void;
  onAssignmentsReload: () => void;
  onLoadCourseMembers: () => void;
  onSubmissionArchiveFileChange: (file: File | null) => void;
  onSubmissionReportFileChange: (file: File | null) => void;
  onUploadSubmission: () => void;
  onPreviewSubmissionArchive: () => void;
  onSubmissionSelect: (id: number) => void;
  onGenerateAiReview: () => void;
  onLoadAssetPreview: (assetId: number) => void;
  onFetchAssetPreview: (assetId: number) => Promise<GeoJsonPreview>;
  onMapFeatureSelect: (index: number | null) => void;
  onDraftSubmitted?: (submission: Submission) => void | Promise<void>;
  onPreviewReport: (source: ReportPreviewSource) => void;
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
              {props.selectedAssignment ? <StudentAssignmentMaterialsBox assignment={props.selectedAssignment} /> : null}
              {props.selectedAssignmentId ? (
                <div className="upload-row">
                  <label>
                    Архив работы
                    <input
                      type="file"
                      accept=".zip"
                      onChange={(event) => props.onSubmissionArchiveFileChange(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <label>
                    DOCX-отчёт
                    <input
                      type="file"
                      accept=".docx"
                      onChange={(event) => props.onSubmissionReportFileChange(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <button className="primary" onClick={props.onUploadSubmission} disabled={props.isLoading}>
                    Сдать работу
                  </button>
                  <button onClick={props.onPreviewSubmissionArchive} disabled={props.isLoading || !props.submissionFileIsArchive}>
                    Проверить на карте
                  </button>
                  <button
                    onClick={() => {
                      if (props.submissionReportFile) {
                        props.onPreviewReport({ kind: "file", file: props.submissionReportFile });
                      }
                    }}
                    disabled={props.isLoading || !props.submissionReportFile}
                  >
                    Просмотреть отчёт
                  </button>
                  {props.hasSubmissionFile ? (
                    <div className="muted">
                      Выбрано: {[props.submissionArchiveFile?.name, props.submissionReportFile?.name].filter(Boolean).join(", ")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </section>
        ) : null}

        {props.activeTab === "submissions" ? (
          <SubmissionPanel
            {...props}
            mode="student"
            onPreviewReport={(asset) => props.onPreviewReport({ kind: "asset", assetId: asset.id, name: asset.asset_name })}
          />
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

function AssignmentMaterialsList(props: {
  materials: AssignmentMaterial[];
  emptyMessage?: string;
}) {
  if (props.materials.length === 0) {
    return <p className="muted">{props.emptyMessage ?? "Материалов пока нет."}</p>;
  }
  return (
    <div className="materials-list-compact">
      {props.materials.map((material) => (
        <div key={material.id} className="material-row-compact">
          <div className="material-row-info">
            <strong title={material.material_name}>{layerDisplayName(material.material_name)}</strong>
            <span>
              {formatDetectedFormat(material.detected_format)} · {statusLabel(material.status)}
            </span>
          </div>
          {material.download_url ? (
            <button
              className="icon-button"
              title={`Скачать ${material.material_name}`}
              aria-label={`Скачать ${material.material_name}`}
              onClick={() => {
                void downloadAuthorizedFile(material.download_url!, material.material_name).catch(
                  (error) => alert(error instanceof Error ? error.message : String(error)),
                );
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AssignmentMaterialsBox(props: { assignment: Assignment }) {
  const [materials, setMaterials] = useState<AssignmentMaterial[]>([]);
  const [layerFile, setLayerFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
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

  async function uploadSingleFile(file: File): Promise<number> {
    const formData = new FormData();
    formData.append("file", file);
    const created = await storedAuthFetchJson<AssignmentMaterial[]>(
      `/assignments/${props.assignment.id}/materials`,
      { method: "POST", body: formData },
    );
    return created.length;
  }

  async function uploadMaterials() {
    if (!layerFile && !documentFile) {
      setMessage("Выберите хотя бы один файл — архив слоёв или документ.");
      return;
    }

    setIsBusy(true);
    const errors: string[] = [];
    let totalCreated = 0;
    try {
      if (layerFile) {
        try {
          totalCreated += await uploadSingleFile(layerFile);
        } catch (error) {
          errors.push(`Слои: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (documentFile) {
        try {
          totalCreated += await uploadSingleFile(documentFile);
        } catch (error) {
          errors.push(`Документ: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      setLayerFile(null);
      setDocumentFile(null);
      await loadMaterials();
      if (errors.length > 0) {
        setMessage(`Загружено: ${totalCreated}. Ошибки: ${errors.join("; ")}`);
      } else {
        setMessage(`Материалы загружены (записей: ${totalCreated}).`);
      }
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
          <h3>Исходные материалы задания</h3>
        </div>
        <button onClick={() => openAssignmentWorkspace(props.assignment.id)}>Открыть карту</button>
      </div>
      <div className="material-upload-grid">
        <label>
          Архив слоёв / QGIS-проект (ZIP)
          <input
            type="file"
            accept=".zip"
            onChange={(event) => setLayerFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Документ задания / методичка / шаблон (DOCX, PDF)
          <input
            type="file"
            accept=".docx,.pdf"
            onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button
          onClick={() => void uploadMaterials()}
          disabled={isBusy || (!layerFile && !documentFile)}
          className="primary"
        >
          Загрузить выбранное
        </button>
      </div>
      {layerFile || documentFile ? (
        <p className="muted">
          Выбрано: {[layerFile?.name, documentFile?.name].filter(Boolean).join(", ")}
        </p>
      ) : null}
      <p className="muted">{message}</p>
      <AssignmentMaterialsList materials={materials} />
    </section>
  );
}

function StudentAssignmentMaterialsBox(props: { assignment: Assignment }) {
  const [materials, setMaterials] = useState<AssignmentMaterial[]>([]);
  const [message, setMessage] = useState("Загрузка материалов задания...");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await storedAuthFetchJson<AssignmentMaterial[]>(
          `/assignments/${props.assignment.id}/materials`,
        );
        if (cancelled) return;
        setMaterials(data);
        setMessage(
          data.length > 0
            ? `Материалов: ${data.length}. Доступны для скачивания.`
            : "Преподаватель пока не приложил материалы.",
        );
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "Не удалось загрузить материалы.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [props.assignment.id]);

  return (
    <section className="materials-box">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">Материалы преподавателя</p>
          <h3>Файлы задания</h3>
        </div>
      </div>
      <p className="muted">{message}</p>
      <AssignmentMaterialsList materials={materials} emptyMessage="Преподаватель пока не приложил материалы." />
    </section>
  );
}


export default App;