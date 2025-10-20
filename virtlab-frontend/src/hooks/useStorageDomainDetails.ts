import { useCallback, useEffect, useRef, useState } from "react";
import { fetchStorageDomain } from "../api";
import type { StorageDomainAggregate } from "../types";

type Options = {
  pollIntervalMs?: number;
};

type LoadOptions = {
  silent?: boolean;
  force?: boolean;
};

const defaultSummary: StorageDomainAggregate["summary"] = {
  host_count: 0,
  status_counts: {},
  last_checked_at: null,
};

function normalizeDomain(domain: StorageDomainAggregate | null | undefined): StorageDomainAggregate | null {
  if (!domain) return null;
  return {
    ...domain,
    hosts: domain.hosts ?? [],
    options: domain.options ?? {},
    status: domain.status ?? "unknown",
    summary: domain.summary ?? { ...defaultSummary },
  };
}

export function useStorageDomainDetails(storageId: string | undefined, options: Options = {}) {
  const [domain, setDomain] = useState<StorageDomainAggregate | null>(null);
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

  const loadDomain = useCallback(
    async ({ silent, force }: LoadOptions = {}) => {
      if (!storageId) {
        if (mountedRef.current) {
          setDomain(null);
          setError("Storage domain ID missing");
        }
        return;
      }

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
        const data = await fetchStorageDomain(storageId);
        if (!mountedRef.current) return;
        const normalized = normalizeDomain(data);
        setDomain(normalized);
        setError(null);
        setLastUpdated(Date.now());
        hasLoadedRef.current = true;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (!mountedRef.current) return;
        if (!hasLoadedRef.current) {
          setDomain(null);
        }
        setError((err as Error).message);
      } finally {
        inFlightRef.current = false;
        if (shouldToggleLoading && mountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [storageId],
  );

  useEffect(() => {
    void loadDomain();
    return () => {
      /* noop */
    };
  }, [loadDomain]);

  const refresh = useCallback(() => {
    void loadDomain({ force: true });
  }, [loadDomain]);

  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    let intervalId: number | null = null;

    const tick = () => {
      void loadDomain({ silent: true });
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
  }, [loadDomain, pollIntervalMs]);

  return {
    domain,
    isLoading,
    error,
    refresh,
    lastUpdated,
    hasLoaded: hasLoadedRef.current,
  } as const;
}

