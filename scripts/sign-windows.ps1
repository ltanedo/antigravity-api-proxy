[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$FilePath,
    [switch]$CheckConfiguration
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:ANTIGRAVITY_UNSIGNED_BUILD -eq '1') {
    Write-Warning "Unsigned development build: skipping $FilePath. Do not publish."
    exit 0
}

foreach ($name in @('AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "Missing $name. Configure an existing Azure Public Trust profile, or use npm run build:unsigned for local development."
    }
}
$servicePrincipal = $env:AZURE_TENANT_ID -and $env:AZURE_CLIENT_ID -and $env:AZURE_CLIENT_SECRET
if (-not $servicePrincipal) {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw 'Provide Azure service principal environment variables or put the logged-in Azure CLI on PATH.'
    }
    & az account show --output none
    if ($LASTEXITCODE -ne 0) { throw 'Azure CLI login is unavailable. Use az login --use-device-code.' }
}

$sign = Get-Command sign -ErrorAction SilentlyContinue
if (-not $sign) {
    foreach ($name in @('AZURE_SIGNTOOL_PATH', 'AZURE_SIGNING_DLIB_PATH')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if (-not $value -or -not (Test-Path -LiteralPath $value -PathType Leaf)) {
            throw "Install the sign CLI, or set $name for the SignTool/dlib fallback."
        }
    }
}
if ($CheckConfiguration) { Write-Host 'Signing configuration is present.'; exit 0 }
if (-not $FilePath) { throw 'A file to sign is required.' }
$resolved = (Resolve-Path -LiteralPath $FilePath).Path
if ([IO.Path]::GetFileName($resolved) -ieq 'bun.exe') { throw 'Never re-sign the bundled Bun runtime.' }
Write-Host "Signing $resolved"

if ($sign) {
    $authOptions = @()
    if (-not $servicePrincipal) { $authOptions = @('--azure-credential-type', 'azure-cli') }
    & $sign.Source code artifact-signing `
        --artifact-signing-endpoint $env:AZURE_SIGNING_ENDPOINT `
        --artifact-signing-account $env:AZURE_SIGNING_ACCOUNT `
        --artifact-signing-certificate-profile $env:AZURE_SIGNING_PROFILE `
        --timestamp-url 'http://timestamp.acs.microsoft.com' `
        --timestamp-digest SHA256 --file-digest SHA256 --verbosity Warning @authOptions $resolved
    if ($LASTEXITCODE -ne 0) { throw "Artifact Signing failed (exit $LASTEXITCODE)." }
} else {
    # No credentials are written here. Keep metadata outside the checkout and remove it.
    $metadataPath = Join-Path ([IO.Path]::GetTempPath()) ("artifact-signing-{0}.json" -f [guid]::NewGuid())
    try {
        @{
            Endpoint = $env:AZURE_SIGNING_ENDPOINT
            CodeSigningAccountName = $env:AZURE_SIGNING_ACCOUNT
            CertificateProfileName = $env:AZURE_SIGNING_PROFILE
            ExcludeCredentials = @('ManagedIdentityCredential')
        } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding UTF8
        & $env:AZURE_SIGNTOOL_PATH sign /fd SHA256 /td SHA256 `
            /tr 'http://timestamp.acs.microsoft.com' `
            /dlib $env:AZURE_SIGNING_DLIB_PATH /dmdf $metadataPath $resolved
        if ($LASTEXITCODE -ne 0) { throw "SignTool failed (exit $LASTEXITCODE)." }
    } finally {
        Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
    }
}

$signature = Get-AuthenticodeSignature -LiteralPath $resolved
if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
    throw "Signature verification failed for $resolved (status $($signature.Status), timestamp required)."
}
Write-Host "Signer: $($signature.SignerCertificate.Subject)"
Write-Host "Timestamp: $($signature.TimeStamperCertificate.Subject)"
