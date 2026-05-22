import { useState } from "react";

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
};

type ArchivePreviewResponse = {
  source_filename: string;
  layer_count: number;
  layer_summaries?: ArchivePreviewLayerSummary[];
};

function layerDisplayName(assetName: string) {
  return assetName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

function formatDetectedFormat(format: string) {
  if (format === "geojson") return "Слой карты";
  if (format === "shapefile_zip") return "Архив слоёв";
  if (format === "qgis_project") return "QGIS-проект";
  return format.replace(/_/g, " ");
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
export function ArchivePreviewReport(props: { preview: ArchivePreviewResponse }) {
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
                  <span>{formatDetectedFormat(summary.detected_format)}</span>
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

