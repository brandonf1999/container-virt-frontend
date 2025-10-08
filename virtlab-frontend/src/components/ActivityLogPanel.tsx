import { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useActivityLog } from "../hooks/useActivityLog";
import {
  DEFAULT_ACTIVITY_PANEL_HEIGHT,
  MAX_ACTIVITY_PANEL_HEIGHT,
  MIN_ACTIVITY_PANEL_HEIGHT,
} from "../state/activity-log";

function formatTimestamp(timestamp: number | string) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return String(timestamp);
  }
}

const statusLabel: Record<string, string> = {
  pending: "In progress",
  success: "Success",
  error: "Failed",
};

export function ActivityLogPanel() {
  const {
    entries,
    isOpen,
    toggleOpen,
    clearEntries,
    panelHeight,
    setPanelHeight,
    viewMode,
    setViewMode,
    systemLogs,
    systemLogState,
    systemLogError,
    retrySystemLogStream,
  } = useActivityLog();
  const [isResizing, setIsResizing] = useState(false);

  const isActivityMode = viewMode === "activity";
  const hasEntries = entries.length > 0;
  const recentEntries = useMemo(() => entries.slice(0, 25), [entries]);
  const recentSystemLogs = useMemo(() => systemLogs.slice(0, 150), [systemLogs]);
  const panelId = "activity-log-panel";

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (!isOpen) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = panelHeight;
      const { body } = document;
      const previousUserSelect = body.style.userSelect;

      setIsResizing(true);
      body.style.userSelect = "none";

      const updateHeight = (clientY: number) => {
        const delta = startY - clientY;
        setPanelHeight(startHeight + delta);
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateHeight(moveEvent.clientY);
      };

      const stopResizing = (endEvent: PointerEvent) => {
        updateHeight(endEvent.clientY);
        setIsResizing(false);
        body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResizing);
        window.removeEventListener("pointercancel", stopResizing);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResizing);
      window.addEventListener("pointercancel", stopResizing);
    },
    [isOpen, panelHeight, setPanelHeight],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isOpen) return;
      const step = 24;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPanelHeight(panelHeight + step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setPanelHeight(panelHeight - step);
      } else if (event.key === "Home") {
        event.preventDefault();
        setPanelHeight(MAX_ACTIVITY_PANEL_HEIGHT);
      } else if (event.key === "End") {
        event.preventDefault();
        setPanelHeight(MIN_ACTIVITY_PANEL_HEIGHT);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setPanelHeight(DEFAULT_ACTIVITY_PANEL_HEIGHT);
      }
    },
    [isOpen, panelHeight, setPanelHeight],
  );

  const handleDoubleClick = useCallback(() => {
    if (!isOpen) return;
    setPanelHeight(DEFAULT_ACTIVITY_PANEL_HEIGHT);
  }, [isOpen, setPanelHeight]);

  const panelStyle = useMemo(
    () =>
      ({
        height: isOpen ? panelHeight : 0,
        "--activity-panel-height": `${panelHeight}px`,
      } as CSSProperties & { "--activity-panel-height": string }),
    [isOpen, panelHeight],
  );

  return (
    <section
      id={panelId}
      className={`activity-panel${isOpen ? " activity-panel--open" : ""}${isResizing ? " activity-panel--resizing" : ""}`}
      aria-hidden={!isOpen}
      style={panelStyle}
    >
      <div
        className="activity-panel__handle"
        role="separator"
        aria-orientation="horizontal"
        aria-controls={panelId}
        aria-valuemin={MIN_ACTIVITY_PANEL_HEIGHT}
        aria-valuemax={MAX_ACTIVITY_PANEL_HEIGHT}
        aria-valuenow={Math.round(panelHeight)}
        tabIndex={isOpen ? 0 : -1}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onDoubleClick={handleDoubleClick}
      >
        <span className="activity-panel__handle-bar" aria-hidden="true" />
        <span className="sr-only">Drag to resize activity log</span>
      </div>
      <header className="activity-panel__header">
        <div>
          <h2>Activity log</h2>
          <p>Track recent actions and their outcomes.</p>
        </div>
        <div className="activity-panel__header-actions">
          <div className="activity-panel__switcher" role="tablist" aria-label="Activity log mode">
            <button
              type="button"
              role="tab"
              aria-selected={isActivityMode}
              className={`activity-panel__switch${isActivityMode ? " is-active" : ""}`}
              onClick={() => setViewMode("activity")}
            >
              User activity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isActivityMode}
              className={`activity-panel__switch${!isActivityMode ? " is-active" : ""}`}
              onClick={() => setViewMode("system")}
            >
              System logs
            </button>
          </div>
          <div className="activity-panel__controls">
            {isActivityMode && hasEntries && (
              <button
                type="button"
                className="activity-panel__clear"
                onClick={clearEntries}
                title="Clear activity log"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              className="activity-panel__collapse"
              onClick={() => toggleOpen(false)}
              aria-label="Hide activity log"
            >
              ×
            </button>
          </div>
        </div>
      </header>

      <div className="activity-panel__body">
        {isActivityMode ? (
          <>
            {!hasEntries && <div className="activity-panel__empty">No activity recorded yet.</div>}
            {hasEntries && (
              <ul className="activity-panel__list">
                {recentEntries.map((entry) => (
                  <li key={entry.id} className={`activity-panel__item activity-panel__item--${entry.status}`}>
                    <div className="activity-panel__meta">
                      <span className="activity-panel__status">{statusLabel[entry.status] ?? entry.status}</span>
                      <time dateTime={new Date(entry.timestamp).toISOString()}>{formatTimestamp(entry.timestamp)}</time>
                    </div>
                    <div className="activity-panel__content">
                      <strong>{entry.title}</strong>
                      {entry.detail && <p>{entry.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="activity-panel__system">
            {systemLogState === "connecting" && (
              <div className="activity-panel__notice">Connecting to system logs…</div>
            )}
            {systemLogState === "error" && (
              <div className="activity-panel__notice activity-panel__notice--error">
                <div>
                  <strong>Unable to stream system logs.</strong>
                  {systemLogError && <p>{systemLogError}</p>}
                </div>
                <button type="button" onClick={retrySystemLogStream} className="activity-panel__retry">
                  Retry
                </button>
              </div>
            )}
            {recentSystemLogs.length === 0 && systemLogState === "open" && (
              <div className="activity-panel__empty">No system logs received yet.</div>
            )}
            {recentSystemLogs.length > 0 && (
              <ul className="activity-panel__system-list">
                {recentSystemLogs.map((entry) => (
                  <li key={entry.id} className={`system-log system-log--${entry.level.toLowerCase()}`}>
                    <div className="system-log__meta">
                      <span className="system-log__level">{entry.level}</span>
                      <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
                      <span className="system-log__logger">{formatLoggerName(entry.logger)}</span>
                      {entry.component && (
                        <span className="system-log__component">{formatComponentLabel(entry.component)}</span>
                      )}
                    </div>
                    <div className="system-log__message">{entry.message}</div>
                    {entry.traceback && <pre className="system-log__traceback">{entry.traceback}</pre>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function formatLoggerName(name: string) {
  return name.replace(/^app\./, "").replace(/\./g, " › ");
}

function formatComponentLabel(component: string) {
  const friendly = component.replace(/[_-]+/g, " ");
  return friendly.charAt(0).toUpperCase() + friendly.slice(1);
}
