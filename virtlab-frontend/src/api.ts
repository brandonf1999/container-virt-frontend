const envBaseUrl = (import.meta.env.VITE_API_URL ?? "https://virtlab.foos.net").trim();

export const API_BASE_URL = envBaseUrl.replace(/\/$/, "");


export async function fetchClusterInfo(signal?: AbortSignal) {
  const res = await fetch(`${API_BASE_URL}/api/cluster/info`, { signal });
  if (!res.ok) throw new Error(`Cluster info HTTP ${res.status}`);
  return (await res.json()) as import("./types").ClusterInfoResponse;
}

export async function fetchClusterNetworks(signal?: AbortSignal) {
  const options = signal ? { signal } : undefined;
  const res = await fetch(`${API_BASE_URL}/api/cluster/networks`, options);
  if (!res.ok) throw new Error(`Cluster networks HTTP ${res.status}`);
  return (await res.json()) as import("./types").ClusterNetworkResponse;
}

export async function fetchNetworkDetails(networkId: string, signal?: AbortSignal) {
  const res = await fetch(`${API_BASE_URL}/api/network/${encodeURIComponent(networkId)}`, { signal });
  if (!res.ok) throw new Error(`Network detail HTTP ${res.status}`);
  return (await res.json()) as import("./types").NetworkDetailResponse;
}

export async function fetchClusterStorage(signal?: AbortSignal) {
  const options = signal ? { signal } : undefined;
  const res = await fetch(`${API_BASE_URL}/api/cluster/storage`, options);
  if (!res.ok) throw new Error(`Cluster storage HTTP ${res.status}`);
  return (await res.json()) as import("./types").ClusterStorageResponse;
}

export async function fetchStorageDomain(storageId: string, signal?: AbortSignal) {
  const res = await fetch(`${API_BASE_URL}/api/storage/${encodeURIComponent(storageId)}`, { signal });
  if (!res.ok) throw new Error(`Storage domain HTTP ${res.status}`);
  return (await res.json()) as import("./types").StorageDomainDetailResponse;
}

export async function deleteStorageVolume(hostname: string, pool: string, volume: string, options?: { force?: boolean }) {
  const params = new URLSearchParams();
  if (options?.force) params.set("force", "true");
  const query = params.toString();
  const url = `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/storage/pools/${encodeURIComponent(pool)}/volumes/${encodeURIComponent(volume)}${query ? `?${query}` : ""}`;

  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    let message = `Delete storage volume HTTP ${res.status}`;
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    const detail = (payload as { detail?: unknown } | null)?.detail ?? payload;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object") {
      const maybeMessage = (detail as { message?: unknown }).message;
      const maybeDomains = (detail as { domains?: unknown }).domains;
      if (typeof maybeMessage === "string") {
        const domainsText = Array.isArray(maybeDomains) && maybeDomains.length > 0 ? ` (${maybeDomains.join(", ")})` : "";
        message = `${maybeMessage}${domainsText}`;
      } else {
        try {
          message = JSON.stringify(detail);
        } catch {
          /* noop */
        }
      }
    }

    throw new Error(message);
  }

  return (await res.json()) as import("./types").StorageVolumeDeleteResponse;
}

export async function deleteStoragePool(hostname: string, pool: string, options?: { force?: boolean }) {
  const params = new URLSearchParams();
  if (options?.force) params.set("force", "true");
  const query = params.toString();
  const url = `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/storage/pools/${encodeURIComponent(pool)}${query ? `?${query}` : ""}`;

  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    let message = `Delete storage pool HTTP ${res.status}`;
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    const detail = (payload as { detail?: unknown } | null)?.detail ?? payload;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object") {
      const maybeMessage = (detail as { message?: unknown }).message;
      const maybeVolumes = (detail as { volumes?: unknown }).volumes;
      if (typeof maybeMessage === "string") {
        const volumesText = Array.isArray(maybeVolumes) && maybeVolumes.length > 0 ? ` (${maybeVolumes.join(", ")})` : "";
        message = `${maybeMessage}${volumesText}`;
      } else {
        try {
          message = JSON.stringify(detail);
        } catch {
          /* noop */
        }
      }
    }

    throw new Error(message);
  }

  return (await res.json()) as import("./types").StoragePoolDeleteResponse;
}

