import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchClusterNetworks } from "../api";
import type { ClusterNetworkResponse, HostNetworkInventory } from "../types";

type NetworksState = {
  hosts: Record<string, HostNetworkInventory>;
  errors?: Record<string, string>;
  summary?: ClusterNetworkResponse["summary"];
};

const defaultState: NetworksState = {
  hosts: {},
};

export function useClusterNetworks() {
  const [state, setState] = useState<NetworksState>(defaultState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNetworks = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoading(true);
      const data = await fetchClusterNetworks(signal);
      setState({
        hosts: data.hosts,
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
    loadNetworks(controller.signal);
    return () => controller.abort();
  }, [loadNetworks]);

  const refresh = useCallback(() => {
    loadNetworks();
  }, [loadNetworks]);

  const hostsSorted = useMemo(() => {
    return Object.keys(state.hosts)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, HostNetworkInventory>>((acc, hostname) => {
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
