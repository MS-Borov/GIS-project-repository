import { useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import { featureSelectionKey } from "../map/selection";
import type { SelectedLayerFeature, ZoomSelectionTarget } from "../map/selection";
import { ZoomToSelectionIcon } from "../../shared/ui/ToolbarIcons";

type SortDirection = "asc" | "desc";

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
export function DraftFeatureTable(props: {
  layerName: string;
  fields: string[];
  features: Feature<Geometry>[];
  selectedFeature: Feature<Geometry> | null;
  onFeatureSelect: (index: number) => void;
  onAttributeChange: (index: number, key: string, value: string) => void;
  onAddField: (field: string) => void;
  onRemoveField: (field: string) => void;
  onClose: () => void;
  position: { x: number; y: number };
  zIndex: number;
  onFocus: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [filterText, setFilterText] = useState("");
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: SortDirection } | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
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
    .sort((left, right) =>
      sortConfig
        ? compareTableValues(left.feature.get(sortConfig.field), right.feature.get(sortConfig.field), sortConfig.direction)
        : left.index - right.index,
    );

  function addField() {
    const field = newFieldName.trim();
    if (!isEditing || !field) {
      return;
    }
    props.onAddField(field);
    setFieldOrder((current) => (current.includes(field) ? current : [...current, field]));
    setNewFieldName("");
  }

  function removeActiveField() {
    if (!isEditing || !sortConfig?.field) {
      return;
    }
    props.onRemoveField(sortConfig.field);
    setFieldOrder((current) => current.filter((field) => field !== sortConfig.field));
    setSortConfig(null);
  }

  function sortByField(field: string) {
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
          disabled={!isEditing}
          placeholder="Новое поле"
        />
        <button onClick={addField} disabled={!isEditing || !newFieldName.trim()}>Добавить поле</button>
      </div>
      {props.fields.length === 0 ? (
        <p className="muted">Добавьте поля в свойствах чернового слоя, чтобы редактировать таблицу.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table editable-feature-table gis-feature-table">
            <thead>
              <tr>
                <th className="row-index">#</th>
                <th>Геометрия</th>
                {orderedFields.map((field) => (
                  <th key={field}>
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
                  key={`draft-${index}`}
                  className={[props.selectedFeature === feature ? "selected" : "", selectedIndexes.has(index) ? "multi-selected" : ""].filter(Boolean).join(" ")}
                  onClick={() => toggleRowSelection(index)}
                >
                  <td>{index + 1}</td>
                  <td>{feature.getGeometry()?.getType() ?? "—"}</td>
                  {orderedFields.map((field) => (
                    <td key={field}>
                      <input
                        value={String(feature.get(field) ?? "")}
                        onChange={(event) => props.onAttributeChange(index, field, event.target.value)}
                        onClick={(event) => event.stopPropagation()}
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
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: SortDirection } | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [fieldOrder, setFieldOrder] = useState<string[]>([]);
  const fields = previewAttributeFields(props.layer.preview);
  const orderedFields = [
    ...fieldOrder.filter((field) => fields.includes(field)),
    ...fields.filter((field) => !fieldOrder.includes(field)),
  ];
  const rows = props.layer.preview.geojson.features;
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
    if (!isEditing || !field) {
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
    setSortConfig(null);
  }

  function sortByField(field: string) {
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
      {fields.length === 0 ? (
        <p className="muted">У слоя нет атрибутивных полей для таблицы.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table editable-feature-table gis-feature-table">
            <thead>
              <tr>
                <th className="row-index">#</th>
                <th>Геометрия</th>
                {fields.map((field) => (
                  <th key={field}>{field}</th>
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
                  {fields.map((field) => (
                    <td key={field}>
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
  const [sortConfig, setSortConfig] = useState<{ field: string; direction: SortDirection } | null>(null);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [lastSelectedRowId, setLastSelectedRowId] = useState<string | null>(null);
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
  const fields = Array.from(new Set([...previewAttributeFields(props.layer.preview), ...draftFields]));
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
    if (!isEditing || !field) {
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
    setSortConfig(null);
  }

  function sortByField(field: string) {
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
          .filter((row) => !selectedIndexes.has(row.index))
          .map((row) => featureSelectionKey(props.layer.asset.id, row.index)),
      ),
    );
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
          disabled={!isEditing}
          placeholder="Новое поле"
        />
        <button onClick={addField} disabled={!isEditing || !newFieldName.trim()}>Добавить поле</button>
      </div>
      {orderedFields.length === 0 ? (
        <p className="muted">У слоя нет атрибутивных полей. Включите редактирование и добавьте поле.</p>
      ) : (
        <div className="feature-table-wrap">
          <table className="feature-table editable-feature-table gis-feature-table">
            <thead>
              <tr>
                <th className="row-index">#</th>
                <th>Геометрия</th>
                {orderedFields.map((field) => (
                  <th key={field}>
                    <button className="feature-table-sort" onClick={() => sortByField(field)}>
                      {field}
                      {sortConfig?.field === field ? (sortConfig.direction === "asc" ? " ↑" : " ↓") : ""}
                    </button>
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
                  ].filter(Boolean).join(" ")}
                  onClick={(event) => toggleRowSelection(row, event)}
                >
                  <td>{selectionIndex + 1}</td>
                  <td>{geometryType}{row.kind === "draft" ? " · черновик" : ""}</td>
                  {orderedFields.map((field) => (
                    <td key={field}>
                      <input
                        value={String(row.kind === "source" ? row.feature.properties?.[field] ?? "" : row.feature.get(field) ?? "")}
                        onChange={(event) => {
                          if (row.kind === "source") {
                            props.onAttributeChange(props.layer.asset.id, row.index, field, event.target.value);
                          } else {
                            props.onDraftAttributeChange(row.feature, field, event.target.value);
                          }
                        }}
                        onClick={(event) => event.stopPropagation()}
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

