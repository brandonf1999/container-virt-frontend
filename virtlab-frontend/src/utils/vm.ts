export type VmStateIntent = "ok" | "warning" | "error" | "info";

const STATE_INTENTS: Record<string, VmStateIntent> = {
  running: "ok",
  blocked: "ok",
  paused: "warning",
  shutdown: "warning",
  shutoff: "warning",
  "in shutdown": "warning",
  "in reboot": "warning",
  "in poweroff": "warning",
  "in restart": "warning",
  crashed: "error",
};

export function classifyVmState(state?: string | null) {
  if (!state) {
    return { label: "--", intent: "info" as VmStateIntent };
  }
  const normalized = state.toLowerCase();
  const intent = STATE_INTENTS[normalized] ?? "info";
  const label = normalized
    .replace(/_/g, " ")
    .replace(/^(.)/, (match) => match.toUpperCase());
  return { label, intent };
}
