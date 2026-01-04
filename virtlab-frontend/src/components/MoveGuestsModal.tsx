import { useId } from "react";
import type { VirtualMachine } from "../types";

type MoveTarget = {
  host: string;
  vm: VirtualMachine;
};

type MoveGuestsModalProps = {
  isOpen: boolean;
  targets: MoveTarget[];
  availableHosts: string[];
  selectedHost: string;
  startAfterMove: boolean;
  isSubmitting: boolean;
  error?: string | null;
  onTargetHostChange: (value: string) => void;
  onStartAfterMoveChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function MoveGuestsModal({
  isOpen,
  targets,
  availableHosts,
  selectedHost,
  startAfterMove,
  isSubmitting,
  error,
  onTargetHostChange,
  onStartAfterMoveChange,
  onClose,
  onConfirm,
}: MoveGuestsModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const targetSelectId = useId();

  if (!isOpen) return null;

  const disableConfirm = isSubmitting || !selectedHost || availableHosts.length === 0;
  const summary =
    targets.length === 1 ? "Move the selected guest to another host." : `Move ${targets.length} guests to another host.`;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id={titleId}>Move guest{targets.length === 1 ? "" : "s"}</h2>
            <p id={descriptionId}>{summary}</p>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="modal__body">
          <div className="vm-move-modal__targets">
            <h3>Selected guest{targets.length === 1 ? "" : "s"}</h3>
            <ul className="vm-move-modal__list">
              {targets.map((target) => (
                <li key={`${target.host}:${target.vm.name}`}>
                  <span className="vm-move-modal__domain">{target.vm.name}</span>
                  <span className="vm-move-modal__host">{target.host}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="vm-move-modal__controls">
            <label htmlFor={targetSelectId}>Target host</label>
            <select
              id={targetSelectId}
              value={selectedHost}
              onChange={(event) => onTargetHostChange(event.target.value)}
              disabled={availableHosts.length === 0 || isSubmitting}
            >
              {availableHosts.length === 0 ? (
                <option value="">No hosts available</option>
              ) : (
                availableHosts.map((host) => (
                  <option key={host} value={host}>
                    {host}
                  </option>
                ))
              )}
            </select>
          </div>

          <label className="vm-move-form__checkbox">
            <input
              type="checkbox"
              checked={startAfterMove}
              onChange={(event) => onStartAfterMoveChange(event.target.checked)}
              disabled={isSubmitting}
            />
            Start after move
          </label>

          {availableHosts.length === 0 && (
            <div className="panel__status panel__status--error">No alternative hosts are available for migration.</div>
          )}

          {error && <div className="panel__status panel__status--error">{error}</div>}

          <div className="modal__actions">
            <button
              type="button"
              className="hosts-table__action-button"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="hosts-table__action-button"
              onClick={onConfirm}
              disabled={disableConfirm}
            >
              {isSubmitting ? "Moving…" : "Confirm Move"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
