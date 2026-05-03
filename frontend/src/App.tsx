import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import Map from "ol/Map";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import Snap from "ol/interaction/Snap";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import "ol/ol.css";
import "./App.css";

type UserRole = "admin" | "teacher" | "student";
type AuthMode = "login" | "register";
type CourseTab = "stream" | "assignments" | "submissions" | "layers" | "requirements" | "people";
type ThemeMode = "light" | "dark";
type EditMode = "select" | "point" | "line" | "polygon";

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

type LayerPreviewState = {
  asset: SubmissionAsset;
  preview: GeoJsonPreview;
  visible: boolean;
  labelsVisible: boolean;
  labelField: string | null;
};

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
const LAYER_COLORS = ["#176f6b", "#c77326", "#3867a6", "#7c5aa6", "#6f8f2e", "#b33f62"];

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

function previewAttributeFields(preview: GeoJsonPreview) {
  const fields = new Set<string>();
  preview.geojson.features.slice(0, 25).forEach((feature) => {
    Object.keys(feature.properties ?? {}).forEach((key) => fields.add(key));
  });
  return Array.from(fields).sort((left, right) => left.localeCompare(right));
}

function defaultLabelField(preview: GeoJsonPreview) {
  const fields = previewAttributeFields(preview);
  const preferred = ["name", "Name", "NAME", "title", "Title", "TITLE", "label", "Label", "LABEL"];
  return preferred.find((field) => fields.includes(field)) ?? fields[0] ?? null;
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
  return status;
}

function isPreviewableAsset(asset: SubmissionAsset) {
  return asset.asset_type === "layer" && ["geojson", "shapefile_zip"].includes(asset.detected_format);
}

