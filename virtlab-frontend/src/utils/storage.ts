export function getVolumeStateMeta(state?: string | null) {
  const normalized = (state ?? "").toLowerCase();
  switch (normalized) {
    case "available":
      return { label: "Available", intent: "ok" } as const;
    case "in-use":
      return { label: "In Use", intent: "info" } as const;
    case "error":
      return { label: "Error", intent: "error" } as const;
    case "unknown":
      return { label: "Unknown", intent: "muted" } as const;
    default: {
      if (!state) {
        return { label: "--", intent: "muted" } as const;
      }
      const cleaned = state.replace(/_/g, " ");
      const label = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      return { label, intent: "muted" } as const;
    }
  }
}
