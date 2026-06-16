import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { ATTRIBUTE_FIELD_TYPES, type AttributeFieldType } from "../feature-table/FeatureTables";

type DraftPropertiesPanelProps = {
  draftId: number | null;
  draftFeatureCount: number;
  draftCrs: string;
  draftName: string;
  draftGeometryType: string;
  draftColor: string;
  draftFillOpacity: number;
  draftSchemaFields: string[];
  newDraftFieldName: string;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onClose: () => void;
  onDraftNameChange: (value: string) => void;
  onDraftGeometryTypeChange: (value: string) => void;
  onDraftCrsChange: (value: string) => void;
  onDraftColorChange: (value: string) => void;
  onDraftFillOpacityChange: (value: number) => void;
  onNewDraftFieldNameChange: (value: string) => void;
  onAddDraftField: () => void;
  onAddDraftFieldWithType?: (field: string, type: AttributeFieldType) => void;
  onRemoveDraftField: (field: string) => void;
  onApplyDraftFieldsToFeatures: () => void;
};

export function DraftPropertiesPanel(props: DraftPropertiesPanelProps) {
  const [newFieldType, setNewFieldType] = useState<AttributeFieldType>("text");

  const handleAddField = () => {
    if (props.onAddDraftFieldWithType) {
      props.onAddDraftFieldWithType(props.newDraftFieldName, newFieldType);
      props.onNewDraftFieldNameChange("");
    } else {
      props.onAddDraftField();
    }
  };

  return (
    <section
      className="draft-properties-panel"
      style={{
        left: props.position.x,
        top: props.position.y,
        zIndex: props.zIndex,
      }}
      onPointerDown={props.onFocus}
    >
      <div className="layer-properties-title draggable-title" onPointerDown={props.onDragStart}>
        <div>
          <p className="eyebrow">Рабочий слой</p>
          <h3>Свойства черновика</h3>
        </div>
        <button onClick={props.onClose} onPointerDown={(event) => event.stopPropagation()} title="Закрыть">
          ×
        </button>
      </div>
      <div className="draft-properties-summary">
        <span>{props.draftId ? `Черновик #${props.draftId}` : "Новый черновик"}</span>
        <span>{props.draftFeatureCount} объектов</span>
        <span>{props.draftCrs || "СК не задана"}</span>
      </div>
      <div className="draft-properties-grid">
        <label>
          Название чернового слоя
          <input
            value={props.draftName}
            onChange={(event) => props.onDraftNameChange(event.target.value)}
            placeholder="Например: Новые объекты"
          />
        </label>
        <label>
          Тип геометрии
          <select
            value={props.draftGeometryType}
            onChange={(event) => props.onDraftGeometryTypeChange(event.target.value)}
          >
            <option value="Polygon">Полигоны</option>
            <option value="LineString">Линии</option>
            <option value="Point">Точки</option>
            <option value="mixed">Авто (без ограничения типа)</option>
          </select>
        </label>
        <label>
          Назначенная СК
          <input
            value={props.draftCrs}
            onChange={(event) => props.onDraftCrsChange(event.target.value)}
            placeholder="Например EPSG:4326"
          />
        </label>
        <label>
          Цвет слоя
          <input type="color" value={props.draftColor} onChange={(event) => props.onDraftColorChange(event.target.value)} />
        </label>
        <label>
          Заливка
          <input
            type="range"
            min="0"
            max="0.7"
            step="0.05"
            value={props.draftFillOpacity}
            onChange={(event) => props.onDraftFillOpacityChange(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="draft-properties-block">
        <div className="draft-properties-block-heading">
          <strong>Поля атрибутов</strong>
          <button
            onClick={props.onApplyDraftFieldsToFeatures}
            disabled={props.draftFeatureCount === 0 || props.draftSchemaFields.length === 0}
          >
            Применить к объектам
          </button>
        </div>
        <div className="draft-field-list">
          {props.draftSchemaFields.length === 0 ? <span className="muted">Поля пока не заданы.</span> : null}
          {props.draftSchemaFields.map((field) => (
            <span className="draft-field-chip" key={field}>
              {field}
              <button onClick={() => props.onRemoveDraftField(field)} title={`Удалить поле ${field}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="draft-field-add">
          <input
            value={props.newDraftFieldName}
            onChange={(event) => props.onNewDraftFieldNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAddField();
              }
            }}
            placeholder="Имя поля"
          />
          <select
            value={newFieldType}
            onChange={(event) => setNewFieldType(event.target.value as AttributeFieldType)}
            title="Тип поля"
          >
            {ATTRIBUTE_FIELD_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <button onClick={handleAddField}>Добавить поле</button>
        </div>
      </div>
    </section>
  );
}