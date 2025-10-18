import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useClusterVms } from "../hooks/useClusterVms";
import { formatDuration, formatMemory } from "../utils/formatters";
import { classifyVmState } from "../utils/vm";
import { controlDomain, createConsoleSession, deleteGuestHost } from "../api";
import type { ConsoleSession, VirtualMachine } from "../types";
import { ColumnSelector, useTableState } from "../utils/table";
import type { TableColumn } from "../utils/table";
import { useActivityLog } from "../hooks/useActivityLog";
import { CreateGuestModal } from "../components/CreateGuestModal";
import { CloneGuestModal } from "../components/CloneGuestModal";
import { DeleteConfirmationModal } from "../components/DeleteConfirmationModal";
import { ConsoleViewerModal } from "../components/ConsoleViewerModal";

type PowerAction = "start" | "shutdown" | "reboot" | "force-off";

type PendingActionMeta = {
  action: PowerAction;
  startedAt: number;
  seenIntermediate?: boolean;
  baselineUptime?: number | null;
};

const VM_RUNNING_STATES = new Set(["running", "blocked"]);
const VM_STOPPED_STATES = new Set(["shutoff", "shutdown"]);
const REBOOT_COMPLETION_FALLBACK_MS = 25_000;
const REBOOT_UPTIME_THRESHOLD_SECONDS = 10;

function vmKey(host: string, name: string) {
  return `${host}:${name}`;
}

function normalizeVmState(state?: string | null) {
  return (state ?? "").toLowerCase();
}

function isRunningState(state: string) {
  return VM_RUNNING_STATES.has(state);
}

function isStoppedState(state: string) {
  return VM_STOPPED_STATES.has(state);
}

function isTransitionalState(state: string) {
  return state.startsWith("in ");
}

const EMPTY_STATE = "No guest hosts reported yet.";

function renderMemory(currentMb?: number | null, maxMb?: number | null) {
  const current = formatMemory(currentMb ?? null);
  const max = formatMemory(maxMb ?? null);
  if (current === "--" && max === "--") return "--";
  if (max !== "--") {
    return `${current} / ${max}`;
  }
  return current;
}

function computeDisplayUptime(vm: VirtualMachine, now: number) {
  const base =
    vm.displayUptimeSeconds ?? vm.metrics?.uptime_seconds ?? vm.metrics?.cpu_time_seconds ?? null;
  if (base === undefined || base === null) return null;
  const state = normalizeVmState(vm.state);
  if (isRunningState(state) && vm.fetchedAt) {
    const deltaSeconds = (now - vm.fetchedAt) / 1000;
    if (deltaSeconds > 0) {
      return base + deltaSeconds;
    }
  }
  return base;
}

function filterGuestIps(values?: string[] | null): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((ip) => (typeof ip === "string" ? ip.trim() : ""))
    .filter((ip) => {
      if (!ip) return false;
      if (ip.startsWith("127.")) return false;
      if (ip === "::1") return false;
      if (ip.toLowerCase().startsWith("::ffff:127.")) return false;
      return true;
    });
}

function renderUptime(vm: VirtualMachine, now: number) {
  const value = computeDisplayUptime(vm, now);
  return formatDuration(value);
}