function App() {
  const mapViewerSubmissionId = Number(new URLSearchParams(window.location.search).get("submission_id"));
  if (new URLSearchParams(window.location.search).get("view") === "map" && Number.isInteger(mapViewerSubmissionId) && mapViewerSubmissionId > 0) {
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
      setStatusMessage(`Map preview для asset #${assetId} загружен.`);
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
      setStatusMessage(`Requirements загружены для задания #${assignmentId}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить requirements.";
      if (message.includes("404")) {
        applyLoadedRequirements({ ...emptyRequirements, assignment_id: assignmentId });
        setStatusMessage("Requirements пока не созданы. Можно загрузить файл задания или заполнить поля.");
      } else {
        setErrorMessage(message);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function saveRequirements() {
    if (!canEditRequirements) {
      setErrorMessage("Редактировать requirements может только преподаватель или администратор.");
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
        expected_outputs_json: parseJsonArrayField<Record<string, unknown>>("Expected outputs", expectedOutputsText),
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
      setStatusMessage(`Requirements сохранены. Обновлено: ${new Date().toLocaleTimeString()}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось сохранить requirements.");
    } finally {
      setIsLoading(false);
    }
  }

  async function extractRequirementsFromFile() {
    if (!canEditRequirements) {
      setErrorMessage("Извлекать requirements может только преподаватель или администратор.");
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
      setStatusMessage(`Requirements извлечены из файла «${assignmentFile.name}». Проверьте и сохраните правки.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Не удалось извлечь requirements из файла.");
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
    setStatusMessage("Expected outputs очищены локально. Нажмите «Сохранить», чтобы записать в backend.");
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
            <p className="eyebrow">GIS Classroom MVP</p>
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
}) {
  return (
    <section className="workspace-grid">
      <aside className="side-panel">
        <h2>{props.course.title}</h2>
        <div className="course-mini-card">
          <span>Курс</span>
          <strong>{props.assignments.length} заданий</strong>
          <small>
            {props.submissions.length} сдач · {props.courseMembers.length} участников
          </small>
        </div>

        <button onClick={props.onAssignmentsReload} disabled={props.isLoading}>
          Обновить список
        </button>

        <div className="list-stack">
          {props.assignments.map((assignment) => (
            <button
              key={assignment.id}
              className={assignment.id === props.selectedAssignmentId ? "list-item active" : "list-item"}
              onClick={() => props.onAssignmentSelect(assignment.id)}
              disabled={props.isLoading}
            >
              <strong>{assignment.title}</strong>
              <span>#{assignment.id}</span>
            </button>
          ))}
        </div>
      </aside>

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
  onSubmissionSelect: (id: number) => void;
  onGenerateAiReview: () => void;
  onLoadAssetPreview: (assetId: number) => void;
  onFetchAssetPreview: (assetId: number) => Promise<GeoJsonPreview>;
  onMapFeatureSelect: (index: number | null) => void;
}) {
  return (
    <section className="workspace-grid">
      <aside className="side-panel">
        <h2>{props.course.title}</h2>
        <h2>Доступные задания</h2>
        <button onClick={props.onAssignmentsReload} disabled={props.isLoading}>
          Обновить список
        </button>
        <div className="list-stack">
          {props.assignments.map((assignment) => (
            <button
              key={assignment.id}
              className={assignment.id === props.selectedAssignmentId ? "list-item active" : "list-item"}
              onClick={() => props.onAssignmentSelect(assignment.id)}
              disabled={props.isLoading}
            >
              <strong>{assignment.title}</strong>
              <span>#{assignment.id}</span>
            </button>
          ))}
        </div>
      </aside>

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
              assignments={props.assignments}
              selectedAssignmentId={props.selectedAssignmentId}
              onAssignmentSelect={props.onAssignmentSelect}
              isLoading={props.isLoading}
            />
            <section className="section-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Submit</p>
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
                </div>
              ) : null}
            </section>
          </section>
        ) : null}

        {props.activeTab === "submissions" ? (
          <SubmissionPanel {...props} mode="student" />
        ) : null}

        {props.activeTab === "layers" ? (
          <LayerWorkspace {...props} />
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
    tabs.push({ id: "requirements", label: "Requirements" });
  }

  return (
    <section className="course-shell">
      <div className="course-banner">
        <div>
          <p className="eyebrow">{props.role === "teacher" ? "Teacher classroom" : "Student classroom"}</p>
          <h2>{props.course.title}</h2>
          <p>
            {props.course.description ||
              "Учебное пространство для выдачи GIS-заданий, сдачи архивов и автоматической проверки отчётов и слоёв."}
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
                ? "Загрузите файл задания, проверьте извлечённые requirements и откройте сдачи студентов."
                : "Откройте задание, прикрепите архив с отчётом и GIS-файлами, затем посмотрите автоматический feedback."}
            </p>
          </div>
        </article>

        <article className="stream-card">
          <div className="stream-icon">AI</div>
          <div>
            <h3>Автоматическая проверка</h3>
            <p>
              {props.hasExpectedOutputs
                ? "Для задания есть формальные GIS-outputs: система сверяет слои, форматы, геометрию, CRS и атрибуты."
                : "Если явных GIS-outputs нет, система анализирует отчёт, вложенные файлы и ограничения проверки."}
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
  assignments: Assignment[];
  selectedAssignmentId: number | null;
  isLoading: boolean;
  onAssignmentSelect: (id: number) => void;
}) {
  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Classwork</p>
          <h2>Задания курса</h2>
        </div>
      </div>
      <div className="classwork-list">
        {props.assignments.length === 0 ? <p className="muted">Пока нет созданных заданий.</p> : null}
        {props.assignments.map((assignment) => (
          <button
            key={assignment.id}
            className={assignment.id === props.selectedAssignmentId ? "classwork-item active" : "classwork-item"}
            onClick={() => props.onAssignmentSelect(assignment.id)}
            disabled={props.isLoading}
          >
            <span className="classwork-dot">#</span>
            <span>
              <strong>{assignment.title}</strong>
              <small>{assignment.description || `Assignment #${assignment.id}`}</small>
            </span>
          </button>
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

function StandaloneMapViewer(props: { submissionId: number }) {
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
        const nextAssets = await viewerFetchJson<SubmissionAsset[]>(`/submissions/${props.submissionId}/assets`);
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
    return viewerFetchJson<GeoJsonPreview>(`/downloads/submission-assets/${assetId}/geojson-preview`);
  }

  return (
    <main className="map-viewer-shell">
      <header className="map-viewer-header">
        <div>
          <p className="eyebrow">GIS viewer</p>
          <h1>Карта сдачи #{props.submissionId}</h1>
        </div>
        <button onClick={() => window.close()}>Закрыть вкладку</button>
      </header>
      {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
      <LayerWorkspace
        selectedSubmissionId={props.submissionId}
        submissions={[]}
        assets={assets}
        isLoading={isLoading}
        onSubmissionSelect={() => undefined}
        onFetchAssetPreview={fetchAssetPreview}
        isStandalone
      />
    </main>
  );
}

function LayerWorkspace(props: {
  selectedSubmissionId: number | null;
  submissions: Submission[];
  assets: SubmissionAsset[];
  isLoading: boolean;
  onSubmissionSelect: (id: number) => void;
  onFetchAssetPreview: (assetId: number) => Promise<GeoJsonPreview>;
  isStandalone?: boolean;
}) {
  const [layers, setLayers] = useState<LayerPreviewState[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<SelectedLayerFeature>(null);
  const [loadingLayerIds, setLoadingLayerIds] = useState<number[]>([]);
  const [layerErrors, setLayerErrors] = useState<Record<number, string>>({});
  const [draggedLayerId, setDraggedLayerId] = useState<number | null>(null);
  const [layerMenuId, setLayerMenuId] = useState<number | null>(null);
  const [expandedLayerId, setExpandedLayerId] = useState<number | null>(null);
  const [tableLayerId, setTableLayerId] = useState<number | null>(null);
  const [isTableWindowOpen, setIsTableWindowOpen] = useState(false);
  const [zoomToLayerId, setZoomToLayerId] = useState<number | null>(null);
  const [zoomToLayerTick, setZoomToLayerTick] = useState(0);
  const previewableAssets = props.assets.filter(isPreviewableAsset);
  const loadedLayerIds = new Set(layers.map((layer) => layer.asset.id));
  const orderedAssets = [
    ...layers.map((layer) => layer.asset),
    ...previewableAssets.filter((asset) => !loadedLayerIds.has(asset.id)),
  ];
  const selectedSubmission = props.submissions.find((submission) => submission.id === props.selectedSubmissionId) ?? null;

  useEffect(() => {
    setLayers([]);
    setSelectedFeature(null);
    setLayerErrors({});
    setLoadingLayerIds([]);
    setDraggedLayerId(null);
    setLayerMenuId(null);
    setExpandedLayerId(null);
    setTableLayerId(null);
    setIsTableWindowOpen(false);
    setZoomToLayerId(null);
    setZoomToLayerTick(0);
  }, [props.selectedSubmissionId]);

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
      const preview = await props.onFetchAssetPreview(asset.id);
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
    for (const asset of previewableAssets) {
      if (!layers.some((layer) => layer.asset.id === asset.id)) {
        await loadLayer(asset);
      }
    }
  }

  function toggleLayer(assetId: number) {
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId ? { ...layer, visible: !layer.visible } : layer,
      ),
    );
  }

  function dropLayer(targetAssetId: number) {
    if (!draggedLayerId || draggedLayerId === targetAssetId) {
      setDraggedLayerId(null);
      return;
    }

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
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId ? { ...layer, labelField, labelsVisible: Boolean(labelField) } : layer,
      ),
    );
  }

  function toggleLayerLabels(assetId: number) {
    setLayers((current) =>
      current.map((layer) =>
        layer.asset.id === assetId ? { ...layer, labelsVisible: !layer.labelsVisible } : layer,
      ),
    );
  }

  return (
    <section className="section-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">GIS viewer</p>
          <h2>Слои выбранной сдачи</h2>
        </div>
        <div className="button-row">
          {props.selectedSubmissionId && !props.isStandalone ? (
            <button onClick={() => openMapViewer(props.selectedSubmissionId!)}>Открыть карту в новой вкладке</button>
          ) : null}
          <button onClick={() => void loadAllLayers()} disabled={props.isLoading || !props.selectedSubmissionId || previewableAssets.length === 0}>
            Загрузить все слои
          </button>
        </div>
      </div>

      {!props.selectedSubmissionId ? (
        <div className="empty-state">
          <h2>Выберите сдачу</h2>
          <p>Откройте работу студента во вкладке сдач, затем здесь можно будет просмотреть все GIS-слои на одной карте.</p>
        </div>
      ) : null}

      {props.selectedSubmissionId ? (
        <div className="layer-workspace">
          <aside className="layer-list">
            <div className="layer-list-heading">
              <div>
                <strong>{selectedSubmission?.original_filename ?? `Сдача #${props.selectedSubmissionId}`}</strong>
                <span>{previewableAssets.length} GIS-слоёв найдено</span>
              </div>
            </div>

            {previewableAssets.length === 0 ? (
              <p className="muted">В выбранной сдаче нет GeoJSON или shapefile_zip слоёв для карты.</p>
            ) : null}

            {orderedAssets.map((asset) => {
              const layer = layers.find((item) => item.asset.id === asset.id);
              const layerIndex = layers.findIndex((item) => item.asset.id === asset.id);
              const layerColor = layerIndex >= 0 ? LAYER_COLORS[layerIndex % LAYER_COLORS.length] : "#9ba8b0";
              const isLoadingLayer = loadingLayerIds.includes(asset.id);
              const fields = layer ? previewAttributeFields(layer.preview) : [];
              return (
                <div
                  key={asset.id}
                  className={[
                    "layer-row",
                    layer?.visible ? "active" : "",
                    layer ? "draggable" : "",
                    draggedLayerId === asset.id ? "dragging" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  draggable={Boolean(layer)}
                  onDragStart={() => (layer ? setDraggedLayerId(asset.id) : undefined)}
                  onDragOver={(event) => {
                    if (layer && draggedLayerId) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={() => (layer ? dropLayer(asset.id) : undefined)}
                  onDragEnd={() => setDraggedLayerId(null)}
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
                      className={layer ? "layer-symbol active" : "layer-symbol"}
                      style={{
                        borderColor: layerColor,
                        background: layer ? `${layerColor}22` : "transparent",
                      }}
                      aria-hidden="true"
                    />
                    <div className="layer-title">
                      <strong>{layerDisplayName(asset.asset_name)}</strong>
                      <small>{statusLabel(asset.status)}</small>
                    </div>
                    <div className="layer-row-tools">
                      <button onClick={() => void loadLayer(asset)} disabled={isLoadingLayer} title={layer ? "Обновить слой" : "Открыть слой"}>
                        {layer ? "↻" : isLoadingLayer ? "..." : "+"}
                      </button>
                      <button
                        onClick={() => setLayerMenuId((current) => (current === asset.id ? null : asset.id))}
                        disabled={!layer}
                        title="Свойства слоя"
                      >
                        ⋮
                      </button>
                    </div>
                  </div>
                  {layer && layerMenuId === asset.id ? (
                    <div className="layer-action-menu">
                      <button
                        onClick={() => {
                          setExpandedLayerId((current) => (current === asset.id ? null : asset.id));
                          setLayerMenuId(null);
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">i</span>
                        Расширенная информация
                      </button>
                      <button
                        onClick={() => {
                          setZoomToLayerId(asset.id);
                          setZoomToLayerTick(Date.now());
                          setLayerMenuId(null);
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">⌕</span>
                        Увеличить до слоя
                      </button>
                      <button
                        onClick={() => {
                          setTableLayerId(asset.id);
                          setIsTableWindowOpen(true);
                          if (layer.preview.geojson.features.length > 0) {
                            setSelectedFeature({ assetId: asset.id, featureIndex: 0 });
                          }
                          setLayerMenuId(null);
                        }}
                      >
                        <span className="menu-icon" aria-hidden="true">▦</span>
                        Атрибутивная таблица
                      </button>
                    </div>
                  ) : null}
                  {layer && expandedLayerId === asset.id ? (
                    <section className="layer-properties">
                      <div className="layer-meta">
                        <span>CRS: {layer.preview.crs}</span>
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
            })}
          </aside>

          <MultiLayerMapPanel
            layers={layers}
            zoomToLayerId={zoomToLayerId}
            zoomToLayerTick={zoomToLayerTick}
            tableLayerId={tableLayerId}
            isTableWindowOpen={isTableWindowOpen}
            selectedFeature={selectedFeature}
            onFeatureSelect={setSelectedFeature}
            onCloseTable={() => setIsTableWindowOpen(false)}
          />
        </div>
      ) : null}
    </section>
  );
}

function MultiLayerMapPanel(props: {
  layers: LayerPreviewState[];
  zoomToLayerId: number | null;
  zoomToLayerTick: number;
  tableLayerId: number | null;
  isTableWindowOpen: boolean;
  selectedFeature: SelectedLayerFeature;
  onFeatureSelect: (feature: SelectedLayerFeature) => void;
  onCloseTable: () => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const selectedFeatureRef = useRef<SelectedLayerFeature>(props.selectedFeature);
  const vectorLayerRefs = useRef<VectorLayer<VectorSource>[]>([]);
  const draftSourceRef = useRef(new VectorSource());
  const drawInteractionRef = useRef<Draw | null>(null);
  const mapViewStateRef = useRef<{ center: number[]; zoom: number } | null>(null);
  const lastFitKeyRef = useRef<string | null>(null);
  const selectedDraftFeatureRef = useRef<Feature<Geometry> | null>(null);
  const [tableWindowPosition, setTableWindowPosition] = useState({ x: 28, y: 88 });
  const [tableDragOffset, setTableDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("select");
  const [draftRevision, setDraftRevision] = useState(0);
  const visibleLayers = props.layers.filter((layer) => layer.visible);
  const fitKey = [
    visibleLayers.map((layer) => `${layer.asset.id}:${layer.preview.preview_feature_count}`).join(","),
    props.zoomToLayerId ?? "all",
    props.zoomToLayerTick,
  ].join("|");
  const draftFeatureCount = draftRevision >= 0 ? draftSourceRef.current.getFeatures().length : 0;
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
  useEffect(() => {
    selectedFeatureRef.current = props.selectedFeature;
    vectorLayerRefs.current.forEach((layer) => layer.changed());
  }, [props.selectedFeature]);

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

  function deleteSelectedDraftFeature() {
    const selectedFeature = selectedDraftFeatureRef.current;
    if (!selectedFeature) {
      return;
    }
    draftSourceRef.current.removeFeature(selectedFeature);
    selectedDraftFeatureRef.current = null;
    setDraftRevision((value) => value + 1);
  }

  function clearDraftLayer() {
    draftSourceRef.current.clear();
    selectedDraftFeatureRef.current = null;
    setDraftRevision((value) => value + 1);
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
    if (!mapElementRef.current) {
      return;
    }

    vectorLayerRefs.current = [];
    const mapLayers = visibleLayers
      .slice()
      .reverse()
      .map((layer, index) => {
        const color = LAYER_COLORS[index % LAYER_COLORS.length];
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
                radius: isSelected ? 7 : 5,
                fill: new Fill({ color: isSelected ? "rgba(199, 115, 38, 0.8)" : `${color}99` }),
                stroke: new Stroke({ color: isSelected ? "#b45f1c" : color, width: isSelected ? 3 : 2 }),
              }),
              fill: new Fill({ color: isSelected ? "rgba(199, 115, 38, 0.35)" : `${color}33` }),
              stroke: new Stroke({ color: isSelected ? "#b45f1c" : color, width: isSelected ? 3 : 2 }),
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
    map.on("moveend", () => {
      const view = map.getView();
      const center = view.getCenter();
      const zoom = view.getZoom();
      if (center && typeof zoom === "number") {
        mapViewStateRef.current = { center: [...center], zoom };
      }
    });

    const draftStyle = new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: "rgba(216, 63, 63, 0.75)" }),
        stroke: new Stroke({ color: "#9e2626", width: 2 }),
      }),
      fill: new Fill({ color: "rgba(216, 63, 63, 0.2)" }),
      stroke: new Stroke({ color: "#d83f3f", width: 2 }),
    });
    const draftLayer = new VectorLayer({
      source: draftSourceRef.current,
      style: draftStyle,
    });
    map.addLayer(draftLayer);

    const modify = new Modify({ source: draftSourceRef.current });
    const selectDraft = new Select({ layers: [draftLayer] });
    const snap = new Snap({ source: draftSourceRef.current });
    selectDraft.on("select", (event) => {
      selectedDraftFeatureRef.current = (event.selected[0] as Feature<Geometry> | undefined) ?? null;
    });
    map.addInteraction(selectDraft);
    map.addInteraction(modify);
    map.addInteraction(snap);

    let draw: Draw | null = null;
    const drawTypeByMode: Partial<Record<EditMode, "Point" | "LineString" | "Polygon">> = {
      point: "Point",
      line: "LineString",
      polygon: "Polygon",
    };
    const drawType = drawTypeByMode[editMode];
    if (drawType) {
      draw = new Draw({
        source: draftSourceRef.current,
        type: drawType,
      });
      draw.on("drawend", () => {
        setDraftRevision((value) => value + 1);
      });
      map.addInteraction(draw);
    }
    drawInteractionRef.current = draw;
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
      const feature = map.forEachFeatureAtPixel(event.pixel, (hit) => hit);
      const assetId = feature?.get("layerAssetId");
      const featureIndex = feature?.get("featureIndex");
      if (typeof assetId === "number" && typeof featureIndex === "number") {
        props.onFeatureSelect({ assetId, featureIndex });
        return;
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
      map.removeLayer(draftLayer);
      map.setTarget(undefined);
      vectorLayerRefs.current = [];
    };
  }, [props.layers, props.zoomToLayerId, props.zoomToLayerTick, editMode, fitKey]);

  return (
    <section className="layer-map-panel" ref={panelRef}>
      <div className="map-preview-heading">
        <div>
          <p className="eyebrow">OpenLayers</p>
          <h3>Общая карта слоёв</h3>
        </div>
        <span>{visibleLayers.length} включено</span>
      </div>
      <div className="map-edit-toolbar" aria-label="Инструменты редактирования">
        <button className={editMode === "select" ? "active" : ""} onClick={() => setEditMode("select")}>
          Выбор
        </button>
        <button className={editMode === "point" ? "active" : ""} onClick={() => setEditMode("point")}>
          Точка
        </button>
        <button className={editMode === "line" ? "active" : ""} onClick={() => setEditMode("line")}>
          Линия
        </button>
        <button className={editMode === "polygon" ? "active" : ""} onClick={() => setEditMode("polygon")}>
          Полигон
        </button>
        <button onClick={deleteSelectedDraftFeature}>Удалить</button>
        <button onClick={clearDraftLayer}>Очистить</button>
        <button onClick={exportDraftLayer} disabled={draftFeatureCount === 0}>
          GeoJSON
        </button>
        <span>Черновик: {draftFeatureCount} объектов</span>
      </div>
      <div className="layer-map-canvas" ref={mapElementRef} />
      <aside className="feature-panel">
        <h3>Атрибуты объекта</h3>
        {selectedLayer ? (
          <p className="muted">
            {layerDisplayName(selectedLayer.asset.asset_name)} · объект #{(props.selectedFeature?.featureIndex ?? 0) + 1}
          </p>
        ) : null}
        {selectedGeoJsonFeature ? (
          <div className="feature-properties">
            {Object.entries(selectedGeoJsonFeature.properties ?? {}).length === 0 ? (
              <p className="muted">У объекта нет атрибутов.</p>
            ) : null}
            {Object.entries(selectedGeoJsonFeature.properties ?? {}).map(([key, value]) => (
              <div key={key}>
                <strong>{key}</strong>
                <span>{String(value ?? "")}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Включите слой и кликните по объекту на карте.</p>
        )}
      </aside>
      {tableLayer && props.isTableWindowOpen ? (
        <FeatureTable
          layer={tableLayer}
          selectedFeature={props.selectedFeature}
          onFeatureSelect={props.onFeatureSelect}
          onClose={props.onCloseTable}
          position={tableWindowPosition}
          onDragStart={(event) => {
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

function FeatureTable(props: {
  layer: LayerPreviewState;
  selectedFeature: SelectedLayerFeature;
  onFeatureSelect: (feature: SelectedLayerFeature) => void;
  onClose: () => void;
  position: { x: number; y: number };
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const fields = previewAttributeFields(props.layer.preview).slice(0, 8);
  const rows = props.layer.preview.geojson.features.slice(0, 25);

  return (
    <section
      className="feature-table-window"
      style={{ left: props.position.x, top: props.position.y }}
    >
      <div className="feature-table-heading" onPointerDown={props.onDragStart}>
        <div>
          <p className="eyebrow">Attribute table</p>
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
      {fields.length === 0 ? (
        <p className="muted">У слоя нет атрибутивных полей для таблицы.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table">
            <thead>
              <tr>
                <th>#</th>
                {fields.map((field) => (
                  <th key={field}>{field}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((feature, index) => (
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
                  {fields.map((field) => (
                    <td key={field}>{String(feature.properties?.[field] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
          <p className="eyebrow">Requirements</p>
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
          <h2>{props.hasExpectedOutputs ? "Формальная проверка GIS-outputs" : "Проверка отчёта и вопросов"}</h2>
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
          Очистить outputs
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
            <option value="archive">Архив с отчётом и GIS-файлами</option>
            <option value="report_only">Только отчёт</option>
            <option value="online_workspace">Работа в онлайн-карте</option>
          </select>
        </label>

        <label>
          Формат output
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
          Expected CRS
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
        Expected outputs JSON
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
          <p className="eyebrow">{props.mode === "teacher" ? "Submissions" : "Feedback"}</p>
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

          <h3>Assets</h3>
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

          <h3>Checks</h3>
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
          <p className="eyebrow">Map preview</p>
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
