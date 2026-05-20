# Antigravity Proxy Tray

Tray-first Windows packaging work for `antigravity-claude-proxy`, kept in a public fork so the upstream history stays visible.

## What this repo is

- A Tauri system-tray wrapper around the Antigravity proxy.
- The tray app launches the bundled proxy with `node`.
- The proxy serves the dashboard and Anthropic-compatible API on `http://127.0.0.1:8086/`.
- The Google OAuth callback listener uses `http://127.0.0.1:38080/oauth-callback`.

## Repo layout

- `src-tauri/`: Rust + Tauri tray shell
- `proxy-app/`: bundled proxy source from upstream, plus a small startup patch
- `src/`: tiny hidden placeholder page for the invisible Tauri window

## Current behavior

- Starts hidden and lives in the system tray.
- Left-click opens the dashboard.
- Right-click menu includes `Open Dashboard` and `Quit`.
- On startup, the tray app launches the proxy child with:
  - `PORT=8086`
  - `HOST=127.0.0.1`
  - `OAUTH_CALLBACK_PORT=38080`
  - `ANTIGRAVITY_DISABLE_DB_FALLBACK=true`
- `38080` only listens while an OAuth flow is active.

## Build on Windows

Prereqs:

- `node` available on `PATH`
- Rust installed through `rustup`
- normal Windows desktop environment for Tauri builds

Commands:

```powershell
npm install
npm run build
```

That build command also installs the bundled proxy runtime dependencies inside `proxy-app/`.

Windows bundle output:

- `src-tauri\target\release\bundle\`

## Dev on Windows

```powershell
npm install
npm run dev
```

## Notes for the next agent

- The Tauri tray entry point is [src-tauri/src/lib.rs](src-tauri/src/lib.rs).
- Hidden-window and resource bundling config lives in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json).
- The only intentional upstream proxy code change is the guarded DB fallback in [proxy-app/src/account-manager/index.js](proxy-app/src/account-manager/index.js).
- If you want the packaged app to be fully standalone, the next likely step is bundling a Windows Node runtime or switching the child runtime strategy.
- This repo currently assumes `node` is already present on the Windows machine.
