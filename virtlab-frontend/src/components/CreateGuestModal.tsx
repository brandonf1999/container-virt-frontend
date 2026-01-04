import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createGuestHost, uploadIso } from "../api";
import type { CreateGuestPayload, GuestVolumeInput } from "../types";
import { useClusterStorage } from "../hooks/useClusterStorage";
import { useClusterNetworks } from "../hooks/useClusterNetworks";
import { formatBytes, formatMemory } from "../utils/formatters";

type CreateGuestModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (hostName: string, guestName: string) => void;
  hosts: string[];
  defaultHost?: string;
};

type VolumeMode = "new" | "existing";

type VolumeState = {
  name: string;
  pool: string;
  sizeMb: number;
  format: "qcow2" | "raw" | "vmdk";
  mode: VolumeMode;
  existingVolume?: string;
};

type IsoState =
  | {
      enabled: false;
      pool: "";
      volume?: string;
      uploadProgress?: undefined;
      uploadError?: undefined;
    }
  | {
      enabled: true;
      pool: string;
      volume?: string;
      uploadProgress?: { loaded: number; total: number };
      uploadError?: string | null;
    };

const VCPU_PRESETS = [1, 2, 4, 8];
const MEMORY_PRESETS_MB = [1024, 2048, 4096, 8192, 16384];
const VNC_PASSWORD_LENGTH = 8;
const VNC_PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const DEFAULT_DISK_NAME = "disk0";

function generateVncPassword(length = VNC_PASSWORD_LENGTH) {
  const alphabet = VNC_PASSWORD_ALPHABET;
  const randomValues = new Uint32Array(length);

  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(randomValues);
  } else {
    for (let index = 0; index < randomValues.length; index += 1) {
      randomValues[index] = Math.floor(Math.random() * alphabet.length);
    }
  }

  return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join("");
}

