import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  CLASSIFICATION_METHODS,
  CLASSIFICATION_SCHEMES,
  LAYER_LEGEND_MODES,
  SYMBOL_PRESETS,
  LegendClassSymbol,
  buildLayerClassification,
  layerGeometryKind,
  legendSymbolType,
  numericFieldsForPreview,
  previewAttributeFields,
} from "../map/layerStyles";
import type {
  ClassificationMethod,
  GeoJsonPreview,
  LayerClassificationClass,
  LayerLegendMode,
  LayerPreviewState,
  LayerStyleSettings,
} from "../map/layerStyles";

type LayerPropertiesTab = "info" | "labels" | "style" | "classification";
type DisplayGeometryKind = "point" | "line" | "polygon" | "mixed" | "unknown";

const DISPLAY_GEOMETRY_KIND_LABELS: Record<DisplayGeometryKind, string> = {
  point: "Точка",
  line: "Линия",
  polygon: "Полигон",
  mixed: "Смешанный",
  unknown: "Не определён",
};

function stringOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function effectiveGeometryKind(preview: GeoJsonPreview, style: LayerStyleSettings): DisplayGeometryKind {
  return style.geometryKind ?? layerGeometryKind(preview);
}

function layerDisplayName(assetName: string) {
  return assetName.replace(/\.(zip|geojson|shp)$/i, "");
}

function formatDetectedFormat(format: string) {
  if (format === "geojson") return "Слой карты";
  if (format === "shapefile_zip") return "Архив слоёв";
  if (format === "qgis_project") return "QGIS-проект";
  return format.replace(/_/g, " ");
}