export function GuestHostsPage() {
  const { hosts, summary, errors, isLoading, error, refresh } = useClusterVms();
  const { addEntry, updateEntry, openPanel } = useActivityLog();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  type VmRow = {
    host: string;
    vm: VirtualMachine;
  };

  const vmRows = useMemo(() => {
    const rows: VmRow[] = [];
    Object.entries(hosts).forEach(([hostname, inventory]) => {
      inventory.vms.forEach((vm) => {
        rows.push({ host: hostname, vm });
      });
    });
    return rows.sort((a, b) => {
      if (a.host === b.host) {
        return a.vm.name.localeCompare(b.vm.name);
      }
      return a.host.localeCompare(b.host);
    });
  }, [hosts]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [pendingActions, setPendingActions] = useState<Record<string, PendingActionMeta>>({});
  const [lastForceOff, setLastForceOff] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ host: string; vm: VirtualMachine } | null>(null);
  const [removeStorage, setRemoveStorage] = useState(false);
  const [isDeletingGuest, setIsDeletingGuest] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [consoleSession, setConsoleSession] = useState<ConsoleSession | null>(null);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [consoleTarget, setConsoleTarget] = useState<{ host: string; name: string } | null>(null);
  const [shouldReconnectConsole, setShouldReconnectConsole] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<{ host: string; vm: VirtualMachine } | null>(null);
  const [isCloning, setIsCloning] = useState(false);

  const consoleVm = useMemo(() => {
    if (!consoleTarget) return null;
    const inventory = hosts[consoleTarget.host];
    if (!inventory) return null;
    return inventory.vms.find((vm) => vm.name === consoleTarget.name) ?? null;
  }, [consoleTarget, hosts]);

  const vmColumns = useMemo<TableColumn<VmRow>[]>(
    () => [
      {
        id: "state",
        label: "State",
        sortable: true,
        sortAccessor: ({ vm }) => (vm.state ?? "").toLowerCase(),
        renderCell: ({ host, vm }) => {
          const key = vmKey(host, vm.name);
          const pending = pendingActions[key];
          const base = classifyVmState(vm.state);

          if (pending) {
            const pendingLabelMap: Record<PowerAction, { label: string; intent: string }> = {
              start: { label: "Powering on", intent: "warning" },
              shutdown: { label: "Shutting down", intent: "warning" },
              reboot: { label: "Rebooting", intent: "warning" },
              "force-off": { label: "Force stopping", intent: "error" },
            };
            const override = pendingLabelMap[pending.action];
            if (override) {
              return <span className={`status-pill status-pill--${override.intent}`}>{override.label}</span>;
            }
          }

          return <span className={`status-pill status-pill--${base.intent}`}>{base.label}</span>;
        },
      },
      {
        id: "name",
        label: "Name",
        sortable: true,
        sortAccessor: ({ vm }) => vm.name ?? "",
        renderCell: ({ host, vm }) => (
          <div className="hosts-table__primary">
            <Link
              to={`/guest-hosts/${encodeURIComponent(host)}/${encodeURIComponent(vm.name)}`}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {vm.name}
            </Link>
          </div>
        ),
      },
      {
        id: "host",
        label: "Host",
        sortable: true,
        sortAccessor: ({ host }) => host,
        renderCell: ({ host }) => host,
      },
      {
        id: "ip",
        label: "IP Address",
        sortable: true,
        sortAccessor: ({ vm }) => {
          const ips = filterGuestIps(vm.guest_agent_ips);
          if (!ips.length) return "";
          const ipv4 = ips.find((ip) => ip.includes("."));
          return ipv4 ?? ips[0];
        },
        renderCell: ({ vm }) => {
          const ips = filterGuestIps(vm.guest_agent_ips);
          if (ips.length === 0) return "--";
          if (ips.length === 1) return ips[0];
          const [primary, ...rest] = ips;
          return `${primary} (+${rest.length} more)`;
        },
      },
      {
        id: "vcpus",
        label: "vCPUs",
        sortable: true,
        sortAccessor: ({ vm }) => vm.metrics?.vcpu_count ?? null,
        renderCell: ({ vm }) => vm.metrics?.vcpu_count ?? "--",
      },
      {
        id: "memory",
        label: "Memory",
        sortable: true,
        sortAccessor: ({ vm }) => vm.metrics?.memory_mb ?? null,
        renderCell: ({ vm }) => renderMemory(vm.metrics?.memory_mb, vm.metrics?.max_memory_mb),
      },
      {
        id: "uptime",
        label: "Uptime",
        sortable: true,
        sortAccessor: ({ vm }) =>
          vm.displayUptimeSeconds ?? vm.metrics?.uptime_seconds ?? vm.metrics?.cpu_time_seconds ?? null,
        renderCell: ({ vm }) => renderUptime(vm, now),
      },
      {
        id: "persistent",
        label: "Persistent",
        sortable: true,
        sortAccessor: ({ vm }) => (vm.persistent === undefined || vm.persistent === null ? null : vm.persistent ? 1 : 0),
        renderCell: ({ vm }) => (vm.persistent === undefined || vm.persistent === null ? "--" : vm.persistent ? "Yes" : "No"),
      },
    ],
    [now, pendingActions],
  );

  const toggleSelection = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedCount = selected.size;

  const selectedVmLabels = useMemo(() => {
    if (selectedCount === 0) return [] as string[];
    return vmRows
      .filter(({ host, vm }) => selected.has(vmKey(host, vm.name)))
      .map(({ host, vm }) => `${vm.name}@${host}`);
  }, [selected, selectedCount, vmRows]);

  const selectedTargets = useMemo(() => {
    if (selected.size === 0) return [] as Array<{ host: string; vm: VirtualMachine }>;
    return vmRows.filter(({ host, vm }) => selected.has(vmKey(host, vm.name)));
  }, [selected, vmRows]);

  useEffect(() => {
    if (!Object.keys(pendingActions).length) return;

    const infoMap = new Map<
      string,
      {
        state: string;
        uptimeSeconds?: number | null;
      }
    >();
    vmRows.forEach(({ host, vm }) => {
      infoMap.set(vmKey(host, vm.name), {
        state: normalizeVmState(vm.state),
        uptimeSeconds: computeDisplayUptime(vm, now),
      });
    });

    const timestamp = Date.now();
    setPendingActions((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([key, meta]) => {
        const info = infoMap.get(key);
        if (!info) {
          delete next[key];
          changed = true;
          return;
        }
        const { state, uptimeSeconds } = info;

        if (meta.action === "reboot") {
          if (!isRunningState(state)) {
            if (!meta.seenIntermediate) {
              next[key] = { ...meta, seenIntermediate: true };
              changed = true;
            }
            return;
          }
          let rebootCompleted = false;
          if (typeof meta.baselineUptime === "number" && typeof uptimeSeconds === "number") {
            const uptimeDelta = meta.baselineUptime - uptimeSeconds;
            if (uptimeDelta > REBOOT_UPTIME_THRESHOLD_SECONDS) {
              rebootCompleted = true;
            }
          }
          if (
            meta.seenIntermediate ||
            rebootCompleted ||
            timestamp - meta.startedAt > REBOOT_COMPLETION_FALLBACK_MS
          ) {
            delete next[key];
            changed = true;
          }
          return;
        }

        if (meta.action === "start" && isRunningState(state)) {
          delete next[key];
          changed = true;
          return;
        }

        if ((meta.action === "shutdown" || meta.action === "force-off") && isStoppedState(state)) {
          delete next[key];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [now, pendingActions, vmRows]);

  useEffect(() => {
    if (lastForceOff === null) return;
    const timer = window.setTimeout(() => setLastForceOff(null), 3000);
    return () => window.clearTimeout(timer);
  }, [lastForceOff]);

  useEffect(() => {
    if (!deleteTarget || isDeletingGuest) return;
    const key = vmKey(deleteTarget.host, deleteTarget.vm.name);
    if (!selected.has(key)) {
      setDeleteTarget(null);
      setRemoveStorage(false);
    }
  }, [deleteTarget, isDeletingGuest, selected]);

  const canStart =
    selectedTargets.length > 0 &&
    selectedTargets.every(({ host, vm }) => {
      const key = vmKey(host, vm.name);
      if (pendingActions[key]) return false;
      const state = normalizeVmState(vm.state);
      if (isTransitionalState(state)) return false;
      if (isRunningState(state)) return false;
      return isStoppedState(state) || state === "crashed";
    });

  const canShutdown =
    selectedTargets.length > 0 &&
    selectedTargets.every(({ host, vm }) => {
      const key = vmKey(host, vm.name);
      if (pendingActions[key]) return false;
      const state = normalizeVmState(vm.state);
      if (isTransitionalState(state)) return false;
      return isRunningState(state) || state === "paused";
    });

  const canReboot =
    selectedTargets.length > 0 &&
    selectedTargets.every(({ host, vm }) => {
      const key = vmKey(host, vm.name);
      if (pendingActions[key]) return false;
      const state = normalizeVmState(vm.state);
      if (isTransitionalState(state)) return false;
      return isRunningState(state);
    });

  const forceOffRateLimited = lastForceOff !== null;
  const canForceOff =
    selectedTargets.length > 0 &&
    !forceOffRateLimited &&
    selectedTargets.every(({ host, vm }) => {
      const key = vmKey(host, vm.name);
      const pending = pendingActions[key];
      if (pending && pending.action !== "shutdown") return false;
      const state = normalizeVmState(vm.state);
      if (isStoppedState(state)) return false;
      return true;
    });

  const canDeleteGuest =
    selectedTargets.length === 1 &&
    (() => {
      const target = selectedTargets[0];
      const key = vmKey(target.host, target.vm.name);
      if (pendingActions[key]) return false;
      return true;
    })();

  const canClone =
    selectedTargets.length === 1 &&
    (() => {
      const target = selectedTargets[0];
      const key = vmKey(target.host, target.vm.name);
      if (pendingActions[key]) return false;
      const state = normalizeVmState(target.vm.state);
      if (isTransitionalState(state)) return false;
      return !isRunningState(state);
    })();

  const canConnect =
    selectedTargets.length === 1 &&
    (() => {
      const target = selectedTargets[0];
      const key = vmKey(target.host, target.vm.name);
      if (pendingActions[key]) return false;
      const state = normalizeVmState(target.vm.state);
      if (isTransitionalState(state)) return false;
      return isRunningState(state);
    })();

  const isBusy = isActing || isDeletingGuest || isConnecting || isCloning;

  const consolePowerPermissions = useMemo<Record<PowerAction, boolean> | null>(() => {
    if (!consoleTarget || !consoleVm) return null;
    const key = vmKey(consoleTarget.host, consoleTarget.name);
    const pending = pendingActions[key];
    const state = normalizeVmState(consoleVm.state);
    const transitional = isTransitionalState(state);
    const blocked = isActing || isDeletingGuest;

    const canStartSingle =
      !blocked &&
      !pending &&
      !transitional &&
      !isRunningState(state) &&
      (isStoppedState(state) || state === "crashed");
    const canShutdownSingle =
      !blocked &&
      !pending &&
      !transitional &&
      (isRunningState(state) || state === "paused");
    const canRebootSingle = !blocked && !pending && !transitional && isRunningState(state);
    const canForceOffSingle =
      !blocked &&
      !forceOffRateLimited &&
      (!pending || pending.action === "shutdown") &&
      !isStoppedState(state);

    return {
      start: canStartSingle,
      shutdown: canShutdownSingle,
      reboot: canRebootSingle,
      "force-off": canForceOffSingle,
    };
  }, [consoleTarget, consoleVm, forceOffRateLimited, isActing, isDeletingGuest, pendingActions]);

  const actionPermissions = useMemo<Record<PowerAction, boolean>>(
    () => ({
      start: canStart,
      shutdown: canShutdown,
      reboot: canReboot,
      "force-off": canForceOff,
    }),
    [canForceOff, canReboot, canShutdown, canStart],
  );

  const handleAction = useCallback(
    async (action: PowerAction) => {
      if (!selectedCount || isActing || isDeletingGuest) return;

      if (!actionPermissions[action as keyof typeof actionPermissions]) return;

      const targets = selectedTargets;
      if (targets.length === 0) return;

      const actionLabels: Record<PowerAction, string> = {
        start: "Power on",
        shutdown: "Shut down",
        reboot: "Reboot",
        "force-off": "Force off",
      };
      const actionLabel = actionLabels[action] ?? `Action: ${action}`;
      const entryDetail = targets
        .map(({ host, vm }) => `${vm.name}@${host}`)
        .join(", ");

      const entryId = addEntry({
        title: `${actionLabel} guest domain${targets.length > 1 ? "s" : ""}`,
        detail: entryDetail,
        scope: "guest-hosts",
        status: "pending",
      });

      setIsActing(true);
      setActionError(null);
      try {
        await Promise.all(targets.map(({ host, vm }) => controlDomain(host, vm.name, action)));

        const timestamp = Date.now();
        setPendingActions((prev) => {
          const next = { ...prev };
          targets.forEach(({ host, vm }) => {
            const entry: PendingActionMeta = {
              action,
              startedAt: timestamp,
            };
            if (action === "reboot") {
              entry.seenIntermediate = false;
              entry.baselineUptime = computeDisplayUptime(vm, timestamp);
            }
            next[vmKey(host, vm.name)] = entry;
          });
          return next;
        });
        if (action === "force-off") {
          setLastForceOff(Date.now());
        }

        refresh();
        updateEntry(entryId, {
          status: "success",
          detail: `${actionLabel} succeeded for ${targets.length} guest domain${targets.length > 1 ? "s" : ""}.`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setActionError(message);
        updateEntry(entryId, { status: "error", detail: message });
        openPanel();
      } finally {
        setIsActing(false);
      }
    },
    [actionPermissions, addEntry, isActing, isDeletingGuest, openPanel, refresh, selectedCount, selectedTargets, updateEntry],
  );

  const handleConsolePowerAction = useCallback(
    async (action: PowerAction) => {
      if (!consoleTarget || !consoleVm) return;
      if (!consolePowerPermissions || !consolePowerPermissions[action]) return;
      if (isActing || isDeletingGuest) return;

      const actionLabels: Record<PowerAction, string> = {
        start: "Power on",
        shutdown: "Shut down",
        reboot: "Reboot",
        "force-off": "Force off",
      };
      const actionLabel = actionLabels[action];

      const entryId = addEntry({
        title: `${actionLabel} ${consoleTarget.name}`,
        detail: `${consoleTarget.name}@${consoleTarget.host}`,
        scope: "guest-hosts",
        status: "pending",
      });

      setIsActing(true);
      setActionError(null);
      try {
        await controlDomain(consoleTarget.host, consoleTarget.name, action);

        const timestamp = Date.now();
        setPendingActions((prev) => {
          const next = { ...prev };
          const key = vmKey(consoleTarget.host, consoleTarget.name);
          const entry: PendingActionMeta = { action, startedAt: timestamp };
          if (action === "reboot") {
            entry.seenIntermediate = false;
            entry.baselineUptime = computeDisplayUptime(consoleVm, timestamp);
          }
          next[key] = entry;
          return next;
        });
        if (action === "force-off") {
          setLastForceOff(Date.now());
        }

        refresh();
        updateEntry(entryId, {
          status: "success",
          detail: `${actionLabel} succeeded for ${consoleTarget.name}@${consoleTarget.host}.`,
        });
        if (action === "start" && isConsoleOpen) {
          setShouldReconnectConsole(true);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setActionError(message);
        updateEntry(entryId, { status: "error", detail: message });
        openPanel();
      } finally {
        setIsActing(false);
      }
    },
    [
      addEntry,
      consolePowerPermissions,
      consoleTarget,
      consoleVm,
      isConsoleOpen,
      isActing,
      isDeletingGuest,
      openPanel,
      refresh,
      setShouldReconnectConsole,
      setActionError,
      updateEntry,
    ],
  );

  const consolePowerControls = useMemo(() => {
    if (!consolePowerPermissions || !consoleTarget) return null;
    return {
      actions: [
        {
          id: "start" as const,
          label: "Power On",
          disabled: !consolePowerPermissions.start,
          onSelect: () => {
            void handleConsolePowerAction("start");
          },
        },
        {
          id: "shutdown" as const,
          label: "Shut Down",
          disabled: !consolePowerPermissions.shutdown,
          onSelect: () => {
            void handleConsolePowerAction("shutdown");
          },
        },
        {
          id: "reboot" as const,
          label: "Reboot",
          disabled: !consolePowerPermissions.reboot,
          onSelect: () => {
            void handleConsolePowerAction("reboot");
          },
        },
        {
          id: "force-off" as const,
          label: "Force Off",
          disabled: !consolePowerPermissions["force-off"],
          tone: "danger" as const,
          onSelect: () => {
            void handleConsolePowerAction("force-off");
          },
        },
      ],
    };
  }, [consolePowerPermissions, consoleTarget, handleConsolePowerAction]);

  useEffect(() => {
    if (!shouldReconnectConsole) return;
    if (!isConsoleOpen) {
      setShouldReconnectConsole(false);
      return;
    }
    if (!consoleTarget || !consoleVm) {
      return;
    }
    if (isConnecting || isActing || isDeletingGuest) {
      return;
    }

    const state = normalizeVmState(consoleVm.state);
    if (!isRunningState(state) || isTransitionalState(state)) {
      return;
    }

    let cancelled = false;
    setShouldReconnectConsole(false);

    const entryId = addEntry({
      title: "Reconnect console viewer",
      detail: `${consoleTarget.name}@${consoleTarget.host}`,
      scope: "guest-hosts",
      status: "pending",
    });

    setConsoleSession(null);
    setIsConnecting(true);
    const reconnect = async () => {
      try {
        const session = await createConsoleSession(consoleTarget.host, consoleTarget.name);
        if (cancelled) return;
        setConsoleSession(session);
        setIsConsoleOpen(true);
        updateEntry(entryId, {
          status: "success",
          detail: `Console viewer ready for ${consoleTarget.name}@${consoleTarget.host}.`,
        });
        openPanel();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setActionError(message);
        updateEntry(entryId, { status: "error", detail: message });
        openPanel();
        window.setTimeout(() => {
          if (!cancelled) {
            setShouldReconnectConsole(true);
          }
        }, 1500);
      } finally {
        if (!cancelled) {
          setIsConnecting(false);
        }
      }
    };

    reconnect();

    return () => {
      cancelled = true;
    };
  }, [
    addEntry,
    consoleTarget,
    consoleVm,
    createConsoleSession,
    isActing,
    isConnecting,
    isConsoleOpen,
    isDeletingGuest,
    openPanel,
    setActionError,
    setShouldReconnectConsole,
    shouldReconnectConsole,
    updateEntry,
  ]);

  const handleConnect = useCallback(async () => {
    if (isConnecting || isActing || isDeletingGuest) return;
    if (selectedTargets.length !== 1) return;

    const target = selectedTargets[0];
    const state = normalizeVmState(target.vm.state);
    if (!isRunningState(state) || isTransitionalState(state)) return;

    const entryId = addEntry({
      title: "Open console viewer",
      detail: `${target.vm.name}@${target.host}`,
      scope: "guest-hosts",
      status: "pending",
    });

    setIsConnecting(true);
    setActionError(null);
    try {
      setConsoleSession(null);
      setIsConsoleOpen(false);
      setConsoleTarget({ host: target.host, name: target.vm.name });
      const session = await createConsoleSession(target.host, target.vm.name);
      setConsoleSession(session);
      setIsConsoleOpen(true);
      updateEntry(entryId, {
        status: "success",
        detail: `Console viewer ready for ${target.vm.name}@${target.host}.`,
      });
      openPanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      updateEntry(entryId, { status: "error", detail: message });
      openPanel();
      setConsoleTarget(null);
      setConsoleSession(null);
      setIsConsoleOpen(false);
    } finally {
      setIsConnecting(false);
    }
  }, [
    addEntry,
    createConsoleSession,
    isActing,
    isConnecting,
    isDeletingGuest,
    openPanel,
    selectedTargets,
    setActionError,
    updateEntry,
  ]);

  const handleDeleteRequest = useCallback(() => {
    if (selectedTargets.length !== 1) return;
    const target = selectedTargets[0];
    const key = vmKey(target.host, target.vm.name);
    if (pendingActions[key]) return;
    setActionError(null);
    setDeleteTarget({ host: target.host, vm: target.vm });
    setRemoveStorage(false);
  }, [pendingActions, selectedTargets, setActionError]);

  const handleCloneRequest = useCallback(() => {
    if (selectedTargets.length !== 1) return;
    const target = selectedTargets[0];
    const key = vmKey(target.host, target.vm.name);
    if (pendingActions[key]) return;
    const state = normalizeVmState(target.vm.state);
    if (isTransitionalState(state) || isRunningState(state)) return;
    setActionError(null);
    setCloneTarget({ host: target.host, vm: target.vm });
  }, [pendingActions, selectedTargets, setActionError]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { host, vm } = deleteTarget;
    const entryId = addEntry({
      title: "Delete guest host",
      detail: `${vm.name}@${host}`,
      scope: "guest-hosts",
      status: "pending",
    });

    setIsDeletingGuest(true);
    setActionError(null);
    try {
      const result = await deleteGuestHost(host, vm.name, { force: true, removeStorage });
      updateEntry(entryId, {
        status: "success",
        detail: `Deleted ${result.domain}@${result.host}.`,
      });
      setBannerMessage(`Deleted guest ${result.domain} on ${result.host}.`);
      openPanel();
      setDeleteTarget(null);
      setRemoveStorage(false);
      clearSelection();
      refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      updateEntry(entryId, { status: "error", detail: message });
      openPanel();
    } finally {
      setIsDeletingGuest(false);
    }
  }, [addEntry, clearSelection, deleteTarget, openPanel, refresh, removeStorage, updateEntry, setActionError, setBannerMessage]);

  const vmTable = useTableState(vmColumns, vmRows, {
    defaultVisible: ["state", "name", "host", "vcpus", "memory", "persistent"],
    storageKey: "guest-hosts-columns",
    initialSort: { columnId: "name", direction: "asc" },
  });

  const {
    visibleColumns: vmVisibleColumns,
    visibleColumnIds: vmVisibleIds,
    toggleColumn: toggleVmColumn,
    canToggleColumn: canToggleVmColumn,
    sortedRows: vmSortedRows,
    sortState: vmSortState,
    requestSort: requestVmSort,
  } = vmTable;

  const vmStats = useMemo(() => {
    const fromSummary = summary?.vm_counts;
    if (fromSummary) {
      return {
        online: fromSummary.online,
        stopped: fromSummary.stopped,
        failed: fromSummary.failed,
        total: fromSummary.total,
      };
    }
    const totals = vmRows.reduce(
      (acc, row) => {
        const state = (row.vm.state ?? "").toLowerCase();
        if (state === "running" || state === "blocked") acc.online += 1;
        else if (state === "crashed") acc.failed += 1;
        else acc.stopped += 1;
        acc.total += 1;
        return acc;
      },
      { online: 0, stopped: 0, failed: 0, total: 0 },
    );
    return totals;
  }, [summary, vmRows]);

  const hostErrors = useMemo(() => {
    if (!errors) return [] as Array<{ host: string; message: string }>;
    return Object.entries(errors).map(([host, message]) => ({ host, message }));
  }, [errors]);

  const inventoryErrors = useMemo(() => {
    const issues: Array<{ host: string; message: string }> = [];
    Object.entries(hosts).forEach(([hostname, inventory]) => {
      inventory.errors?.forEach((message) => {
        issues.push({ host: hostname, message });
      });
    });
    return issues;
  }, [hosts]);

  const hasRows = vmRows.length > 0;

  return (
    <div className="page-stack" data-page="guest-hosts">
      <header className="page-header">
        <div>
          <h1>Guest Hosts</h1>
          <p className="page-header__subtitle">
            Aggregated libvirt domains per host with current state and persistence.
          </p>
        </div>
        <div className="page-header__actions">
          <button
            type="button"
            className="refresh-button"
            onClick={() => {
              setBannerMessage(null);
              setIsCreateOpen(true);
            }}
          >
            New Guest
          </button>
        </div>
      </header>

      {bannerMessage && <div className="panel__status panel__status--success">{bannerMessage}</div>}

      <section className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Domains</h2>
          <p className="panel__subtitle">
            {vmStats.total} total · {vmStats.online} online · {vmStats.stopped} stopped · {vmStats.failed} failed.
          </p>
        </header>

        <div className="vm-actions">
          <div className="vm-actions__summary">
            {selectedCount > 0
              ? `${selectedCount} selected: ${selectedVmLabels.join(", ")}`
              : "Select guest domains to enable controls."}
          </div>
          <div className="vm-actions__buttons">
            <button
              type="button"
              onClick={() => handleAction("start")}
              disabled={!canStart || isBusy}
            >
              Power On
            </button>
            <button
              type="button"
              onClick={() => handleAction("shutdown")}
              disabled={!canShutdown || isBusy}
            >
              Shut Down
            </button>
            <button
              type="button"
              onClick={() => handleAction("reboot")}
              disabled={!canReboot || isBusy}
            >
              Reboot
            </button>
            <button
              type="button"
              onClick={() => handleAction("force-off")}
              disabled={!canForceOff || isBusy}
            >
              Force Off
            </button>
            <button type="button" onClick={handleConnect} disabled={!canConnect || isBusy}>
              Connect
            </button>
            <button type="button" onClick={handleCloneRequest} disabled={!canClone || isBusy}>
              Clone
            </button>
            <button
              type="button"
              className="vm-actions__button--danger"
              onClick={handleDeleteRequest}
              disabled={!canDeleteGuest || isBusy}
            >
              Delete
            </button>
            <button type="button" onClick={clearSelection} disabled={!selectedCount || isBusy}>
              Clear Selection
            </button>
          </div>
        </div>
        {actionError && <div className="panel__status panel__status--error">{actionError}</div>}

        {isLoading && <div className="panel__status">Loading virtual machines…</div>}
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
        {!isLoading && !error && !hasRows && <div className="panel__status">{EMPTY_STATE}</div>}

        {!isLoading && !error && hasRows && (
          <>
            <div className="table-wrapper">
              <table className="hosts-table hosts-table--metrics">
                <thead>
                  <tr>
                    {vmVisibleColumns.map((column) => {
                      const isSorted = vmSortState?.columnId === column.id;
                      const ariaSort = isSorted
                        ? vmSortState?.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none";
                      return (
                        <th key={column.id} scope="col" aria-sort={ariaSort}>
                          {column.sortable ? (
                            <button
                              type="button"
                              className={`table-header-button table-header-button--sortable${
                                isSorted ? " table-header-button--active" : ""
                              }`}
                              onClick={() => requestVmSort(column.id)}
                            >
                              {column.label}
                              <span className="table-header-button__icon">
                                {isSorted ? (vmSortState?.direction === "asc" ? "▲" : "▼") : "↕"}
                              </span>
                            </button>
                          ) : (
                            column.label
                          )}
                        </th>
                      );
                    })}
                    <th scope="col" className="table-gear-header" aria-label="Column settings">
                      <ColumnSelector
                        columns={vmColumns}
                        visibleColumnIds={vmVisibleIds}
                        toggleColumn={toggleVmColumn}
                        canToggleColumn={canToggleVmColumn}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vmSortedRows.map((row) => {
                    const key = vmKey(row.host, row.vm.name);
                    const isSelected = selected.has(key);
                    return (
                      <tr
                        key={key}
                        className={isSelected ? "hosts-table__row hosts-table__row--selected" : "hosts-table__row"}
                        onClick={() => toggleSelection(key)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleSelection(key);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-pressed={isSelected}
                      >
                        {vmVisibleColumns.map((column) => (
                          <td key={column.id}>{column.renderCell(row)}</td>
                        ))}
                        <td className="table-gear-cell" aria-hidden="true" />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!isLoading && !error && hostErrors.length > 0 && (
          <div className="panel__status panel__status--error">
            {hostErrors.map(({ host, message }) => (
              <div key={`${host}:${message}`}>{`${host}: ${message}`}</div>
            ))}
          </div>
        )}

        {!isLoading && !error && inventoryErrors.length > 0 && (
          <div className="panel__status panel__status--error">
            {inventoryErrors.map(({ host, message }) => (
              <div key={`${host}:${message}`}>{`${host}: ${message}`}</div>
            ))}
          </div>
        )}
      </section>

      <CreateGuestModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(host, name) => {
          setBannerMessage(`Created guest ${name} on ${host}.`);
          setIsCreateOpen(false);
          addEntry({
            title: "Created guest host",
            detail: `${name}@${host}`,
            scope: "guest-hosts",
            status: "success",
          });
          openPanel();
          refresh();
        }}
        hosts={Object.keys(hosts)}
        defaultHost={Object.keys(hosts)[0]}
      />

      {cloneTarget && (
        <CloneGuestModal
          isOpen
          sourceHost={cloneTarget.host}
          sourceName={cloneTarget.vm.name}
          hosts={Object.keys(hosts)}
          onClose={() => {
            if (!isCloning) {
              setIsCloning(false);
              setCloneTarget(null);
            }
          }}
          onBusyChange={setIsCloning}
          onCloned={(result) => {
            setCloneTarget(null);
            setIsCloning(false);
            const newDomain = `${result.domain}@${result.host}`;
            const cloneMeta = result.clone;
            const infoPieces: string[] = [];
            if (cloneMeta?.vnc_password) {
              infoPieces.push(`Console password: ${cloneMeta.vnc_password}`);
            }
            if (cloneMeta?.mac_addresses && cloneMeta.mac_addresses.length > 0) {
              infoPieces.push(`MACs: ${cloneMeta.mac_addresses.join(", ")}`);
            }
            const infoText = infoPieces.length ? ` ${infoPieces.join(" | ")}` : "";
            setBannerMessage(`Cloned guest ${newDomain}.${infoText}`.trim());
            addEntry({
              title: "Cloned guest host",
              detail: infoPieces.length ? `${newDomain} | ${infoPieces.join(" | ")}` : newDomain,
              scope: "guest-hosts",
              status: "success",
            });
            openPanel();
            clearSelection();
            refresh();
          }}
        />
      )}

      <ConsoleViewerModal
        isOpen={isConsoleOpen}
        session={consoleSession}
        target={consoleTarget}
        onClose={() => {
          setIsConsoleOpen(false);
          setConsoleSession(null);
          setConsoleTarget(null);
          setShouldReconnectConsole(false);
        }}
        powerControls={consolePowerControls ?? undefined}
      />

      {deleteTarget && (
        <DeleteConfirmationModal
          title="Delete guest"
          description="This action cannot be undone."
          entityName={deleteTarget.vm.name}
          onCancel={() => {
            if (!isDeletingGuest) setDeleteTarget(null);
          }}
          onConfirm={handleConfirmDelete}
          isProcessing={isDeletingGuest}
          inputLabel={
            <span>
              Type <code>{deleteTarget.vm.name}</code>
            </span>
          }
        >
          <p className="modal__danger-text">
            You are about to permanently delete <strong>{deleteTarget.vm.name}</strong> on <strong>{deleteTarget.host}</strong>.
          </p>
          <p>This powers off the guest immediately. Attached storage volumes are not removed unless you opt in below.</p>
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={removeStorage}
              onChange={(event) => setRemoveStorage(event.target.checked)}
              disabled={isDeletingGuest}
            />
            Also delete the primary storage volume
          </label>
        </DeleteConfirmationModal>
      )}
    </div>
  );
}
