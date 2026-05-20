Overview

- This repo is a public fork of `badrisnarayanan/antigravity-claude-proxy`, but the working tree has been repurposed into a Tauri tray wrapper project.
- The tray shell is in `src-tauri/`.
- The bundled Node proxy source is in `proxy-app/`.
- Runtime target is Windows first.

Build Context

- Build on Windows, not on macOS.
- The expected workflow is:
  - `npm install`
  - `npm run build`
- `npm run build` automatically installs `proxy-app` production dependencies before the Tauri bundle step.
- `node` must already be on `PATH`.
- Rust must already be installed through `rustup`.

Ports

- Main local dashboard and Anthropic-compatible API: `127.0.0.1:8086`
- Google OAuth callback: `127.0.0.1:38080`
- Important: `38080` is on-demand, not permanently listening.

Key Files

- `src-tauri/src/lib.rs`: tray startup, child process launch, dashboard open, quit handling
- `src-tauri/tauri.conf.json`: hidden window, bundled `proxy-app` resource
- `proxy-app/src/account-manager/index.js`: patched to avoid noisy DB fallback on first run
- `README.md`: human-facing Windows build notes

Current Assumptions

- The app is tray-only.
- The dashboard opens in the browser instead of embedding a window.
- The child proxy is launched with `node`, not Bun and not an embedded runtime.
- The tray app stores its own isolated app data instead of reusing the normal user profile directly.

What Was Validated On macOS

- Tauri compiled successfully.
- Running the tray app locally launched the bundled proxy.
- `http://127.0.0.1:8086/health` returned `ok`.
- Triggering `/api/auth/url` caused the callback listener to bind on `127.0.0.1:38080`.

Likely Next Windows Tasks

- Produce the first Windows release build.
- Test autostart persistence after login.
- Confirm the tray icon behavior on Windows specifically.
- Decide whether to keep the `node on PATH` assumption or bundle a runtime.
- If desired, rename the fork/repo branding from `docker` wording to `tray` wording.
