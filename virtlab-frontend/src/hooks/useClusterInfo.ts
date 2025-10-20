import { useCallback, useEffect, useRef, useState } from "react";
import { fetchClusterInfo } from "../api";
import type { ClusterInfoResponse, HostInfo } from "../types";

type Options = {
  pollIntervalMs?: number;
};

type LoadOptions = {
  silent?: boolean;
  force?: boolean;
};

export function useClusterInfo(options: Options = {}) {
  const [hosts, setHosts] = useState<HostInfo[]>([]);
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

  const loadCluster = useCallback(
    async ({ silent, force }: LoadOptions = {}) => {
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
        const data: ClusterInfoResponse = await fetchClusterInfo();
        if (!mountedRef.current) return;
        setHosts(Object.values(data));
        setError(null);
        setLastUpdated(Date.now());
        hasLoadedRef.current = true;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (!mountedRef.current) return;
        if (!hasLoadedRef.current) {
          setHosts([]);
        }
        setError((err as Error).message);
      } finally {
        inFlightRef.current = false;
        if (shouldToggleLoading && mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void loadCluster();
    return () => {
      /* noop */
    };
  }, [loadCluster]);

  const refresh = useCallback(() => {
    void loadCluster({ force: true });
  }, [loadCluster]);

  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    let intervalId: number | null = null;

    const tick = () => {
      void loadCluster({ silent: true });
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
  }, [loadCluster, pollIntervalMs]);

  return {
    hosts,
    isLoading,
    error,
    refresh,
    lastUpdated,
    hasLoaded: hasLoadedRef.current,
  } as const;
}
