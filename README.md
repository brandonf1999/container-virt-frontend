# VirtLab Frontend

Containerized React + Vite UI for VirtLab. This package serves the web console, host dashboards, and guest management flows that talk to the VirtLab backend (`container-virt`). The repository ships dev/prod container images, Taskfile helpers, and the source application under `virtlab-frontend/`.

## Features
- React 19 + TypeScript single-page app built with Vite (rolldown-based distribution)
- WebSocket VNC console using noVNC 1.6.0 with custom patching during install
- Host and guest dashboards with power actions, cloning, and storage management
- Environment-driven API endpoint (`VITE_API_URL`) for dev/prod parity
- Nginx production image and Vite dev container wrappers via `Containerfile`

## Project Layout
```
Containerfile        # Multi-stage build (dev + prod)
Taskfile.yml         # Podman/buildah automation
nginx.conf           # Production nginx reverse proxy for the SPA
virtlab-frontend/    # Source tree (React components, assets, configs)
  package.json       # Scripts + dependencies
  scripts/           # Build-time patches (noVNC loader, etc.)
  src/               # Application code
```

## Local Development
Install Node.js 20+ and npm:
```bash
cd container-virt-frontend/virtlab-frontend
npm install
npm run dev
```
Vite serves the app on `http://localhost:5173`. The development container and Vite dev server default the backend API to `http://localhost:8000`; adjust with `VITE_API_URL` in a local `.env` if needed.

### Linting & Builds
```bash
npm run lint   # ESLint (follows repo rules; fix warnings before PRs)
npm run build  # Type-check then emit production bundle to dist/
```
The `postinstall` script patches noVNC imports—ensure `npm install` runs inside any build or CI environment.

## Container Workflows
`Taskfile.yml` wraps Podman/buildah flows:
- `task dev:up` – build the dev image, mount the source tree, and run `npm run dev`
- `task build` – build the production image targeting nginx, honoring `VITE_API_URL`
- `task up` – run the production container locally on `http://localhost:8080`
- `task logs` / `task clean` – inspect or clean up containers and images

Override defaults with environment vars (examples):
```bash
export VITE_API_URL=https://virtlab.foos.net
export IMAGE_TAG=feature-123
task build
```

## Configuration
At runtime the SPA reads `import.meta.env.VITE_API_URL` (injected at build time). When using Docker/Podman:
- Production stage accepts `--build-arg VITE_API_URL=...` (see Taskfile default)
- Dev stage passes `VITE_API_URL` to Vite for live reload behavior

If you need per-request overrides, expose a config endpoint from the backend or serve a thin config script before the bundle (not yet implemented here).

## Deployment Notes
- The production image exposes port 80 and serves static assets through nginx with caching disabled for the SPA entrypoint.
- Pair the container with the repo’s `nginx-reverse-proxy.conf` (root) so `/api` and `/ws` routes hit the backend service.
- Rebuild the frontend image whenever novnc patches or API environment values change.
- Secrets (API URLs, feature flags) should be injected via build args or a config script—do not hardcode them in the repo.

## Troubleshooting
- Missing console assets? Confirm `node ./scripts/patch-novnc.js` ran (triggered by `npm install`).
- Network calls still point at `localhost:8000` in production? Ensure the build used the desired `VITE_API_URL` and that caches are cleared.
- Docker builds failing on npm? Check corporate proxies and npm registry access; you may need to vendor dependencies or set npm mirrors.
