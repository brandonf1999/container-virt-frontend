export type CpuMetrics = {
  cores: number | null;
  usage_percent: number | null;
  sample_period_seconds: number | null;
  times_ns: Record<string, number> | null;
};

export type MemoryMetrics = {
  total_mb: number | null;
  used_mb: number | null;
  free_mb: number | null;
  available_mb: number | null;
  usage_percent: number | null;
  raw: Record<string, number> | null;
};

export type HostMetrics = {
  cpu: CpuMetrics;
  memory: MemoryMetrics;
};

export type HostInfo = {
  hostname: string;
  memory_MB: number;
  cpus: number;
  arch: string;
  uri: string;
  metrics?: HostMetrics;
};

export type ClusterInfoResponse = Record<string, HostInfo>;

export type InterfaceStats = {
  rx_bytes: number;
  rx_packets: number;
  rx_errors: number;
  rx_drops: number;
  tx_bytes: number;
  tx_packets: number;
  tx_errors: number;
  tx_drops: number;
  collected_at: number;
};

export type InterfaceAddress = {
  family?: string | null;
  address?: string | null;
  prefix?: string | null;
};

export type NetworkInterface = {
  name: string;
  type?: string | null;
  mac?: string | null;
  active: boolean;
  start_mode?: string | null;
  mtu?: number | string | null;
  addresses: InterfaceAddress[];
  routes?: Array<Record<string, string | null>>;
  link?: {
    state?: string | null;
    speed_mbps?: number;
    speed?: string | null;
  } | null;
  bond?: Record<string, unknown> | null;
  bridge?: Record<string, unknown> | null;
  vlan?: Record<string, unknown> | null;
  stats?: InterfaceStats;
};

export type NetworkIP = {
  family?: string;
  address?: string;
  prefix?: string;
  netmask?: string;
};

export type DhcpRange = {
  family?: string;
  start?: string;
  end?: string;
};

export type LibvirtNetwork = {
  name: string;
  uuid?: string | null;
  active: boolean;
  autostart: boolean;
  forward_mode?: string | null;
  forward_dev?: string | null;
  bridge?: Record<string, unknown> | null;
  ips: NetworkIP[];
  dhcp: DhcpRange[];
  dns?: Record<string, unknown> | null;
  mtu?: number | string | null;
};

export type HostNetworkInventory = {
  interfaces: NetworkInterface[];
  networks: LibvirtNetwork[];
  errors?: string[];
};

export type NetworkHostStatus = {
  hostname: string;
  display_name?: string | null;
  status?: string | null;
  bridge_active?: boolean | null;
  last_checked_at?: string | null;
  mac_prefix?: string | null;
  message?: string | null;
  attributes: Record<string, unknown>;
};

export type NetworkAggregate = {
  id: string;
  name: string;
  forward_mode?: string | null;
  bridge_name?: string | null;
  vlan_id?: number | null;
  is_shared: boolean;
  description?: string | null;
  options: Record<string, unknown>;
  hosts: NetworkHostStatus[];
  summary?: {
    host_count: number;
    status_counts: Record<string, number>;
    state: string;
    attention_hosts: NetworkHostStatus[];
  };
};

export type NetworkDetailResponse = NetworkAggregate;

export type ClusterNetworkResponse = {
  hosts: Record<string, HostNetworkInventory>;
  networks?: NetworkAggregate[];
  errors?: Record<string, string>;
  summary?: {
    host_count: number;
    reported_hosts: number;
    failed_hosts: number;
  };
};

export type StoragePool = {
  name: string;
  state: string;
  type?: string | null;
  persistent: boolean | null;
  autostart: boolean | null;
  capacity_bytes: number;
  allocation_bytes: number;
  available_bytes: number;
};

export type StorageVolume = {
  pool: string;
  name: string;
  type: string;
  capacity_bytes: number | null;
  allocation_bytes: number | null;
  available_bytes?: number;
  key?: string | null;
  path?: string | null;
  state?: string | null;
};

export type StorageVolumeDeleteResponse = {
  host: string;
  pool: string;
  volume: string;
  deleted: boolean;
  force: boolean;
  path?: string | null;
  capacity_bytes?: number | null;
  allocation_bytes?: number | null;
  attached_domains?: string[];
};

export type StoragePoolDeleteResponse = {
  host: string;
  pool: string;
  deleted: boolean;
  force: boolean;
  state?: string | null;
  persistent?: boolean | null;
  autostart?: boolean | null;
  capacity_bytes?: number | null;
  allocation_bytes?: number | null;
  available_bytes?: number | null;
  type?: string | null;
  volumes?: string[];
  was_active?: boolean | null;
};

export type StoragePoolDetails = {
  name: string;
  state?: string | null;
  persistent?: boolean | null;
  autostart?: boolean | null;
  capacity_bytes?: number | null;
  allocation_bytes?: number | null;
  available_bytes?: number | null;
};

export type StorageVolumeDetails = {
  name: string;
  path?: string | null;
  key?: string | null;
  type?: string | null;
  format?: string | null;
  capacity_bytes?: number | null;
  allocation_bytes?: number | null;
  available_bytes?: number | null;
  backing_store?: string | null;
  state?: string | null;
};

export type StorageVolumeUploadSummary = {
  bytes: number;
  overwrite: boolean;
  format?: string | null;
};

export type StorageVolumeDetailsResponse = {
  host: string;
  pool: StoragePoolDetails;
  volume: StorageVolumeDetails;
  attached_domains: string[];
  xml?: string | null;
  upload?: StorageVolumeUploadSummary | null;
};

