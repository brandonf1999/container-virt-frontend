import { useCallback, useEffect, useState } from "react";
import { fetchNetworkDetails } from "../api";
import type { NetworkDetailResponse } from "../types";

export function useNetworkDetails(networkId: string | undefined) {
  const [data, setData] = useState<NetworkDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(
    async (signal?: AbortSignal) => {
      if (!networkId) return;
      try {
        setIsLoading(true);
        const response = await fetchNetworkDetails(networkId, signal);
        setData(response);
        setError(null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setData(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!signal || !signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [networkId],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadDetails(controller.signal);
    return () => controller.abort();
  }, [loadDetails]);

  const refresh = useCallback(() => {
    loadDetails();
  }, [loadDetails]);

  return {
    network: data,
    isLoading,
    error,
    refresh,
  } as const;
}