export function LayerPropertiesWindow(props: {
  layer: LayerPreviewState;
  assignedCrs: string;
  coordinateProjections: Array<{ code: string; label: string; definition?: string }>;
  layerStyle: LayerStyleSettings;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onClose: () => void;
  onZoomToLayer: () => void;
  onOpenTable: () => void;
  onApplyChanges: (changes: {
    assignedCrs: string;
    labelsVisible: boolean;
    labelField: string | null;
    layerStyle: LayerStyleSettings;
  }) => void;
}) {
  const fields = previewAttributeFields(props.layer.preview);
  const numericFields = numericFieldsForPreview(props.layer.preview);
  const [activeTab, setActiveTab] = useState<LayerPropertiesTab>("info");
  const [draftAssignedCrs, setDraftAssignedCrs] = useState(props.assignedCrs);
  const [draftLabelsVisible, setDraftLabelsVisible] = useState(props.layer.labelsVisible);
  const [draftLabelField, setDraftLabelField] = useState<string | null>(props.layer.labelField);
  const [draftLayerStyle, setDraftLayerStyle] = useState<LayerStyleSettings>(props.layerStyle);
  const [legendMode, setLegendMode] = useState<LayerLegendMode>(props.layerStyle.classification?.mode ?? "graduated_color");
  const [classificationField, setClassificationField] = useState(props.layerStyle.classification?.field ?? numericFields[0] ?? fields[0] ?? "");
  const [classificationClassCount, setClassificationClassCount] = useState(props.layerStyle.classification?.classCount ?? 5);
  const [classificationScheme, setClassificationScheme] = useState(props.layerStyle.classification?.scheme ?? "yellowRed");
  const [classificationMethod, setClassificationMethod] = useState<ClassificationMethod>(props.layerStyle.classification?.method ?? "equal_interval");
  const displayGeometryKind = effectiveGeometryKind(props.layer.preview, draftLayerStyle);

  useEffect(() => {
    setActiveTab("info");
    setDraftAssignedCrs(props.assignedCrs);
    setDraftLabelsVisible(props.layer.labelsVisible);
    setDraftLabelField(props.layer.labelField);
    setDraftLayerStyle(props.layerStyle);
    setLegendMode(props.layerStyle.classification?.mode ?? "graduated_color");
    setClassificationField(props.layerStyle.classification?.field ?? numericFields[0] ?? fields[0] ?? "");
    setClassificationClassCount(props.layerStyle.classification?.classCount ?? 5);
    setClassificationScheme(props.layerStyle.classification?.scheme ?? "yellowRed");
    setClassificationMethod(props.layerStyle.classification?.method ?? "equal_interval");
  }, [props.layer.asset.id]);

  function updateDraftStyle(patch: Partial<LayerStyleSettings>) {
    setDraftLayerStyle((current) => ({
      ...current,
      ...patch,
    }));
  }

  function applyLayerPropertyChanges() {
    props.onApplyChanges({
      assignedCrs: draftAssignedCrs,
      labelsVisible: draftLabelsVisible,
      labelField: draftLabelField,
      layerStyle: draftLayerStyle,
    });
  }

  function applyClassification() {
    const effectiveField = classificationField || (legendMode === "unique_value" ? fields[0] : numericFields[0]) || "";
    const classification = buildLayerClassification(
      props.layer.preview,
      effectiveField,
      classificationClassCount,
      classificationScheme,
      classificationMethod,
      legendMode,
    );
    updateDraftStyle({ classification });
  }

  function updateClassificationClass(index: number, patch: Partial<LayerClassificationClass>) {
    const classification = draftLayerStyle.classification;
    if (!classification) {
      return;
    }
    updateDraftStyle({
      classification: {
        ...classification,
        classes: classification.classes.map((item, classIndex) =>
          classIndex === index ? { ...item, ...patch } : item,
        ),
      },
    });
  }

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
        <button
          className={activeTab === "classification" ? "active" : ""}
          onClick={() => setActiveTab("classification")}
          type="button"
        >
          Классификация
        </button>
      </div>
      {activeTab === "info" ? (
        <>
          <dl className="layer-properties-dl">
            <dt>Формат</dt>
            <dd>{formatDetectedFormat(props.layer.asset.detected_format)}</dd>
            <dt>Система координат</dt>
            <dd>{props.layer.preview.crs}</dd>
            <dt>Исходная СК</dt>
            <dd>{props.layer.preview.source_crs || "не задана"}</dd>
            <dt>Назначенная СК</dt>
            <dd>{draftAssignedCrs || "не задана"}</dd>
            <dt>Объекты</dt>
            <dd>{props.layer.preview.preview_feature_count}/{props.layer.preview.feature_count}</dd>
          </dl>
          <div className="layer-properties-form">
            <label>
              Назначить СК слоя
              <select
                value={draftAssignedCrs}
                onChange={(event) => setDraftAssignedCrs(event.target.value)}
              >
                <option value="">Не задана</option>
                {props.coordinateProjections.map((projection) => (
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
              checked={draftLabelsVisible}
              onChange={(event) => setDraftLabelsVisible(event.target.checked)}
              disabled={!draftLabelField}
            />
            <span>Подписи слоя</span>
          </label>
          <label className="layer-labels-field">
            <span>Поле подписи</span>
            <select
              value={draftLabelField ?? ""}
              onChange={(event) => {
                const nextField = stringOrNull(event.target.value);
                setDraftLabelField(nextField);
                setDraftLabelsVisible(Boolean(nextField));
              }}
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
            Тип слоя
            <select
              value={draftLayerStyle.geometryKind ?? ""}
              onChange={(event) =>
                updateDraftStyle({
                  geometryKind: (event.target.value || null) as LayerStyleSettings["geometryKind"],
                })
              }
            >
              <option value="">Авто: {DISPLAY_GEOMETRY_KIND_LABELS[layerGeometryKind(props.layer.preview)]}</option>
              <option value="point">Точка</option>
              <option value="line">Линия</option>
              <option value="polygon">Полигон</option>
              <option value="mixed">Смешанный</option>
            </select>
          </label>
          <label>
            Цвет обводки
            <input
              type="color"
              value={draftLayerStyle.strokeColor}
              onChange={(event) => updateDraftStyle({ strokeColor: event.target.value })}
            />
          </label>
          <label>
            Цвет заливки
            <input
              type="color"
              value={draftLayerStyle.fillColor}
              onChange={(event) => updateDraftStyle({ fillColor: event.target.value })}
            />
          </label>
          <label>
            Прозрачность заливки
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={draftLayerStyle.fillOpacity}
              onChange={(event) => updateDraftStyle({ fillOpacity: Number(event.target.value) })}
            />
            <span>{Math.round(draftLayerStyle.fillOpacity * 100)}%</span>
          </label>
          <label>
            Толщина линии
            <input
              type="number"
              min="1"
              max="12"
              value={draftLayerStyle.strokeWidth}
              onChange={(event) => updateDraftStyle({ strokeWidth: Number(event.target.value) })}
            />
          </label>
          <label>
            Размер точки
            <input
              type="number"
              min="2"
              max="24"
              value={draftLayerStyle.pointRadius}
              onChange={(event) => updateDraftStyle({ pointRadius: Number(event.target.value) })}
            />
          </label>
        </div>
      ) : null}
      {activeTab === "classification" ? (
        <section className="layer-classification-editor standalone">
          <label>
            Тип классификации
            <select
              value={legendMode}
              onChange={(event) => {
                const nextMode = event.target.value as LayerLegendMode;
                setLegendMode(nextMode);
                setClassificationField(nextMode === "unique_value" ? fields[0] ?? "" : numericFields[0] ?? "");
              }}
            >
              {Object.entries(LAYER_LEGEND_MODES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="layer-properties-subtitle">
            <strong>Классификация</strong>
            <span>Тематическая раскраска по атрибуту</span>
          </div>
          <label>
            Поле
            <select
              value={classificationField}
              onChange={(event) => setClassificationField(event.target.value)}
              disabled={(legendMode === "unique_value" ? fields : numericFields).length === 0}
            >
              {numericFields.length === 0 ? <option value="">Нет числовых полей</option> : null}
              {(legendMode === "unique_value" ? fields : numericFields).map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </label>
          <label>
            Метод
            <select
              value={classificationMethod}
              onChange={(event) => setClassificationMethod(event.target.value as ClassificationMethod)}
            >
              {Object.entries(CLASSIFICATION_METHODS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Классы
            <input
              type="number"
              min="1"
              max="9"
              value={classificationClassCount}
              onChange={(event) => setClassificationClassCount(Number(event.target.value))}
            />
          </label>
          <label>
            Цветовая схема
            <select value={classificationScheme} onChange={(event) => setClassificationScheme(event.target.value)}>
              {Object.entries(CLASSIFICATION_SCHEMES).map(([key, scheme]) => (
                <option key={key} value={key}>
                  {scheme.label}
                </option>
              ))}
            </select>
          </label>
          <div className="classification-actions">
            <button type="button" onClick={applyClassification} disabled={!classificationField}>
              Классифицировать
            </button>
            <button type="button" onClick={() => updateDraftStyle({ classification: null })}>
              Сбросить
            </button>
          </div>
          {draftLayerStyle.classification ? (
            <div className="classification-preview">
              <strong>
                {LAYER_LEGEND_MODES[draftLayerStyle.classification.mode ?? "graduated_color"] ?? "Классификация"}:
                {" "}
                {draftLayerStyle.classification.field}
              </strong>
              {draftLayerStyle.classification.classes.map((item, index) => (
                <div key={`${item.value ?? item.label}-${index}`} className="classification-class-editor-row">
                  <span
                    className="classification-symbol-preview"
                  >
                    <LegendClassSymbol
                      geometryKind={displayGeometryKind}
                      classItem={item}
                      color={item.color}
                      fillOpacity={item.fillOpacity}
                    />
                  </span>
                  <span className="classification-class-label">{item.label}</span>
                  <input
                    type="color"
                    value={item.color}
                    onChange={(event) => updateClassificationClass(index, { color: event.target.value })}
                    title="Цвет класса"
                  />
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={item.strokeWidth ?? draftLayerStyle.strokeWidth}
                    onChange={(event) => updateClassificationClass(index, { strokeWidth: Number(event.target.value) })}
                    title="Толщина линии"
                  />
                  <select
                    value={item.lineStyle ?? ""}
                    onChange={(event) => updateClassificationClass(index, { lineStyle: stringOrNull(event.target.value) })}
                    title="Тип линии"
                  >
                    <option value="">Сплошная</option>
                    <option value="dash">Пунктир</option>
                    <option value="dot">Точки</option>
                  </select>
                  <select
                    value={legendSymbolType(displayGeometryKind, item)}
                    onChange={(event) => {
                      const preset = SYMBOL_PRESETS.find((candidate) => candidate.type === event.target.value);
                      if (!preset) {
                        return;
                      }
                      updateClassificationClass(index, {
                        symbolType: preset.type,
                        lineStyle: preset.lineStyle,
                      });
                    }}
                    title="Условный знак"
                  >
                    {SYMBOL_PRESETS.map((preset) => (
                      <option key={preset.type} value={preset.type}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Выберите числовое поле и метод классификации.</p>
          )}
        </section>
      ) : null}
      <div className="layer-properties-actions">
        <button className="primary" onClick={applyLayerPropertyChanges}>
          Применить изменения
        </button>
        <button onClick={props.onZoomToLayer}>⌕ Приблизить</button>
        <button onClick={props.onOpenTable}>▦ Таблица</button>
      </div>
    </section>
  );
}

export function SymbolEditorWindow(props: {
  layerName: string;
  geometryKind: "point" | "line" | "polygon" | "mixed" | "unknown";
  classItem: LayerClassificationClass;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onClose: () => void;
  onUpdate: (patch: Partial<LayerClassificationClass>) => void;
}) {
  const currentSymbolType = legendSymbolType(props.geometryKind, props.classItem);
  const [localPosition, setLocalPosition] = useState(props.position);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const windowElRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setLocalPosition(props.position);
  }, [props.position]);

  useEffect(() => {
    if (!dragOffset) {
      return undefined;
    }
    const activeDragOffset = dragOffset;
    const draggedEl = windowElRef.current;
    let latest = localPosition;

    function handlePointerMove(event: PointerEvent) {
      const nextX = Math.min(Math.max(8, event.clientX - activeDragOffset.x), Math.max(8, window.innerWidth - 360));
      const nextY = Math.min(Math.max(8, event.clientY - activeDragOffset.y), Math.max(8, window.innerHeight - 220));
      latest = { x: nextX, y: nextY };
      // Двигаем окно напрямую через style, без setState на каждый move.
      if (draggedEl) {
        draggedEl.style.left = `${nextX}px`;
        draggedEl.style.top = `${nextY}px`;
      } else {
        setLocalPosition(latest);
      }
    }

    function handlePointerUp() {
      setLocalPosition(latest);
      setDragOffset(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragOffset]);

  return (
    <section
      ref={windowElRef}
      className="symbol-editor-window"
      style={{ left: localPosition.x, top: localPosition.y, zIndex: props.zIndex }}
      onPointerDown={props.onFocus}
    >
      <div
        className="symbol-editor-title draggable-title"
        onPointerDown={(event) => {
          props.onFocus();
          setDragOffset({
            x: event.clientX - localPosition.x,
            y: event.clientY - localPosition.y,
          });
        }}
      >
        <div>
          <p className="eyebrow">Выбор условного знака</p>
          <h3>{props.classItem.label}</h3>
          <span>{props.layerName}</span>
        </div>
        <button
          onPointerDown={(event) => event.stopPropagation()}
          onClick={props.onClose}
          title="Закрыть"
        >
          ×
        </button>
      </div>

      <div className="symbol-editor-preview">
        <LegendClassSymbol
          geometryKind={props.geometryKind}
          classItem={props.classItem}
          color={props.classItem.color}
          fillOpacity={props.classItem.fillOpacity}
        />
      </div>

      <div className="symbol-editor-controls">
        <label>
          Основной цвет
          <input
            type="color"
            value={props.classItem.color}
            onChange={(event) => props.onUpdate({ color: event.target.value })}
          />
        </label>
        <label>
          Непрозрачность
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={props.classItem.fillOpacity ?? 1}
            onChange={(event) => props.onUpdate({ fillOpacity: Number(event.target.value) })}
          />
        </label>
        <label>
          Толщина
          <input
            type="number"
            min="1"
            max="12"
            value={props.classItem.strokeWidth ?? 2}
            onChange={(event) => props.onUpdate({ strokeWidth: Number(event.target.value) })}
          />
        </label>
        <label>
          Тип линии
          <select
            value={props.classItem.lineStyle ?? ""}
            onChange={(event) => props.onUpdate({ lineStyle: stringOrNull(event.target.value) })}
          >
            <option value="">Сплошная</option>
            <option value="dash">Пунктир</option>
            <option value="dot">Точечная</option>
          </select>
        </label>
      </div>

      <div className="symbol-preset-panel">
        <strong>Доступные условные знаки</strong>
        <div className="symbol-preset-grid">
          {SYMBOL_PRESETS.map((preset) => (
            <button
              key={preset.type}
              className={currentSymbolType === preset.type ? "active" : ""}
              onClick={() =>
                props.onUpdate({
                  symbolType: preset.type,
                  lineStyle: preset.lineStyle,
                })
              }
              type="button"
            >
              <LegendClassSymbol
                geometryKind={preset.type === "point" ? "point" : preset.type === "polygon" ? "polygon" : "line"}
                classItem={{ ...props.classItem, symbolType: preset.type, lineStyle: preset.lineStyle }}
                color={props.classItem.color}
                fillOpacity={props.classItem.fillOpacity}
              />
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="symbol-editor-actions">
        <button onClick={props.onClose}>ОК</button>
      </div>
    </section>
  );
}