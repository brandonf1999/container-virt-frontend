import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDomainDetails } from "../hooks/useDomainDetails";
import { useClusterVms } from "../hooks/useClusterVms";
import { classifyVmState } from "../utils/vm";
import { formatBytes, formatDuration, formatMemory, formatPercent } from "../utils/formatters";
import { controlDomain, createConsoleSession, deleteGuestHost, detachGuestBlockDevice, moveGuestHost } from "../api";
import { useActivityLog } from "../hooks/useActivityLog";
import { DeleteConfirmationModal } from "../components/DeleteConfirmationModal";
import { ConsoleViewerModal } from "../components/ConsoleViewerModal";
import { CloneGuestModal } from "../components/CloneGuestModal";
import { MoveGuestsModal } from "../components/MoveGuestsModal";
import type { ConsoleSession, VirtualMachine } from "../types";

type PowerAction = "start" | "shutdown" | "reboot" | "force-off";

function normalizeVmState(state?: string | null) {
  return (state ?? "").toLowerCase();
}

const VM_RUNNING_STATES = new Set(["running", "blocked"]);
const VM_STOPPED_STATES = new Set(["shutoff", "shutdown"]);
const REBOOT_COMPLETION_FALLBACK_MS = 25_000;
const REBOOT_UPTIME_THRESHOLD_SECONDS = 10;

function isRunningState(state: string) {
  return VM_RUNNING_STATES.has(state);
}

function isStoppedState(state: string) {
  return VM_STOPPED_STATES.has(state);
}

function isTransitionalState(state: string) {
  return state.startsWith("in ");
}

const RESOURCE_OPTIONS = [
  { id: "block" as const, label: "Block Devices" },
  { id: "network" as const, label: "Network Interfaces" },
  { id: "filesystems" as const, label: "Filesystems" },
];

const STATS_OPTIONS = [
  { id: "memory" as const, label: "Memory Stats" },
  { id: "domain" as const, label: "Domain Stats" },
];

type ResourceView = (typeof RESOURCE_OPTIONS)[number]["id"];
type StatsView = (typeof STATS_OPTIONS)[number]["id"];

type MemoryMetricSource = string;

type GuestMemoryMetrics = {
  maxMb: number | null;
  totalMb: number | null;
  usedMb: number | null;
  freeMb: number | null;
  availableMb: number | null;
  rssMb: number | null;
  usagePercent: number | null;
  swapInKiB: number | null;
  swapOutKiB: number | null;
  sources: {
    max: MemoryMetricSource | null;
    total: MemoryMetricSource | null;
    used: MemoryMetricSource | null;
    free: MemoryMetricSource | null;
    available: MemoryMetricSource | null;
  };
};

const MEMORY_SOURCE_LABELS: Record<MemoryMetricSource, string> = {
  actual: "Balloon driver actual allocation",
  "dominfo-max": "Max memory from domain definition",
  "dominfo-current": "Current balloon size from dominfo",
  "actual-unused": "Actual allocation minus unused balloon pages",
  rss: "Resident set size reported by host",
  balloon: "Derived from balloon available memory",
  fallback: "Derived from available totals",
  unused: "Unused pages reported by balloon",
  derived: "Calculated from totals",
  available: "Available memory reported by balloon",
  usable: "Usable memory reported by balloon",
  free: "Matches unused balloon pages",
  "memory_stats.actual": "Actual allocation from dommemstat.actual",
  "memory_stats.balloon": "Balloon allocation from dommemstat.balloon",
  "dominfo.maxMem": "Max memory from domain definition",
  "dominfo.memory": "Current memory from dominfo",
  "memory_stats.unused": "Unused balloon pages from dommemstat.unused",
  "memory_stats.free": "Free memory from dommemstat.free",
  "memory_stats.available": "Available memory from dommemstat.available",
  "memory_stats.usable": "Usable memory from dommemstat.usable",
  "memory_stats.rss": "Resident set size from dommemstat.rss",
};

function formatMemorySourceLabel(source?: string | null): string | null {
  if (!source) return null;
  const parts = source.split(" - ").map((part) => MEMORY_SOURCE_LABELS[part] ?? part);
  return parts.join(" - ");
}

type CpuMetricSource =
  | "stats-vcpu"
  | "dominfo-vcpu"
  | "stats-time"
  | "dominfo-time"
  | "stats-user"
  | "stats-system"
  | "stats-util"
  | "stats-runqueue";

type GuestCpuMetrics = {
  vcpuCount: number | null;
  totalTimeSeconds: number | null;
  userTimeSeconds: number | null;
  systemTimeSeconds: number | null;
  utilizationPercent: number | null;
  runQueueLength: number | null;
  sources: {
    vcpu: CpuMetricSource | null;
    time: CpuMetricSource | null;
    user: CpuMetricSource | null;
    system: CpuMetricSource | null;
    utilization: CpuMetricSource | null;
    runQueue: CpuMetricSource | null;
  };
};

const CPU_SOURCE_LABELS: Record<CpuMetricSource, string> = {
  "stats-vcpu": "vcpu.current from domstats",
  "dominfo-vcpu": "nrVirtCpu from dominfo",
  "stats-time": "cpu.time from domstats",
  "dominfo-time": "cpuTime from dominfo",
  "stats-user": "cpu.user from domstats",
  "stats-system": "cpu.system from domstats",
  "stats-util": "cpu.utilization from domstats",
  "stats-runqueue": "cpu.runqueue metrics from domstats",
};

type FilesystemEntry = {
  mountpoint?: unknown;
  name?: unknown;
  type?: unknown;
  total?: unknown;
  used?: unknown;
};

type InterfaceEntry = {
  target?: string | null;
  mac?: string | null;
  model?: string | null;
  source?: Record<string, unknown>;
  stats?: {
    rx_bytes?: number;
    rx_packets?: number;
    rx_errors?: number;
    rx_drops?: number;
    tx_bytes?: number;
    tx_packets?: number;
    tx_errors?: number;
    tx_drops?: number;
  };
  addresses?: Array<Record<string, unknown>>;
};

type BlockEntry = {
  target: string | null;
  bus?: string | null;
  source?: Record<string, unknown>;
  stats?: {
    read_requests?: number;
    read_bytes?: number;
    write_requests?: number;
    write_bytes?: number;
    errors?: number;
  };
};

function renderMemoryUsage(usedMb?: number | null, totalMb?: number | null) {
  const used = formatMemory(usedMb ?? null);
  const total = formatMemory(totalMb ?? null);
  if (used === "--" && total === "--") return "--";
  return `${used} / ${total}`;
}

