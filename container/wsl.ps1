[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('Install', 'Build', 'Up', 'Stop', 'Down', 'Status', 'Logs', 'Test')]
    [string]$Action,
    [string]$Distribution = 'Ubuntu',
    [ValidateRange(1025, 65535)]
    [int]$Port = 8087
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$wslArgs = @('-d', $Distribution, '-u', 'root', '--cd', $repoRoot, '--exec')

& wsl.exe @wslArgs /bin/true
if ($LASTEXITCODE -ne 0) {
    throw 'WSL could not start. If it reports HCS_E_HYPERV_NOT_INSTALLED, check Windows virtualization and hypervisor boot settings, then reboot. Docker Desktop is not required.'
}

if ($Action -eq 'Install') {
    & wsl.exe @wslArgs bash container/install-docker-engine.sh
    if ($LASTEXITCODE -ne 0) { throw 'Docker Engine installation did not complete.' }
    return
}

# Select the engine inside this distro, regardless of Docker Desktop contexts.
$engineArgs = @('env', '-u', 'DOCKER_HOST', '-u', 'DOCKER_CONTEXT',
    '-u', 'DOCKER_TLS_VERIFY', '-u', 'DOCKER_CERT_PATH',
    "ANTIGRAVITY_HTTP_PORT=$Port", '/usr/bin/docker', '--host', 'unix:///var/run/docker.sock')

if ($Action -in @('Build', 'Up', 'Test')) {
    & wsl.exe @wslArgs sh -c 'if [ "$(cat /proc/1/comm)" = systemd ]; then systemctl start docker; else service docker start; fi'
    if ($LASTEXITCODE -ne 0) { throw 'Could not start Docker Engine. Run Install first.' }
}

if ($Action -eq 'Test') {
    $previousDistro = $env:ANTIGRAVITY_DOCKER_WSL
    try {
        $env:ANTIGRAVITY_DOCKER_WSL = $Distribution
        & node (Join-Path $PSScriptRoot 'smoke-test.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Container smoke test failed.' }
    } finally {
        $env:ANTIGRAVITY_DOCKER_WSL = $previousDistro
    }
    return
}

$composeArgs = switch ($Action) {
    'Build' { @('build', 'proxy') }
    'Up' { @('up', '-d', '--build', '--wait', '--wait-timeout', '90') }
    'Stop' { @('stop', 'proxy') }
    'Down' { @('down') }
    'Status' { @('ps') }
    'Logs' { @('logs', '--tail', '50', 'proxy') }
}
& wsl.exe @wslArgs @engineArgs compose @composeArgs
if ($LASTEXITCODE -ne 0) { throw "Docker Compose $Action failed." }
if ($Action -eq 'Up') {
    Write-Host "Dashboard: http://127.0.0.1:$Port/#accounts"
    Write-Host "OpenClaw URL: http://127.0.0.1:$Port/v1"
    Write-Host 'OAuth callback: localhost:38080. Account storage is separate from the Windows tray.'
}
