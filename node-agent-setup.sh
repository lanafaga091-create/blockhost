#!/usr/bin/env bash
set -euo pipefail

IMAGE="${BLOCKHOST_DOCKER_IMAGE:-itzg/minecraft-bedrock-server:latest}"

echo "[1/4] Checking Docker..."
docker version >/dev/null

echo "[2/4] Pulling Minecraft Bedrock runtime image: ${IMAGE}"
docker pull "${IMAGE}"

echo "[3/4] Checking storage quota support..."
if [[ "${BLOCKHOST_REQUIRE_STORAGE_LIMIT:-true}" == "true" ]]; then
  echo "Docker storage quota is required. For hard per-container storage limits, the Docker host must support --storage-opt size=... (commonly overlay2 with the required backing filesystem/project quota configuration)."
fi

echo "[4/4] Node Agent ready. Start BlockHost with BLOCKHOST_DOCKER_ENABLED=true."
echo "IMPORTANT: protect the Node Agent with a strong BLOCKHOST_NODE_KEY and do not expose the Docker socket or Node Agent publicly."
