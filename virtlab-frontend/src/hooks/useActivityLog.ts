import { useContext } from "react";
import { ActivityLogContext } from "../state/activity-log-context";

export function useActivityLog() {
  const context = useContext(ActivityLogContext);
  if (!context) {
    throw new Error("useActivityLog must be used within an ActivityLogProvider");
  }
  return context;
}
