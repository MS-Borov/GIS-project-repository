import { ZoomToSelectionIcon, FitExtentIcon } from "../../shared/ui/ToolbarIcons";

export type MapEditMode = "select" | "point" | "line" | "polygon" | "aiBox" | "measure";
export type MapBasemapMode = "osm" | "satellite" | "none";

export type MapSnapSettings = {
  enabled: boolean;
  point: boolean;
  endpoint: boolean;
  vertex: boolean;
  edge: boolean;
  tolerance: number;
};

type CoordinateProjectionOption = {
  code: string;
  label: string;
  definition?: string;
};

type MapToolbarProps = {
  isDraftEditingEnabled: boolean;
  activeEditableLayerId: number | null;
  activeEditableLayerName: string | null;
  activeDraftFeatureCount: number;
  draftFeatureCount: number;
  canEditActiveLayer: boolean;
  hasSelectedDraftFeature: boolean;
  hasSelectedGeoJsonFeature: boolean;
  selectedFeatureCount: number;
  isAiSegmenting: boolean;
  editMode: MapEditMode;
  activeEditableLayerGeometryType?: string | null;
  snapSettings: MapSnapSettings;
  canUndoDraft: boolean;
  canRedoDraft: boolean;
  canPersistDraft: boolean;
  isDraftBusy: boolean;
  basemapMode: MapBasemapMode;
  mapZoom: number;
  mapScaleText: string;
  measureDistanceText: string;
  measureStartText: string;
  measureEndText: string;
  coordinateProjection: string;
  coordinateProjections: CoordinateProjectionOption[];
  cursorCoordinates: string;
  onToggleDraftEditing: () => void;
  onContinueSelectedDraftFeatureWithAi: () => void;
  onEditModeChange: (mode: MapEditMode) => void;
  onZoomToSelection: () => void;
  onZoomToFullExtent: () => void;
  onDeleteSelectedDraftFeature: () => void;
  onClearDraftLayer: () => void;
  onToggleSnapEnabled: () => void;
  onToggleSnapSetting: (key: "point" | "endpoint" | "vertex" | "edge") => void;
  onSnapToleranceChange: (value: number) => void;
  onUndoDraftChange: () => void;
  onRedoDraftChange: () => void;
  onToggleDraftProperties: () => void;
  onToggleDraftTable: () => void;
  onExportShapefileArchive: () => void;
  onExportMapPng: () => void;
  onBasemapModeChange: (mode: MapBasemapMode) => void;
  onLoadLatestDraft: () => void;
  onSaveDraftLayer: () => void;
  onSubmitDraftLayer: () => void;
  submitReportFileName?: string | null;
  onSubmitReportFileChange: (file: File | null) => void;
  onMapZoomChange: (zoom: number) => void;
  onMapScaleTextChange: (value: string) => void;
  onApplyMapScaleText: () => void;
  onCoordinateProjectionChange: (projection: string) => void;
};

// Тип геометрии слоя -> допустимый инструмент рисования.
// null = тип не задан ("mixed"/пусто), ограничение не накладывается.
function normalizeGeometryKind(value?: string | null): "point" | "line" | "polygon" | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "mixed") return null;
  if (v.includes("line")) return "line";
  if (v.includes("point")) return "point";
  if (v.includes("polygon")) return "polygon";
  return null;
}

