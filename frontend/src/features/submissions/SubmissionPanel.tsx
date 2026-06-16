import { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";

type Submission = {
  id: number;
  assignment_id: number;
  original_filename: string;
  status: string;
  review_status?: string;
  review_comment?: string | null;
  size_bytes: number;
  created_at: string;
  download_url: string;
};

type ReviewDecision = "returned" | "accepted" | "pending";

type SubmissionAsset = {
  id: number;
  asset_name: string;
  asset_type: string;
  detected_format: string;
  status: string;
};

type SubmissionCheck = {
  id: number;
  status: string;
  file_type: string;
  message: string;
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
  crs: string;
  feature_count: number;
  preview_feature_count: number;
  truncated: boolean;
  geojson: {
    type: "FeatureCollection";
    features: GeoJsonFeature[];
  };
};

type AiReviewResponse = {
  ai_review?: {
    status?: string;
    message?: string;
    review_text?: string;
  };
  warnings?: string[];
};

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function layerDisplayName(assetName: string) {
  return assetName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

function formatDetectedFormat(format: string) {
  if (format === "geojson") return "Слой карты";
  if (format === "shapefile_zip") return "Архив слоёв";
  if (format === "qgis_project") return "QGIS-проект";
  return format.replace(/_/g, " ");
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

function findReportAssets(assets: SubmissionAsset[]): SubmissionAsset[] {
  return assets.filter((asset) => asset.asset_type === "report");
}

function reportButtonLabel(asset: SubmissionAsset, total: number): string {
  if (total <= 1) return "Просмотреть отчёт";
  return `Отчёт: ${asset.asset_name}`;
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

function reviewStatusLabel(reviewStatus?: string) {
  const value = (reviewStatus ?? "pending").toLowerCase();
  if (value === "returned") return "Возвращена на переделку";
  if (value === "accepted") return "Принята";
  return "Ждёт проверки";
}

function isPreviewableAsset(asset: SubmissionAsset) {
  return asset.asset_type === "layer" && ["geojson", "shapefile_zip"].includes(asset.detected_format);
}
export function SubmissionPanel(props: {
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
  onDraftSubmitted?: (submission: Submission) => void | Promise<void>;
  onPreviewReport?: (asset: SubmissionAsset) => void;
  onReviewSubmission?: (id: number, decision: ReviewDecision, comment?: string) => void;
  onRenameSubmission?: (id: number, filename: string) => void;
  onDownloadSubmission?: (submission: Submission) => void;
}) {
  const selectedSubmission =
    props.submissions.find((submission) => submission.id === props.selectedSubmissionId) ?? null;
  const [reviewComment, setReviewComment] = useState("");
  // Подставляем комментарий выбранной сдачи при смене выбора.
  useEffect(() => {
    setReviewComment(selectedSubmission?.review_comment ?? "");
  }, [props.selectedSubmissionId, selectedSubmission?.review_comment]);

  function promptRename() {
    if (!props.onRenameSubmission || !selectedSubmission) {
      return;
    }
    const name = window.prompt(
      "Новое имя файла сдачи (например, Иванов_3):",
      selectedSubmission.original_filename,
    );
    if (name && name.trim()) {
      props.onRenameSubmission(selectedSubmission.id, name.trim());
    }
  }

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
          {props.selectedSubmissionId && props.onRenameSubmission ? (
            <button onClick={promptRename} disabled={props.isLoading} title="Переименовать файл сдачи">
              Переименовать
            </button>
          ) : null}
          {(() => {
            const reportAssets = findReportAssets(props.assets);
            if (reportAssets.length === 0) return null;
            return (
              <>
                {reportAssets.length > 1 ? (
                  <span className="muted" title="В архиве несколько DOCX — AI-review анализирует первый">
                    Отчётов: {reportAssets.length}
                  </span>
                ) : null}
                {reportAssets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => props.onPreviewReport?.(asset)}
                    disabled={props.isLoading || !props.onPreviewReport}
                  >
                    {reportButtonLabel(asset, reportAssets.length)}
                  </button>
                ))}
              </>
            );
          })()}
          <button onClick={props.onGenerateAiReview} disabled={props.isLoading || !props.selectedSubmissionId}>
            AI-review
          </button>
        </div>
      </div>

      <div className="submission-layout">
        <div className="list-stack">
          {props.submissions.length === 0 ? <p className="muted">Пока нет загруженных работ.</p> : null}
          {props.submissions.map((submission) => (
            <div key={submission.id} className="submission-row">
              <button
                className={submission.id === props.selectedSubmissionId ? "list-item active" : "list-item"}
                onClick={() => props.onSubmissionSelect(submission.id)}
                disabled={props.isLoading}
              >
                <strong>{submission.original_filename}</strong>
                <span>
                  #{submission.id} · {statusLabel(submission.status)} · {reviewStatusLabel(submission.review_status)} ·{" "}
                  {new Date(submission.created_at).toLocaleString()}
                </span>
              </button>
              {props.onDownloadSubmission ? (
                <button
                  className="submission-download-icon"
                  onClick={() => props.onDownloadSubmission!(submission)}
                  disabled={props.isLoading}
                  title="Скачать работу"
                  aria-label={`Скачать ${submission.original_filename}`}
                >
                  <svg
                    width="16"
                    height="16"
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

        <div className="details-panel">
          {props.mode === "teacher" && props.onReviewSubmission && selectedSubmission ? (
            <div className="review-decision-box">
              <h3>Решение по работе</h3>
              <label className="review-comment-label">
                Комментарий студенту (замечания, что исправить)
                <textarea
                  value={reviewComment}
                  onChange={(event) => setReviewComment(event.target.value)}
                  placeholder="Например: контур озера слишком грубый, добавьте южный пруд…"
                  rows={3}
                />
              </label>
              <div className="button-row">
                <button
                  className="warn"
                  onClick={() => props.onReviewSubmission?.(selectedSubmission.id, "returned", reviewComment)}
                  disabled={props.isLoading}
                  title="Вернуть студенту на переделку — задание снова появится у него в списке"
                >
                  Вернуть на переделку
                </button>
                <button
                  className="primary"
                  onClick={() => props.onReviewSubmission?.(selectedSubmission.id, "accepted", reviewComment)}
                  disabled={props.isLoading}
                  title="Принять работу"
                >
                  Принять
                </button>
              </div>
            </div>
          ) : null}

          {props.mode === "student" && selectedSubmission ? (
            <div className={`student-review-status review-${(selectedSubmission.review_status ?? "pending").toLowerCase()}`}>
              <strong>Статус проверки: {reviewStatusLabel(selectedSubmission.review_status)}</strong>
              {selectedSubmission.review_comment ? (
                <p className="review-comment-text">Комментарий преподавателя: {selectedSubmission.review_comment}</p>
              ) : null}
            </div>
          ) : null}

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
                  {asset.asset_type} · {formatDetectedFormat(asset.detected_format)} · {statusLabel(asset.status)}
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
    if (extent && Number.isFinite(extent[0])) {
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