import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityLogContext,
  type ActivityLogContextValue,
  type ActivityEntry,
  type ActivityEntryInput,
  type ActivityStatus,
  type ActivityLogViewMode,
  type SystemLogEntry,
  type SystemLogConnectionState,
} from "./activity-log-context";
import { API_BASE_URL } from "../api";

const MAX_ENTRIES = 50;
const SYSTEM_LOG_LIMIT = 400;

export const DEFAULT_ACTIVITY_PANEL_HEIGHT = 320;
export const MIN_ACTIVITY_PANEL_HEIGHT = 200;
export const MAX_ACTIVITY_PANEL_HEIGHT = 560;

const clampHeight = (next: number) =>
  Math.min(MAX_ACTIVITY_PANEL_HEIGHT, Math.max(MIN_ACTIVITY_PANEL_HEIGHT, next));

const LOG_STREAM_ENDPOINT = "/api/logs/stream";

function createLogStreamUrl(): string | null {
  if (typeof window === "undefined") return null;

  if (!API_BASE_URL) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${LOG_STREAM_ENDPOINT}`;
  }

  try {
    const baseUrl = API_BASE_URL.startsWith("http://") || API_BASE_URL.startsWith("https://")
      ? new URL(API_BASE_URL)
      : new URL(API_BASE_URL, window.location.origin);
    baseUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
    baseUrl.pathname = LOG_STREAM_ENDPOINT;
    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl.toString();
  } catch {
    return null;
  }
}

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function ActivityLogProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [panelHeight, setPanelHeightState] = useState(DEFAULT_ACTIVITY_PANEL_HEIGHT);
  const [viewMode, setViewModeState] = useState<ActivityLogViewMode>("activity");
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [systemLogState, setSystemLogState] = useState<SystemLogConnectionState>("idle");
  const [systemLogError, setSystemLogError] = useState<string | null>(null);
  const systemSocketRef = useRef<WebSocket | null>(null);
  const manualCloseRef = useRef(false);

  const appendSystemLog = useCallback((entry: SystemLogEntry) => {
    const source = entry.source ?? (entry.logger.includes("libvirt") ? "libvirt" : "system");
    if (source !== "libvirt") {
      return;
    }
    setSystemLogs((prev) => [entry, ...prev].slice(0, SYSTEM_LOG_LIMIT));
  }, []);

  const setViewMode = useCallback(
    (mode: ActivityLogViewMode) => {
      setViewModeState(mode);
    },
    [],
  );

  const clearSystemSocket = useCallback(() => {
    const socket = systemSocketRef.current;
    if (!socket) return;
    manualCloseRef.current = true;
    try {
      socket.close();
    } catch {
      /* noop */
    }
    systemSocketRef.current = null;
    setSystemLogState("idle");
  }, []);

  const handleSystemMessage = useCallback(
    (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as Partial<SystemLogEntry & { type?: string; reason?: string }>;
        if (payload?.type !== "log" || !payload.id) {
          return;
        }
        const entry: SystemLogEntry = {
          id: payload.id,
          type: "log",
          timestamp: payload.timestamp ?? new Date().toISOString(),
          level: payload.level ?? "INFO",
          logger: payload.logger ?? "backend",
          message: payload.message ?? "",
          source: payload.source,
          component: payload.component,
          traceback: payload.traceback,
        };
        appendSystemLog(entry);
      } catch (error) {
        console.warn("Failed to parse system log payload", error);
      }
    },
    [appendSystemLog],
  );

  const connectSystemLogs = useCallback(() => {
    if (systemSocketRef.current || systemLogState === "connecting") return;
    const url = createLogStreamUrl();
    if (!url) {
      setSystemLogState("error");
      setSystemLogError("Unable to resolve system log endpoint");
      return;
    }

    try {
      const socket = new WebSocket(url);
      systemSocketRef.current = socket;
      manualCloseRef.current = false;
      setSystemLogState("connecting");
      setSystemLogError(null);

      socket.addEventListener("open", () => {
        setSystemLogState("open");
      });

      socket.addEventListener("message", handleSystemMessage);

      socket.addEventListener("error", (event) => {
        console.error("System log stream error", event);
        setSystemLogState("error");
        setSystemLogError("System log stream error");
      });

      socket.addEventListener("close", (event) => {
        socket.removeEventListener("message", handleSystemMessage);
        if (systemSocketRef.current === socket) {
          systemSocketRef.current = null;
        }

        if (manualCloseRef.current) {
          manualCloseRef.current = false;
          setSystemLogState("idle");
          return;
        }

        setSystemLogState("error");
        let message = event.reason || "System log stream closed";
        if (!event.reason && (event.code === 1006 || event.code === 1002)) {
          message = "WebSocket upgrade failed; ensure the backend is running with websocket support (e.g. uvicorn[standard]).";
        }
        setSystemLogError(message);
      });
    } catch (error) {
      console.error("Failed to open system log stream", error);
      setSystemLogState("error");
      setSystemLogError(error instanceof Error ? error.message : "Failed to open system log stream");
    }
  }, [handleSystemMessage, systemLogState]);

  useEffect(() => {
    if (viewMode === "system" && systemLogState === "idle" && !systemSocketRef.current) {
      connectSystemLogs();
    }
  }, [connectSystemLogs, systemLogState, viewMode]);

  useEffect(() => () => {
    clearSystemSocket();
  }, [clearSystemSocket]);

  const retrySystemLogStream = useCallback(() => {
    clearSystemSocket();
    setSystemLogError(null);
    setSystemLogState("idle");
    connectSystemLogs();
  }, [clearSystemSocket, connectSystemLogs]);

  const addEntry = useCallback((entry: ActivityEntryInput) => {
    const id = entry.id ?? generateId();
    const status = entry.status ?? "pending";
    const record: ActivityEntry = {
      id,
      title: entry.title,
      status,
      detail: entry.detail,
      scope: entry.scope,
      timestamp: Date.now(),
    };
    setEntries((prev) => [record, ...prev].slice(0, MAX_ENTRIES));
    return id;
  }, []);

  const updateEntry = useCallback(
    (id: string, update: Partial<Omit<ActivityEntry, "id" | "timestamp">> & { status?: ActivityStatus }) => {
      setEntries((prev) =>
        prev.map((entry) => {
          if (entry.id !== id) return entry;
          const nextStatus = update.status ?? entry.status;
          return {
            ...entry,
            ...update,
            status: nextStatus,
            timestamp: Date.now(),
          };
        }),
      );
    },
    [],
  );

  const toggleOpen = useCallback((nextState?: boolean) => {
    if (typeof nextState === "boolean") {
      setIsOpen(nextState);
    } else {
      setIsOpen((prev) => !prev);
    }
  }, []);

  const openPanel = useCallback(() => setIsOpen(true), []);
  const closePanel = useCallback(() => setIsOpen(false), []);

  const clearEntries = useCallback(() => {
    setEntries([]);
  }, []);

  const setPanelHeight = useCallback((height: number) => {
    setPanelHeightState(clampHeight(Math.round(height)));
  }, []);

  const value = useMemo<ActivityLogContextValue>(
    () => ({
      entries,
      isOpen,
      toggleOpen,
      openPanel,
      closePanel,
      panelHeight,
      setPanelHeight,
      viewMode,
      setViewMode,
      systemLogs,
      systemLogState,
      systemLogError,
      retrySystemLogStream,
      addEntry,
      updateEntry,
      clearEntries,
    }),
    [
      addEntry,
      clearEntries,
      closePanel,
      entries,
      isOpen,
      openPanel,
      panelHeight,
      retrySystemLogStream,
      setPanelHeight,
      setViewMode,
      systemLogError,
      systemLogState,
      systemLogs,
      toggleOpen,
      updateEntry,
      viewMode,
    ],
  );

  return <ActivityLogContext.Provider value={value}>{children}</ActivityLogContext.Provider>;
}
