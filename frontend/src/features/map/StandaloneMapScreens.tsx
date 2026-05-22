import { useEffect, useState } from "react";
import { ArchivePreviewReport } from "../archive-preview/ArchivePreviewReport";
import { LayerWorkspace } from "./LayerWorkspace";
import {
  API_BASE_URL,
  ARCHIVE_PREVIEW_STORAGE_PREFIX,
  AUTH_STORAGE_KEY,
  RUSSIA_PREVIEW_QUERY,
  THEME_STORAGE_KEY,
  storedAuthFetchJson,
  storedUserRole,
  toggleStoredTheme,
} from "./mapWorkspaceUtils";
import type {
  Assignment,
  AssignmentMaterial,
  ArchivePreviewResponse,
  AuthResponse,
  GeoJsonPreview,
  LayerStyleManifest,
  QgisProjectMetadata,
  Submission,
  SubmissionAsset,
  ThemeMode,
} from "./mapWorkspaceUtils";

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

export function StandaloneArchivePreview(props: { previewKey: string }) {
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
        `/submissions/archive-preview/${preview.preview_token}/assets/${assetId}/geojson-preview?${RUSSIA_PREVIEW_QUERY}`,
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
            qgisProject={preview.qgis_project}
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

export function StandaloneAssignmentWorkspace(props: { assignmentId: number; autoLoadDraft?: boolean }) {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [materials, setMaterials] = useState<AssignmentMaterial[]>([]);
  const [qgisProject, setQgisProject] = useState<QgisProjectMetadata | null>(null);
  const [submittedSubmission, setSubmittedSubmission] = useState<Submission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = savedTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    setThemeMode(nextTheme);
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
        const projectMaterial = nextMaterials.find((material) => material.detected_format === "qgis_project");
        if (projectMaterial) {
          setQgisProject(await storedAuthFetchJson<QgisProjectMetadata>(`/downloads/assignment-materials/${projectMaterial.id}/qgis-project`));
        } else {
          setQgisProject(null);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось открыть workspace задания.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadWorkspace();
  }, [props.assignmentId]);

  async function fetchMaterialPreview(materialId: number) {
    return storedAuthFetchJson<GeoJsonPreview>(`/downloads/assignment-materials/${materialId}/geojson-preview?${RUSSIA_PREVIEW_QUERY}`);
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
        qgisProject={qgisProject}
        isLoading={isLoading}
        onSubmissionSelect={() => undefined}
        onFetchAssetPreview={fetchMaterialPreview}
        isStandalone
        isAssignmentWorkspace
        themeMode={themeMode}
        onThemeToggle={() => toggleStoredTheme(themeMode, setThemeMode)}
        autoLoadLayers
        autoLoadDraft={props.autoLoadDraft}
        allowDraftSubmit={storedUserRole() === "student"}
        onDraftSubmitted={setSubmittedSubmission}
      />
    </main>
  );
}

export function StandaloneMapViewer(props: { submissionId: number }) {
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [assets, setAssets] = useState<SubmissionAsset[]>([]);
  const [styleManifest, setStyleManifest] = useState<LayerStyleManifest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = savedTheme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    setThemeMode(nextTheme);
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
        const [nextSubmission, nextAssets, nextStyleManifest] = await Promise.all([
          storedAuthFetchJson<Submission>(`/submissions/${props.submissionId}`),
          storedAuthFetchJson<SubmissionAsset[]>(`/submissions/${props.submissionId}/assets`),
          storedAuthFetchJson<LayerStyleManifest | null>(`/submissions/${props.submissionId}/style-manifest`).catch(() => null),
        ]);
        setSubmission(nextSubmission);
        setAssets(nextAssets);
        setStyleManifest(nextStyleManifest);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить слои сдачи.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadAssets();
  }, [props.submissionId]);

  async function fetchAssetPreview(assetId: number) {
    return storedAuthFetchJson<GeoJsonPreview>(`/downloads/submission-assets/${assetId}/geojson-preview?${RUSSIA_PREVIEW_QUERY}`);
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
        styleManifest={styleManifest}
        isLoading={isLoading}
        onSubmissionSelect={() => undefined}
        onFetchAssetPreview={fetchAssetPreview}
        isStandalone
        autoLoadLayers
        themeMode={themeMode}
        onThemeToggle={() => toggleStoredTheme(themeMode, setThemeMode)}
      />
    </main>
  );
}
