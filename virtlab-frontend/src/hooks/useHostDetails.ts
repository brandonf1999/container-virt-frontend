import { useCallback, useEffect, useState } from "react";
import { fetchHostDetails } from "../api";
import type { HostDetailsEnvelope } from "../types";

export function useHostDetails(hostname: string | undefined) {
  const [data, setData] = useState<HostDetailsEnvelope | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(
    async (signal?: AbortSignal) => {
      if (!hostname) return;
      try {
        setIsLoading(true);
        const res = await fetchHostDetails(hostname, signal);
        setData(res);
        setError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setData(null);
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [hostname],
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
    host: data?.host,
    details: data?.details,
    isLoading,
    error,
    refresh,
  } as const;
}
