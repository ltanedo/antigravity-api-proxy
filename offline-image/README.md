# Antigravity Offline Docker Image

This directory captures the original work used to create the offline Docker image tar for `antigravity-claude-proxy`.

## What was built

- Source repo: `badrisnarayanan/antigravity-claude-proxy`
- Source commit: `eb2e1a8e881581e90d8ca8e0e2feeb996429be47`
- Package version: `2.7.7`
- Target platform: `linux/amd64`
- Final image tag after `docker load`: `antigravity-claude-proxy:offline`

## Why this exists

The original goal was to create a Docker-loadable image tar that could be copied to a Windows machine and loaded locally without requiring a registry pull at runtime.

The Docker daemon on the source Mac was unstable after running out of disk space, so the image was assembled without a local `docker build`. Instead, the image was created in a daemon-free flow using:

- `npm ci` and `npm rebuild` to prepare the app payload
- `regctl image copy` to fetch the official Node base image into an OCI layout
- `regctl image mod` to add the app layer and configure ports/env
- `regctl image export` to emit a Docker-loadable tar
- a small helper script to rewrite `manifest.json` so the tar loads with a clean local tag

## Files here

- [Dockerfile.reference](Dockerfile.reference): reference image layout only
- [SHA256SUMS.txt](SHA256SUMS.txt): checksum for the original exported tar
- [scripts/build-offline-image.sh](scripts/build-offline-image.sh): rebuild flow
- [scripts/retag_docker_tar.py](scripts/retag_docker_tar.py): retag helper for the exported tar

## Preconfigured runtime settings

- Web UI / proxy port: `8080`
- Google OAuth callback port: `38080`
- Data volume: `/data`
- `HOME=/data`

`38080` was chosen instead of the upstream default `51121` because the default port often collides on Windows Docker / Hyper-V / WSL setups.

## Windows usage

Load:

```powershell
docker load -i .\antigravity-claude-proxy-offline-linux-amd64.tar
```

Run:

```powershell
docker run -d `
  --name antigravity-claude-proxy `
  -v C:/Users/YOUR_NAME/antigravity-proxy-data:/data `
  -p 8080:8080 `
  -p 38080:38080 `
  antigravity-claude-proxy:offline
```

Open:

- `http://localhost:8080/`

OAuth callback target:

- `http://localhost:38080/oauth-callback`

## Rebuild notes

The rebuild script assumes:

- `node` and `npm` are installed
- `regctl` is installed
- the source tree to package is available at `proxy-app/` by default

Example:

```bash
./offline-image/scripts/build-offline-image.sh
```

That script will generate a fresh Docker-loadable tar in a working directory and rewrite the tar tag to `antigravity-claude-proxy:offline`.