function formatKeyValue(value: unknown): string {
  if (value === null || value === undefined) return "--";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function VirtualHostDetailsPage() {
  const params = useParams<{ host?: string; name?: string }>();
  const hostname = decodeURIComponent(params.host ?? "");
  const domainName = decodeURIComponent(params.name ?? "");
  const navigate = useNavigate();

  const {
    details,
    isLoading,
    error,
    refresh,
    fetchedAt,
    displayUptimeSeconds,
  } = useDomainDetails(hostname, domainName);
  const { hosts: clusterHosts } = useClusterVms();
  const { addEntry, updateEntry, openPanel } = useActivityLog();

  const dominfo = (details?.dominfo ?? null) as Record<string, number> | null;
  const rawState =
    typeof details?.state === "string"
      ? details.state
      : dominfo && typeof dominfo.state === "string"
        ? dominfo.state
        : null;
  const normalizedState = normalizeVmState(rawState);
  const baseStateMeta = classifyVmState(rawState);

  const [actionError, setActionError] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [consoleSession, setConsoleSession] = useState<ConsoleSession | null>(null);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [detachingTargets, setDetachingTargets] = useState<Set<string>>(new Set());
  const [consoleTarget, setConsoleTarget] = useState<{ host: string; name: string } | null>(null);
  const [shouldReconnectConsole, setShouldReconnectConsole] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    action: PowerAction;
    startedAt: number;
    seenIntermediate?: boolean;
    baselineUptime?: number | null;
  } | null>(null);
  const [lastForceOff, setLastForceOff] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [removeStorage, setRemoveStorage] = useState(false);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isCloneBusy, setIsCloneBusy] = useState(false);
  const [isMigrateModalOpen, setIsMigrateModalOpen] = useState(false);
  const [migrateTargetHost, setMigrateTargetHost] = useState("");
  const [migrateStartGuest, setMigrateStartGuest] = useState(false);
  const [migrateMode, setMigrateMode] = useState<"live" | "cold">("live");
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const derivedUptimeSeconds = useMemo(() => {
    if (displayUptimeSeconds == null) return null;
    if (!fetchedAt) return displayUptimeSeconds;
    if (!normalizedState) return displayUptimeSeconds;
    if (isRunningState(normalizedState)) {
      const delta = (now - fetchedAt) / 1000;
      if (delta > 0) {
        return displayUptimeSeconds + delta;
      }
    }
    return displayUptimeSeconds;
  }, [displayUptimeSeconds, fetchedAt, normalizedState, now]);

  const vcpus = dominfo && typeof dominfo.nrVirtCpu === "number" ? dominfo.nrVirtCpu : "--";
  const dominfoMemoryKiB = dominfo && typeof dominfo.memory === "number" ? dominfo.memory : undefined;
  const dominfoMaxMemoryKiB = dominfo && typeof dominfo.maxMem === "number" ? dominfo.maxMem : undefined;
  const memorySummary = details?.memory_summary ?? null;
  const memoryTotalMb = typeof memorySummary?.total_mb === "number" ? memorySummary.total_mb : null;
  const memoryUsedMb = typeof memorySummary?.used_mb === "number" ? memorySummary.used_mb : null;
  const memoryTotalFallbackMb =
    memoryTotalMb ??
    (typeof dominfoMemoryKiB === "number" ? dominfoMemoryKiB / 1024 : null) ??
    (typeof dominfoMaxMemoryKiB === "number" ? dominfoMaxMemoryKiB / 1024 : null);
  const memoryUsage = renderMemoryUsage(memoryUsedMb, memoryTotalFallbackMb);
  const autostart =
    details && details.autostart !== undefined && details.autostart !== null
      ? details.autostart
        ? "Yes"
        : "No"
      : "--";

  useEffect(() => {
    if (!pendingAction) return;
    const state = normalizedState;
    if (!state) return;
    const timestamp = Date.now();

    if (pendingAction.action === "reboot") {
      if (!isRunningState(state)) {
        if (!pendingAction.seenIntermediate) {
          setPendingAction((prev) => (prev ? { ...prev, seenIntermediate: true } : prev));
        }
        return;
      }

      let rebootCompleted = false;
      if (
        typeof pendingAction.baselineUptime === "number" &&
        typeof derivedUptimeSeconds === "number"
      ) {
        const uptimeDelta = pendingAction.baselineUptime - derivedUptimeSeconds;
        if (uptimeDelta > REBOOT_UPTIME_THRESHOLD_SECONDS) {
          rebootCompleted = true;
        }
      }

      if (
        pendingAction.seenIntermediate ||
        rebootCompleted ||
        timestamp - pendingAction.startedAt > REBOOT_COMPLETION_FALLBACK_MS
      ) {
        setPendingAction(null);
      }
      return;
    }

    if (pendingAction.action === "start" && isRunningState(state)) {
      setPendingAction(null);
      return;
    }

    if ((pendingAction.action === "shutdown" || pendingAction.action === "force-off") && isStoppedState(state)) {
      setPendingAction(null);
    }
  }, [derivedUptimeSeconds, normalizedState, pendingAction]);

  useEffect(() => {
    if (lastForceOff === null) return;
    const timer = window.setTimeout(() => setLastForceOff(null), 3000);
    return () => window.clearTimeout(timer);
  }, [lastForceOff]);

  const forceOffRateLimited = lastForceOff !== null;
  const transitional = isTransitionalState(normalizedState);
  const busy = Boolean(pendingAction) || isCloneBusy;
  const canStart =
    !isActing &&
    !busy &&
    !transitional &&
    !isRunningState(normalizedState) &&
    !isDeleting &&
    (isStoppedState(normalizedState) || normalizedState === "crashed");
  const canShutdown =
    !isActing &&
    !busy &&
    !transitional &&
    !isDeleting &&
    (isRunningState(normalizedState) || normalizedState === "paused");
  const canReboot = !isActing && !busy && !transitional && !isDeleting && isRunningState(normalizedState);
  const canForceOff =
    !isActing &&
    !forceOffRateLimited &&
    (!pendingAction || pendingAction.action === "shutdown") &&
    !isStoppedState(normalizedState) &&
    !isDeleting;
  const canConnect =
    !isActing &&
    !busy &&
    !transitional &&
    !isDeleting &&
    isRunningState(normalizedState) &&
    !isConnecting;
  const canDelete = !isActing && !busy && !transitional && !isDeleting;
  const canCloneDomain =
    !isActing &&
    !busy &&
    !transitional &&
    !isDeleting &&
    !isConnecting &&
    !isRunningState(normalizedState);

  const migrateHostCandidates = useMemo(() => {
    if (!hostname) return [] as string[];
    return Object.keys(clusterHosts)
      .filter((host) => host !== hostname)
      .sort((a, b) => a.localeCompare(b));
  }, [clusterHosts, hostname]);

  const canMigrate =
    !isActing &&
    !busy &&
    !transitional &&
    !isDeleting &&
    !isMigrating &&
    migrateHostCandidates.length > 0;

  const migrateTargets = useMemo(() => {
    if (!hostname || !domainName) return [] as Array<{ host: string; vm: VirtualMachine }>;
    const state = rawState || "unknown";
    return [{ host: hostname, vm: { name: domainName, state } }];
  }, [domainName, hostname, rawState]);

  useEffect(() => {
    if (!isMigrateModalOpen) return;
    if (!migrateHostCandidates.length) {
      setMigrateTargetHost("");
      return;
    }
    setMigrateTargetHost((current) => {
      if (current && migrateHostCandidates.includes(current)) {
        return current;
      }
      return migrateHostCandidates[0] ?? "";
    });
  }, [isMigrateModalOpen, migrateHostCandidates]);

  const displayStateMeta = useMemo(() => {
    if (!pendingAction) return baseStateMeta;
    const pendingLabelMap: Record<PowerAction, { label: string; intent: string }> = {
      start: { label: "Powering on", intent: "warning" },
      shutdown: { label: "Shutting down", intent: "warning" },
      reboot: { label: "Rebooting", intent: "warning" },
      "force-off": { label: "Force stopping", intent: "error" },
    };
    return pendingLabelMap[pendingAction.action] ?? baseStateMeta;
  }, [baseStateMeta, pendingAction]);

  const handleAction = useCallback(
    async (action: PowerAction) => {
      if (!hostname || !domainName) return;

      const permissionMap: Record<PowerAction, boolean> = {
        start: canStart,
        shutdown: canShutdown,
        reboot: canReboot,
        "force-off": canForceOff,
      };
      if (!permissionMap[action]) return;
      if (isActing) return;

      const actionLabels: Record<PowerAction, string> = {
        start: "Power on",
        shutdown: "Shut down",
        reboot: "Reboot",
        "force-off": "Force off",
      };
      const actionLabel = actionLabels[action];

      const entryId = addEntry({
        title: `${actionLabel} ${domainName}`,
        detail: `${domainName}@${hostname}`,
        scope: "guest-host",
        status: "pending",
      });

      setIsActing(true);
      setActionError(null);

      try {
        await controlDomain(hostname, domainName, action);

        setPendingAction({
          action,
          startedAt: Date.now(),
          seenIntermediate: action === "reboot" ? false : undefined,
          baselineUptime: action === "reboot" ? derivedUptimeSeconds ?? null : undefined,
        });
        if (action === "force-off") {
          setLastForceOff(Date.now());
        }

        refresh();
        updateEntry(entryId, {
          status: "success",
          detail: `${actionLabel} request succeeded for ${domainName}@${hostname}.`,
        });
        if (action === "start" && isConsoleOpen) {
          setShouldReconnectConsole(true);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setActionError(message);
        updateEntry(entryId, { status: "error", detail: message });
        openPanel();
      } finally {
        setIsActing(false);
      }
    },
    [
      addEntry,
      canForceOff,
      canReboot,
      canShutdown,
      canStart,
      derivedUptimeSeconds,
      domainName,
      hostname,
      isConsoleOpen,
      isActing,
      openPanel,
      setShouldReconnectConsole,
      refresh,
      updateEntry,
    ],
  );

  const handleConnect = useCallback(async () => {
    if (!hostname || !domainName) return;
    if (isConnecting || isActing || busy || transitional || isDeleting) return;
    if (!isRunningState(normalizedState)) return;

    const entryId = addEntry({
      title: "Open console viewer",
      detail: `${domainName}@${hostname}`,
      scope: "guest-hosts",
      status: "pending",
    });

    setIsConnecting(true);
    setActionError(null);
    try {
      setConsoleSession(null);
      setIsConsoleOpen(false);
      setConsoleTarget({ host: hostname, name: domainName });
      const session = await createConsoleSession(hostname, domainName);
      setConsoleSession(session);
      setIsConsoleOpen(true);
      updateEntry(entryId, {
        status: "success",
        detail: `Console viewer ready for ${domainName}@${hostname}.`,
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
    busy,
    createConsoleSession,
    domainName,
    hostname,
    isActing,
    isConnecting,
    isDeleting,
    normalizedState,
    openPanel,
    setActionError,
    transitional,
    updateEntry,
  ]);

  const consolePowerControls = useMemo(
    () => ({
      actions: [
        {
          id: "start" as const,
          label: "Power On",
          disabled: !canStart,
          onSelect: () => {
            void handleAction("start");
          },
        },
        {
          id: "shutdown" as const,
          label: "Shut Down",
          disabled: !canShutdown,
          onSelect: () => {
            void handleAction("shutdown");
          },
        },
        {
          id: "reboot" as const,
          label: "Reboot",
          disabled: !canReboot,
          onSelect: () => {
            void handleAction("reboot");
          },
        },
        {
          id: "force-off" as const,
          label: "Force Off",
          disabled: !canForceOff,
          tone: "danger" as const,
          onSelect: () => {
            void handleAction("force-off");
          },
        },
      ],
    }),
    [canForceOff, canReboot, canShutdown, canStart, handleAction],
  );

  useEffect(() => {
    if (!shouldReconnectConsole) return;
    if (!isConsoleOpen) {
      setShouldReconnectConsole(false);
      return;
    }
    if (!consoleTarget) {
      return;
    }
    if (isConnecting || isActing || busy || transitional || isDeleting) {
      return;
    }
    if (!isRunningState(normalizedState)) {
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
    busy,
    consoleTarget,
    createConsoleSession,
    isActing,
    isConnecting,
    isConsoleOpen,
    isDeleting,
    normalizedState,
    openPanel,
    setActionError,
    setShouldReconnectConsole,
    shouldReconnectConsole,
    transitional,
    updateEntry,
  ]);

  const handleOpenMigrate = useCallback(() => {
    if (!hostname || !domainName) return;
    setMigrateError(null);
    setMigrateStartGuest(false);
    setMigrateMode("live");
    setIsMigrateModalOpen(true);
  }, [domainName, hostname]);

  const handleCancelMigrate = useCallback(() => {
    if (isMigrating) return;
    setIsMigrateModalOpen(false);
    setMigrateError(null);
    setMigrateStartGuest(false);
    setMigrateMode("live");
    setMigrateTargetHost("");
  }, [isMigrating]);

  const handleConfirmMigrate = useCallback(async () => {
    if (!hostname || !domainName) return;
    if (!migrateTargetHost || !migrateHostCandidates.includes(migrateTargetHost)) {
      setMigrateError("Select a valid target host");
      return;
    }
    setIsMigrateModalOpen(false);
    setIsMigrating(true);
    setMigrateError(null);
    const migrationLabel = migrateMode === "live" ? "live" : "cold";
    const entryId = addEntry({
      title: "Migrate guest host",
      detail: `${domainName}@${hostname} -> ${migrateTargetHost} (${migrationLabel})`,
      scope: "guest-host",
      status: "pending",
    });
    try {
      const result = await moveGuestHost(hostname, domainName, {
        target_host: migrateTargetHost,
        start: migrateStartGuest,
        mode: migrateMode,
      });
      updateEntry(entryId, {
        status: "success",
        detail: `${result.domain}@${result.target_host} (${migrationLabel})`,
      });
      openPanel();
      refresh();
      if (result.target_host && result.target_host !== hostname) {
        const newDomainPath = `/guest-hosts/${encodeURIComponent(result.target_host)}/${encodeURIComponent(result.domain)}`;
        navigate(newDomainPath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      updateEntry(entryId, { status: "error", detail: message });
      openPanel();
    } finally {
      setIsMigrating(false);
    }
  }, [
    addEntry,
    domainName,
    hostname,
    migrateMode,
    migrateHostCandidates,
    migrateStartGuest,
    migrateTargetHost,
    navigate,
    openPanel,
    refresh,
    setActionError,
    updateEntry,
  ]);

  const handleDelete = useCallback(() => {
    if (!hostname || !domainName) return;
    if (!canDelete) return;
    setActionError(null);
    setRemoveStorage(false);
    setShowDeleteModal(true);
  }, [canDelete, domainName, hostname]);

  const handleConfirmDelete = useCallback(async () => {
    if (!hostname || !domainName) return;
    const entryId = addEntry({
      title: "Delete guest host",
      detail: `${domainName}@${hostname}`,
      scope: "guest-hosts",
      status: "pending",
    });

    setIsDeleting(true);
    setActionError(null);
    try {
      const result = await deleteGuestHost(hostname, domainName, { force: true, removeStorage });
      updateEntry(entryId, {
        status: "success",
        detail: `Deleted ${result.domain}@${result.host}.`,
      });
      openPanel();
      setShowDeleteModal(false);
      setRemoveStorage(false);
      navigate("/guest-hosts", { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      updateEntry(entryId, { status: "error", detail: message });
      openPanel();
    } finally {
      setIsDeleting(false);
    }
  }, [addEntry, domainName, hostname, navigate, openPanel, removeStorage, updateEntry, setActionError]);
  const handleDetachBlockDevice = useCallback(
    async (targetDev: string) => {
      if (!hostname || !domainName) return;
      if (!targetDev) return;

      setDetachingTargets((prev) => {
        const next = new Set(prev);
        next.add(targetDev);
        return next;
      });

      const entryId = addEntry({
        title: `Detach ${targetDev}`,
        detail: `${domainName}@${hostname}`,
        scope: "guest-host",
        status: "pending",
      });

      try {
        await detachGuestBlockDevice(hostname, domainName, targetDev);
        updateEntry(entryId, {
          status: "success",
          detail: `Detached ${targetDev} from ${domainName}@${hostname}.`,
        });
        refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setActionError(message);
        updateEntry(entryId, { status: "error", detail: message });
        openPanel();
      } finally {
        setDetachingTargets((prev) => {
          const next = new Set(prev);
          next.delete(targetDev);
          return next;
        });
      }
    },
    [addEntry, domainName, hostname, openPanel, refresh, setActionError, updateEntry],
  );



  const blockDevices = useMemo(
    () => ((details?.block_devices ?? []) as BlockEntry[]),
    [details?.block_devices],
  );
  const interfaces = useMemo(
    () => ((details?.interfaces ?? []) as InterfaceEntry[]),
    [details?.interfaces],
  );
  const filesystems = useMemo(
    () => ((details?.filesystems ?? []) as FilesystemEntry[]),
    [details?.filesystems],
  );
  const domainStatsEntries = useMemo(
    () => (details?.stats ? Object.entries(details.stats) : []),
    [details?.stats],
  );

  const guestMemoryMetrics = useMemo<GuestMemoryMetrics | null>(() => {
    const stats = details?.memory_stats;
    const summary = details?.memory_summary ?? null;
    const readStat = (key: string): number | null => {
      if (!stats) return null;
      const value = stats[key as keyof typeof stats];
      if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
        return null;
      }
      return value;
    };

    const rssKiB = readStat("rss");
    const swapInKiB = readStat("swap_in");
    const swapOutKiB = readStat("swap_out");

    const summaryMaxMb = typeof summary?.max_mb === "number" ? summary.max_mb : null;
    const summaryTotalMb = typeof summary?.total_mb === "number" ? summary.total_mb : null;
    const summaryUsedMb = typeof summary?.used_mb === "number" ? summary.used_mb : null;
    const summaryFreeMb = typeof summary?.free_mb === "number" ? summary.free_mb : null;
    const summaryAvailableMb = typeof summary?.available_mb === "number" ? summary.available_mb : null;
    const summarySources = {
      max: summary?.max_source ?? null,
      total: summary?.total_source ?? null,
      used: summary?.used_source ?? null,
      free: summary?.free_source ?? null,
      available: summary?.available_source ?? null,
    };

    const summaryHasData =
      summaryMaxMb != null ||
      summaryTotalMb != null ||
      summaryUsedMb != null ||
      summaryFreeMb != null ||
      summaryAvailableMb != null;

    const rssMb = rssKiB != null ? rssKiB / 1024 : null;
    const summaryUsagePercent =
      summaryUsedMb != null && summaryTotalMb != null && summaryTotalMb > 0
        ? Number(Math.min(Math.max((summaryUsedMb / summaryTotalMb) * 100, 0), 100).toFixed(1))
        : null;

    if (summaryHasData) {
      return {
        maxMb: summaryMaxMb,
        totalMb: summaryTotalMb,
        usedMb: summaryUsedMb,
        freeMb: summaryFreeMb,
        availableMb: summaryAvailableMb,
        rssMb,
        usagePercent: summaryUsagePercent,
        swapInKiB: swapInKiB ?? null,
        swapOutKiB: swapOutKiB ?? null,
        sources: summarySources,
      };
    }

    const actualKiB = readStat("actual");
    const unusedKiB = readStat("unused");
    const availableKiBRaw = readStat("available");
    const usableKiBRaw = readStat("usable");

    let totalKiB: number | null = null;
    let totalSource: MemoryMetricSource | null = null;
    if (actualKiB != null) {
      totalKiB = Math.max(actualKiB, 0);
      totalSource = "actual";
    } else if (dominfoMaxMemoryKiB != null) {
      totalKiB = Math.max(dominfoMaxMemoryKiB, 0);
      totalSource = "dominfo-max";
    } else if (dominfoMemoryKiB != null) {
      totalKiB = Math.max(dominfoMemoryKiB, 0);
      totalSource = "dominfo-current";
    }

    let usedKiB: number | null = null;
    let usedSource: MemoryMetricSource | null = null;
    if (actualKiB != null && unusedKiB != null) {
      usedKiB = Math.max(actualKiB - unusedKiB, 0);
      usedSource = "actual-unused";
    } else if (rssKiB != null) {
      usedKiB = Math.max(rssKiB, 0);
      usedSource = "rss";
    } else if (dominfoMemoryKiB != null) {
      usedKiB = Math.max(dominfoMemoryKiB, 0);
      usedSource = "dominfo-current";
    } else if (actualKiB != null && availableKiBRaw != null) {
      usedKiB = Math.max(actualKiB - availableKiBRaw, 0);
      usedSource = "balloon";
    } else if (totalKiB != null && unusedKiB != null) {
      usedKiB = Math.max(totalKiB - unusedKiB, 0);
      usedSource = "fallback";
    }

    let freeKiB: number | null = null;
    let freeSource: MemoryMetricSource | null = null;
    if (unusedKiB != null) {
      freeKiB = Math.max(unusedKiB, 0);
      freeSource = "unused";
    } else if (totalKiB != null && usedKiB != null) {
      freeKiB = Math.max(totalKiB - usedKiB, 0);
      freeSource = "derived";
    } else if (availableKiBRaw != null && actualKiB != null) {
      freeKiB = Math.max(actualKiB - availableKiBRaw, 0);
      freeSource = "derived";
    }

    let availableKiB: number | null = null;
    let availableSource: MemoryMetricSource | null = null;
    if (availableKiBRaw != null) {
      availableKiB = Math.max(availableKiBRaw, 0);
      availableSource = "available";
    } else if (usableKiBRaw != null) {
      availableKiB = Math.max(usableKiBRaw, 0);
      availableSource = "usable";
    } else if (freeKiB != null) {
      availableKiB = freeKiB;
      availableSource = "free";
    }

    const usagePercent =
      usedKiB != null && totalKiB != null && totalKiB > 0
        ? Number(Math.min(Math.max((usedKiB / totalKiB) * 100, 0), 100).toFixed(1))
        : null;

    const toMb = (value: number | null): number | null => {
      if (value == null) return null;
      return value / 1024;
    };

    if (totalKiB == null && usedKiB == null && freeKiB == null && availableKiB == null && rssKiB == null) {
      return null;
    }

    return {
      maxMb: dominfoMaxMemoryKiB != null ? dominfoMaxMemoryKiB / 1024 : null,
      totalMb: toMb(totalKiB),
      usedMb: toMb(usedKiB),
      freeMb: toMb(freeKiB),
      availableMb: toMb(availableKiB),
      rssMb,
      usagePercent,
      swapInKiB: swapInKiB ?? null,
      swapOutKiB: swapOutKiB ?? null,
      sources: {
        max: dominfoMaxMemoryKiB != null ? "dominfo-max" : null,
        total: totalSource,
        used: usedSource,
        free: freeSource,
        available: availableSource,
      },
    } as GuestMemoryMetrics;
  }, [details?.memory_stats, details?.memory_summary, dominfoMaxMemoryKiB, dominfoMemoryKiB]);

  const guestCpuMetrics = useMemo<GuestCpuMetrics | null>(() => {
    const stats = details?.stats;
    const readStat = (key: string): number | null => {
      if (!stats) return null;
      const value = stats[key as keyof typeof stats];
      if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
        return null;
      }
      return value;
    };

    const vcpuStat = readStat("vcpu.current");
    const vcpuDominfo = typeof dominfo?.nrVirtCpu === "number" ? dominfo.nrVirtCpu : null;
    const vcpuCount = vcpuStat ?? vcpuDominfo;
    const vcpuSource: CpuMetricSource | null = vcpuStat != null ? "stats-vcpu" : vcpuDominfo != null ? "dominfo-vcpu" : null;

    const cpuTimeNsStat = readStat("cpu.time");
    const cpuTimeNsDominfo = typeof dominfo?.cpuTime === "number" ? dominfo.cpuTime : null;
    const totalTimeNs = cpuTimeNsStat ?? cpuTimeNsDominfo;
    const totalTimeSource: CpuMetricSource | null =
      cpuTimeNsStat != null ? "stats-time" : cpuTimeNsDominfo != null ? "dominfo-time" : null;

    const cpuUserNs = readStat("cpu.user");
    const cpuSystemNs = readStat("cpu.system");
    const userSource: CpuMetricSource | null = cpuUserNs != null ? "stats-user" : null;
    const systemSource: CpuMetricSource | null = cpuSystemNs != null ? "stats-system" : null;

    let cpuUtil = readStat("cpu.utilization");
    if (cpuUtil != null) {
      const normalized = cpuUtil <= 1 ? cpuUtil * 100 : cpuUtil;
      cpuUtil = Number(normalized.toFixed(1));
    }
    const utilSource: CpuMetricSource | null = cpuUtil != null ? "stats-util" : null;

    const runQueue = readStat("cpu.runqueue.latest") ?? readStat("cpu.runqueue.current") ?? null;
    const runQueueSource: CpuMetricSource | null = runQueue != null ? "stats-runqueue" : null;

    if (
      vcpuCount == null &&
      totalTimeNs == null &&
      cpuUserNs == null &&
      cpuSystemNs == null &&
      cpuUtil == null &&
      runQueue == null
    ) {
      return null;
    }

    const toSeconds = (valueNs: number | null): number | null => {
      if (valueNs == null) return null;
      return valueNs / 1_000_000_000;
    };

    return {
      vcpuCount,
      totalTimeSeconds: toSeconds(totalTimeNs),
      userTimeSeconds: toSeconds(cpuUserNs),
      systemTimeSeconds: toSeconds(cpuSystemNs),
      utilizationPercent: cpuUtil,
      runQueueLength: runQueue,
      sources: {
        vcpu: vcpuSource,
        time: totalTimeSource,
        user: userSource,
        system: systemSource,
        utilization: utilSource,
        runQueue: runQueueSource,
      },
    } satisfies GuestCpuMetrics;
  }, [details?.stats, dominfo]);

  const memoryCardMeta = useMemo(() => {
    if (!guestMemoryMetrics) return null;

    const meta: Record<"max" | "total" | "used" | "free" | "available" | "rss" | "utilization", string[]> = {
      max: [],
      total: [],
      used: [],
      free: [],
      available: [],
      rss: [],
      utilization: [],
    };

    const append = (key: keyof typeof meta, label?: string | null) => {
      if (label) {
        meta[key].push(label);
      }
    };

    const sourceLabels = guestMemoryMetrics.sources;

    append("max", formatMemorySourceLabel(sourceLabels.max));
    append("total", formatMemorySourceLabel(sourceLabels.total));
    append("used", formatMemorySourceLabel(sourceLabels.used));
    append("free", formatMemorySourceLabel(sourceLabels.free));
    append("available", formatMemorySourceLabel(sourceLabels.available));

    if (guestMemoryMetrics.swapInKiB != null || guestMemoryMetrics.swapOutKiB != null) {
      const swapParts: string[] = [];
      if (guestMemoryMetrics.swapInKiB != null) {
        swapParts.push(`In ${formatBytes(guestMemoryMetrics.swapInKiB * 1024)}`);
      }
      if (guestMemoryMetrics.swapOutKiB != null) {
        swapParts.push(`Out ${formatBytes(guestMemoryMetrics.swapOutKiB * 1024)}`);
      }
      if (swapParts.length) {
        append("used", `Swap ${swapParts.join(", ")}`);
      }
    }

    if (guestMemoryMetrics.rssMb != null) {
      append("rss", "Resident set size from dommemstat.rss");
    }

    append("utilization", formatMemorySourceLabel(sourceLabels.used));

    return meta;
  }, [guestMemoryMetrics]);

  const cpuCardMeta = useMemo(() => {
    if (!guestCpuMetrics) return null;

    const meta: Record<"vcpu" | "total" | "user" | "utilization", string[]> = {
      vcpu: [],
      total: [],
      user: [],
      utilization: [],
    };

    const append = (key: keyof typeof meta, label?: string | null) => {
      if (label) {
        meta[key].push(label);
      }
    };

    const { sources } = guestCpuMetrics;

    append("vcpu", sources.vcpu ? CPU_SOURCE_LABELS[sources.vcpu] : null);
    append("total", sources.time ? CPU_SOURCE_LABELS[sources.time] : null);
    append("user", sources.user ? CPU_SOURCE_LABELS[sources.user] : null);
    if (sources.system && !sources.user) {
      append("user", CPU_SOURCE_LABELS[sources.system]);
    }
    if (guestCpuMetrics.systemTimeSeconds != null) {
      append("user", `System ${formatDuration(guestCpuMetrics.systemTimeSeconds)}`);
    }
    append("utilization", sources.utilization ? CPU_SOURCE_LABELS[sources.utilization] : null);
    if (guestCpuMetrics.runQueueLength != null) {
      append("utilization", `Run queue ${guestCpuMetrics.runQueueLength}`);
    }

    return meta;
  }, [guestCpuMetrics]);

  const [resourceView, setResourceView] = useState<ResourceView>("block");
  const [statsView, setStatsView] = useState<StatsView>("memory");
  const [showXml, setShowXml] = useState(false);

  const domainStatRows = useMemo(() => domainStatsEntries, [domainStatsEntries]);

  const guestUptimeSeconds = details?.guest_uptime_seconds ?? null;
  const displayGuestUptime = guestUptimeSeconds != null ? formatDuration(guestUptimeSeconds) : "--";

  const resourceContent = useMemo(() => {
    if (resourceView === "block") {
      if (blockDevices.length === 0) {
        return <div className="panel__status">No block devices reported.</div>;
      }
      return (
        <div className="table-wrapper">
          <table className="hosts-table hosts-table--metrics">
            <thead>
              <tr>
                <th>Target</th>
                <th>Bus</th>
                <th>Source</th>
                <th>Read</th>
                <th>Write</th>
                <th>Errors</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {blockDevices.map((disk, index) => {
                const key = disk.target ?? `disk-${index}`;
                const source = disk.source
                  ? Object.entries(disk.source)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" ")
                  : "--";
                const read = disk.stats
                  ? `${formatBytes(disk.stats.read_bytes ?? 0)} (${disk.stats.read_requests ?? 0} req)`
                  : "--";
                const write = disk.stats
                  ? `${formatBytes(disk.stats.write_bytes ?? 0)} (${disk.stats.write_requests ?? 0} req)`
                  : "--";
                const targetDev = disk.target ?? null;
                const detaching = targetDev ? detachingTargets.has(targetDev) : false;
                const detachDisabled = detaching || isActing || busy || isDeleting;
                const deviceType = ((disk as { device?: string }).device || (disk as { type?: string }).type || "").toLowerCase();
                const isCdrom = deviceType === "cdrom" || deviceType === "iso";
                return (
                  <tr key={key}>
                    <td>{disk.target ?? "--"}</td>
                    <td>{disk.bus ?? "--"}</td>
                    <td>{source}</td>
                    <td>{read}</td>
                    <td>{write}</td>
                    <td>{disk.stats?.errors ?? "--"}</td>
                    <td>
                      {targetDev ? (
                        <button
                          type="button"
                          className={`hosts-table__action-button ${isCdrom ? '' : 'hosts-table__action-button--danger'}`}
                          onClick={() => handleDetachBlockDevice(targetDev)}
                          disabled={detachDisabled}
                        >
                          {detaching ? "Detaching…" : "Detach"}
                        </button>
                      ) : (
                        "--"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    if (resourceView === "network") {
      if (interfaces.length === 0) {
        return <div className="panel__status">No interfaces reported.</div>;
      }

      const sanitizeAddresses = (values?: string[]) => {
        if (!Array.isArray(values)) return [] as string[];
        return values.filter((value) => {
          if (typeof value !== "string") return false;
          const trimmed = value.trim();
          if (!trimmed) return false;
          if (trimmed.startsWith("127.")) return false;
          if (trimmed === "::1") return false;
          if (trimmed.toLowerCase().startsWith("::ffff:127.")) return false;
          return true;
        });
      };
      const splitAddresses = (values: string[]) => {
        const ipv4: string[] = [];
        const ipv6: string[] = [];
        values.forEach((value) => {
          if (value.includes(":")) {
            ipv6.push(value);
          } else {
            ipv4.push(value);
          }
        });
        return { ipv4, ipv6 };
      };

      return (
        <div className="table-wrapper">
          <table className="hosts-table hosts-table--metrics">
            <thead>
              <tr>
                <th>Interface</th>
                <th>MAC</th>
                <th>IP Addresses</th>
                <th>Rx</th>
                <th>Tx</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              {interfaces.flatMap((iface, index) => {
                const key = iface.target ?? iface.mac ?? `iface-${index}`;
                const addresses = Array.isArray(iface.addresses)
                  ? iface.addresses
                      .map((addr) => {
                        const ip = (addr as { addr?: string }).addr;
                        const prefix = (addr as { prefix?: number }).prefix;
                        return ip ? `${ip}${prefix ? `/${prefix}` : ""}` : null;
                      })
                      .filter((value): value is string => typeof value === "string" && value.length > 0)
                  : [];
                const cleanedAddresses = sanitizeAddresses(addresses);
                const { ipv4, ipv6 } = splitAddresses(cleanedAddresses);
                const rxBytes = iface.stats ? formatBytes(iface.stats.rx_bytes ?? 0) : "--";
                const txBytes = iface.stats ? formatBytes(iface.stats.tx_bytes ?? 0) : "--";
                const rxPackets = iface.stats?.rx_packets ?? 0;
                const txPackets = iface.stats?.tx_packets ?? 0;
                const errorCount = (iface.stats?.rx_errors ?? 0) + (iface.stats?.tx_errors ?? 0);
                const hasIpv4 = ipv4.length > 0;
                const hasIpv6 = ipv6.length > 0;
                if (!hasIpv4 || !hasIpv6) {
                  return [
                    <tr key={key}>
                      <td>{iface.target ?? "--"}</td>
                      <td>{iface.mac ?? "--"}</td>
                      <td>{cleanedAddresses.length ? cleanedAddresses.join(", ") : "--"}</td>
                      <td>{iface.stats ? `${rxBytes} (${rxPackets} pkts)` : "--"}</td>
                      <td>{iface.stats ? `${txBytes} (${txPackets} pkts)` : "--"}</td>
                      <td>{iface.stats ? errorCount : "--"}</td>
                    </tr>,
                  ];
                }
                return [
                  <tr key={`${key}-ipv4`}>
                    <td rowSpan={2}>{iface.target ?? "--"}</td>
                    <td rowSpan={2}>{iface.mac ?? "--"}</td>
                    <td>{`IPv4: ${ipv4.join(", ")}`}</td>
                    <td rowSpan={2}>{iface.stats ? `${rxBytes} (${rxPackets} pkts)` : "--"}</td>
                    <td rowSpan={2}>{iface.stats ? `${txBytes} (${txPackets} pkts)` : "--"}</td>
                    <td rowSpan={2}>{iface.stats ? errorCount : "--"}</td>
                  </tr>,
                  <tr key={`${key}-ipv6`}>
                    <td>{`IPv6: ${ipv6.join(", ")}`}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      );
    }

    if (filesystems.length === 0) {
      return <div className="panel__status">No filesystems reported.</div>;
    }

    return (
      <div className="table-wrapper">
        <table className="hosts-table hosts-table--metrics">
          <thead>
            <tr>
              <th>Mount</th>
              <th>Filesystem</th>
              <th>Type</th>
              <th>Capacity</th>
              <th>Used</th>
            </tr>
          </thead>
          <tbody>
            {filesystems.map((fs, index) => {
              const mount = typeof fs.mountpoint === "string" ? fs.mountpoint : "--";
              const name = typeof fs.name === "string" ? fs.name : "--";
              const type = typeof fs.type === "string" ? fs.type : "--";
              const total = typeof fs.total === "number" ? fs.total : Number(fs.total ?? NaN);
              const used = typeof fs.used === "number" ? fs.used : Number(fs.used ?? NaN);
              const totalDisplay = Number.isFinite(total) ? formatBytes(total) : "--";
              const usedDisplay = Number.isFinite(used) ? formatBytes(used) : "--";
              return (
                <tr key={`${mount}-${name}-${index}`}>
                  <td>{mount}</td>
                  <td>{name}</td>
                  <td>{type}</td>
                  <td>{totalDisplay}</td>
                  <td>{usedDisplay}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }, [blockDevices, handleDetachBlockDevice, detachingTargets, interfaces, filesystems, resourceView, busy, isActing, isDeleting]);

  const statsContent = useMemo(() => {
    if (statsView === "memory") {
      if (!guestMemoryMetrics) {
        return <div className="panel__status">No memory statistics available.</div>;
      }

      return (
        <div className="metric-grid">
          <div className="metric-card">
            <div className="metric-card__label">Max Memory</div>
            <div className="metric-card__value">
              {guestMemoryMetrics.maxMb != null ? formatMemory(guestMemoryMetrics.maxMb) : "--"}
            </div>
            {memoryCardMeta?.max?.length ? (
              <div className="metric-card__meta">{memoryCardMeta.max.join(" · ")}</div>
            ) : null}
          </div>
          <div className="metric-card">
            <div className="metric-card__label">Total Memory</div>
            <div className="metric-card__value">
              {guestMemoryMetrics.totalMb != null ? formatMemory(guestMemoryMetrics.totalMb) : "--"}
            </div>
            {memoryCardMeta?.total?.length ? (
              <div className="metric-card__meta">{memoryCardMeta.total.join(" · ")}</div>
            ) : null}
          </div>
          <div className="metric-card">
            <div className="metric-card__label">Used Memory</div>
            <div className="metric-card__value">
              {guestMemoryMetrics.usedMb != null ? formatMemory(guestMemoryMetrics.usedMb) : "--"}
            </div>
            {memoryCardMeta?.used?.length ? (
              <div className="metric-card__meta">{memoryCardMeta.used.join(" · ")}</div>
            ) : null}
          </div>
          <div className="metric-card">
            <div className="metric-card__label">Free Memory</div>
            <div className="metric-card__value">
              {guestMemoryMetrics.freeMb != null ? formatMemory(guestMemoryMetrics.freeMb) : "--"}
            </div>
            {memoryCardMeta?.free?.length ? (
              <div className="metric-card__meta">{memoryCardMeta.free.join(" · ")}</div>
            ) : null}
          </div>
          <div className="metric-card">
            <div className="metric-card__label">Available Memory</div>
            <div className="metric-card__value">
              {guestMemoryMetrics.availableMb != null ? formatMemory(guestMemoryMetrics.availableMb) : "--"}
            </div>
            {memoryCardMeta?.available?.length ? (
              <div className="metric-card__meta">{memoryCardMeta.available.join(" · ")}</div>
            ) : null}
          </div>
          <div className="metric-card">
            <div className="metric-card__label">Resident Set</div>
            <div className="metric-card__value">
              {guestMemoryMetrics.rssMb != null ? formatMemory(guestMemoryMetrics.rssMb) : "--"}
            </div>
            {memoryCardMeta?.rss?.length ? (
              <div className="metric-card__meta">{memoryCardMeta.rss.join(" · ")}</div>
            ) : null}
          </div>
          <div className="metric-card">
            <div className="metric-card__label">Memory Utilization</div>
            <div className="metric-card__value">
              {guestMemoryMetrics.usagePercent != null ? formatPercent(guestMemoryMetrics.usagePercent) : "--"}
            </div>
            {memoryCardMeta?.utilization?.length ? (
              <div className="metric-card__meta">{memoryCardMeta.utilization.join(" · ")}</div>
            ) : null}
          </div>
        </div>
      );
    }

    const hasCpuCards = Boolean(guestCpuMetrics);
    const hasDomainRows = domainStatRows.length > 0;

    if (!hasCpuCards && !hasDomainRows) {
      return <div className="panel__status">No domain statistics reported.</div>;
    }

    return (
      <div className="stats-domain">
        {guestCpuMetrics && (
          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-card__label">vCPU Count</div>
              <div className="metric-card__value">
                {guestCpuMetrics.vcpuCount != null ? guestCpuMetrics.vcpuCount : "--"}
              </div>
              {cpuCardMeta?.vcpu?.length ? (
                <div className="metric-card__meta">{cpuCardMeta.vcpu.join(" · ")}</div>
              ) : null}
            </div>
            <div className="metric-card">
              <div className="metric-card__label">Total CPU Time</div>
              <div className="metric-card__value">
                {guestCpuMetrics.totalTimeSeconds != null
                  ? formatDuration(guestCpuMetrics.totalTimeSeconds)
                  : "--"}
              </div>
              {cpuCardMeta?.total?.length ? (
                <div className="metric-card__meta">{cpuCardMeta.total.join(" · ")}</div>
              ) : null}
            </div>
            <div className="metric-card">
              <div className="metric-card__label">User Time</div>
              <div className="metric-card__value">
                {guestCpuMetrics.userTimeSeconds != null
                  ? formatDuration(guestCpuMetrics.userTimeSeconds)
                  : "--"}
              </div>
              {cpuCardMeta?.user?.length ? (
                <div className="metric-card__meta">{cpuCardMeta.user.join(" · ")}</div>
              ) : null}
            </div>
            <div className="metric-card">
              <div className="metric-card__label">CPU Utilization</div>
              <div className="metric-card__value">
                {guestCpuMetrics.utilizationPercent != null
                  ? formatPercent(guestCpuMetrics.utilizationPercent)
                  : "--"}
              </div>
              {cpuCardMeta?.utilization?.length ? (
                <div className="metric-card__meta">{cpuCardMeta.utilization.join(" · ")}</div>
              ) : null}
            </div>
          </div>
        )}

        {hasDomainRows && (
          <div className="table-wrapper">
            <table className="hosts-table hosts-table--metrics">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {domainStatRows.map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{formatKeyValue(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }, [cpuCardMeta, domainStatRows, guestCpuMetrics, guestMemoryMetrics, memoryCardMeta, statsView]);

  return (
    <div className="page-stack" data-page="virtual-host-details">
      <header className="page-header">
        <div>
          <h1>{domainName}</h1>
          <p className="page-header__subtitle">Guest host insight with libvirt metrics and device explorers.</p>
        </div>
        <div className="page-header__controls">
          <div className="page-header__actions">
            <Link className="link-button" to="/guest-hosts">
              ← Back to Guest Hosts
            </Link>
          </div>
          <div className="vm-actions vm-actions--header">
            <div className="vm-actions__menu" aria-label="Power controls">
              <details className="vm-actions__menu-group" role="list">
                <summary>Power</summary>
                <div className="vm-actions__menu-items">
                  <button type="button" onClick={() => handleAction("start")} disabled={!canStart || isActing}>
                    Power On
                  </button>
                  <button type="button" onClick={() => handleAction("shutdown")} disabled={!canShutdown || isActing}>
                    Shut Down
                  </button>
                  <button type="button" onClick={() => handleAction("reboot")} disabled={!canReboot || isActing}>
                    Reboot
                  </button>
                  <button type="button" onClick={() => handleAction("force-off")} disabled={!canForceOff || isActing}>
                    Force Off
                  </button>
                </div>
              </details>
            </div>

            <div className="vm-actions__groups">
              <div className="vm-actions__group">
                <button type="button" onClick={handleConnect} disabled={!canConnect}>
                  Connect
                </button>
                <button type="button" onClick={handleOpenMigrate} disabled={!canMigrate}>
                  Migrate
                </button>
                <button type="button" onClick={() => setIsCloneModalOpen(true)} disabled={!canCloneDomain || isCloneBusy}>
                  Clone
                </button>
              </div>
              <div className="vm-actions__group vm-actions__group--danger">
                <button
                  type="button"
                  className="vm-actions__button--danger"
                  onClick={handleDelete}
                  disabled={!canDelete || isDeleting}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>
      {actionError && <div className="vm-actions__status panel__status panel__status--error">{actionError}</div>}

      <section className="panel">
        <header className="panel__header">
          <h2 className="panel__title">Summary</h2>
          <p className="panel__subtitle">Core libvirt domain metrics</p>
        </header>
        {error && !isLoading && <div className="panel__status panel__status--error">{error}</div>}
        {isLoading && <div className="panel__status">Loading domain details…</div>}
        {!isLoading && !details && !error && (
          <div className="panel__status">No details available.</div>
        )}
        {details && (
          <>
            <div className="summary-grid">
              <div>
                <span className={`status-pill status-pill--${displayStateMeta.intent}`}>{displayStateMeta.label}</span>
                <div className="summary-grid__label">State</div>
              </div>
              <div>
                <div className="summary-grid__value">{vcpus}</div>
                <div className="summary-grid__label">vCPUs</div>
              </div>
              <div>
                <div className="summary-grid__value">{memoryUsage}</div>
                <div className="summary-grid__label">Memory (used / total)</div>
              </div>
              <div>
                <div className="summary-grid__value">{displayGuestUptime}</div>
                <div className="summary-grid__label">Guest uptime</div>
              </div>
              <div>
                <div className="summary-grid__value">
                  {details.persistent === false ? "No" : details.persistent ? "Yes" : "--"}
                </div>
                <div className="summary-grid__label">Persistent</div>
              </div>
              <div>
                <div className="summary-grid__value">{autostart}</div>
                <div className="summary-grid__label">Autostart</div>
              </div>
            </div>
            <dl className="definition-list definition-list--compact">
              <div className="definition-list__item">
                <dt>Host</dt>
                <dd>{hostname}</dd>
              </div>
              <div className="definition-list__item">
                <dt>UUID</dt>
                <dd>{details.uuid ?? "--"}</dd>
              </div>
              <div className="definition-list__item">
                <dt>Domain ID</dt>
                <dd>{details.id ?? "--"}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      {details && (
        <>
          <section className="panel">
            <header className="panel__header">
              <h2 className="panel__title">Resources</h2>
              <p className="panel__subtitle">Inspect devices exposed to the guest.</p>
            </header>
            <div className="table-selector" role="tablist" aria-label="Resource selector">
              {RESOURCE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`table-selector__button${resourceView === option.id ? " table-selector__button--active" : ""}`}
                  onClick={() => setResourceView(option.id)}
                  role="tab"
                  aria-selected={resourceView === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div>{resourceContent}</div>
          </section>

          <section className="panel">
            <header className="panel__header">
              <h2 className="panel__title">Statistics</h2>
              <p className="panel__subtitle">Live counters from libvirt.</p>
            </header>
            <div className="table-selector" role="tablist" aria-label="Statistics selector">
              {STATS_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`table-selector__button${statsView === option.id ? " table-selector__button--active" : ""}`}
                  onClick={() => setStatsView(option.id)}
                  role="tab"
                  aria-selected={statsView === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div>{statsContent}</div>
          </section>

          {details.errors && details.errors.length > 0 && (
            <section className="panel panel--warning">
              <header className="panel__header">
                <h2 className="panel__title">Collection Warnings</h2>
              </header>
              <div className="panel__status panel__status--error">
                {details.errors.map((msg) => (
                  <div key={msg}>{msg}</div>
                ))}
              </div>
            </section>
          )}

      {details.metadata && (
        <section className="panel">
          <header className="panel__header">
            <h2 className="panel__title">Domain XML</h2>
            <p className="panel__subtitle">Raw libvirt XML description (collapsed by default).</p>
          </header>
          <button type="button" className="link-button" onClick={() => setShowXml((prev) => !prev)}>
            {showXml ? "Hide domain XML" : "Show domain XML"}
          </button>
          {showXml && <pre className="code-block">{details.metadata}</pre>}
        </section>
      )}
    </>
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
    powerControls={consolePowerControls}
  />

  <MoveGuestsModal
    isOpen={isMigrateModalOpen && migrateTargets.length > 0}
    targets={migrateTargets}
    availableHosts={migrateHostCandidates}
    selectedHost={migrateTargetHost}
    actionLabel="Migrate"
    actionProgressLabel="Migrating…"
    migrationMode={migrateMode}
    startAfterMigration={migrateStartGuest}
    isSubmitting={isMigrating}
    error={migrateError}
    onTargetHostChange={setMigrateTargetHost}
    onMigrationModeChange={setMigrateMode}
    onStartAfterMigrationChange={setMigrateStartGuest}
    onClose={handleCancelMigrate}
    onConfirm={() => {
      void handleConfirmMigrate();
    }}
  />

  {isCloneModalOpen && (
    <CloneGuestModal
      isOpen
      sourceHost={hostname}
      sourceName={domainName}
      hosts={[hostname]}
      onBusyChange={setIsCloneBusy}
      onClose={() => {
        if (!isCloneBusy) {
          setIsCloneBusy(false);
          setIsCloneModalOpen(false);
        }
      }}
      onCloned={(result) => {
        setIsCloneBusy(false);
        setIsCloneModalOpen(false);
        const newDomainPath = `/guest-hosts/${encodeURIComponent(result.host)}/${encodeURIComponent(result.domain)}`;
        const infoPieces: string[] = [];
        if (result.clone?.vnc_password) {
          infoPieces.push(`Console password: ${result.clone.vnc_password}`);
        }
        if (result.clone?.mac_addresses && result.clone.mac_addresses.length > 0) {
          infoPieces.push(`MACs: ${result.clone.mac_addresses.join(", ")}`);
        }
        const detailText = infoPieces.length ? `${result.domain}@${result.host} | ${infoPieces.join(" | ")}` : `${result.domain}@${result.host}`;
        addEntry({
          title: "Cloned guest host",
          detail: detailText,
          scope: "guest-host",
          status: "success",
        });
        openPanel();
        refresh();
        navigate(newDomainPath);
      }}
    />
  )}

  {showDeleteModal && (
    <DeleteConfirmationModal
      title="Delete guest"
          description="This action cannot be undone."
          entityName={domainName}
          onCancel={() => {
            if (!isDeleting) {
              setShowDeleteModal(false);
              setRemoveStorage(false);
            }
          }}
          onConfirm={handleConfirmDelete}
          isProcessing={isDeleting}
          inputLabel={
            <span>
              Type <code>{domainName}</code>
            </span>
          }
        >
          <p className="modal__danger-text">
            You are about to permanently delete <strong>{domainName}</strong> on <strong>{hostname}</strong>.
          </p>
          <p>This powers off the guest immediately. Attached storage volumes are not removed unless you opt in below.</p>
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={removeStorage}
              onChange={(event) => setRemoveStorage(event.target.checked)}
              disabled={isDeleting}
            />
            Also delete the primary storage volume
          </label>
        </DeleteConfirmationModal>
      )}
    </div>
  );
}
