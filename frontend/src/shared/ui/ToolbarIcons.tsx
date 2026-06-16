export function ZoomToSelectionIcon() {
  return (
    <svg className="toolbar-icon zoom-to-selection-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.25" cy="10.25" r="5.75" />
      <path d="M14.5 14.5L20 20" />
      <path d="M10.25 7.25V13.25" />
      <path d="M7.25 10.25H13.25" />
    </svg>
  );
}

export function FitExtentIcon() {
  return (
    <svg className="toolbar-icon fit-extent-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg className="toolbar-icon trash-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6.5 7l1 12.5h9l1-12.5" />
      <path d="M10 10.5v6" />
      <path d="M14 10.5v6" />
    </svg>
  );
}

export function RestoreIcon() {
  return (
    <svg className="toolbar-icon restore-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 8.5a7 7 0 1 1-1 6.5" />
      <path d="M3.5 5v4h4" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg className="toolbar-icon check-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg className="toolbar-icon close-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}