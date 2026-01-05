import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchDomainDetails } from "../api";
import type { DomainDetails, DomainDetailsEnvelope } from "../types";

const POLL_INTERVAL_MS = 3000;

function deriveUptimeSeconds(details: DomainDetails | null | undefined): number | null {
  if (!details) return null;
  if (typeof details.guest_uptime_seconds === "number") {
    return details.guest_uptime_seconds;
  }
  return null;
}

type LoadOptions = {
  signal?: AbortSignal;
  silent?: boolean;
};

export function useDomainDetails(hostname: string | undefined, name: string | undefined) {
  const [data, setData] = useState<{ envelope: DomainDetailsEnvelope | null; fetchedAt: number | null; displayUptimeSeconds: number | null }>(
    { envelope: null, fetchedAt: null, displayUptimeSeconds: null },
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(
    async ({ signal, silent }: LoadOptions = {}) => {
      if (!hostname || !name) return;
      try {
        if (!silent) setIsLoading(true);
        const result = await fetchDomainDetails(hostname, name, signal);
        const fetchedAt = Date.now();
        const baseUptime = deriveUptimeSeconds(result.details);
        setData((prev) => {
          const prevDisplay = prev.displayUptimeSeconds;
          const prevFetchedAt = prev.fetchedAt;
          let display = baseUptime;
          if (prevDisplay !== null && prevFetchedAt !== null) {
            const deltaSeconds = (fetchedAt - prevFetchedAt) / 1000;
            if (deltaSeconds > 0) {
              const projectedPrev = prevDisplay + deltaSeconds;
              display = display === null ? projectedPrev : Math.max(display, projectedPrev);
            }
          }
          return { envelope: result, fetchedAt, displayUptimeSeconds: display };
        });
        setError(null);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setData({ envelope: null, fetchedAt: null, displayUptimeSeconds: null });
        setError((err as Error).message);
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [hostname, name],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadDetails({ signal: controller.signal });

    const interval = window.setInterval(() => {
      loadDetails({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadDetails]);

  const refresh = useCallback(() => {
    loadDetails();
  }, [loadDetails]);

  const details = useMemo(() => data.envelope?.details, [data.envelope]);

  return {
    host: data.envelope?.host,
    domain: data.envelope?.domain,
    details,
    isLoading,
    error,
    refresh,
    fetchedAt: data.fetchedAt,
    displayUptimeSeconds: data.displayUptimeSeconds,
  } as const;
}
