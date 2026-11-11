# Windows tray project

This is the Tauri tray repo. Branch from main; do not force-push it. Build on Windows.

- `src-tauri/`: Rust tray, child lifecycle, welcome window and autostart opt-in.
- `src/index.html`: first-run introduction. No accounts.json in the isolated
  `proxy-home/.config/antigravity-proxy/` means show the window on the taskbar.
  Later launches with that file present are hidden. Never silently enable autostart.
- `proxy-app/`: upstream v3.0.0, SHA `7c672fdc6fa62fcd50e8f75df5644dad6a63c2dc`.
  Its package.json still says 2.7.7. Preserve upstream tests and license.
- Preserve fork patches: `compat/openai.js`, its test and `/v1/chat/completions`
  route (including reasoning_content), plus the empty-account DB fallback guard.
- OpenClaw's plugin lives in the separate `ltanedo/openclaw-antigravity-proxy` repo.

## Launch contract

`src-tauri/src/lib.rs` starts bundled `bun.exe`, otherwise `bun` on PATH, with
`proxy-app/src/index.js`. End users need no Node or Bun installation.

- `PORT=8086`, `HOST=127.0.0.1`: dashboard and Anthropic/OpenAI-compatible APIs.
- `OAUTH_CALLBACK_PORT=38080`: loopback callback, only listening during login.
- `HOME` and `USERPROFILE`: app-data `proxy-home/` directory.
- `ANTIGRAVITY_DISABLE_DB_FALLBACK=true`: empty accounts wait for OAuth.
- Keep Windows `CREATE_NO_WINDOW`. Start the child immediately; kill and wait on Quit.

## Build and signing

Node >=22.19, official Bun >=1.4.4, Rust/MSVC and WebView2 are prerequisites.
Bun 1.3.13 crashes loading better-sqlite3 13; 1.4.4 is verified. `npm ci`
installs Tauri. `npm run build` copies Bun byte-for-byte, installs production
proxy dependencies with --ignore-scripts, checks SQLite under staged Bun, and
signs the tray EXE plus NSIS and MSI. Never re-sign Bun.

`scripts/sign-windows.ps1` uses `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`,
`AZURE_SIGNING_PROFILE` for an existing Public Trust profile, authenticated by
Azure service principal env vars or a logged-in Azure CLI on PATH. Prefer
`sign code artifact-signing`; fallback uses `AZURE_SIGNTOOL_PATH` and
`AZURE_SIGNING_DLIB_PATH`. Both use SHA256 and RFC 3161 timestamping at
`http://timestamp.acs.microsoft.com`. Tauri runs from src-tauri, hence the config
uses `../scripts/sign-windows.ps1 %1`.

Default build fails if signing is unavailable. `npm run build:unsigned` is local
development only; never publish its artifacts. Never commit credentials, auth
profiles, metadata.json, PFX/P12 files or local signing config. Do not create Azure resources.

Run cargo check, the upstream npm test script (TEST_PORT=8086 for the tray), and
`node tests/test-openai-compat.cjs` in proxy-app. Report live tests honestly;
generation requires a confirmed throwaway Google account. Verify Valid signatures
and timestamp certificates on all three outputs and the original Bun signature
in installed resources. Signing is not whitelisting or a guarantee against Defender/SmartScreen.