export async function uploadStorageVolume(hostname: string, pool: string, formData: FormData) {
  const url = `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/storage/pools/${encodeURIComponent(pool)}/upload`;
  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail = (payload as { detail?: unknown } | null)?.detail ?? payload;
    if (typeof detail === "string") {
      throw new Error(detail);
    }
    if (detail && typeof detail === "object") {
      const maybeMessage = (detail as { message?: unknown }).message;
      if (typeof maybeMessage === "string") {
        throw new Error(maybeMessage);
      }
    }
    throw new Error(`Upload storage volume HTTP ${res.status}`);
  }

  return payload as import("./types").StorageVolumeDetailsResponse;
}

export async function fetchStorageVolumeDetails(hostname: string, pool: string, volume: string, signal?: AbortSignal) {
  const url = `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/storage/pools/${encodeURIComponent(pool)}/volumes/${encodeURIComponent(volume)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Storage volume details HTTP ${res.status}`);
  return (await res.json()) as import("./types").StorageVolumeDetailsResponse;
}

export async function fetchClusterVms(signal?: AbortSignal) {
  const res = await fetch(`${API_BASE_URL}/api/cluster/vms`, { signal });
  if (!res.ok) throw new Error(`Cluster VMs HTTP ${res.status}`);
  return (await res.json()) as import("./types").ClusterVmResponse;
}

export async function fetchDomainDetails(hostname: string, name: string, signal?: AbortSignal) {
  const res = await fetch(`${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/vms/${encodeURIComponent(name)}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Domain details HTTP ${res.status}`);
  return (await res.json()) as import("./types").DomainDetailsEnvelope;
}

export async function controlDomain(hostname: string, name: string, action: string) {
  const res = await fetch(`${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/vms/${encodeURIComponent(name)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`Domain action HTTP ${res.status}`);
  return res.json();
}

export async function createConsoleSession(hostname: string, name: string) {
  const res = await fetch(
    `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/vms/${encodeURIComponent(name)}/console-session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
  );

  if (!res.ok) {
    let message = `Console session HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { detail?: unknown } | null;
      const detail = payload?.detail ?? payload;
      if (typeof detail === "string") {
        message = detail;
      }
    } catch {
      try {
        const text = await res.text();
        if (text) message = text;
      } catch {
        /* noop */
      }
    }
    throw new Error(message);
  }

  return (await res.json()) as import("./types").ConsoleSession;
}

export async function fetchGuestConsoleFile(hostname: string, name: string): Promise<{
  filename: string;
  blob: Blob;
  host?: string;
  port?: string;
}> {
  const url = `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/vms/${encodeURIComponent(name)}/connect`;
  const res = await fetch(url);

  if (!res.ok) {
    let message = `Console file HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { detail?: unknown } | null;
      const detail = payload?.detail ?? payload;
      if (typeof detail === "string") {
        message = detail;
      }
    } catch {
      try {
        const text = await res.text();
        if (text) {
          message = text;
        }
      } catch {
        /* noop */
      }
    }
    throw new Error(message);
  }

  const contentType = res.headers.get("Content-Type") || "text/x-shellscript";
  const disposition = res.headers.get("Content-Disposition") || "";

  let filename = `${name}-console.sh`;
  const match = disposition.match(/filename="?([^";]+)"?/i);
  if (match && match[1]) {
    filename = match[1];
  }

  const rawBlob = await res.blob();
  const blob = rawBlob.type ? rawBlob : rawBlob.slice(0, rawBlob.size || 0, contentType);

  const consoleHost = res.headers.get("X-Console-Host") || undefined;
  const consolePort = res.headers.get("X-Console-Port") || undefined;

  return {
    filename,
    blob,
    host: consoleHost,
    port: consolePort,
  };
}

export async function fetchHostDetails(hostname: string, signal?: AbortSignal) {
  const options = signal ? { signal } : undefined;
  const res = await fetch(`${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/info`, options);
  if (!res.ok) throw new Error(`Host details HTTP ${res.status}`);
  return (await res.json()) as import("./types").HostDetailsEnvelope;
}

