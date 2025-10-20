import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchClusterStorage } from "../api";
import type { ClusterStorageResponse, HostStorageInventory, StorageDomainAggregate } from "../types";

type StorageState = {
  hosts: Record<string, HostStorageInventory>;
  storageDomains: StorageDomainAggregate[];
  errors?: Record<string, string>;
  summary?: ClusterStorageResponse["summary"];
};

const defaultState: StorageState = {
  hosts: {},
  storageDomains: [],
};

type StorageOptions = {
  pollIntervalMs?: number;
};

type LoadOptions = {
  silent?: boolean;
  force?: boolean;
};

export function useClusterStorage(options: StorageOptions = {}) {
  const [state, setState] = useState<StorageState>(defaultState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const pollIntervalMs = options.pollIntervalMs ?? 0;

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadStorage = useCallback(async ({ silent, force }: LoadOptions = {}) => {
    if (inFlightRef.current && !force) return;

    inFlightRef.current = true;
    let shouldToggleLoading = false;
    if (!silent) {
      shouldToggleLoading = true;
      if (mountedRef.current) {
        setIsLoading(true);
      }
    }

    try {
      const data = await fetchClusterStorage();
      if (!mountedRef.current) return;
      const sanitizedHosts = Object.entries(data.hosts).reduce<Record<string, HostStorageInventory>>(
        (acc, [hostname, inventory]) => {
          acc[hostname] = {
            pools: inventory.pools ?? [],
            volumes: inventory.volumes ?? [],
            errors: inventory.errors,
          };
          return acc;
        },
        {},
      );
      const sanitizedDomains = (data.storage_domains ?? []).map((domain) => ({
        ...domain,
        hosts: domain.hosts ?? [],
        options: domain.options ?? {},
        status: domain.status ?? "unknown",
        summary:
          domain.summary ?? {
            host_count: 0,
            status_counts: {} as Record<string, number>,
            last_checked_at: null,
          },
      }));

      setState({
        hosts: sanitizedHosts,
        storageDomains: sanitizedDomains,
        errors: data.errors,
        summary: data.summary,
      });
      setError(null);
      setLastUpdated(Date.now());
      hasLoadedRef.current = true;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (!mountedRef.current) return;
      if (!hasLoadedRef.current) {
        setState(defaultState);
      }
      setError((err as Error).message);
    } finally {
      inFlightRef.current = false;
      if (shouldToggleLoading && mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadStorage();
    return () => {
      /* noop */
    };
  }, [loadStorage]);

  const refresh = useCallback(() => {
    void loadStorage({ force: true });
  }, [loadStorage]);

  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    let intervalId: number | null = null;

    const tick = () => {
      void loadStorage({ silent: true });
    };

    const start = () => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(tick, pollIntervalMs);
    };

    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        tick();
        start();
      }
    };

    if (typeof document !== "undefined") {
      if (document.visibilityState === "hidden") {
        stop();
      } else {
        start();
      }
      document.addEventListener("visibilitychange", handleVisibility);
    } else {
      start();
    }

    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [loadStorage, pollIntervalMs]);

  const hostsSorted = useMemo(() => {
    return Object.keys(state.hosts)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, HostStorageInventory>>((acc, hostname) => {
        acc[hostname] = state.hosts[hostname];
        return acc;
      }, {});
  }, [state.hosts]);

  const storageDomainsSorted = useMemo(
    () => [...state.storageDomains].sort((a, b) => a.name.localeCompare(b.name)),
    [state.storageDomains],
  );

  return {
    hosts: hostsSorted,
    storageDomains: storageDomainsSorted,
    errors: state.errors,
    summary: state.summary,
    isLoading,
    error,
    refresh,
    lastUpdated,
    hasLoaded: hasLoadedRef.current,
  } as const;
}
