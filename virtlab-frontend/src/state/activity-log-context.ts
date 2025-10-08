import { createContext } from "react";

export type ActivityStatus = "pending" | "success" | "error";

export type ActivityLogViewMode = "activity" | "system";

export type SystemLogEntry = {
  id: string;
  type: "log";
  timestamp: string;
  level: string;
  logger: string;
  message: string;
  source?: string;
  component?: string;
  traceback?: string;
};

export type SystemLogConnectionState = "idle" | "connecting" | "open" | "error";

export type ActivityEntry = {
  id: string;
  title: string;
  status: ActivityStatus;
  detail?: string | null;
  scope?: string | null;
  timestamp: number;
};

export type ActivityEntryInput = {
  id?: string;
  title: string;
  status?: ActivityStatus;
  detail?: string | null;
  scope?: string | null;
};

export type ActivityLogContextValue = {
  entries: ActivityEntry[];
  isOpen: boolean;
  toggleOpen: (nextState?: boolean) => void;
  openPanel: () => void;
  closePanel: () => void;
  panelHeight: number;
  setPanelHeight: (height: number) => void;
  viewMode: ActivityLogViewMode;
  setViewMode: (mode: ActivityLogViewMode) => void;
  systemLogs: SystemLogEntry[];
  systemLogState: SystemLogConnectionState;
  systemLogError: string | null;
  retrySystemLogStream: () => void;
  addEntry: (entry: ActivityEntryInput) => string;
  updateEntry: (id: string, update: Partial<Omit<ActivityEntry, "id" | "timestamp">> & { status?: ActivityStatus }) => void;
  clearEntries: () => void;
};

export const ActivityLogContext = createContext<ActivityLogContextValue | undefined>(undefined);
