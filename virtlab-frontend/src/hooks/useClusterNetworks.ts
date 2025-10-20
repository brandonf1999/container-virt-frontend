import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchClusterNetworks } from "../api";
import type { ClusterNetworkResponse, HostNetworkInventory, NetworkAggregate } from "../types";

type NetworksState = {
  hosts: Record<string, HostNetworkInventory>;
  networks: NetworkAggregate[];
  errors?: Record<string, string>;
  summary?: ClusterNetworkResponse["summary"];
};

const defaultState: NetworksState = {
  hosts: {},
  networks: [],
};

type NetworkOptions = {
  pollIntervalMs?: number;
};

type LoadOptions = {
  silent?: boolean;
  force?: boolean;
};

export function useClusterNetworks(options: NetworkOptions = {}) {
  const [state, setState] = useState<NetworksState>(defaultState);
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

  const loadNetworks = useCallback(async ({ silent, force }: LoadOptions = {}) => {
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
      const data = await fetchClusterNetworks();
      if (!mountedRef.current) return;
      setState({
        hosts: data.hosts,
        networks: data.networks ?? [],
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
    void loadNetworks();
    return () => {
      /* noop */
    };
  }, [loadNetworks]);

  const refresh = useCallback(() => {
    void loadNetworks({ force: true });
  }, [loadNetworks]);

  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    let intervalId: number | null = null;

    const tick = () => {
      void loadNetworks({ silent: true });
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
  }, [loadNetworks, pollIntervalMs]);

  const hostsSorted = useMemo(() => {
    return Object.keys(state.hosts)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, HostNetworkInventory>>((acc, hostname) => {
        acc[hostname] = state.hosts[hostname];
        return acc;
      }, {});
  }, [state.hosts]);

  const networksSorted = useMemo(
    () =>
      [...state.networks]
        .map((network) => ({
          ...network,
          hosts: [...network.hosts].sort((a, b) => (a.display_name ?? a.hostname ?? "").localeCompare(b.display_name ?? b.hostname ?? "")),
        }))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [state.networks],
  );

  return {
    hosts: hostsSorted,
    networks: networksSorted,
    errors: state.errors,
    summary: state.summary,
    isLoading,
    error,
    refresh,
    lastUpdated,
    hasLoaded: hasLoadedRef.current,
  } as const;
}
