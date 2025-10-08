import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

export type DeleteConfirmationModalProps = {
  title: string;
  entityName: string;
  onCancel: () => void;
  onConfirm: () => void;
  isProcessing?: boolean;
  description?: string;
  confirmButtonLabel?: string;
  cancelButtonLabel?: string;
  confirmationHint?: string;
  inputLabel?: ReactNode;
  children?: ReactNode;
};

export function DeleteConfirmationModal({
  title,
  entityName,
  onCancel,
  onConfirm,
  isProcessing = false,
  description = "This action cannot be undone.",
  confirmButtonLabel = "Delete",
  cancelButtonLabel = "Cancel",
  confirmationHint = "To confirm, type the exact name below.",
  inputLabel,
  children,
}: DeleteConfirmationModalProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hintId = useId();
  const inputId = useId();

  useEffect(() => {
    setValue("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [entityName]);

  const canConfirm = value.trim() === entityName && entityName.length > 0;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!isProcessing) onCancel();
      }
      if (event.key === "Enter" && canConfirm && !isProcessing) {
        event.preventDefault();
        onConfirm();
      }
    },
    [canConfirm, isProcessing, onCancel, onConfirm],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const effectiveInputLabel = inputLabel ?? (
    <span>
      Type <code>{entityName}</code>
    </span>
  );

  const defaultBody = !children ? (
    <p className="modal__danger-text">
      You are about to permanently delete <strong>{entityName}</strong>.
    </p>
  ) : null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={() => {
        if (!isProcessing) onCancel();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? `${descriptionId} ${hintId}` : hintId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <button type="button" className="modal__close" onClick={onCancel} disabled={isProcessing} aria-label="Close">
            ×
          </button>
        </header>

        <div className="modal__body">
          {defaultBody}
          {children}
          <p id={hintId}>{confirmationHint}</p>

          <div className="modal__input-group">
            <label htmlFor={inputId}>{effectiveInputLabel}</label>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={isProcessing}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="modal__actions">
            <button
              type="button"
              className="hosts-table__action-button"
              onClick={onCancel}
              disabled={isProcessing}
            >
              {cancelButtonLabel}
            </button>
            <button
              type="button"
              className="hosts-table__action-button hosts-table__action-button--danger"
              onClick={onConfirm}
              disabled={!canConfirm || isProcessing}
            >
              {isProcessing ? `${confirmButtonLabel}...` : confirmButtonLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