export type HostStorageInventory = {
  pools: StoragePool[];
  volumes: StorageVolume[];
  errors?: string[];
};

export type StorageDomainHostStatus = {
  hostname: string;
  display_name: string;
  scope: string;
  status: string;
  capacity_bytes?: number | null;
  allocation_bytes?: number | null;
  available_bytes?: number | null;
  last_checked_at?: string | null;
  message?: string | null;
  attributes?: Record<string, unknown>;
};

export type StorageDomainSummary = {
  host_count: number;
  status_counts: Record<string, number>;
  last_checked_at?: string | null;
};

export type StorageDomainAggregate = {
  id: string;
  name: string;
  type?: string | null;
  is_shared: boolean;
  description?: string | null;
  source_host?: string | null;
  source_path?: string | null;
  options: Record<string, unknown>;
  hosts: StorageDomainHostStatus[];
  status: string;
  summary: StorageDomainSummary;
};

export type StorageDomainDetailResponse = StorageDomainAggregate;

export type ClusterStorageResponse = {
  hosts: Record<string, HostStorageInventory>;
  storage_domains?: StorageDomainAggregate[];
  errors?: Record<string, string>;
  summary?: {
    host_count: number;
    reported_hosts: number;
    failed_hosts: number;
  };
};

export type VirtualMachine = {
  name: string;
  state: string;
  state_code?: number | null;
  persistent?: boolean | null;
  metrics?: {
    vcpu_count?: number | null;
    memory_mb?: number | null;
    max_memory_mb?: number | null;
    cpu_time_seconds?: number | null;
    uptime_seconds?: number | null;
  } | null;
  guest_agent_ips?: string[] | null;
  fetchedAt?: number;
  displayUptimeSeconds?: number | null;
};

export type HostVmInventory = {
  vms: VirtualMachine[];
  errors?: string[];
};

export type ClusterVmResponse = {
  hosts: Record<string, HostVmInventory>;
  errors?: Record<string, string>;
  summary?: {
    host_count: number;
    reported_hosts: number;
    failed_hosts: number;
    vm_counts: {
      online: number;
      stopped: number;
      failed: number;
      total: number;
    };
  };
};

export type DomainBlockDevice = {
  target: string | null;
  bus?: string | null;
  source?: Record<string, unknown>;
  stats?: {
    read_requests?: number;
    read_bytes?: number;
    write_requests?: number;
    write_bytes?: number;
    errors?: number;
  };
};

export type DomainInterface = {
  target?: string | null;
  mac?: string | null;
  model?: string | null;
  source?: Record<string, unknown>;
  stats?: {
    rx_bytes?: number;
    rx_packets?: number;
    rx_errors?: number;
    rx_drops?: number;
    tx_bytes?: number;
    tx_packets?: number;
    tx_errors?: number;
    tx_drops?: number;
  };
  addresses?: Array<Record<string, unknown>>;
};

export type DomainDetails = {
  name: string;
  uuid?: string | null;
  id?: number | null;
  state?: string | null;
  state_code?: number | null;
  persistent?: boolean | null;
  autostart?: boolean | null;
  dominfo?: Record<string, number>;
  metadata?: string | null;
  block_devices?: DomainBlockDevice[];
  interfaces?: DomainInterface[];
  memory_stats?: Record<string, number>;
  filesystems?: Array<Record<string, unknown>>;
  stats?: Record<string, unknown>;
  errors?: string[];
};

export type DomainDetailsEnvelope = {
  host: string;
  domain: string;
  details: DomainDetails;
};

export type GuestVolumeInput = {
  name: string;
  pool: string;
  type?: "disk" | "iso";
  size_mb?: number;
  format?: string | null;
  source_volume?: string | null;
  source_path?: string | null;
  boot?: boolean;
};

export type GuestNetworkInput = {
  network: string;
  mac?: string | null;
  model?: string | null;
};

export type CreateGuestPayload = {
  name: string;
  vcpus: number;
  memory_mb: number;
  autostart?: boolean;
  start?: boolean;
  description?: string | null;
  volumes: GuestVolumeInput[];
  networks?: GuestNetworkInput[];
  enable_vnc?: boolean;
  vnc_password?: string | null;
};

export type CreateGuestResponse = DomainDetailsEnvelope;

export type CloneGuestPayload = {
  name: string;
  autostart?: boolean;
  start?: boolean;
  description?: string | null;
  target_host?: string | null;
};

export type GuestCloneMetadata = {
  vnc_password?: string | null;
  mac_addresses: string[];
};

export type GuestCloneResponse = DomainDetailsEnvelope & {
  clone?: GuestCloneMetadata | null;
};

export type GuestDeleteResponse = {
  host: string;
  domain: string;
  removed: boolean;
  forced: boolean;
  was_active?: boolean;
  removed_volumes?: Array<{ pool: string; volume: string; path?: string }>;
};

export type HostDetails = HostInfo & {
  metrics?: HostMetrics;
  guests?: VirtualMachine[];
};

export type HostDetailsEnvelope = {
  host: string;
  details: HostDetails;
};

export type ConsoleSession = {
  token: string;
  expires_at: number;
  websocket_path: string;
  password: string;
};

export type GuestMoveRequest = {
  target_host: string;
  start?: boolean;
  shutdown_timeout?: number;
  force?: boolean;
};

export type GuestMoveResponse = {
  source_host: string;
  target_host: string;
  domain: string;
  uuid?: string | null;
  started: boolean;
  status: string;
};
