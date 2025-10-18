import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { cloneGuestHost } from "../api";
import { useDomainDetails } from "../hooks/useDomainDetails";
import { formatDuration, formatMemory } from "../utils/formatters";
import { classifyVmState } from "../utils/vm";
import type { GuestCloneResponse } from "../types";

const MIN_NAME_LENGTH = 1;

function formatMemoryFromKiB(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return formatMemory(value / 1024);
}

type CloneGuestModalProps = {
  isOpen: boolean;
  sourceHost: string;
  sourceName: string;
  hosts: string[];
  onClose: () => void;
  onCloned: (result: GuestCloneResponse) => void;
  onBusyChange?: (busy: boolean) => void;
};

export function CloneGuestModal({
  isOpen,
  sourceHost,
  sourceName,
  hosts,
  onClose,
  onCloned,
  onBusyChange,
}: CloneGuestModalProps) {
  const { details, isLoading, error } = useDomainDetails(sourceHost, sourceName);
  const [targetHost, setTargetHost] = useState(sourceHost);
  const [name, setName] = useState(`${sourceName}-clone`);
  const [autostart, setAutostart] = useState(false);
  const [startAfterClone, setStartAfterClone] = useState(false);
  const [description, setDescription] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTargetHost(sourceHost);
      setName(`${sourceName}-clone`);
      setAutostart(Boolean(details?.autostart));
      setStartAfterClone(false);
      setDescription("");
      setFormError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, sourceHost, sourceName, details?.autostart]);

  useEffect(() => {
    onBusyChange?.(isSubmitting);
  }, [isSubmitting, onBusyChange]);

  const normalizedState = useMemo(() => {
    const dominfoState = typeof details?.dominfo?.state === "number" ? details.dominfo.state : undefined;
    const state = details?.state ?? dominfoState;
    return state == null ? "" : String(state).toLowerCase();
  }, [details?.state, details?.dominfo]);

  const stateMeta = useMemo(() => classifyVmState(details?.state), [details?.state]);
  const isRunning = normalizedState === "running" || normalizedState === "blocked";

  const dominfo = (details?.dominfo ?? null) as Record<string, number> | null;
  const vcpuCount = dominfo && typeof dominfo.nrVirtCpu === "number" ? dominfo.nrVirtCpu : null;
  const memoryCurrent = dominfo && typeof dominfo.memory === "number" ? dominfo.memory : null;
  const cpuTime = dominfo && typeof dominfo.cpuTime === "number" ? dominfo.cpuTime : null;

  const disableSubmit =
    !name.trim() ||
    name.trim().length < MIN_NAME_LENGTH ||
    isRunning ||
    isSubmitting;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (disableSubmit) return;
      setIsSubmitting(true);
      setFormError(null);
      try {
        const payload = {
          name: name.trim(),
          autostart,
          start: startAfterClone,
          description: description.trim() ? description.trim() : null,
          target_host: targetHost,
        };
        const result = await cloneGuestHost(sourceHost, sourceName, payload);
        onCloned(result);
        setIsSubmitting(false);
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setFormError(message);
        setIsSubmitting(false);
      }
    },
    [disableSubmit, autostart, description, name, onCloned, onClose, sourceHost, sourceName, startAfterClone, targetHost],
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clone-guest-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal__header">
          <div>
            <h2 id="clone-guest-title">Clone Guest Host</h2>
            <p>
              Duplicate <strong>{sourceName}</strong> on <strong>{sourceHost}</strong> with deep-copied disks and fresh network identities.
            </p>
          </div>
          <button type="button" className="modal__close" onClick={onClose} disabled={isSubmitting} aria-label="Close">
            ×
          </button>
        </header>

        <form className="modal__body" onSubmit={handleSubmit}>
          <div className="modal__section">
            <h3 className="modal__section-title">Source Summary</h3>
            {isLoading && <div className="panel__status">Loading source details…</div>}
            {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
            {!isLoading && !error && (
              <div className="summary-grid">
                <div>
                  <span className={`status-pill status-pill--${stateMeta.intent}`}>{stateMeta.label}</span>
                  <div className="summary-grid__label">State</div>
                </div>
                <div>
                  <div className="summary-grid__value">{vcpuCount ?? "--"}</div>
                  <div className="summary-grid__label">vCPUs</div>
                </div>
                <div>
                  <div className="summary-grid__value">{formatMemoryFromKiB(memoryCurrent)}</div>
                  <div className="summary-grid__label">Memory</div>
                </div>
                <div>
                  <div className="summary-grid__value">
                    {cpuTime != null ? formatDuration(cpuTime / 1_000_000_000) : "--"}
                  </div>
                  <div className="summary-grid__label">CPU Time</div>
                </div>
              </div>
            )}
            {isRunning && (
              <div className="panel__status panel__status--warning">
                Power off the source guest before cloning. Runtime cloning is not supported.
              </div>
            )}
            <div className="panel__status panel__status--note">
              The clone process performs a full copy of each disk volume, assigns new MAC addresses to all
              interfaces, and generates a new console password.
            </div>
          </div>

          <div className="modal__section">
            <div className="modal__field">
              <label htmlFor="clone-host-select">Target Host</label>
              <select
                id="clone-host-select"
                value={targetHost}
                onChange={(event) => setTargetHost(event.target.value)}
                disabled
              >
                {hosts.map((host) => (
                  <option key={host} value={host}>
                    {host} {host !== sourceHost ? "(unsupported)" : ""}
                  </option>
                ))}
              </select>
              <p className="modal__field-note">Cross-host cloning is not yet available.</p>
            </div>

            <div className="modal__field">
              <label htmlFor="clone-name-input">Clone Name</label>
              <input
                id="clone-name-input"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={`${sourceName}-clone`}
                required
              />
            </div>

            <div className="modal__field">
              <label htmlFor="clone-description-input">Description</label>
              <textarea
                id="clone-description-input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional description override"
              />
            </div>

            <label className="modal__checkbox">
              <input
                type="checkbox"
                checked={autostart}
                onChange={(event) => setAutostart(event.target.checked)}
                disabled={isSubmitting}
              />
              Enable autostart on boot
            </label>

            <label className="modal__checkbox">
              <input
                type="checkbox"
                checked={startAfterClone}
                onChange={(event) => setStartAfterClone(event.target.checked)}
                disabled={isSubmitting}
              />
              Power on immediately after cloning
            </label>
          </div>

          {formError && <div className="panel__status panel__status--error">{formError}</div>}

          <footer className="modal__footer">
            <button type="button" className="link-button" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" disabled={disableSubmit}>
              {isSubmitting ? "Cloning…" : "Clone Guest"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
