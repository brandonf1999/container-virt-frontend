import { useMemo } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { TopNav } from "./components.TopNav";
import { SideNav } from "./components.SideNav";
import { DashboardPage } from "./pages/DashboardPage";
import { PhysicalHostsPage } from "./pages/PhysicalHostsPage";
import { useClusterInfo } from "./hooks/useClusterInfo";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { NetworkPage } from "./pages/NetworkPage";
import { StoragePage } from "./pages/StoragePage";
import { GuestHostsPage } from "./pages/GuestHostsPage";
import { VirtualHostDetailsPage } from "./pages/VirtualHostDetailsPage";
import { PhysicalHostDetailsPage } from "./pages/PhysicalHostDetailsPage";
import { StorageVolumeDetailsPage } from "./pages/StorageVolumeDetailsPage";
import { ActivityLogPanel } from "./components/ActivityLogPanel";
import { useActivityLog } from "./hooks/useActivityLog";

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const HomeIcon = () => (
  <svg {...iconProps}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.25 9V21h4.5v-6h4.5v6h4.5V9" />
  </svg>
);

const ServerIcon = () => (
  <svg {...iconProps}>
    <rect x="3.5" y="4" width="17" height="6.5" rx="1.5" />
    <rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" />
    <path d="M8 7h.01M8 16.5h.01" />
    <path d="M12 7h4M12 16.5h4" />
  </svg>
);

const VmIcon = () => (
  <svg {...iconProps}>
    <rect x="4" y="4" width="16" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

const StorageIcon = () => (
  <svg {...iconProps}>
    <path d="M4 7c0-2 3.58-3.5 8-3.5s8 1.5 8 3.5" />
    <path d="M4 7v5c0 2 3.58 3.5 8 3.5s8-1.5 8-3.5V7" />
    <path d="M4 12v5c0 2 3.58 3.5 8 3.5s8-1.5 8-3.5v-5" />
  </svg>
);

const NetworkIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 4.5c2 2.5 3 5.5 3 7.5s-1 5-3 7.5c-2-2.5-3-5.5-3-7.5s1-5 3-7.5Z" />
    <path d="M5 9h14M5 15h14" />
  </svg>
);

const AdminIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="2.5" />
    <path d="M12 5.5V3" />
    <path d="M12 21v-2.5" />
    <path d="m6.6 7.4-1.8-1.8" />
    <path d="m19.2 18-1.8-1.8" />
    <path d="M5.5 12H3" />
    <path d="M21 12h-2.5" />
    <path d="m6.6 16.6-1.8 1.8" />
    <path d="m19.2 6-1.8 1.8" />
  </svg>
);

const navItems = [
  { label: "Home", to: "/", icon: <HomeIcon /> },
  { label: "Physical Hosts", to: "/physical-hosts", icon: <ServerIcon /> },
  { label: "Guest Hosts", to: "/guest-hosts", icon: <VmIcon /> },
  { label: "Storage", to: "/storage", icon: <StorageIcon /> },
  { label: "Networking", to: "/networking", icon: <NetworkIcon /> },
  { label: "Admin", to: "/admin", icon: <AdminIcon /> },
];

function App() {
  const { hosts, isLoading, error, refresh } = useClusterInfo();
  const { isOpen } = useActivityLog();

  const sortedHosts = useMemo(
    () => [...hosts].sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [hosts],
  );

  return (
    <div className="app-shell">
      <TopNav />
      <div className="app-shell__body">
        <SideNav items={navItems} />
        <main className={`main-content${isOpen ? " main-content--drawer-open" : ""}`}>
          <div className="main-content__body">
            <Routes>
              <Route
                path="/"
                element={<DashboardPage hosts={sortedHosts} isLoading={isLoading} error={error} />}
              />
              <Route
                path="/physical-hosts"
                element={
                  <PhysicalHostsPage
                    hosts={sortedHosts}
                    isLoading={isLoading}
                    error={error}
                    onRefresh={refresh}
                  />
                }
              />
              <Route path="/physical-hosts/:hostname" element={<PhysicalHostDetailsPage />} />
              <Route path="/guest-hosts/:host/:name" element={<VirtualHostDetailsPage />} />
              <Route path="/guest-hosts" element={<GuestHostsPage />} />
              <Route
                path="/storage"
                element={<StoragePage />}
              />
              <Route
                path="/storage/hosts/:hostname/pools/:pool/volumes/:volume"
                element={<StorageVolumeDetailsPage />}
              />
              <Route
                path="/networking"
                element={<NetworkPage />}
              />
              <Route
                path="/admin"
                element={<PlaceholderPage title="Admin">Cluster administration tools coming soon.</PlaceholderPage>}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
          <ActivityLogPanel />
        </main>
      </div>
    </div>
  );
}

export default App;
