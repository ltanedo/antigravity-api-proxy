# Antigravity Proxy Tray

Tray-first Windows packaging work for `antigravity-claude-proxy`, kept in a public fork so the upstream history stays visible.

## What this repo is

- A Tauri system-tray wrapper around the Antigravity proxy.
- The tray app launches the bundled proxy with a packaged Bun runtime.
- The proxy serves the dashboard, Anthropic-compatible API, and OpenAI-compatible Chat Completions API on `http://127.0.0.1:8086/`.
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
- `bun` available on `PATH`
- Rust installed through `rustup`
- normal Windows desktop environment for Tauri builds

Commands:

```powershell
npm install
npm run build
```

Build flow:

- `npm run runtime:stage` copies the active `bun.exe` into `bundled-runtime/` for packaging.
- `npm install` installed the root Tauri build dependency.
- `npm run build` ran `npm run proxy:install` first, which installed production dependencies inside `proxy-app/`.
- `npm run build` then ran `tauri build` to produce the Windows executable and installer bundles.

Windows bundle output:

- Raw app executable: `src-tauri\target\release\antigravity-proxy-tray.exe`
- NSIS setup executable: `src-tauri\target\release\bundle\nsis\Antigravity Proxy Tray_<version>_x64-setup.exe`
- MSI installer: `src-tauri\target\release\bundle\msi\Antigravity Proxy Tray_<version>_x64_en-US.msi`

The packaged app includes its own Bun runtime, so end users do not need to install Bun or Node separately.

## Dev on Windows

```powershell
npm install
npm run dev
```

## First Run on Windows

After launching the app, use the local dashboard to authenticate:

1. Start the tray app.
2. Open `http://127.0.0.1:8086/#accounts`
3. Click **Add Account**
4. Complete the Google OAuth flow in your browser
5. Return to the dashboard once the account appears

Notes:

- The main dashboard, local Anthropic-compatible API, and local OpenAI-compatible Chat Completions API run on `http://127.0.0.1:8086/`
- The OAuth callback temporarily listens on `http://127.0.0.1:38080/oauth-callback`
- `38080` is only used during the auth flow

## Local API Examples

Once authenticated, the tray app exposes the local proxy on `http://127.0.0.1:8086/`.

List available models:

```powershell
curl.exe -sS http://127.0.0.1:8086/v1/models
```

Send an Anthropic-style test request to `gemini-3.1-pro-low`:

```powershell
@'
{"model":"gemini-3.1-pro-low","max_tokens":128,"messages":[{"role":"user","content":"Reply with exactly: test ok"}]}
'@ | Set-Content -NoNewline anthropic-test.json

curl.exe -sS -X POST http://127.0.0.1:8086/v1/messages `
  -H "content-type: application/json" `
  -H "anthropic-version: 2023-06-01" `
  --data-binary @anthropic-test.json
```

Expected response shape:

```json
{
  "type": "message",
  "role": "assistant",
  "model": "gemini-3.1-pro-low",
  "content": [
    {
      "type": "text",
      "text": "test ok"
    }
  ]
}
```

If you later configure `apiKey` for the proxy, add an `x-api-key` header to `/v1/*` requests.

Send an OpenAI-style Chat Completions request to the same local proxy:

```powershell
@'
{"model":"gemini-3.1-pro-low","messages":[{"role":"user","content":"Reply with exactly: openai ok"}],"max_tokens":128}
'@ | Set-Content -NoNewline openai-test.json

curl.exe -sS -X POST http://127.0.0.1:8086/v1/chat/completions `
  -H "content-type: application/json" `
  --data-binary @openai-test.json
```

Expected response shape:

```json
{
  "object": "chat.completion",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "openai ok"
      }
    }
  ]
}
```
