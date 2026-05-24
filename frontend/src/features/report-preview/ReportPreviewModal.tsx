import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import { API_BASE_URL, storedAuthHeaders } from "../map/mapWorkspaceUtils";

export type ReportPreviewSource =
  | { kind: "file"; file: File }
  | { kind: "asset"; assetId: number; name?: string | null };

export function ReportPreviewModal(props: {
  source: ReportPreviewSource | null;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reportName, setReportName] = useState<string>("Отчёт");

  const { source, onClose } = props;
  const isOpen = source !== null;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!source) return;
    const signal = { cancelled: false };
    setErrorMessage(null);
    setIsLoading(true);

    async function load() {
      const container = containerRef.current;
      if (!container || !source) return;
      try {
        container.innerHTML = "";
        let buffer: ArrayBuffer;

        if (source.kind === "file") {
          setReportName(source.file.name);
          buffer = await source.file.arrayBuffer();
        } else {
          setReportName(source.name || "Отчёт");
          const response = await fetch(
            `${API_BASE_URL}/downloads/submission-assets/${source.assetId}`,
            { headers: storedAuthHeaders() },
          );
          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Не удалось загрузить отчёт: ${response.status} ${text}`);
          }
          buffer = await response.arrayBuffer();
        }

        if (signal.cancelled) return;

        await renderAsync(buffer, container, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          experimental: true,
        });

        if (!signal.cancelled) {
          setIsLoading(false);
        }
      } catch (error) {
        if (signal.cancelled) return;
        const msg = error instanceof Error ? error.message : "Не удалось открыть отчёт.";
        setErrorMessage(msg);
        setIsLoading(false);
      }
    }

    void load();
    return () => {
      signal.cancelled = true;
    };
  }, [source]);

  if (!isOpen) return null;

  return (
    <div className="report-modal-overlay" onClick={onClose}>
      <div className="report-modal" onClick={(event) => event.stopPropagation()}>
        <header className="report-modal-header">
          <div>
            <p className="eyebrow">Просмотр отчёта</p>
            <h2>{reportName}</h2>
          </div>
          <div className="report-modal-actions">
            {isLoading && !errorMessage ? <span className="muted">Загрузка...</span> : null}
            <button onClick={onClose}>Закрыть</button>
          </div>
        </header>
        {errorMessage ? <div className="alert error">{errorMessage}</div> : null}
        <div ref={containerRef} className="report-modal-content" />
      </div>
    </div>
  );
}
