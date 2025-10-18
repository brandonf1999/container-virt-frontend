import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../api";
import type { ConsoleSession } from "../types";
import { useActivityLog } from "../hooks/useActivityLog";

type ConsoleStatus = "idle" | "connecting" | "connected" | "error" | "disconnected";

type ConsoleTarget = {
  host: string;
  name: string;
};

type ConsolePowerAction = "start" | "shutdown" | "reboot" | "force-off";

type ConsolePowerButton = {
  id: ConsolePowerAction;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: "danger";
};

type ConsolePowerControls = {
  actions: ConsolePowerButton[];
};

type ConsoleViewerModalProps = {
  isOpen: boolean;
  session: ConsoleSession | null;
  target: ConsoleTarget | null;
  onClose: () => void;
  powerControls?: ConsolePowerControls | null;
};

type RfbInstance = {
  viewOnly: boolean;
  scaleViewport: boolean;
  background: string;
  focusOnClick: boolean;
  dragViewport: boolean;
  disconnect: () => void;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
};

type RfbConstructor = new (target: HTMLElement, url: string, options: { credentials: { password: string } }) => RfbInstance;

declare global {
  interface Window {
    __virtlabRFB?: RfbConstructor;
  }
}

function buildConsoleWebSocketUrl(path: string): string | null {
  if (typeof window === "undefined") return null;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (!API_BASE_URL) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${normalizedPath}`;
  }

  try {
    const baseUrl = API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")
      ? new URL(API_BASE_URL)
      : new URL(API_BASE_URL, window.location.origin);
    baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    baseUrl.pathname = normalizedPath;
    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl.toString();
  } catch (error) {
    console.error("Failed to construct console WebSocket URL", error);
    return null;
  }
}

async function loadRfbClass(): Promise<RfbConstructor> {
  if (window.__virtlabRFB) {
    return window.__virtlabRFB;
  }
  const imported = await import("@novnc/novnc/lib/rfb.js");
  const moduleDefault = (imported as { default?: RfbConstructor }).default;
  const fallbackExport = (imported as { RFB?: RfbConstructor }).RFB;
  const RFBClass = moduleDefault ?? fallbackExport;
  if (!RFBClass) {
    throw new Error("noVNC RFB constructor unavailable");
  }
  window.__virtlabRFB = RFBClass;
  return RFBClass;
}

export function ConsoleViewerModal({ isOpen, session, target, onClose, powerControls }: ConsoleViewerModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const [status, setStatus] = useState<ConsoleStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { addEntry, updateEntry, openPanel } = useActivityLog();
  const sessionEntryRef = useRef<string | null>(null);
  const trackedTokenRef = useRef<string | null>(null);

  const targetLabel = useMemo(() => {
    if (!target) return "unknown";
    return `${target.name}@${target.host}`;
  }, [target]);

  const expiresInSeconds = useMemo(() => {
    if (!session) return null;
    const delta = Math.max(0, session.expires_at * 1000 - Date.now());
    return Math.ceil(delta / 1000);
  }, [session]);

  useEffect(() => {
    if (!isOpen) {
      setIsFullscreen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !session || !target) {
      sessionEntryRef.current = null;
      trackedTokenRef.current = null;
      return;
    }
    if (trackedTokenRef.current === session.token) {
      return;
    }
    trackedTokenRef.current = session.token;
    sessionEntryRef.current = addEntry({
      title: "Console session",
      detail: targetLabel,
      status: "pending",
      scope: "console",
    });
  }, [addEntry, isOpen, session, target, targetLabel]);

  useEffect(() => {
    if (!isOpen || !session || !target) {
      setStatus("idle");
      setError(null);
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch {
          /* noop */
        }
        if (containerRef.current) {
          containerRef.current.replaceChildren();
        }
        rfbRef.current = null;
      }
      return;
    }

    const activeSession = session;
    let cancelled = false;
    let disconnectHandler: ((event: Event) => void) | null = null;
    let connectHandler: ((event: Event) => void) | null = null;

    async function connectConsole() {
      setStatus("connecting");
      setError(null);

      const wsUrl = buildConsoleWebSocketUrl(activeSession.websocket_path);
      if (!wsUrl) {
        throw new Error("Unable to resolve console endpoint");
      }

      const canvas = containerRef.current;
      if (!canvas) {
        throw new Error("Console container unavailable");
      }

      const RFBClass = await loadRfbClass();
      if (cancelled) return;

      const rfbInstance = new RFBClass(canvas, wsUrl, {
        credentials: { password: activeSession.password },
      });
      rfbInstance.viewOnly = false;
      rfbInstance.scaleViewport = true;
      rfbInstance.background = "#000";
      rfbInstance.focusOnClick = true;
      rfbInstance.dragViewport = false;
      rfbRef.current = rfbInstance;

      connectHandler = () => {
        if (!cancelled) {
          setStatus("connected");
          if (sessionEntryRef.current) {
            updateEntry(sessionEntryRef.current, {
              status: "success",
              detail: `Console connected for ${targetLabel}`,
            });
          }
        }
      };
      disconnectHandler = (event: Event) => {
        if (cancelled) return;
        const detail = (event as CustomEvent<{ clean?: boolean; reason?: string }>).detail;
        if (detail?.reason) {
          setError(detail.reason);
          setStatus("error");
          if (sessionEntryRef.current) {
            updateEntry(sessionEntryRef.current, {
              status: "error",
              detail: `Console error for ${targetLabel}: ${detail.reason}`,
            });
          } else {
            addEntry({
              title: "Console error",
              detail: `${targetLabel}: ${detail.reason}`,
              status: "error",
              scope: "console",
            });
          }
          openPanel();
        } else if (detail?.clean === false) {
          setError("Console connection closed unexpectedly");
          setStatus("error");
          if (sessionEntryRef.current) {
            updateEntry(sessionEntryRef.current, {
              status: "error",
              detail: `Console disconnected unexpectedly for ${targetLabel}`,
            });
          } else {
            addEntry({
              title: "Console disconnected",
              detail: `${targetLabel} (unexpected)`,
              status: "error",
              scope: "console",
            });
          }
          openPanel();
        } else {
          setStatus("disconnected");
          if (sessionEntryRef.current) {
            updateEntry(sessionEntryRef.current, {
              status: "success",
              detail: `Console disconnected for ${targetLabel}`,
            });
          } else {
            addEntry({
              title: "Console disconnected",
              detail: targetLabel,
              status: "success",
              scope: "console",
            });
          }
        }
      };
      rfbInstance.addEventListener("connect", connectHandler);
      rfbInstance.addEventListener("disconnect", disconnectHandler);
    }

    connectConsole().catch((err) => {
      if (cancelled) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("error");
      if (sessionEntryRef.current) {
        updateEntry(sessionEntryRef.current, {
          status: "error",
          detail: `Console failed for ${targetLabel}: ${message}`,
        });
      } else {
        addEntry({
          title: "Console error",
          detail: `${targetLabel}: ${message}`,
          status: "error",
          scope: "console",
        });
      }
      openPanel();
    });

    return () => {
      cancelled = true;
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch {
          /* noop */
        }
        if (connectHandler) rfbRef.current.removeEventListener("connect", connectHandler);
        if (disconnectHandler) rfbRef.current.removeEventListener("disconnect", disconnectHandler);
        rfbRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.replaceChildren();
      }
    };
  }, [addEntry, isOpen, openPanel, session, target, targetLabel, updateEntry]);

  if (!isOpen) return null;

  const handleClose = () => {
    setIsFullscreen(false);
    if (sessionEntryRef.current) {
      updateEntry(sessionEntryRef.current, {
        status: status === "error" ? "error" : "success",
        detail:
          status === "error"
            ? `Console closed with errors for ${targetLabel}`
            : `Console closed for ${targetLabel}`,
      });
    } else if (target) {
      addEntry({
        title: "Console closed",
        detail: `${target.name}@${target.host}`,
        status: status === "error" ? "error" : "success",
        scope: "console",
      });
    }
    onClose();
  };

  const hasPowerControls = Boolean(powerControls && powerControls.actions.length > 0);
  const canvasKey = session?.token ?? (session === null ? "pending" : "idle");

  return (
    <div
      className={`modal-overlay${isFullscreen ? " modal-overlay--fullscreen" : ""}`}
      role="presentation"
      onClick={handleClose}
    >
      <div
        className={`modal modal--wide console-viewer__modal${isFullscreen ? " console-viewer__modal--fullscreen" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal__header console-viewer__header">
          <div>
            <h2>Console Viewer</h2>
            <p>
              {status === "connected" && "Connected"}
              {status === "connecting" && "Connecting to VNC console…"}
              {status === "error" && "Connection failed"}
              {status === "disconnected" && "Console disconnected"}
            </p>
          </div>
          <div className="console-viewer__header-actions">
            <button
              type="button"
              className="console-viewer__fullscreen-button"
              onClick={() => setIsFullscreen((current) => !current)}
              aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
            >
              {isFullscreen ? "Exit full screen" : "Full screen"}
            </button>
            <button type="button" className="modal__close" onClick={handleClose} aria-label="Close console viewer">
              ×
            </button>
          </div>
        </header>

        <div className="console-viewer__body">
          <div key={canvasKey} className="console-viewer__canvas" ref={containerRef} role="presentation">
            {!session && <div className="console-viewer__placeholder">Waiting for console session…</div>}
          </div>
          <aside className="console-viewer__sidebar">
            <div className="console-viewer__status">
              <strong>Status:</strong> {status}
            </div>
            {expiresInSeconds !== null && (
              <div className="console-viewer__status">Token expires in ~{expiresInSeconds}s</div>
            )}
            {hasPowerControls && powerControls && (
              <div className="console-viewer__power">
                <div className="console-viewer__power-title">Power controls</div>
                <div className="console-viewer__power-buttons">
                  {powerControls.actions.map(({ id, label, onSelect, disabled, tone }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={onSelect}
                      disabled={disabled}
                      className={`console-viewer__power-button${
                        tone === "danger" ? " console-viewer__power-button--danger" : ""
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="console-viewer__hint">
              Use keyboard and mouse inside the console. Press ESC to release the pointer, or close this panel to end the
              session.
            </p>
            {error && <div className="panel__status panel__status--error console-viewer__error">{error}</div>}
            <button type="button" onClick={handleClose} className="console-viewer__close-button">
              Close
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
