#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="${1:-$ROOT_DIR/proxy-app}"
WORK_DIR="${2:-$ROOT_DIR/.offline-image-work}"
IMAGE_ROOT="$WORK_DIR/agcp-image-root"
OCI_DIR="$WORK_DIR/agcp-oci"
LAYER_TAR="$WORK_DIR/agcp-layer.tar"
UNRETAGGED_TAR="$WORK_DIR/antigravity-claude-proxy-offline-linux-amd64-unretagged.tar"
FINAL_TAR="$WORK_DIR/antigravity-claude-proxy-offline-linux-amd64.tar"
TAG="antigravity-claude-proxy:offline"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require node
require npm
require rsync
require tar
require python3
require regctl

if [[ ! -f "$SOURCE_DIR/package.json" ]]; then
  echo "source dir does not look like the proxy app: $SOURCE_DIR" >&2
  exit 1
fi

rm -rf "$WORK_DIR"
mkdir -p "$IMAGE_ROOT"

echo "==> staging source tree"
rsync -a \
  --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'tests' \
  --exclude 'docs' \
  --exclude 'images' \
  "$SOURCE_DIR"/ "$IMAGE_ROOT"/

echo "==> installing production dependencies for linux/amd64"
(
  cd "$IMAGE_ROOT"
  npm_config_platform=linux \
  npm_config_arch=x64 \
  npm_config_target_platform=linux \
  npm_config_target_arch=x64 \
  npm ci --omit=dev --ignore-scripts

  npm_config_platform=linux \
  npm_config_arch=x64 \
  npm_config_target_platform=linux \
  npm_config_target_arch=x64 \
  npm rebuild better-sqlite3 --foreground-scripts --verbose
)

mkdir -p "$IMAGE_ROOT/data"

echo "==> creating app layer tar"
tar -C "$IMAGE_ROOT" -cf "$LAYER_TAR" .

echo "==> importing base image into OCI layout"
regctl image copy \
  --platform linux/amd64 \
  docker.io/library/node:22-bookworm-slim \
  "ocidir://$OCI_DIR:base"

echo "==> composing offline image"
regctl image mod "ocidir://$OCI_DIR:base" \
  --create "ocidir://$OCI_DIR:offline" \
  --layer-add "tar=$LAYER_TAR" \
  --config-entrypoint '["node","/app/src/index.js"]' \
  --config-cmd '' \
  --env NODE_ENV=production \
  --env HOME=/data \
  --env HOST=0.0.0.0 \
  --env PORT=8080 \
  --env OAUTH_CALLBACK_PORT=38080 \
  --expose-add 8080 \
  --expose-add 38080 \
  --volume-add /data

echo "==> exporting docker-loadable tar"
regctl image export "ocidir://$OCI_DIR:offline" "$UNRETAGGED_TAR"

echo "==> rewriting RepoTags to $TAG"
python3 "$ROOT_DIR/offline-image/scripts/retag_docker_tar.py" \
  "$UNRETAGGED_TAR" \
  "$FINAL_TAR" \
  "$TAG"

echo "==> final tar"
ls -lh "$FINAL_TAR"
shasum -a 256 "$FINAL_TAR"
