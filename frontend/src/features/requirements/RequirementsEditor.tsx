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

function stringOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
export function RequirementsEditor(props: {
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
          <p className="eyebrow">Требования</p>
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
          <h2>{props.hasExpectedOutputs ? "Формальная проверка ГИС-результатов" : "Проверка отчёта и вопросов"}</h2>
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
          Очистить результаты
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
            <option value="archive">Архив с отчётом и ГИС-файлами</option>
            <option value="report_only">Только отчёт</option>
            <option value="online_workspace">Работа в онлайн-карте</option>
          </select>
        </label>

        <label>
          Формат результата
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
          Ожидаемая СК
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
        Ожидаемые результаты JSON
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

