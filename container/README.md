# Lightweight proxy container

This packages the proxy from the signed tray's v0.4.0 source, including upstream
v3.0.0, OpenAI chat completions/reasoning and the disabled database fallback.
It is a Linux/amd64 alternative to the tray's proxy process. It does not contain
the Tauri UI, OpenClaw or Slack. It does not change the installed Windows tray.

The layout builds on `origin/feature/docker-compose-testing` and
`origin/offline-image-release`: a proxy-only image with persistent HOME and
OAuth callback forwarding. Their old Node/root-user images are not reused.

## Requirements and startup

### CLI on Windows without Docker Desktop

Use Docker Engine directly in Ubuntu WSL2. The PowerShell wrapper invokes the
Linux Docker CLI and its Unix socket, so Docker Desktop can stay stopped or be
absent. It does not expose the engine on a TCP port or switch Windows Docker
contexts. Engine installation follows
[Docker's Ubuntu apt instructions](https://docs.docker.com/engine/install/ubuntu/).

First verify `wsl -d Ubuntu --exec uname -r` works. If WSL reports
`HCS_E_HYPERV_NOT_INSTALLED`, changing container CLIs does not fix the Windows
hypervisor. On this laptop the firmware and required Windows features are
enabled, but the hypervisor is not running. In **Administrator PowerShell**,
inspect `bcdedit /enum`; if `hypervisorlaunchtype` is Off, run:

```powershell
bcdedit /set hypervisorlaunchtype auto
```

Save your work and reboot Windows, then verify WSL again. The agent's normal
session cannot read/change this boot configuration. See
[Microsoft's WSL troubleshooting](https://learn.microsoft.com/en-us/windows/wsl/troubleshooting).
If the setting is already Auto, investigate the hypervisor startup error instead
of assuming the boot setting is the cause. No script here reboots Windows.

From the repository root, using ordinary PowerShell after WSL starts:

```powershell
.\container\wsl.ps1 Install  # Installs Engine, Buildx and Compose inside Ubuntu
.\container\wsl.ps1 Test     # Fresh-volume tests; requires the existing host Node
.\container\wsl.ps1 Up       # Uses 8087 so the Windows tray can remain on 8086
.\container\wsl.ps1 Status
.\container\wsl.ps1 Logs
.\container\wsl.ps1 Stop
```

The installer uses Linux root via `wsl -u root`, not an elevated Windows shell.
It refuses to remove conflicting distro packages, leaves existing container
storage intact, and does not add Windows autostart or change OpenClaw settings.
The Docker daemon may start with Ubuntu's service manager; the proxy still uses
`restart: no`. Ubuntu must stay running while the proxy is in use.

The default CLI dashboard is `http://127.0.0.1:8087/#accounts`. For a later switch
to the existing OpenClaw URL, quit the Windows tray, run `wsl.ps1 Stop`, then
`wsl.ps1 Up -Port 8086`. Linking accounts in the container remains a separate
step. The callback still uses port 38080, so do not start tray OAuth concurrently.
Specify `-Distribution <name>` if your Ubuntu WSL distribution has another name.

CLI support has been syntax-checked; installation and execution remain blocked
until this laptop's WSL2 hypervisor starts successfully.

### Docker Desktop or another working Docker engine

Use an approved Docker installation with a running Linux engine and Compose v2.
On Windows, Docker Desktop requires working virtualization/WSL2 or another
supported backend. Docker Desktop's enterprise licensing also needs review.
You do not need Node, Rust, Bun or Azure credentials on the host to build/run.

1. Choose **Quit** from the Windows tray menu before using the default port 8086.
   Closing the welcome window is not Quit.
2. From the repository root:

   ```powershell
   docker compose build
   docker compose up -d --wait
   ```

3. Open `http://127.0.0.1:8086/#accounts` and link an authorized Google account.
   The named volume starts empty; it does not import the Windows tray's tokens.
4. Keep OpenClaw's provider URL `http://127.0.0.1:8086/v1`. Start/use its gateway
   after the proxy is healthy. An empty profile returns 503 from `/v1/models`;
   live model discovery and completions require a linked account.

The OAuth browser must run on the same host as Docker for the localhost callback.
The container listens on `0.0.0.0` **inside its network namespace** so forwarding
works. Compose publishes only `127.0.0.1:8086` and `127.0.0.1:38080` on the host.
The application opens the callback listener only during login. Docker reserves
the published host callback port for the container's lifetime, so a TCP port
probe alone does not prove that an OAuth flow is active.

For parallel evaluation while the tray stays on 8086, use
`$env:ANTIGRAVITY_HTTP_PORT = '8087'` before the Compose commands and open 8087.
Do not initiate tray OAuth concurrently: both use host callback port 38080.
Do not change OpenClaw's working provider just to evaluate the empty container.

## Storage, shutdown and authentication

```powershell
docker compose logs --tail 50 proxy
docker compose stop              # Keeps the container and account volume
docker compose start --wait      # Starts it again
docker compose down              # Removes the container; keeps the account volume
```

Restart policy is `no`: the container does not automatically start with Windows
or Docker. Start it explicitly. Do not run `down --volumes` on your real profile
unless you intend to delete its accounts and settings.

HOME is `/data`; accounts, settings, signatures and usage live in the named
`proxy-home` volume. Treat volume backups as credentials. Do not mount the tray's
profile into both running processes, commit it or bake it into an image.
New files use umask 077 and the data directory is owned by UID 1000 with mode 700.
Docker administrators still have access to the volume; it is not encrypted by
this setup. Set a Web UI password and API key in dashboard settings if needed;
OpenClaw's `ANTIGRAVITY_PROXY_API_KEY` must match that API key. Loopback is not
authentication against other processes/users on the same host.

## What is kept small and isolated

- Digest-pinned Node dependency stage; only production dependencies enter runtime.
- Digest-pinned official Bun 1.4.4 slim runtime; no Node/npm/compiler in final image.
- Build context allowlist excludes Windows binaries, profiles and signing files.
- UID/GID 1000, read-only root filesystem, dropped capabilities, no new privileges.
- Only a named data volume and a 64 MiB temporary filesystem are writable; no
  host home-directory bind mount, Docker socket or privileged mode.
- Limits: 512 MiB container RAM, 1 CPU, 128 processes, rotated container logs.
- HTTP liveness checks use `HEAD /favicon.svg`, so checks do not query Google
  quotas or generate model requests. `/health` is the separate detailed check.

The RAM limit applies to this container, not the additional Docker Desktop VM.
These settings reduce exposure; they are not a sandbox for OpenClaw running on
Windows and do not restrict Google egress. Review pinned dependencies/images for
updates and vulnerabilities before organizational deployment.

## Verification

The Docker build checks that better-sqlite3 loads and can query under Linux Bun,
then runs the OpenAI compatibility and mocked model-registry tests. No Google
account is used in these checks. The checked-in CSS is already built upstream.

On a host with Node >=22.19 and Docker's Linux engine running:

```powershell
node container/smoke-test.mjs
```

This builds and runs a disposable Compose project with a fresh volume on HTTP
port 18086 and OAuth port 38080. It verifies health, the empty-account 503,
OpenAI error format, DB fallback guard, callback bind/cancel/release, container
restrictions, volume persistence and graceful shutdown. It deletes only its own
randomly named project's volume. It never copies linked accounts or completes
Google OAuth. Live completion testing is a separate authorized step after login.

Initial authoring on 2026-11-11: Compose validation and Windows Bun offline tests
were run. Docker Desktop reported `hasNoVirtualization: true`; Windows reported
`HypervisorPresent: False`, despite firmware virtualization support being enabled.
The Linux image build, smoke test and image size therefore remain **unverified**
until a working Linux engine is available. No runnable image was published.

## Monitoring and signing

A container changes packaging and process isolation. It is not a way to bypass
Sophos, Defender, application-control or company policy. Docker itself, the
downloaded image, mounted files and network connections may be monitored or
restricted. Docker documents that host security tools can observe traffic from
its backend: https://docs.docker.com/desktop/features/networking/

The Windows tray's Azure Authenticode signature does **not** sign this Linux
image. OCI image signing, registry approval and vulnerability scanning are
separate controls; no container signature or security clearance is claimed here.
Containerizing just the proxy leaves OpenClaw's host tool permissions unchanged,
and corporate data still goes to Google. Get the original quarantine reviewed
and obtain approval for the container deployment before using a company laptop.

## Optional offline transfer

After a successful, approved build:

```powershell
docker save --output antigravity-proxy-0.4.0-linux-amd64.tar antigravity-proxy:0.4.0-local
Get-FileHash .\antigravity-proxy-0.4.0-linux-amd64.tar -Algorithm SHA256
# On the target host, with compose.yaml available:
docker load --input antigravity-proxy-0.4.0-linux-amd64.tar
docker compose up -d --no-build --wait
```

This transfers the image only, not its account volume. The checksum verifies
transfer integrity, not publisher identity. The target still needs Google network
access for login and model requests. Do not commit the exported image tar to git.
