import { useCallback, useEffect, useState } from "react";
import { fetchClusterInfo } from "../api";
import type { ClusterInfoResponse, HostInfo } from "../types";

export function useClusterInfo() {
  const [hosts, setHosts] = useState<HostInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCluster = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoading(true);
      const data: ClusterInfoResponse = await fetchClusterInfo(signal);
      setHosts(Object.values(data));
      setError(null);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setHosts([]);
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadCluster(controller.signal);
    return () => controller.abort();
  }, [loadCluster]);

  const refresh = useCallback(() => {
    loadCluster();
  }, [loadCluster]);

  return { hosts, isLoading, error, refresh } as const;
}
