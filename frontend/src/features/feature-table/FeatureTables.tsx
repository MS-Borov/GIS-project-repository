import { useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import { featureSelectionKey } from "../map/selection";
import type { SelectedLayerFeature, ZoomSelectionTarget } from "../map/selection";
import { ZoomToSelectionIcon } from "../../shared/ui/ToolbarIcons";

type SortDirection = "asc" | "desc";
export type AttributeFieldType = "text" | "number" | "integer" | "boolean" | "date";

const LEGACY_DRAFT_DEFAULT_FIELDS = new Set(["name", "description"]);

export const ATTRIBUTE_FIELD_TYPES: Array<{ value: AttributeFieldType; label: string }> = [
  { value: "text", label: "Текст" },
  { value: "number", label: "Число" },
  { value: "integer", label: "Целое" },
  { value: "boolean", label: "Да/нет" },
  { value: "date", label: "Дата" },
];

type GeoJsonFeature = {
  type: "Feature";
  geometry: { type: string } | null;
  properties?: Record<string, unknown> | null;
};

type GeoJsonPreview = {
  feature_count: number;
  geojson: {
    features: GeoJsonFeature[];
  };
};

type LayerPreviewState = {
  asset: {
    id: number;
    asset_name: string;
  };
  preview: GeoJsonPreview;
};

function previewAttributeFields(preview: GeoJsonPreview) {
  const fields = new Set<string>();
  preview.geojson.features.forEach((feature) => {
    Object.keys(feature.properties ?? {}).forEach((key) => fields.add(key));
  });
  return Array.from(fields).sort((left, right) => left.localeCompare(right));
}

function layerDisplayName(assetName: string) {
  return assetName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

function isBlankAttributeValue(value: unknown) {
  return value === undefined || value === null || String(value).trim() === "";
}

function isLegacyDraftDefaultField(field: string) {
  return LEGACY_DRAFT_DEFAULT_FIELDS.has(field.trim().toLowerCase());
}

function compareTableValues(left: unknown, right: unknown, direction: SortDirection) {
  const multiplier = direction === "asc" ? 1 : -1;
  const leftNumber = typeof left === "number" ? left : Number(left);
  const rightNumber = typeof right === "number" ? right : Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return (leftNumber - rightNumber) * multiplier;
  }
  return String(left ?? "").localeCompare(String(right ?? ""), "ru") * multiplier;
}

function nextSortDirection(current: SortDirection | null) {
  return current === "asc" ? "desc" : "asc";
}

function fieldInputType(type: AttributeFieldType | undefined) {
  if (type === "number" || type === "integer") {
    return "number";
  }
  if (type === "date") {
    return "date";
  }
  return "text";
}

function formatFieldValueForInput(value: unknown, type: AttributeFieldType | undefined) {
  if (type === "boolean") {
    return value === true || value === "true" || value === "1" || value === 1 ? "true" : value === false || value === "false" || value === "0" || value === 0 ? "false" : "";
  }
  return String(value ?? "");
}

function FieldValueEditor(props: {
  value: unknown;
  type?: AttributeFieldType;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  if (props.type === "boolean") {
    return (
      <select
        value={formatFieldValueForInput(props.value, props.type)}
        onChange={(event) => props.onChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        disabled={props.disabled}
      >
        <option value="">—</option>
        <option value="true">Да</option>
        <option value="false">Нет</option>
      </select>
    );
  }

  return (
    <input
      type={fieldInputType(props.type)}
      step={props.type === "integer" ? "1" : undefined}
      value={formatFieldValueForInput(props.value, props.type)}
      onChange={(event) => props.onChange(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      disabled={props.disabled}
    />
  );
}

function isAiDraftFeature(feature: Feature<Geometry>) {
  return feature.get("source") === "ai_digitizer" || Boolean(feature.get("ai_suggestion_accepted"));
}

type AttributeExpression = {
  field: string;
  operator: "=" | "!=" | ">" | ">=" | "<" | "<=" | "contains";
  value: string;
};

function stripExpressionToken(value: string) {
  const trimmed = value.trim();
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["[", "]"],
  ];
  const pair = quotePairs.find(([left, right]) => trimmed.startsWith(left) && trimmed.endsWith(right));
  return pair ? trimmed.slice(1, -1).trim() : trimmed;
}

function parseAttributeExpression(expression: string): AttributeExpression | null {
  const normalized = expression.trim();
  const match = normalized.match(/^(.+?)\s*(>=|<=|!=|<>|==|=|>|<|\bcontains\b)\s*(.+)$/i);
  if (!match) {
    return null;
  }
  const operator = match[2].toLowerCase() === "contains" ? "contains" : match[2] === "==" ? "=" : match[2] === "<>" ? "!=" : match[2];
  return {
    field: stripExpressionToken(match[1]),
    operator: operator as AttributeExpression["operator"],
    value: stripExpressionToken(match[3]),
  };
}

function propertyValue(properties: Record<string, unknown>, field: string) {
  const exactValue = properties[field];
  if (exactValue !== undefined) {
    return exactValue;
  }
  const normalizedField = field.toLowerCase();
  const matchingKey = Object.keys(properties).find((key) => key.toLowerCase() === normalizedField);
  return matchingKey ? properties[matchingKey] : undefined;
}

function matchesAttributeExpression(properties: Record<string, unknown>, expression: AttributeExpression) {
  const actual = propertyValue(properties, expression.field);
  const expected = expression.value;
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  const canCompareAsNumber = Number.isFinite(actualNumber) && Number.isFinite(expectedNumber);

  if (["<", "<=", ">", ">="].includes(expression.operator)) {
    if (!canCompareAsNumber) {
      return false;
    }
    if (expression.operator === ">") {
      return actualNumber > expectedNumber;
    }
    if (expression.operator === ">=") {
      return actualNumber >= expectedNumber;
    }
    if (expression.operator === "<") {
      return actualNumber < expectedNumber;
    }
    return actualNumber <= expectedNumber;
  }

  const actualText = String(actual ?? "").trim().toLowerCase();
  const expectedText = expected.trim().toLowerCase();
  if (expression.operator === "contains") {
    return actualText.includes(expectedText);
  }
  return expression.operator === "=" ? actualText === expectedText : actualText !== expectedText;
}

function AttributeExpressionBar(props: {
  expression: string;
  message: string;
  onExpressionChange: (value: string) => void;
  onRun: () => void;
}) {
  return (
    <div className="feature-table-expression">
      <label>
        <span>Выражение</span>
        <input
          value={props.expression}
          onChange={(event) => props.onExpressionChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.onRun();
            }
          }}
          placeholder="TYPE = bog"
        />
      </label>
      <button onClick={props.onRun} disabled={!props.expression.trim()}>Выделить</button>
      <span className="feature-table-expression-message">{props.message || "Пример: TYPE = bog, NAME contains озеро, ID > 10"}</span>
    </div>
  );
}

export function DraftFeatureTable(props: {
  layerName: string;
  fields: string[];
  fieldTypes: Record<string, AttributeFieldType>;
  features: Feature<Geometry>[];
  selectedFeature: Feature<Geometry> | null;
  onFeatureSelect: (index: number) => void;
  onAttributeChange: (index: number, key: string, value: string) => void;
  onAddField: (field: string) => void;
  onAddFieldWithType?: (field: string, type: AttributeFieldType) => void;
  onRemoveField: (field: string) => void;
  onFieldTypeChange?: (field: string, type: AttributeFieldType) => void;
  onClose: () => void;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<AttributeFieldType>("text");
  const [filterText, setFilterText] = useState("");
  const [attributeExpression, setAttributeExpression] = useState("");
  const [attributeExpressionMessage, setAttributeExpressionMessage] = useState("");
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: SortDirection } | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
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
    .filter(({ index }) => !showSelectedOnly || selectedIndexes.has(index))
    .sort((left, right) =>
      sortConfig
        ? compareTableValues(left.feature.get(sortConfig.field), right.feature.get(sortConfig.field), sortConfig.direction)
        : left.index - right.index,
    );

  function addField() {
    const field = newFieldName.trim();
    if (!field) {
      return;
    }
    if (props.onAddFieldWithType) {
      props.onAddFieldWithType(field, newFieldType);
    } else {
      props.onAddField(field);
    }
    setFieldOrder((current) => (current.includes(field) ? current : [...current, field]));
    setNewFieldName("");
  }

  function removeActiveField() {
    if (!isEditing || !sortConfig?.field) {
      return;
    }
    props.onRemoveField(sortConfig.field);
    setFieldOrder((current) => current.filter((field) => field !== sortConfig.field));
    if (selectedField === sortConfig.field) {
      setSelectedField(null);
    }
    setSortConfig(null);
  }

  function sortByField(field: string) {
    setSelectedField(field);
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

  function selectByExpression() {
    const expression = parseAttributeExpression(attributeExpression);
    if (!expression) {
      setAttributeExpressionMessage("Не понял выражение. Пример: TYPE = bog");
      return;
    }
    const matchingIndexes = props.features
      .map((feature, index) => ({ feature, index }))
      .filter(({ feature }) => matchesAttributeExpression(feature.getProperties(), expression))
      .map(({ index }) => index);
    setSelectedIndexes(new Set(matchingIndexes));
    if (matchingIndexes[0] !== undefined) {
      props.onFeatureSelect(matchingIndexes[0]);
    }
    setAttributeExpressionMessage(`Найдено: ${matchingIndexes.length}`);
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
          <button
            className={`selected-only-toggle${showSelectedOnly ? " active" : ""}`}
            onClick={() => setShowSelectedOnly((value) => !value)}
            disabled={!showSelectedOnly && selectedIndexes.size === 0}
            title="Показать только выделенные"
            data-tooltip="Показать только выделенные"
          >
            Выд.
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
      <AttributeExpressionBar
        expression={attributeExpression}
        message={attributeExpressionMessage}
        onExpressionChange={setAttributeExpression}
        onRun={selectByExpression}
      />
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
          placeholder="Новое поле"
        />
        <select value={newFieldType} onChange={(event) => setNewFieldType(event.target.value as AttributeFieldType)}>
          {ATTRIBUTE_FIELD_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
        <button onClick={addField} disabled={!newFieldName.trim()}>Добавить поле</button>
      </div>
      {props.fields.length === 0 ? (
        <p className="muted">Добавьте первое поле через строку выше.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table editable-feature-table gis-feature-table">
            <thead>
              <tr>
                <th className="row-index">#</th>
                <th>Геометрия</th>
                {orderedFields.map((field) => (
                  <th key={field} className={selectedField === field ? "selected-column" : undefined}>
                    <div className="feature-table-field-header">
                      <button className="feature-table-sort" onClick={() => sortByField(field)}>
                        {field}
                        {sortConfig?.field === field ? (sortConfig.direction === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                      <select
                        value={props.fieldTypes[field] ?? "text"}
                        onChange={(event) => props.onFieldTypeChange?.(field, event.target.value as AttributeFieldType)}
                        onClick={(event) => event.stopPropagation()}
                        disabled={!isEditing || !props.onFieldTypeChange}
                      >
                        {ATTRIBUTE_FIELD_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ feature, index }) => (
                <tr
                  key={`draft-${index}`}
                  className={[
                    props.selectedFeature === feature ? "selected" : "",
                    selectedIndexes.has(index) ? "multi-selected" : "",
                    isAiDraftFeature(feature) ? "ai-draft-row" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => toggleRowSelection(index)}
                >
                  <td>{index + 1}</td>
                  <td>{feature.getGeometry()?.getType() ?? "—"}{isAiDraftFeature(feature) ? " · AI" : ""}</td>
                  {orderedFields.map((field) => (
                    <td key={field} className={selectedField === field ? "selected-column-cell" : undefined}>
                      <FieldValueEditor
                        type={props.fieldTypes[field]}
                        value={feature.get(field)}
                        onChange={(value) => props.onAttributeChange(index, field, value)}
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

export function FeatureTable(props: {
  layer: LayerPreviewState;
  selectedFeature: SelectedLayerFeature;
  onFeatureSelect: (feature: SelectedLayerFeature) => void;
  selectedFeatureKeys: Set<string>;
  onFeatureSelectionChange: (keys: Set<string>) => void;
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
  const [attributeExpression, setAttributeExpression] = useState("");
  const [attributeExpressionMessage, setAttributeExpressionMessage] = useState("");
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: SortDirection } | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [fieldOrder, setFieldOrder] = useState<string[]>([]);
  const fields = previewAttributeFields(props.layer.preview);
  const orderedFields = [
    ...fieldOrder.filter((field) => fields.includes(field)),
    ...fields.filter((field) => !fieldOrder.includes(field)),
  ];
  const rows = props.layer.preview.geojson.features;
  const selectedIndexesForLayer = new Set(
    Array.from(props.selectedFeatureKeys)
      .filter((key) => key.startsWith(`${props.layer.asset.id}:`))
      .map((key) => Number(key.split(":")[1])),
  );
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
    .filter(({ index }) => !showSelectedOnly || selectedIndexesForLayer.has(index))
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
    if (!field) {
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
    if (selectedField === sortConfig.field) {
      setSelectedField(null);
    }
    setSortConfig(null);
  }

  function sortByField(field: string) {
    setSelectedField(field);
    setSortConfig((current) => ({
      field,
      direction: current?.field === field ? nextSortDirection(current.direction) : "asc",
    }));
  }

  function selectRow(index: number, event?: ReactMouseEvent<HTMLTableRowElement>) {
    const currentLayerKeys = Array.from(props.selectedFeatureKeys).filter((key) =>
      key.startsWith(`${props.layer.asset.id}:`),
    );
    let nextIndexes: number[];
    if (event?.shiftKey && lastSelectedIndex !== null) {
      const visibleIndexes = filteredRows.map((row) => row.index);
      const startPosition = visibleIndexes.indexOf(lastSelectedIndex);
      const endPosition = visibleIndexes.indexOf(index);
      const range =
        startPosition >= 0 && endPosition >= 0
          ? visibleIndexes.slice(Math.min(startPosition, endPosition), Math.max(startPosition, endPosition) + 1)
          : [index];
      nextIndexes = event.ctrlKey || event.metaKey
        ? Array.from(new Set([...currentLayerKeys.map((key) => Number(key.split(":")[1])), ...range]))
        : range;
    } else if (event?.ctrlKey || event?.metaKey) {
      const next = new Set(currentLayerKeys.map((key) => Number(key.split(":")[1])));
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      nextIndexes = Array.from(next);
    } else {
      nextIndexes = [index];
    }
    props.onFeatureSelectionChange(new Set(nextIndexes.map((item) => featureSelectionKey(props.layer.asset.id, item))));
    setLastSelectedIndex(index);
    props.onFeatureSelect({ assetId: props.layer.asset.id, featureIndex: index });
  }

  function selectAllRows() {
    props.onFeatureSelectionChange(new Set(filteredRows.map((row) => featureSelectionKey(props.layer.asset.id, row.index))));
  }

  function clearSelection() {
    props.onFeatureSelectionChange(new Set());
  }

  function invertSelection() {
    const visibleIndexes = filteredRows.map((row) => row.index);
    const currentIndexes = new Set(
      Array.from(props.selectedFeatureKeys)
        .filter((key) => key.startsWith(`${props.layer.asset.id}:`))
        .map((key) => Number(key.split(":")[1])),
    );
    props.onFeatureSelectionChange(
      new Set(
        visibleIndexes
          .filter((index) => !currentIndexes.has(index))
          .map((index) => featureSelectionKey(props.layer.asset.id, index)),
      ),
    );
  }

  function selectByExpression() {
    const expression = parseAttributeExpression(attributeExpression);
    if (!expression) {
      setAttributeExpressionMessage("Не понял выражение. Пример: TYPE = bog");
      return;
    }
    const matchingIndexes = rows
      .map((feature, index) => ({ feature, index }))
      .filter(({ feature }) => matchesAttributeExpression(feature.properties ?? {}, expression))
      .map(({ index }) => index);
    props.onFeatureSelectionChange(
      new Set(matchingIndexes.map((index) => featureSelectionKey(props.layer.asset.id, index))),
    );
    if (matchingIndexes[0] !== undefined) {
      setLastSelectedIndex(matchingIndexes[0]);
      props.onFeatureSelect({ assetId: props.layer.asset.id, featureIndex: matchingIndexes[0] });
    }
    setAttributeExpressionMessage(`Найдено: ${matchingIndexes.length}`);
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
          <button
            className={`selected-only-toggle${showSelectedOnly ? " active" : ""}`}
            onClick={() => setShowSelectedOnly((value) => !value)}
            disabled={!showSelectedOnly && selectedIndexesForLayer.size === 0}
            title="Показать только выделенные"
            data-tooltip="Показать только выделенные"
          >
            Выд.
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
      <AttributeExpressionBar
        expression={attributeExpression}
        message={attributeExpressionMessage}
        onExpressionChange={setAttributeExpression}
        onRun={selectByExpression}
      />
      {fields.length === 0 ? (
        <p className="muted">У слоя нет атрибутивных полей для таблицы.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table editable-feature-table gis-feature-table">
            <thead>
              <tr>
                <th className="row-index">#</th>
                <th>Геометрия</th>
                {orderedFields.map((field) => (
                  <th key={field} className={selectedField === field ? "selected-column" : undefined}>
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
                  key={`${props.layer.asset.id}-${index}`}
                  className={[
                    props.selectedFeature?.assetId === props.layer.asset.id &&
                    props.selectedFeature.featureIndex === index
                      ? "selected"
                      : "",
                    props.selectedFeatureKeys.has(featureSelectionKey(props.layer.asset.id, index)) ? "multi-selected" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={(event) => selectRow(index, event)}
                >
                  <td>{index + 1}</td>
                  <td>{feature.geometry?.type ?? "—"}</td>
                  {orderedFields.map((field) => (
                    <td key={field} className={selectedField === field ? "selected-column-cell" : undefined}>
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
        <span>{Array.from(props.selectedFeatureKeys).filter((key) => key.startsWith(`${props.layer.asset.id}:`)).length} выделено</span>
        <span>
          {props.selectedFeature?.assetId === props.layer.asset.id
            ? `Выбран объект #${props.selectedFeature.featureIndex + 1}`
            : "Нет выбранного объекта"}
        </span>
      </div>
    </section>
  );
}

export function GisFeatureTable(props: {
  layer: LayerPreviewState;
  draftFeatures: Feature<Geometry>[];
  draftSchemaFields: string[];
  draftFieldTypes: Record<string, AttributeFieldType>;
  selectedDraftFeature: Feature<Geometry> | null;
  selectedFeature: SelectedLayerFeature;
  onFeatureSelect: (feature: SelectedLayerFeature) => void;
  onDraftFeatureSelect: (feature: Feature<Geometry>) => void;
  selectedFeatureKeys: Set<string>;
  onFeatureSelectionChange: (keys: Set<string>) => void;
  onZoomToSelection: (selection?: ZoomSelectionTarget) => void;
  onAttributeChange: (assetId: number, featureIndex: number, field: string, value: string) => void;
  onDraftAttributeChange: (feature: Feature<Geometry>, field: string, value: string) => void;
  onAddField: (assetId: number, field: string) => void;
  onAddDraftFieldWithType?: (field: string, type: AttributeFieldType) => void;
  onRemoveField: (assetId: number, field: string) => void;
  onDraftFieldTypeChange?: (field: string, type: AttributeFieldType) => void;
  onClose: () => void;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<AttributeFieldType>("text");
  const [filterText, setFilterText] = useState("");
  const [attributeExpression, setAttributeExpression] = useState("");
  const [attributeExpressionMessage, setAttributeExpressionMessage] = useState("");
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: SortDirection } | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [lastSelectedRowId, setLastSelectedRowId] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
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
  const draftFeatureHasNonBlankValue = (field: string) =>
    props.draftFeatures.some((feature) => !isBlankAttributeValue(feature.get(field)));
  const shouldShowDraftField = (field: string) =>
    !isLegacyDraftDefaultField(field) || draftFeatureHasNonBlankValue(field);
  const visibleDraftSchemaFields = props.draftSchemaFields.filter(shouldShowDraftField);
  const visibleDraftFields = Array.from(draftFields).filter(shouldShowDraftField);
  const fields = Array.from(new Set([...previewAttributeFields(props.layer.preview), ...visibleDraftSchemaFields, ...visibleDraftFields]));
  const emptyLayerFields = props.layer.preview.geojson.features[0]?.properties
    ? Object.keys(props.layer.preview.geojson.features[0].properties ?? {})
    : [];
  const schemaFields = fields.length > 0 ? fields : emptyLayerFields;
  const orderedFields = [
    ...fieldOrder.filter((field) => schemaFields.includes(field)),
    ...schemaFields.filter((field) => !fieldOrder.includes(field)),
  ];
  const sourceRows = props.layer.preview.geojson.features
    .map((feature, index) => ({ feature, index }))
    .filter((row) => row.feature.geometry !== null);
  const rows = [
    ...sourceRows.map((row) => ({
      kind: "source" as const,
      feature: row.feature,
      index: row.index,
      rowId: `source-${row.index}`,
    })),
    ...props.draftFeatures.map((feature, index) => ({
      kind: "draft" as const,
      feature,
      index,
      rowId: `draft-${index}`,
    })),
  ];
  const selectedSourceKeysForFilter = new Set(
    Array.from(props.selectedFeatureKeys).filter((key) => key.startsWith(`${props.layer.asset.id}:`)),
  );
  const rowSelectionIndex = (row: (typeof rows)[number]) =>
    row.kind === "source" ? row.index : props.layer.preview.geojson.features.length + row.index;
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
    .filter(
      (row) =>
        !showSelectedOnly ||
        selectedIndexes.has(rowSelectionIndex(row)) ||
        (row.kind === "source" && selectedSourceKeysForFilter.has(featureSelectionKey(props.layer.asset.id, row.index))) ||
        (row.kind === "draft" && props.selectedDraftFeature === row.feature),
    )
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
    if (!field) {
      return;
    }
    if (props.onAddDraftFieldWithType) {
      props.onAddDraftFieldWithType(field, newFieldType);
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
    if (selectedField === sortConfig.field) {
      setSelectedField(null);
    }
    setSortConfig(null);
  }

  function sortByField(field: string) {
    setSelectedField(field);
    setSortConfig((current) => ({
      field,
      direction: current?.field === field ? nextSortDirection(current.direction) : "asc",
    }));
  }

  function toggleRowSelection(row: (typeof rows)[number], event?: ReactMouseEvent<HTMLTableRowElement>) {
    const selectionIndex = row.kind === "source" ? row.index : props.layer.preview.geojson.features.length + row.index;
    setSelectedIndexes((current) => {
      let next = new Set<number>();
      if (event?.shiftKey && lastSelectedRowId !== null) {
        const visibleRowIds = filteredRows.map((item) => item.rowId);
        const startPosition = visibleRowIds.indexOf(lastSelectedRowId);
        const endPosition = visibleRowIds.indexOf(row.rowId);
        const rangeRows =
          startPosition >= 0 && endPosition >= 0
            ? filteredRows.slice(Math.min(startPosition, endPosition), Math.max(startPosition, endPosition) + 1)
            : [row];
        next = event.ctrlKey || event.metaKey ? new Set(current) : new Set();
        rangeRows.forEach((item) => {
          next.add(item.kind === "source" ? item.index : props.layer.preview.geojson.features.length + item.index);
        });
      } else if (event?.ctrlKey || event?.metaKey) {
        next = new Set(current);
        if (next.has(selectionIndex)) {
          next.delete(selectionIndex);
        } else {
          next.add(selectionIndex);
        }
      } else {
        next = new Set([selectionIndex]);
      }
      return next;
    });
    const nextSourceKeys = new Set<string>();
    const selectedRows =
      event?.shiftKey && lastSelectedRowId !== null
        ? (() => {
            const visibleRowIds = filteredRows.map((item) => item.rowId);
            const startPosition = visibleRowIds.indexOf(lastSelectedRowId);
            const endPosition = visibleRowIds.indexOf(row.rowId);
            return startPosition >= 0 && endPosition >= 0
              ? filteredRows.slice(Math.min(startPosition, endPosition), Math.max(startPosition, endPosition) + 1)
              : [row];
          })()
        : [row];
    const currentLayerKeys = Array.from(props.selectedFeatureKeys).filter((key) => key.startsWith(`${props.layer.asset.id}:`));
    if (event?.ctrlKey || event?.metaKey) {
      currentLayerKeys.forEach((key) => nextSourceKeys.add(key));
    }
    selectedRows.forEach((item) => {
      if (item.kind !== "source") {
        return;
      }
      const key = featureSelectionKey(props.layer.asset.id, item.index);
      if ((event?.ctrlKey || event?.metaKey) && selectedRows.length === 1 && nextSourceKeys.has(key)) {
        nextSourceKeys.delete(key);
      } else {
        nextSourceKeys.add(key);
      }
    });
    if (!event?.ctrlKey && !event?.metaKey && !event?.shiftKey && row.kind === "source") {
      nextSourceKeys.clear();
      nextSourceKeys.add(featureSelectionKey(props.layer.asset.id, row.index));
    }
    props.onFeatureSelectionChange(nextSourceKeys);
    setLastSelectedRowId(row.rowId);
    if (row.kind === "source") {
      props.onFeatureSelect({ assetId: props.layer.asset.id, featureIndex: row.index });
    } else {
      props.onDraftFeatureSelect(row.feature);
    }
  }

  function selectAllRows() {
    setSelectedIndexes(new Set(filteredRows.map((row) => (row.kind === "source" ? row.index : props.layer.preview.geojson.features.length + row.index))));
    props.onFeatureSelectionChange(
      new Set(
        filteredRows
          .filter((row) => row.kind === "source")
          .map((row) => featureSelectionKey(props.layer.asset.id, row.index)),
      ),
    );
  }

  function clearSelection() {
    setSelectedIndexes(new Set());
    props.onFeatureSelectionChange(new Set());
  }

  function invertSelection() {
    const visibleIndexes = filteredRows.map((row) => (row.kind === "source" ? row.index : props.layer.preview.geojson.features.length + row.index));
    setSelectedIndexes((current) => new Set(visibleIndexes.filter((index) => !current.has(index))));
    props.onFeatureSelectionChange(
      new Set(
        filteredRows
          .filter((row) => row.kind === "source")
          .filter((row) => !selectedIndexes.has(rowSelectionIndex(row)))
          .map((row) => featureSelectionKey(props.layer.asset.id, row.index)),
      ),
    );
  }

  function selectByExpression() {
    const expression = parseAttributeExpression(attributeExpression);
    if (!expression) {
      setAttributeExpressionMessage("Не понял выражение. Пример: TYPE = bog");
      return;
    }
    const matchingRows = rows.filter((row) =>
      matchesAttributeExpression(
        row.kind === "source" ? row.feature.properties ?? {} : row.feature.getProperties(),
        expression,
      ),
    );
    setSelectedIndexes(new Set(matchingRows.map(rowSelectionIndex)));
    props.onFeatureSelectionChange(
      new Set(
        matchingRows
          .filter((row) => row.kind === "source")
          .map((row) => featureSelectionKey(props.layer.asset.id, row.index)),
      ),
    );
    const firstRow = matchingRows[0];
    if (firstRow?.kind === "source") {
      props.onFeatureSelect({ assetId: props.layer.asset.id, featureIndex: firstRow.index });
      setLastSelectedRowId(firstRow.rowId);
    } else if (firstRow?.kind === "draft") {
      props.onDraftFeatureSelect(firstRow.feature);
      setLastSelectedRowId(firstRow.rowId);
    }
    setAttributeExpressionMessage(`Найдено: ${matchingRows.length}`);
  }

  function zoomToTableSelection() {
    const sourceKeys = new Set(
      Array.from(props.selectedFeatureKeys).filter((key) => key.startsWith(`${props.layer.asset.id}:`)),
    );
    const draftFeatures: Feature<Geometry>[] = [];
    rows.forEach((row) => {
      const selectionIndex = row.kind === "source" ? row.index : props.layer.preview.geojson.features.length + row.index;
      if (!selectedIndexes.has(selectionIndex)) {
        return;
      }
      if (row.kind === "source") {
        sourceKeys.add(featureSelectionKey(props.layer.asset.id, row.index));
      } else {
        draftFeatures.push(row.feature);
      }
    });
    props.onZoomToSelection({
      sourceKeys,
      sourceFeature: sourceKeys.size === 0 && draftFeatures.length === 0 && props.selectedFeature?.assetId === props.layer.asset.id ? props.selectedFeature : null,
      draftFeatures,
    });
  }

  const selectedSourceKeysForLayer = Array.from(props.selectedFeatureKeys).filter((key) => key.startsWith(`${props.layer.asset.id}:`));
  const hasZoomSelection =
    selectedIndexes.size > 0 ||
    selectedSourceKeysForLayer.length > 0 ||
    props.selectedFeature?.assetId === props.layer.asset.id ||
    Boolean(props.selectedDraftFeature);
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
          <button
            className={`selected-only-toggle${showSelectedOnly ? " active" : ""}`}
            onClick={() => setShowSelectedOnly((value) => !value)}
            disabled={!showSelectedOnly && selectedIndexes.size === 0 && selectedSourceKeysForFilter.size === 0 && !props.selectedDraftFeature}
            title="Показать только выделенные"
            data-tooltip="Показать только выделенные"
          >
            Выд.
          </button>
          <button className="zoom-selected-button" onClick={zoomToTableSelection} disabled={!hasZoomSelection} title="Увеличить до выделенного" data-tooltip="Увеличить до выделенного">
            <ZoomToSelectionIcon />
          </button>
          <button onClick={() => moveSortedField(-1)} disabled={!sortConfig} title="Поле левее" data-tooltip="Поле левее">←</button>
          <button onClick={() => moveSortedField(1)} disabled={!sortConfig} title="Поле правее" data-tooltip="Поле правее">→</button>
          <button onClick={removeActiveField} disabled={!isEditing || !sortConfig} title="Удалить выбранное поле" data-tooltip="Удалить выбранное поле">⊟</button>
        </div>
        <label className="feature-table-search">
          <span>Фильтр</span>
          <input value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="Поиск" />
        </label>
      </div>
      <AttributeExpressionBar
        expression={attributeExpression}
        message={attributeExpressionMessage}
        onExpressionChange={setAttributeExpression}
        onRun={selectByExpression}
      />
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
          placeholder="Новое поле"
        />
        <select value={newFieldType} onChange={(event) => setNewFieldType(event.target.value as AttributeFieldType)}>
          {ATTRIBUTE_FIELD_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
        <button onClick={addField} disabled={!newFieldName.trim()}>Добавить поле</button>
      </div>
      {orderedFields.length === 0 ? (
        <p className="muted">У слоя нет атрибутивных полей. Добавьте первое поле через строку выше.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table editable-feature-table gis-feature-table">
            <thead>
              <tr>
                <th className="row-index">#</th>
                <th>Геометрия</th>
                {orderedFields.map((field) => (
                  <th key={field} className={selectedField === field ? "selected-column" : undefined}>
                    <div className="feature-table-field-header">
                      <button className="feature-table-sort" onClick={() => sortByField(field)}>
                        {field}
                        {sortConfig?.field === field ? (sortConfig.direction === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                      <select
                        value={props.draftFieldTypes[field] ?? "text"}
                        onChange={(event) => props.onDraftFieldTypeChange?.(field, event.target.value as AttributeFieldType)}
                        onClick={(event) => event.stopPropagation()}
                        disabled={!isEditing || !props.onDraftFieldTypeChange}
                      >
                        {ATTRIBUTE_FIELD_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const selectionIndex = row.kind === "source" ? row.index : props.layer.preview.geojson.features.length + row.index;
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
                    row.kind === "draft" && isAiDraftFeature(row.feature) ? "ai-draft-row" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={(event) => toggleRowSelection(row, event)}
                >
                  <td>{selectionIndex + 1}</td>
                  <td>
                    {geometryType}
                    {row.kind === "draft" ? ` · ${isAiDraftFeature(row.feature) ? "AI-черновик" : "черновик"}` : ""}
                  </td>
                  {orderedFields.map((field) => (
                    <td key={field} className={selectedField === field ? "selected-column-cell" : undefined}>
                      <FieldValueEditor
                        type={props.draftFieldTypes[field]}
                        value={row.kind === "source" ? row.feature.properties?.[field] ?? "" : row.feature.get(field)}
                        onChange={(value) => {
                          if (row.kind === "source") {
                            props.onAttributeChange(props.layer.asset.id, row.index, field, value);
                          } else {
                            props.onDraftAttributeChange(row.feature, field, value);
                          }
                        }}
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
