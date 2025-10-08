export function formatMemory(memoryMb?: number | null): string {
  if (memoryMb === undefined || memoryMb === null || Number.isNaN(memoryMb)) {
    return "--";
  }

  const gib = memoryMb / 1024;
  if (gib >= 1) {
    const decimals = gib >= 10 ? 0 : 1;
    return `${gib.toFixed(decimals)} GiB`;
  }

  return `${Math.round(memoryMb)} MiB`;
}

export function formatConnectionType(uri: string | null | undefined): string {
  if (!uri) return "Unknown";
  const scheme = uri.split("://")[0];
  if (!scheme) return "Unknown";
  return scheme.toUpperCase();
}

export function formatPercent(value?: number | null, fractionDigits = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "--";
  }
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatSampleWindow(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) {
    return "--";
  }
  if (seconds < 1) {
    return `${seconds.toFixed(2)}s`;
  }
  return `${seconds.toFixed(1)}s`;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) {
    return "--";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export function formatSpeedMbps(speedMbps?: number | null, fallback?: string | null): string {
  if (speedMbps === undefined || speedMbps === null || Number.isNaN(speedMbps)) {
    return fallback ?? "--";
  }

  if (speedMbps >= 1000) {
    const gbps = speedMbps / 1000;
    const decimals = gbps >= 10 ? 0 : 1;
    return `${gbps.toFixed(decimals)} Gbps`;
  }

  if (speedMbps >= 1) {
    return `${speedMbps.toFixed(0)} Mbps`;
  }

  return `${speedMbps.toFixed(2)} Mbps`;
}

export function formatInterfaceAddress(address: { address?: string | null; prefix?: string | null }) {
  if (!address || !address.address) return null;
  if (address.prefix) return `${address.address}/${address.prefix}`;
  return address.address;
}

export function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds) || seconds < 0) {
    return "--";
  }

  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && parts.length < 2) parts.push(`${minutes}m`);
  if (!parts.length) parts.push(`${secs}s`);

  return parts.slice(0, 2).join(" ");
}
