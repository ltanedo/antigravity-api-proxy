# Antigravity Proxy Tray

A Windows Tauri tray app with bundled Bun. The dashboard, Anthropic API and
OpenAI Chat Completions API listen on **http://127.0.0.1:8086/**. Google OAuth stays
in the proxy. Tray version: **0.4.0**.

`proxy-app/` vendors upstream
[`v3.0.0`](https://github.com/badrisnarayanan/antigravity-claude-proxy/tree/7c672fdc6fa62fcd50e8f75df5644dad6a63c2dc),
SHA `7c672fdc6fa62fcd50e8f75df5644dad6a63c2dc`. Upstream's package version still
says 2.7.7. Local patches add `/v1/chat/completions`, `reasoning_content` for
streaming and non-streaming thinking, and the isolated-account DB fallback guard.

## First run

1. Launch the tray. The proxy starts immediately. With no isolated accounts.json,
   a welcome window appears on the taskbar.
2. Click **Open Accounts**, then **Add Account** in the dashboard and complete
   Google OAuth. The callback binds to `127.0.0.1:38080` only during login.
3. **Start with Windows** is off by default. Opt in with the welcome checkbox
   or the checked tray menu item. Either control also turns it off.
4. Close the window or choose **Continue in tray**. Left-click the tray icon for
   the dashboard; right-click for **Open Dashboard**, **Start with Windows**, or
   **Quit**. Quit stops the child and releases port 8086.

Later launches with `proxy-home/.config/antigravity-proxy/accounts.json` present
stay hidden. Until that file exists, the introduction appears again. Installing
or launching never silently enables autostart. Existing preferences are preserved.

The isolated home is `%APPDATA%\com.ltanedo.antigravityproxytray\proxy-home`.
The child receives it as `HOME` and `USERPROFILE`, plus `PORT=8086`,
`HOST=127.0.0.1`, `OAUTH_CALLBACK_PORT=38080`, and
`ANTIGRAVITY_DISABLE_DB_FALLBACK=true`. Empty accounts wait for OAuth without
probing the Antigravity database. `CREATE_NO_WINDOW` prevents a flashing Bun console.

## Build on Windows

For the optional Linux proxy container, see [container/README.md](container/README.md).
It serves the same OpenClaw `/v1` endpoint without the Windows tray UI. Quit the
tray before using the container on port 8086; their account stores are separate.

Prerequisites: Node >=22.19, official Bun >=1.4.4 on PATH, Rust/MSVC build tools,
and WebView2. Bun 1.3.13 crashes loading better-sqlite3 13.0.3; 1.4.4 is verified.
End users do not need Node or Bun installed.

```powershell
npm ci
npm run build
```

The build stages Bun byte-for-byte, installs production proxy dependencies with
`--ignore-scripts`, smoke-tests SQLite under staged Bun, then builds and signs.
better-sqlite3 13 ships prebuilt native modules. Bun's original Authenticode
signature is preserved; the tray publisher never re-signs it.

### Existing Azure signing profile

Default release builds fail if signing is unavailable. Configure an existing
Artifact Signing **Public Trust** profile:

```powershell
$env:AZURE_SIGNING_ENDPOINT = '<existing account endpoint>'
$env:AZURE_SIGNING_ACCOUNT = '<existing account name>'
$env:AZURE_SIGNING_PROFILE = '<existing public-trust profile>'
# Use existing AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET env vars,
# or a logged-in Azure CLI on PATH. For broker errors: az login --use-device-code
dotnet tool install -g --prerelease sign
sign code artifact-signing --help
npm run build
```

If the sign CLI cannot be installed, use x64 Windows SDK SignTool newer than
10.0.22621.755 beside the x64 Artifact Signing dlib and dependencies, with the
runtime required by that dlib version (.NET 8 or .NET 10).
Set `AZURE_SIGNTOOL_PATH` and `AZURE_SIGNING_DLIB_PATH` to those files.
The wrapper creates temporary metadata outside the checkout and removes it.
Do not create new Azure resources or commit credentials, PFX/P12 or metadata.

Tauri invokes `../scripts/sign-windows.ps1 %1` from `src-tauri/`. It signs all
three outputs with SHA256 and an RFC 3161 timestamp from
`http://timestamp.acs.microsoft.com`, verifies signatures, and prints the signer
subject without secrets. After bundling, the build wrapper signs the release EXE
again because Tauri restores its original unsigned executable:

- `src-tauri/target/release/antigravity-proxy-tray.exe`
- `src-tauri/target/release/bundle/nsis/Antigravity Proxy Tray_0.4.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Antigravity Proxy Tray_0.4.0_x64_en-US.msi`

Check each with `Get-AuthenticodeSignature` (Valid, signer and timestamp present)
and `signtool verify /pa /v`; check Bun's original signature after installation.
A valid Public Trust signature identifies the publisher, but a first release
can still show a SmartScreen warning while reputation accrues; it does not
whitelist the app or guarantee Defender will never alert.

```powershell
npm run build:unsigned # local development only; never publish these artifacts
npm run dev
```

## OpenClaw 2026.9.9

Use the separate
[`ltanedo/openclaw-antigravity-proxy`](https://github.com/ltanedo/openclaw-antigravity-proxy)
plugin. It stores no Google tokens and discovers models live from `/v1/models`.

```powershell
openclaw plugins install git:github.com/ltanedo/openclaw-antigravity-proxy@main --force
$env:ANTIGRAVITY_PROXY_API_KEY = 'local'
openclaw onboard --auth-choice antigravity-proxy --non-interactive
openclaw models list
```

Provider id: `antigravity-proxy`. Base URL: `http://127.0.0.1:8086/v1`, including
`/v1`. Any key works without a proxy `apiKey`; otherwise the env var must match
it. The proxy accepts `Authorization: Bearer` or `x-api-key`.

Start the tray and wait for `/health` before starting the **OpenClaw Gateway**
scheduled task. Arrange that same order at logon, or start the gateway manually
after the tray. Discovery fails soft when the proxy is unavailable and the
refreshable catalog retries within 60 seconds. Choose `antigravity-proxy/<id>`
refs from the live list; the v3 registry filters disabled/placeholder models.

## Verify

```powershell
curl.exe -sS http://127.0.0.1:8086/health
curl.exe -sS http://127.0.0.1:8086/v1/models
$env:TEST_PORT = '8086'
npm --prefix proxy-app test
node proxy-app/tests/test-openai-compat.cjs
cargo check --manifest-path src-tauri/Cargo.toml
```

The full upstream suite includes Google integration tests; use only a linked
throwaway account for generation. Empty accounts keep the server healthy but
model discovery returns 503 until an account is linked. Compatibility unit
tests cover visible text, reasoning, tool calls and usage without Google access.
