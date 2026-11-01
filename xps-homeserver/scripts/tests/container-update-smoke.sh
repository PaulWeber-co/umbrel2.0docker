#!/bin/bash
# All writes happen in an explicitly created disposable Docker host.
set -euo pipefail
candidate=${1:?Usage: container-update-smoke.sh image@sha256:digest}
if [[ ! "$candidate" =~ ^ghcr\.io/paulweber-co/xps-homeserver-umbrelos@sha256:[a-f0-9]{64}$ ]]; then
    echo 'Expected an immutable candidate from the approved registry' >&2; exit 1
fi
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
host="codex-xps-smoke-${RANDOM}-$$"
network="$host-network"
cleanup() {
    docker rm -f -v "$host" >/dev/null 2>&1 || true
    docker network rm "$network" >/dev/null 2>&1 || true
    docker volume rm "$host-data" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker pull "$candidate"
# The disposable Docker host must not itself live on 172.17/16: its own
# docker0 uses that subnet, which otherwise shadows the registry return route.
docker network create --subnet 192.168.247.0/24 "$network"
docker run --detach --privileged --cgroupns private --tmpfs /run --tmpfs /run/lock \
    --name "$host" --network "$network" --volume "$host-data:/data" \
    --mount "type=bind,src=$repo,dst=/source,readonly" \
    "$candidate" /sbin/init
ready=false
for _ in $(seq 1 120); do
    if docker exec "$host" systemctl is-active --quiet docker; then ready=true; break; fi
    sleep 2
done
if [ "$ready" != true ]; then docker logs "$host"; exit 1; fi
# Stop only this disposable host's built-in Umbrel before testing a nested one.
docker exec "$host" systemctl stop umbrel
docker exec -e CANDIDATE="$candidate" "$host" bash -c '
    apt-get update -qq && apt-get install --yes --no-install-recommends python3
    install -d /opt/xps-homeserver
    cp -a /source/xps-homeserver /opt/xps-homeserver/
    chown -R root:root /opt/xps-homeserver
    python3 /opt/xps-homeserver/xps-homeserver/scripts/tests/container_update_lifecycle.py
'
