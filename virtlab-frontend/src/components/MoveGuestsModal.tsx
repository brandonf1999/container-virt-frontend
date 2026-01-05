import { useId } from "react";
import type { VirtualMachine } from "../types";

type MigrationTarget = {
  host: string;
  vm: VirtualMachine;
};

type MoveGuestsModalProps = {
  isOpen: boolean;
  targets: MigrationTarget[];
  availableHosts: string[];
  selectedHost: string;
  actionLabel?: string;
  actionProgressLabel?: string;
  migrationMode: "live" | "cold";
  startAfterMigration: boolean;
  isSubmitting: boolean;
  error?: string | null;
  onTargetHostChange: (value: string) => void;
  onMigrationModeChange: (value: "live" | "cold") => void;
  onStartAfterMigrationChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function MoveGuestsModal({
  isOpen,
  targets,
  availableHosts,
  selectedHost,
  actionLabel,
  actionProgressLabel,
  migrationMode,
  startAfterMigration,
  isSubmitting,
  error,
  onTargetHostChange,
  onMigrationModeChange,
  onStartAfterMigrationChange,
  onClose,
  onConfirm,
}: MoveGuestsModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const targetSelectId = useId();
  const modeSelectId = useId();

  if (!isOpen) return null;

  const action = actionLabel ?? "Migrate";
  const progressLabel = actionProgressLabel ?? "Migrating…";
  const disableConfirm = isSubmitting || !selectedHost || availableHosts.length === 0;
  const summary =
    targets.length === 1
      ? `${action} the selected guest to another host.`
      : `${action} ${targets.length} guests to another host.`;

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
            <h2 id={titleId}>
              {action} guest{targets.length === 1 ? "" : "s"}
            </h2>
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

          <div className="vm-move-modal__controls">
            <label htmlFor={modeSelectId}>Migration mode</label>
            <select
              id={modeSelectId}
              value={migrationMode}
              onChange={(event) => onMigrationModeChange(event.target.value as "live" | "cold")}
              disabled={isSubmitting}
            >
              <option value="live">Live (shared storage required)</option>
              <option value="cold">Cold (shutdown + define)</option>
            </select>
            <div className="modal__field-note">
              Live migration keeps the guest running and requires shared storage on both hosts.
            </div>
          </div>

          <label className="vm-move-form__checkbox">
            <input
              type="checkbox"
              checked={startAfterMigration}
              onChange={(event) => onStartAfterMigrationChange(event.target.checked)}
              disabled={isSubmitting}
            />
            Start after migration if the guest is stopped
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
              {isSubmitting ? progressLabel : `Confirm ${action}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
