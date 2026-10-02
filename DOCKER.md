# Running umbrelOS in a container

umbrelOS can run as a container on **Docker Desktop for macOS** (Apple Silicon and Intel), **Docker Desktop for Windows** (WSL 2 backend) and **Docker Engine on Linux**. It's the same umbrelOS userland, umbreld and dashboard as a physical install, booted with systemd inside one privileged container. Apps run in umbrelOS's own Docker daemon inside that container, exactly like on an Umbrel Home.

This is great for trying umbrelOS 2.0, developing apps, or running a handful of apps on a machine you already own. For hardware features (Storage Manager, FailSafe, Machines with KVM, GPU passthrough) install umbrelOS on a real device instead.

## Quick start

Requirements:

- Docker Desktop 4.x (or Docker Engine 24+ with the Compose plugin on Linux)
- 4 GB of RAM assigned to Docker, 8 GB+ recommended (Docker Desktop → Settings → Resources)
- 32 GB+ of free space in Docker's virtual disk, more for apps with large data such as Bitcoin Node (Docker Desktop → Settings → Resources → Disk usage limit)

```sh
git clone https://github.com/PaulWeber-co/umbreltest.git umbrel
cd umbrel
docker compose up --detach --build
```

The first build takes 10–30 minutes depending on your machine and connection. It builds the image natively for your CPU (arm64 on an M1/M2/M3/M4 Mac), so no emulation is involved.

Once the containers are up, umbrelOS needs a minute or two to boot. Then open **http://localhost** and create your account. To follow the boot:

```sh
docker exec umbrel journalctl --unit umbrel --follow
```

Docker Desktop shows the instance as the **umbrel** stack under *Containers*. You can start, stop and restart it from there.

## Opening apps

The dashboard opens apps at `http://localhost:<app port>`, just like `http://umbrel.local:<app port>` on a physical install. Docker Desktop can only forward ports that are published when a container is created, but every app brings its own port. The `port-publisher` service takes care of that: it watches which ports umbrelOS serves and creates one small forwarder container (`umbrel-port-<port>`) per port, removing it again when the app is uninstalled. Newly installed apps are reachable within a few seconds.

```sh
docker logs umbrel-port-publisher
```

shows what is published. If a port is already taken on your computer, only that app can't be reached and the publisher logs it and retries every minute. On macOS the AirPlay Receiver occupies ports 5000 and 7000; turn it off under System Settings → General → AirDrop & Handoff if you need an app on one of those ports.

## Settings

Create a `.env` file next to `compose.yaml` to change the defaults, then run `docker compose up --detach` again:

| Variable | Default | Meaning |
| --- | --- | --- |
| `UMBREL_HTTP_PORT` | `80` | Host port for the dashboard |
| `UMBREL_HTTPS_PORT` | `443` | Host port for the dashboard over HTTPS |
| `UMBREL_PUBLISH_ADDRESS` | `0.0.0.0` | Address the dashboard and apps are published on. `0.0.0.0` makes umbrelOS reachable from other devices on your network (like a real Umbrel, e.g. `http://<your-computer-ip>`). Set `127.0.0.1` to keep it to this computer. |
| `UMBREL_PUBLISH_EXCLUDE` | `22` | Space separated ports the publisher never publishes. SSH is excluded by default, use `docker exec -it umbrel bash` or the terminal in Settings instead. |

App sign-in (port `2000`) always uses the same port on the host, because apps redirect to it.

## Everyday tasks

| Task | Command |
| --- | --- |
| Stop / start | `docker compose stop` / `docker compose start` (or the Docker Desktop buttons) |
| Shell inside umbrelOS | `docker exec -it umbrel bash` |
| umbreld logs | `docker exec umbrel journalctl --unit umbrel --follow` |
| Update to newer source | `git pull && docker compose up --detach --build` |
| Remove the containers, keep all data | `docker compose down` |
| Delete everything, including all data | `docker compose down --volumes` |

All state (your account, installed apps and their data, files, app images) lives in the `umbrel_umbrel-data` volume, the container equivalent of the data partition. Recreating the container from a newer image is how updates work in a container, the in-dashboard update button can't replace the OS of a container.

To back up the volume while the instance is stopped:

```sh
docker compose stop
docker run --rm --volume umbrel_umbrel-data:/data --volume "$PWD":/backup debian:trixie tar --create --gzip --file /backup/umbrel-data.tar.gz --directory /data .
docker compose start
```

umbrelOS's own backups (Settings → Backups) to a NAS or cloud storage work as well.

## What works in a container

| Works | Doesn't work in a container |
| --- | --- |
| Dashboard, account, 2FA, widgets, search | Storage Manager and FailSafe (need ZFS and real drives) |
| App Store, installing, updating and opening apps | Umbrel Machines (needs KVM; there is no nested virtualisation on Docker Desktop) |
| Files, file sharing (`smb://localhost`), Cloud | OTA updates (rebuild the image instead, see above) |
| Backups to network/cloud storage | Wi-Fi, static IP, Bluetooth, GPU acceleration |
| Terminal in Settings, `docker exec` | `umbrel.local` from your computer (use `localhost`) |

## Troubleshooting

- **http://localhost doesn't load yet**: the first boot clones the app store and starts umbreld's Docker daemon, give it a few minutes and check `docker exec umbrel journalctl --unit umbrel --follow`.
- **"port is already allocated" for 80 or 443**: something else on your computer uses the port. Set `UMBREL_HTTP_PORT=8080` (and/or `UMBREL_HTTPS_PORT=8443`) in `.env` and open `http://localhost:8080`.
- **Apps open but show "can't be reached"**: check `docker logs umbrel-port-publisher`. Docker Desktop's *Enhanced Container Isolation* blocks the Docker socket the publisher needs; allow it for the image or turn the feature off.
- **HTTPS shows a certificate warning**: umbrelOS uses its own local certificate authority, install it from Settings → HTTPS access.
- **Out of disk space**: app images and data live in Docker Desktop's virtual disk. Raise *Disk usage limit* under Settings → Resources.

## How it works

- `compose.yaml` builds `packages/os/umbrelos.Dockerfile` with `BASE_VARIANT=-container`. That variant leaves out what only a booted OS needs (kernel, firmware, ZFS, NVIDIA drivers, initramfs) and adds `packages/os/overlay-container`.
- The `umbrel` container runs `/sbin/init` privileged, the same way the `npm run dev` environment does, and stops with `SIGRTMIN+3` so systemd shuts umbreld and the apps down cleanly.
- `/data` is a named volume. `/etc/fstab` bind mounts `/home`, `/var/lib/docker`, `/var/log` and friends from it, so umbrelOS keeps its usual layout and the inner Docker daemon stores images on the volume instead of the container's overlay filesystem.
- `port-publisher` runs `umbrel-port-publisher` from the same image. It asks the umbrel container for its public ports (`umbrel-list-public-ports`: LAN ingress app ports, Machines port forwards and wildcard listeners) and keeps a socat forwarder container per port.
