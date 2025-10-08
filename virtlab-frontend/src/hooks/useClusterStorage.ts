import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchClusterStorage } from "../api";
import type { ClusterStorageResponse, HostStorageInventory } from "../types";

type StorageState = {
  hosts: Record<string, HostStorageInventory>;
  errors?: Record<string, string>;
  summary?: ClusterStorageResponse["summary"];
};

const defaultState: StorageState = {
  hosts: {},
};

export function useClusterStorage() {
  const [state, setState] = useState<StorageState>(defaultState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStorage = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoading(true);
      const data = await fetchClusterStorage(signal);
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
      setState({
        hosts: sanitizedHosts,
        errors: data.errors,
        summary: data.summary,
      });
      setError(null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState(defaultState);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadStorage(controller.signal);
    return () => controller.abort();
  }, [loadStorage]);

  const refresh = useCallback(() => {
    loadStorage();
  }, [loadStorage]);

  const hostsSorted = useMemo(() => {
    return Object.keys(state.hosts)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, HostStorageInventory>>((acc, hostname) => {
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