export function CreateGuestModal({ isOpen, onClose, onCreated, hosts, defaultHost }: CreateGuestModalProps) {
  const [hostName, setHostName] = useState(defaultHost ?? hosts[0] ?? "");
  const [guestName, setGuestName] = useState("");
  const [description, setDescription] = useState("");
  const [autostart, setAutostart] = useState(false);
  const [powerOn, setPowerOn] = useState(true);
  const [vcpus, setVcpus] = useState(2);
  const [memoryMb, setMemoryMb] = useState(2048);
  const [disk, setDisk] = useState<VolumeState>({ name: DEFAULT_DISK_NAME, pool: "", sizeMb: 20 * 1024, format: "qcow2", mode: "new" });
  const [diskNameTouched, setDiskNameTouched] = useState(false);
  const [iso, setIso] = useState<IsoState>({ enabled: false, pool: "" });
  const [network, setNetwork] = useState<string>("");
  const [macAddress, setMacAddress] = useState("");
  const [vncEnabled, setVncEnabled] = useState(true);
  const [vncPassword, setVncPassword] = useState(() => generateVncPassword());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { hosts: storageHosts, isLoading: storageLoading } = useClusterStorage();
  const { hosts: networkHosts, isLoading: networksLoading } = useClusterNetworks();

  const storagePools = useMemo(() => {
    if (!hostName) return [] as string[];
    const inventory = storageHosts[hostName];
    if (!inventory) return [];
    return inventory.pools.map((pool) => pool.name).sort();
  }, [hostName, storageHosts]);

  const isoVolumes = useMemo(() => {
    if (!hostName || !iso.enabled || !iso.pool) return [] as string[];
    const inventory = storageHosts[hostName];
    if (!inventory) return [];
    const poolExists = inventory.pools.some((pool) => pool.name === iso.pool);
    if (!poolExists) return [];
    const poolVolumes = (inventory.volumes ?? []).filter((volume) => volume.pool === iso.pool);
    return poolVolumes.map((volume) => volume.name).sort();
  }, [hostName, iso.enabled, iso.pool, storageHosts]);

  const diskVolumeOptions = useMemo(() => {
    if (!hostName || !disk.pool) return [] as string[];
    const inventory = storageHosts[hostName];
    if (!inventory) return [];
    const poolExists = inventory.pools.some((pool) => pool.name === disk.pool);
    if (!poolExists) return [];
    const poolVolumes = (inventory.volumes ?? []).filter((volume) => volume.pool === disk.pool);
    return poolVolumes.map((volume) => volume.name).sort();
  }, [hostName, storageHosts, disk.pool]);

  const availableNetworks = useMemo(() => {
    if (!hostName) return [] as string[];
    const inventory = networkHosts[hostName];
    if (!inventory) return [];
    return inventory.networks.map((net) => net.name).sort();
  }, [hostName, networkHosts]);

  const wasOpenRef = useRef(false);
  const diskNameTouchedRef = useRef(diskNameTouched);

  useEffect(() => {
    diskNameTouchedRef.current = diskNameTouched;
  }, [diskNameTouched]);

  const deriveDiskName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return DEFAULT_DISK_NAME;
      }
      return `${trimmed}-disk0`;
    },
    [],
  );

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      const initialHost = defaultHost ?? hosts[0] ?? "";
      setHostName(initialHost);
      setGuestName("");
      setDescription("");
      setAutostart(false);
      setPowerOn(true);
      setVcpus(2);
      setMemoryMb(2048);
      setDisk({ name: DEFAULT_DISK_NAME, pool: "", sizeMb: 20 * 1024, format: "qcow2", mode: "new", existingVolume: undefined });
      setDiskNameTouched(false);
      setIso({ enabled: false, pool: "" });
      setNetwork("");
      setMacAddress("");
      setVncEnabled(true);
      setVncPassword(() => generateVncPassword());
      setFormError(null);
      setIsSubmitting(false);
    }
    wasOpenRef.current = isOpen;
  }, [defaultHost, hosts, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (diskNameTouchedRef.current) return;
    const autoName = deriveDiskName(guestName);
    setDisk((prev) => (prev.name === autoName ? prev : { ...prev, name: autoName }));
  }, [deriveDiskName, guestName, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setDisk((prev) =>
      storagePools.length === 0 || storagePools.includes(prev.pool)
        ? prev
        : { ...prev, pool: storagePools[0] ?? "" },
    );
    setNetwork((prev) => (prev && availableNetworks.includes(prev) ? prev : availableNetworks[0] ?? ""));
    setIso((prev) => {
      if (!prev.enabled) return prev;
      if (!storagePools.includes(prev.pool)) {
        return { enabled: true, pool: storagePools[0] ?? "" };
      }
      return prev;
    });
  }, [availableNetworks, isOpen, storagePools]);

  useEffect(() => {
    if (!isOpen) return;
    setDisk((prev) => {
      if (prev.mode !== "existing") return prev;
      if (diskVolumeOptions.length === 0) {
        if (prev.existingVolume === undefined) return prev;
        return { ...prev, existingVolume: undefined };
      }
      if (prev.existingVolume && diskVolumeOptions.includes(prev.existingVolume)) {
        return prev;
      }
      return { ...prev, existingVolume: diskVolumeOptions[0] };
    });
  }, [diskVolumeOptions, isOpen]);

  const updateIso = useCallback((updater: (state: IsoState) => IsoState) => {
    setIso((current) => updater(current));
  }, []);

  const handleIsoToggle = (enabled: boolean) => {
    if (!enabled) {
      setIso({ enabled: false, pool: "" });
      return;
    }
    setIso({ enabled: true, pool: storagePools[0] ?? "" });
  };

  useEffect(() => {
    if (!iso.enabled) return;
    if (!iso.pool) return;
    if (isoVolumes.length === 0) {
      updateIso((current) => ({ ...current, enabled: true, volume: undefined }));
      return;
    }
    if (!iso.volume || !isoVolumes.includes(iso.volume)) {
      updateIso((current) => ({ ...current, enabled: true, volume: isoVolumes[0] }));
    }
  }, [iso.enabled, iso.pool, iso.volume, isoVolumes, updateIso]);

  const handleIsoUpload = async (file: File) => {
    if (!hostName) {
      updateIso((current) => ({ ...current, enabled: true, uploadError: "Select a host first" }));
      return;
    }
    const pool = (iso.enabled ? iso.pool : "") || storagePools[0] || "";
    if (!pool) {
      updateIso((current) => ({
        ...current,
        enabled: true,
        pool: "",
        uploadError: "Select a pool before uploading",
      }));
      return;
    }

    if (!iso.enabled || iso.pool !== pool) {
      setIso({ enabled: true, pool, volume: undefined });
    }

    updateIso((current) => ({
      ...current,
      enabled: true,
      uploadError: null,
      uploadProgress: { loaded: 0, total: file.size },
    }));

    try {
      const response = await uploadIso(hostName, pool, file, (event) => {
        if (event.lengthComputable) {
          updateIso((current) => ({
            ...current,
            enabled: true,
            uploadProgress: { loaded: event.loaded, total: event.total },
          }));
        }
      });
      updateIso((current) => ({
        ...current,
        enabled: true,
        pool,
        volume: response.volume?.name ?? current.volume,
        uploadProgress: { loaded: file.size, total: file.size },
        uploadError: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "ISO upload failed";
      updateIso((current) => ({
        ...current,
        enabled: true,
        uploadError: message,
        uploadProgress: undefined,
      }));
    }
  };

  const validate = (): string | null => {
    if (!hostName) return "Select a host";
    if (!guestName.trim()) return "Guest name is required";
    if (!disk.pool) return "Choose a storage pool for the disk";
    if (disk.mode === "new") {
      if (!disk.sizeMb || disk.sizeMb <= 0) return "Disk size must be positive";
    } else if (!disk.existingVolume) {
      return "Select an existing volume to attach";
    }
    if (!network && availableNetworks.length > 0) return "Choose a network";
    if (iso.enabled) {
      if (!iso.pool) return "Choose a pool for the ISO";
      if (!iso.volume) return "Select or upload an ISO image";
    }
    if (vncEnabled) {
      const password = vncPassword.trim();
      if (!password) return "Provide a VNC password";
      if (password.length < 6) return "VNC password must be at least 6 characters";
      if (password.length > 64) return "VNC password must be 64 characters or fewer";
      if (!/^[\x00-\x7F]+$/.test(password)) return "VNC password must use ASCII characters";
    }
    return null;
  };

  const handleSubmit = async () => {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    if (!hostName) return;

    const diskVolume: GuestVolumeInput = {
      name: disk.name.trim() || "disk0",
      pool: disk.pool,
      type: "disk",
      boot: !iso.enabled,
    };

    if (disk.mode === "existing" && disk.existingVolume) {
      diskVolume.source_volume = disk.existingVolume;
    } else {
      diskVolume.size_mb = disk.sizeMb;
      diskVolume.format = disk.format;
    }

    const payload: CreateGuestPayload = {
      name: guestName.trim(),
      description: description.trim() || undefined,
      autostart,
      start: powerOn,
      vcpus,
      memory_mb: memoryMb,
      volumes: [
        diskVolume,
        ...(iso.enabled && iso.volume
          ? [
              {
                name: "cdrom0",
                pool: iso.pool,
                type: "iso",
                source_volume: iso.volume,
                boot: true,
              } as const,
            ]
          : []),
      ],
      networks: network
        ? [
            {
              network,
              mac: macAddress.trim() || undefined,
              model: "virtio",
            },
          ]
        : [],
      enable_vnc: vncEnabled,
      vnc_password: vncEnabled ? vncPassword.trim() : undefined,
    };

    setIsSubmitting(true);
    setFormError(null);

    try {
      await createGuestHost(hostName, payload);
      onCreated(hostName, payload.name);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFormError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const disableForm = isSubmitting || storageLoading || networksLoading;
  const isoPercent = iso.enabled && iso.uploadProgress && iso.uploadProgress.total > 0
    ? Math.min(Math.round((iso.uploadProgress.loaded / iso.uploadProgress.total) * 100), 100)
    : null;

  return (
    <div className="modal-overlay" role="presentation" onClick={() => !isSubmitting && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="modal__header">
          <div>
            <h2>Create Guest</h2>
            <p>Provide VM basics, storage, and networking.</p>
          </div>
          <button type="button" className="modal__close" onClick={onClose} disabled={disableForm} aria-label="Close">
            ×
          </button>
        </header>

        <div className="create-guest-simple">
          <div className="create-guest-simple__column">
            <div className="modal__field">
              <label htmlFor="create-guest-host">Host</label>
              <select
                id="create-guest-host"
                value={hostName}
                onChange={(event) => setHostName(event.target.value)}
                disabled={disableForm}
              >
                <option value="" disabled>
                  Select host
                </option>
                {hosts.map((host) => (
                  <option key={host} value={host}>
                    {host}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal__field">
              <label htmlFor="create-guest-name">Guest name</label>
              <input
                id="create-guest-name"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                disabled={disableForm}
              />
            </div>

            <div className="modal__field">
              <label htmlFor="create-guest-description">Description (optional)</label>
              <textarea
                id="create-guest-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={disableForm}
              />
            </div>

            <div className="create-guest-simple__checkboxes">
              <label className="modal__checkbox">
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={(event) => setAutostart(event.target.checked)}
                  disabled={disableForm}
                />
                Autostart on host boot
              </label>
              <label className="modal__checkbox">
                <input
                  type="checkbox"
                  checked={powerOn}
                  onChange={(event) => setPowerOn(event.target.checked)}
                  disabled={disableForm}
                />
                Power on after creation
              </label>
            </div>

            <div className="modal__field">
              <label className="modal__checkbox">
                <input
                  type="checkbox"
                  checked={vncEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setVncEnabled(enabled);
                    if (enabled) {
                      setVncPassword((current) => current || generateVncPassword());
                    }
                  }}
                  disabled={disableForm}
                />
                Enable VNC console access
              </label>
            </div>

            {vncEnabled && <p className="modal__field-note">Password is generated automatically when the console is enabled.</p>}

            <div className="create-guest-simple__grid">
              <div className="modal__field">
                <label htmlFor="create-guest-vcpus">vCPUs</label>
                <input
                  id="create-guest-vcpus"
                  type="number"
                  min={1}
                  value={vcpus}
                  onChange={(event) => setVcpus(Number(event.target.value) || 1)}
                  disabled={disableForm}
                />
                <div className="create-guest-simple__preset-group">
                  {VCPU_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`create-guest-simple__preset${preset === vcpus ? " is-active" : ""}`}
                      onClick={() => setVcpus(preset)}
                      disabled={disableForm}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="modal__field">
                <label htmlFor="create-guest-memory">Memory (MiB)</label>
                <input
                  id="create-guest-memory"
                  type="number"
                  min={256}
                  value={memoryMb}
                  onChange={(event) => setMemoryMb(Number(event.target.value) || 256)}
                  disabled={disableForm}
                />
                <div className="create-guest-simple__preset-group">
                  {MEMORY_PRESETS_MB.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`create-guest-simple__preset${preset === memoryMb ? " is-active" : ""}`}
                      onClick={() => setMemoryMb(preset)}
                      disabled={disableForm}
                    >
                      {formatMemory(preset)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="create-guest-simple__column">
            <section className="create-guest-simple__card panel">
              <header>
                <h3>Primary disk</h3>
                <p>Boot disk configuration.</p>
              </header>
              <div className="modal__field">
                <label htmlFor="create-disk-name">Disk name</label>
                <input
                  id="create-disk-name"
                  value={disk.name}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDiskNameTouched(true);
                    setDisk((prev) => ({ ...prev, name: value }));
                  }}
                  disabled={disableForm}
                />
              </div>
              <div className="modal__field">
                <label htmlFor="create-disk-pool">Storage pool</label>
                <select
                  id="create-disk-pool"
                  value={disk.pool}
                  onChange={(event) => setDisk((prev) => ({ ...prev, pool: event.target.value }))}
                  disabled={disableForm}
                >
                  <option value="" disabled>
                    Select pool
                  </option>
                  {storagePools.map((pool) => (
                    <option key={pool} value={pool}>
                      {pool}
                    </option>
                  ))}
                </select>
              </div>
              <div className="modal__field">
                <label htmlFor="create-disk-mode">Disk source</label>
                <select
                  id="create-disk-mode"
                  value={disk.mode}
                  onChange={(event) => {
                    const nextMode = event.target.value as VolumeMode;
                    setDisk((prev) => {
                      if (nextMode === "existing") {
                        const firstVolume = diskVolumeOptions[0];
                        return {
                          ...prev,
                          mode: nextMode,
                          existingVolume: firstVolume,
                        };
                      }
                      return {
                        ...prev,
                        mode: nextMode,
                        existingVolume: undefined,
                      };
                    });
                  }}
                  disabled={disableForm}
                >
                  <option value="new">Create new volume</option>
                  <option value="existing" disabled={diskVolumeOptions.length === 0}>
                    Attach existing volume
                  </option>
                </select>
                {disk.mode === "existing" && diskVolumeOptions.length === 0 && (
                  <p className="modal__field-note">No volumes available in this pool.</p>
                )}
              </div>
              {disk.mode === "existing" && (
                <div className="modal__field">
                  <label htmlFor="create-disk-existing">Existing volume</label>
                  <select
                    id="create-disk-existing"
                    value={disk.existingVolume ?? ""}
                    onChange={(event) =>
                      setDisk((prev) => ({ ...prev, existingVolume: event.target.value || undefined }))
                    }
                    disabled={disableForm || diskVolumeOptions.length === 0}
                  >
                    {diskVolumeOptions.length === 0 && <option value="">Select pool</option>}
                    {diskVolumeOptions.map((volume) => (
                      <option key={volume} value={volume}>
                        {volume}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="create-guest-simple__grid">
                <div className="modal__field">
                  <label htmlFor="create-disk-size">Size (MiB)</label>
                  <input
                    id="create-disk-size"
                    type="number"
                    min={1}
                    value={disk.sizeMb}
                    onChange={(event) =>
                      setDisk((prev) => ({ ...prev, sizeMb: Number(event.target.value) || prev.sizeMb }))
                    }
                    disabled={disableForm || disk.mode === "existing"}
                  />
                </div>
                <div className="modal__field">
                  <label htmlFor="create-disk-format">Format</label>
                  <select
                    id="create-disk-format"
                    value={disk.format}
                    onChange={(event) => setDisk((prev) => ({ ...prev, format: event.target.value as VolumeState["format"] }))}
                    disabled={disableForm || disk.mode === "existing"}
                  >
                    <option value="qcow2">qcow2</option>
                    <option value="raw">raw</option>
                    <option value="vmdk">vmdk</option>
                  </select>
                </div>
              </div>
            </section>

            <section className="create-guest-simple__card panel">
              <header>
                <div className="create-guest-simple__card panel-header">
                  <div>
                    <h3>Attach ISO (optional)</h3>
                    <p>Use an installer or rescue media.</p>
                  </div>
                  <label className="modal__switch">
                    <input
                      type="checkbox"
                      checked={iso.enabled}
                      onChange={(event) => handleIsoToggle(event.target.checked)}
                      disabled={disableForm}
                    />
                    <span />
                  </label>
                </div>
              </header>

              {iso.enabled && (
                <>
                  <div className="modal__field">
                    <label htmlFor="create-iso-pool">ISO pool</label>
                    <select
                      id="create-iso-pool"
                      value={iso.pool}
                      onChange={(event) =>
                        updateIso((current) => ({
                          ...current,
                          enabled: true,
                          pool: event.target.value,
                          volume: undefined,
                        }))
                      }
                      disabled={disableForm}
                    >
                      <option value="" disabled>
                        Select pool
                      </option>
                      {storagePools.map((pool) => (
                        <option key={pool} value={pool}>
                          {pool}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="modal__field">
                    <label htmlFor="create-iso-volume">ISO image</label>
                    <select
                      id="create-iso-volume"
                      value={iso.volume ?? ""}
                      onChange={(event) =>
                        updateIso((current) => ({
                          ...current,
                          enabled: true,
                          volume: event.target.value || undefined,
                        }))
                      }
                      disabled={disableForm || isoVolumes.length === 0}
                    >
                      <option value="" disabled>
                        {isoVolumes.length ? "Select ISO" : "No images available"}
                      </option>
                      {isoVolumes.map((volume) => (
                        <option key={volume} value={volume}>
                          {volume}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="create-guest-simple__upload">
                    <input
                      id="create-iso-upload"
                      type="file"
                      accept=".iso"
                      disabled={disableForm}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleIsoUpload(file);
                        }
                      }}
                    />
                    <label htmlFor="create-iso-upload" className="hosts-table__action-button" aria-live="polite">
                      Upload ISO
                    </label>
                    {isoPercent !== null && iso.uploadProgress && (
                      <div className="modal__progress modal__field">
                        <div className="modal__progress-bar">
                          <div
                            className="modal__progress-bar-fill"
                            style={{ width: `${isoPercent}%` }}
                          />
                        </div>
                        <div className="modal__progress-label">
                          {isoPercent}% · {formatBytes(iso.uploadProgress.loaded)} / {formatBytes(iso.uploadProgress.total)}
                        </div>
                      </div>
                    )}
                    {iso.uploadError && <div className="panel__status panel__status--error">{iso.uploadError}</div>}
                  </div>
                </>
              )}
            </section>

            <section className="create-guest-simple__card panel">
              <header>
                <h3>Network</h3>
                <p>Attach to a libvirt-defined network.</p>
              </header>

              <div className="modal__field">
                <label htmlFor="create-network">Network</label>
                <select
                  id="create-network"
                  value={network}
                  onChange={(event) => setNetwork(event.target.value)}
                  disabled={disableForm}
                >
                  <option value="" disabled>
                    {availableNetworks.length ? "Select network" : "No networks available"}
                  </option>
                  {availableNetworks.map((net) => (
                    <option key={net} value={net}>
                      {net}
                    </option>
                  ))}
                </select>
              </div>

              <div className="modal__field">
                <label htmlFor="create-mac">MAC address (optional)</label>
                <input
                  id="create-mac"
                  value={macAddress}
                  onChange={(event) => setMacAddress(event.target.value)}
                  placeholder="Auto-generate if blank"
                  disabled={disableForm}
                />
              </div>
            </section>
          </div>
        </div>

        {formError && <div className="panel__status panel__status--error create-guest-simple__error">{formError}</div>}

        <footer className="modal__actions">
          <button type="button" className="hosts-table__action-button hosts-table__action-button--ghost" onClick={onClose} disabled={disableForm}>
            Cancel
          </button>
          <button type="button" className="hosts-table__action-button" onClick={handleSubmit} disabled={disableForm}>
            {isSubmitting ? "Creating…" : "Create Guest"}
          </button>
        </footer>
      </div>
    </div>
  );
}