export async function moveGuestHost(
  hostname: string,
  name: string,
  payload: import("./types").GuestMoveRequest,
) {
  const url = `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/vms/${encodeURIComponent(name)}/move`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Migrate guest HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown } | null;
      const detail = data?.detail ?? data;
      if (typeof detail === "string") {
        message = detail;
      } else if (detail && typeof detail === "object") {
        const maybeMessage = (detail as { message?: unknown }).message;
        if (typeof maybeMessage === "string") {
          message = maybeMessage;
        }
      }
    } catch {
      /* noop */
    }
    throw new Error(message);
  }
  return (await res.json()) as import("./types").GuestMoveResponse;
}

export async function createGuestHost(hostname: string, payload: import("./types").CreateGuestPayload) {
  const res = await fetch(`${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/vms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = `Create guest HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown } | null;
      const detail = data?.detail ?? data;
      if (typeof detail === "string") {
        message = detail;
      } else if (detail && typeof detail === "object") {
        const maybeMessage = (detail as { message?: unknown }).message;
        if (typeof maybeMessage === "string") {
          message = maybeMessage;
        }
      }
    } catch {
      /* noop */
    }
    throw new Error(message);
  }
  return (await res.json()) as import("./types").CreateGuestResponse;
}

export async function cloneGuestHost(
  hostname: string,
  name: string,
  payload: import("./types").CloneGuestPayload,
) {
  const res = await fetch(
    `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/vms/${encodeURIComponent(name)}/clone`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    let message = `Clone guest HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown } | null;
      const detail = data?.detail ?? data;
      if (typeof detail === "string") {
        message = detail;
      } else if (detail && typeof detail === "object") {
        const maybeMessage = (detail as { message?: unknown }).message;
        if (typeof maybeMessage === "string") {
          message = maybeMessage;
        }
      }
    } catch {
      /* noop */
    }
    throw new Error(message);
  }

  return (await res.json()) as import("./types").GuestCloneResponse;
}


export async function detachGuestBlockDevice(hostname: string, name: string, target: string) {
  const url = `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/vms/${encodeURIComponent(name)}/devices/block/${encodeURIComponent(target)}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    let message = `Detach block device HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown } | null;
      const detail = data?.detail ?? data;
      if (typeof detail === "string") {
        message = detail;
      }
    } catch {
      /* noop */
    }
    throw new Error(message);
  }
  return (await res.json()) as import("./types").DomainDetailsEnvelope;
}

export async function deleteGuestHost(
  hostname: string,
  name: string,
  options?: { force?: boolean; removeStorage?: boolean },
) {
  const params = new URLSearchParams();
  if (options?.force) params.set("force", "true");
  if (options?.removeStorage) params.set("remove_storage", "true");
  const query = params.toString();
  const url = `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/vms/${encodeURIComponent(name)}${query ? `?${query}` : ""}`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    let message = `Delete guest HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { detail?: unknown } | null;
      const detail = data?.detail ?? data;
      if (typeof detail === "string") {
        message = detail;
      } else if (detail && typeof detail === "object") {
        const maybeMessage = (detail as { message?: unknown }).message;
        if (typeof maybeMessage === "string") {
          message = maybeMessage;
        }
      }
    } catch {
      /* noop */
    }
    throw new Error(message);
  }
  return (await res.json()) as import("./types").GuestDeleteResponse;
}

export function uploadIso(
  hostname: string,
  pool: string,
  file: File,
  onProgress?: (event: ProgressEvent<EventTarget>) => void,
) {
  return new Promise<import("./types").StorageVolumeDetailsResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${API_BASE_URL}/api/hosts/${encodeURIComponent(hostname)}/storage/pools/${encodeURIComponent(pool)}/upload`;

    xhr.open("POST", url, true);

    xhr.upload.onprogress = (event) => {
      if (onProgress) onProgress(event);
    };

    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText || "null");
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload as import("./types").StorageVolumeDetailsResponse);
        } else {
          const detail = (payload as { detail?: unknown } | null)?.detail ?? payload;
          if (typeof detail === "string") {
            reject(new Error(detail));
            return;
          }
          if (detail && typeof detail === "object") {
            const maybeMessage = (detail as { message?: unknown }).message;
            if (typeof maybeMessage === "string") {
              reject(new Error(maybeMessage));
              return;
            }
          }
          reject(new Error(`Upload ISO HTTP ${xhr.status}`));
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    xhr.onerror = () => {
      reject(new Error("ISO upload failed"));
    };

    const formData = new FormData();
    formData.set("file", file);
    formData.set("volume", file.name);
    formData.set("overwrite", "true");

    xhr.send(formData);
  });
}
