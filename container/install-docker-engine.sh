#!/usr/bin/env bash
# Run through wsl.ps1 Install. Uses Docker's signed Ubuntu apt repository.
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
    echo 'Run this installer as root inside Ubuntu WSL.' >&2
    exit 1
fi
. /etc/os-release
if [[ ${ID:-} != ubuntu ]]; then
    echo 'This installer supports Ubuntu only.' >&2
    exit 1
fi
codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
case "$codename" in
    jammy|noble|resolute|stonking) ;;
    *) echo "Unsupported Ubuntu release: $codename" >&2; exit 1 ;;
esac

# Do not silently remove another engine or its container storage.
conflicts=()
for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
    if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) == 'install ok installed' ]]; then
        conflicts+=("$package")
    fi
done
if (( ${#conflicts[@]} )); then
    printf 'Review conflicting installed packages before continuing: %s\n' "${conflicts[*]}" >&2
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl --fail --silent --show-error --location --proto '=https' \
    https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# A dedicated source file avoids overwriting a pre-existing Docker apt config.
source_file=/etc/apt/sources.list.d/antigravity-docker.sources
existing_source=$(grep -rl 'download.docker.com/linux/ubuntu' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null || true)
if [[ -z "$existing_source" || "$existing_source" == "$source_file" ]]; then
    cat > "$source_file" <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $codename
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
fi
apt-get update
apt-get install -y --no-install-recommends \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

if [[ $(cat /proc/1/comm) == systemd ]]; then
    systemctl start docker
else
    service docker start
fi
# Local Unix socket only; no TCP daemon listener and no docker-group membership changes.
/usr/bin/docker --host unix:///var/run/docker.sock info --format 'Engine: {{.ServerVersion}} ({{.OSType}})'
/usr/bin/docker --host unix:///var/run/docker.sock compose version
