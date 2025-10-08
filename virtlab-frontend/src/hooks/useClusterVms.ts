import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchClusterVms } from "../api";
import type { ClusterVmResponse, HostVmInventory, VirtualMachine } from "../types";

type VmState = {
  hosts: Record<string, HostVmInventory>;
  errors?: Record<string, string>;
  summary?: ClusterVmResponse["summary"];
};

const defaultState: VmState = {
  hosts: {},
};

const POLL_INTERVAL_MS = 3000;
const VM_RUNNING_STATES = new Set(["running", "blocked"]);

function computeDisplayUptimeAt(vm: VirtualMachine, timestamp: number): number | null {
  const base =
    vm.displayUptimeSeconds ?? vm.metrics?.uptime_seconds ?? vm.metrics?.cpu_time_seconds ?? null;
  if (base === null || base === undefined) return null;

  const state = (vm.state ?? "").toLowerCase();
  if (VM_RUNNING_STATES.has(state) && vm.fetchedAt) {
    const deltaSeconds = (timestamp - vm.fetchedAt) / 1000;
    if (deltaSeconds > 0) {
      return base + deltaSeconds;
    }
  }
  return base;
}

type LoadOptions = {
  signal?: AbortSignal;
  silent?: boolean;
};

export function useClusterVms() {
  const [state, setState] = useState<VmState>(defaultState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVms = useCallback(async ({ signal, silent }: LoadOptions = {}) => {
    try {
      if (!silent) setIsLoading(true);
      const data = await fetchClusterVms(signal);
      const fetchedAt = Date.now();
      setState((prev) => {
        const sanitizedHosts = Object.entries(data.hosts).reduce<Record<string, HostVmInventory>>(
          (acc, [hostname, inventory]) => {
            const prevHost = prev.hosts[hostname];
            const prevVms = prevHost?.vms ?? [];
            const vms = (inventory.vms ?? []).map((vm) => {
              const metrics = vm.metrics ? { ...vm.metrics } : null;
              const prevVm = prevVms.find((candidate) => candidate.name === vm.name);
              const prevDisplay = prevVm ? computeDisplayUptimeAt(prevVm, fetchedAt) : null;
              const rawBase = metrics?.uptime_seconds ?? metrics?.cpu_time_seconds ?? null;
              let displayUptimeSeconds: number | null | undefined = undefined;
              if (rawBase != null || prevDisplay != null) {
                const base = rawBase ?? 0;
                const fallback = prevDisplay ?? 0;
                displayUptimeSeconds = Math.max(base, fallback);
              }
              return {
                ...vm,
                metrics,
                fetchedAt,
                displayUptimeSeconds: displayUptimeSeconds ?? undefined,
              };
            });
            acc[hostname] = {
              vms,
              errors: inventory.errors,
            };
            return acc;
          },
          {},
        );
        return {
          hosts: sanitizedHosts,
          errors: data.errors,
          summary: data.summary,
        };
      });
      setError(null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState(defaultState);
      setError((err as Error).message);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadVms({ signal: controller.signal });

    const interval = window.setInterval(() => {
      loadVms({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadVms]);

  const refresh = useCallback(() => {
    loadVms();
  }, [loadVms]);

  const hostsSorted = useMemo(() => {
    return Object.keys(state.hosts)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, HostVmInventory>>((acc, hostname) => {
        acc[hostname] = state.hosts[hostname];
        return acc;
      }, {});
  }, [state.hosts]);

  return {
    hosts: hostsSorted,
    errors: state.errors,
    summary: state.summary,
    isLoading,
    error,
    refresh,
  } as const;
}
