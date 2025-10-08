import { useCallback, useEffect, useState } from "react";
import { fetchStorageVolumeDetails } from "../api";
import type { StorageVolumeDetailsResponse } from "../types";

export function useStorageVolumeDetails(hostname: string, pool: string, volume: string) {
  const [data, setData] = useState<StorageVolumeDetailsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!hostname || !pool || !volume) {
        setData(null);
        setError(null);
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        const details = await fetchStorageVolumeDetails(hostname, pool, volume, signal);
        setData(details);
        setError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setData(null);
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [hostname, pool, volume],
  );

  useEffect(() => {
    if (!hostname || !pool || !volume) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [hostname, pool, volume, load]);

  const refresh = useCallback(() => {
    load();
  }, [load]);

  return {
    data,
    isLoading,
    error,
    refresh,
  } as const;
}