export function MapToolbar(props: MapToolbarProps) {
  const canZoomToSelection =
    props.selectedFeatureCount > 0 || props.hasSelectedGeoJsonFeature || props.hasSelectedDraftFeature;

  const lockedGeometryKind = normalizeGeometryKind(props.activeEditableLayerGeometryType);
  const isDrawModeAllowed = (mode: "point" | "line" | "polygon") =>
    lockedGeometryKind === null || lockedGeometryKind === mode;

  return (
    <div className="map-edit-toolbar" aria-label="Инструменты редактирования">
      <button
        className={props.isDraftEditingEnabled ? "active" : ""}
        onClick={props.onToggleDraftEditing}
        title={props.isDraftEditingEnabled ? "Выключить редактирование" : "Включить редактирование"}
        data-tooltip={props.isDraftEditingEnabled ? "Выключить редактирование" : "Включить редактирование"}
      >
        ✎
      </button>
      <button
        onClick={props.onContinueSelectedDraftFeatureWithAi}
        disabled={!props.canEditActiveLayer || !props.hasSelectedDraftFeature || props.isAiSegmenting}
        title="AI продолжить выбранный объект"
        data-tooltip="AI продолжить выбранный объект"
      >
        AI
      </button>
      <button
        className={props.editMode === "select" ? "active" : ""}
        onClick={() => props.onEditModeChange("select")}
        title="Выбор объекта"
        data-tooltip="Выбор объекта"
      >
        ⌖
      </button>
      <button
        className={props.editMode === "point" ? "active" : ""}
        onClick={() => props.onEditModeChange("point")}
        disabled={!props.canEditActiveLayer || !isDrawModeAllowed("point")}
        title={isDrawModeAllowed("point") ? "Создать точку" : "Слой не точечный"}
        data-tooltip={isDrawModeAllowed("point") ? "Создать точку" : "Слой не точечный"}
      >
        ●
      </button>
      <button
        className={props.editMode === "line" ? "active" : ""}
        onClick={() => props.onEditModeChange("line")}
        disabled={!props.canEditActiveLayer || !isDrawModeAllowed("line")}
        title={isDrawModeAllowed("line") ? "Создать линию" : "Слой не линейный"}
        data-tooltip={isDrawModeAllowed("line") ? "Создать линию" : "Слой не линейный"}
      >
        ╱
      </button>
      <button
        className={props.editMode === "polygon" ? "active" : ""}
        onClick={() => props.onEditModeChange("polygon")}
        disabled={!props.canEditActiveLayer || !isDrawModeAllowed("polygon")}
        title={isDrawModeAllowed("polygon") ? "Создать полигон" : "Слой не полигональный"}
        data-tooltip={isDrawModeAllowed("polygon") ? "Создать полигон" : "Слой не полигональный"}
      >
        ▱
      </button>
      <button
        className="zoom-selected-button"
        onClick={props.onZoomToSelection}
        disabled={!canZoomToSelection}
        title="Увеличить до выделенного объекта"
        data-tooltip="Увеличить до выделенного объекта"
      >
        <ZoomToSelectionIcon />
      </button>
      <button
        className="map-fit-extent-button"
        onClick={props.onZoomToFullExtent}
        title="Полный охват: вместить все объекты слоёв"
        data-tooltip="Полный охват карты"
      >
        <FitExtentIcon />
      </button>
      <button
        className={props.editMode === "measure" ? "active" : ""}
        onClick={() => props.onEditModeChange("measure")}
        title="Измерить расстояние"
        data-tooltip="Измерить расстояние"
      >
        ⇔
      </button>
      <button
        onClick={props.onDeleteSelectedDraftFeature}
        disabled={!props.canEditActiveLayer}
        title="Удалить выбранный объект"
        data-tooltip="Удалить выбранный объект"
      >
        ⌫
      </button>
      <button
        onClick={props.onClearDraftLayer}
        disabled={!props.canEditActiveLayer}
        title="Очистить черновик активного слоя"
        data-tooltip="Очистить черновик активного слоя"
      >
        ×
      </button>
      <div className="map-snap-controls" aria-label="Параметры замыкания">
        <button
          className={props.snapSettings.enabled ? "active" : ""}
          onClick={props.onToggleSnapEnabled}
          disabled={!props.canEditActiveLayer}
          title={props.snapSettings.enabled ? "Выключить замыкание" : "Включить замыкание"}
          data-tooltip={props.snapSettings.enabled ? "Выключить замыкание" : "Включить замыкание"}
        >
          ⊙
        </button>
        <button
          className={props.snapSettings.point ? "active" : ""}
          onClick={() => props.onToggleSnapSetting("point")}
          disabled={!props.canEditActiveLayer || !props.snapSettings.enabled}
          title="Замыкание на точки"
          data-tooltip="Замыкание на точки"
        >
          Т
        </button>
        <button
          className={props.snapSettings.endpoint ? "active" : ""}
          onClick={() => props.onToggleSnapSetting("endpoint")}
          disabled={!props.canEditActiveLayer || !props.snapSettings.enabled}
          title="Замыкание на конечные точки линий"
          data-tooltip="Замыкание на конечные точки"
        >
          К
        </button>
        <button
          className={props.snapSettings.vertex ? "active" : ""}
          onClick={() => props.onToggleSnapSetting("vertex")}
          disabled={!props.canEditActiveLayer || !props.snapSettings.enabled}
          title="Замыкание на вершины"
          data-tooltip="Замыкание на вершины"
        >
          В
        </button>
        <button
          className={props.snapSettings.edge ? "active" : ""}
          onClick={() => props.onToggleSnapSetting("edge")}
          disabled={!props.canEditActiveLayer || !props.snapSettings.enabled}
          title="Замыкание на ребро"
          data-tooltip="Замыкание на ребро"
        >
          Р
        </button>
        <label title="Допуск замыкания в пикселях">
          px
          <input
            type="number"
            min="2"
            max="40"
            value={props.snapSettings.tolerance}
            onChange={(event) => props.onSnapToleranceChange(Number(event.target.value))}
            disabled={!props.canEditActiveLayer || !props.snapSettings.enabled}
          />
        </label>
      </div>
      <button
        onClick={props.onUndoDraftChange}
        disabled={!props.canUndoDraft}
        title="Отменить изменение черновика"
        data-tooltip="Отменить изменение черновика"
      >
        ↶
      </button>
      <button
        onClick={props.onRedoDraftChange}
        disabled={!props.canRedoDraft}
        title="Вернуть изменение черновика"
        data-tooltip="Вернуть изменение черновика"
      >
        ↷
      </button>
      <button
        onClick={props.onToggleDraftProperties}
        title="Свойства чернового слоя"
        data-tooltip="Свойства чернового слоя"
      >
        ⚙
      </button>
      <button
        onClick={props.onToggleDraftTable}
        disabled={props.draftFeatureCount === 0}
        title="Таблица черновика"
        data-tooltip="Таблица черновика"
      >
        ▦
      </button>
      <button onClick={props.onExportShapefileArchive} disabled={props.isDraftBusy} title="Экспортировать архив работы" data-tooltip="Экспортировать архив работы">
        Архив
      </button>
      <button onClick={props.onExportMapPng} title="Экспортировать карту в PNG" data-tooltip="Экспортировать карту в PNG">
        PNG
      </button>
      <div className="map-basemap-controls" aria-label="Подложка карты">
        <button
          className={props.basemapMode === "osm" ? "active" : ""}
          onClick={() => props.onBasemapModeChange("osm")}
          title="Подложка OpenStreetMap"
          data-tooltip="OpenStreetMap"
        >
          OSM
        </button>
        <button
          className={props.basemapMode === "satellite" ? "active" : ""}
          onClick={() => props.onBasemapModeChange("satellite")}
          title="Спутниковая подложка"
          data-tooltip="Спутник"
        >
          Спутник
        </button>
        <button
          className={props.basemapMode === "none" ? "active" : ""}
          onClick={() => props.onBasemapModeChange("none")}
          title="Отключить подложку"
          data-tooltip="Без подложки"
        >
          Без
        </button>
      </div>
      <button onClick={props.onLoadLatestDraft} disabled={props.isDraftBusy || !props.canPersistDraft} title="Загрузить черновик" data-tooltip="Загрузить черновик">
        Загрузить черновик
      </button>
      <button onClick={props.onSaveDraftLayer} disabled={props.isDraftBusy || !props.canPersistDraft || props.draftFeatureCount === 0} title="Сохранить черновик" data-tooltip="Сохранить черновик">
        Сохранить
      </button>
      {props.canPersistDraft ? (
        <label
          className={`report-attach${props.submitReportFileName ? " has-file" : ""}`}
          title={props.submitReportFileName ? `Отчёт: ${props.submitReportFileName} (нажмите, чтобы заменить)` : "Прикрепить отчёт (DOCX/PDF) к сдаче"}
          data-tooltip={props.submitReportFileName ? `Отчёт: ${props.submitReportFileName}` : "Прикрепить отчёт"}
        >
          {props.submitReportFileName ? "Отчёт ✓" : "Отчёт"}
          <input
            type="file"
            accept=".docx,.pdf"
            style={{ display: "none" }}
            onChange={(event) => props.onSubmitReportFileChange(event.target.files?.[0] ?? null)}
          />
        </label>
      ) : null}
      <button onClick={props.onSubmitDraftLayer} disabled={props.isDraftBusy || !props.canPersistDraft || props.draftFeatureCount === 0} title="Сдать черновик" data-tooltip="Сдать черновик">
        Сдать
      </button>
      <div className="map-scale-controls" aria-label="Масштаб карты">
        <button onClick={() => props.onMapZoomChange(props.mapZoom - 1)} title="Уменьшить масштаб" data-tooltip="Уменьшить масштаб">
          −
        </button>
        <label>
          Масштаб
          <input
            value={props.mapScaleText}
            onChange={(event) => props.onMapScaleTextChange(event.target.value)}
            onBlur={props.onApplyMapScaleText}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                props.onApplyMapScaleText();
              }
            }}
            placeholder="1:10000"
          />
        </label>
        <button onClick={() => props.onMapZoomChange(props.mapZoom + 1)} title="Увеличить масштаб" data-tooltip="Увеличить масштаб">
          +
        </button>
      </div>
      <div className="map-coordinate-controls" aria-label="Координаты курсора">
        <label>
          СК
          <select
            value={props.coordinateProjection}
            onChange={(event) => props.onCoordinateProjectionChange(event.target.value)}
          >
            {props.coordinateProjections.map((projection) => (
              <option key={projection.code} value={projection.code}>
                {projection.label}
              </option>
            ))}
          </select>
        </label>
        <output>{props.cursorCoordinates}</output>
      </div>
      <span>
        {props.activeEditableLayerName
          ? `Редактируемый слой: ${props.activeEditableLayerName} · ${props.activeDraftFeatureCount}/${props.draftFeatureCount}`
          : `Редактируемый слой не выбран · ${props.draftFeatureCount} объектов`}
      </span>
      {props.measureDistanceText ? (
        <span className="measure-output">
          Линейка: {props.measureDistanceText}
          {props.measureStartText ? <span className="measure-point">Начало: {props.measureStartText}</span> : null}
          {props.measureEndText ? <span className="measure-point">Конец: {props.measureEndText}</span> : null}
        </span>
      ) : null}
    </div>
  );
}