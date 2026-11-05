# Reframe, core: design

Date: 2026-11-05
Status: draft, waiting for review

## Summary

Reframe turns an old laptop into a wall dashboard. The laptop's display shows
a calm, glassy dashboard (clock, weather, calendar, system and service status,
music from AirPlay) over slow aerial video, and a phone can control it.

It ships as one Docker image that runs either on any Linux machine with Docker
or as a community app on umbrelOS. This spec covers the first of three
independent pieces:

1. **Core (this spec).** A new, clean repository with the dashboard, the
   container, the Umbrel community app, docs and screenshots.
2. **New widgets.** Own spec and plan, after the core exists.
3. **umbrelOS as a container.** Stays in the existing fork, because it contains
   Umbrel code under PolyForm Noncommercial. Reframe's repo only links to it.

The dashboard exists today as `xps-homeserver/dashboard` in the fork and runs
on one specific Dell XPS 13. The core work is turning that into something that
runs on any laptop and contains nothing personal.

## Goals

- `docker compose --profile web up` works on any Linux, macOS or Windows
  machine with Docker and shows a working dashboard with demo data.
- `docker compose --profile kiosk up` on a Linux laptop shows the dashboard
  full screen on the laptop's own display.
- The same files install as an app from an Umbrel community app store.
- No personal data, no XPS-specific code, no code or media we may not
  redistribute.
- A repository that reads as a maintained project: sensible history, honest
  README with screenshots, working CI.

## Non-goals

- Running umbrelOS itself in Docker (piece 3).
- New widgets beyond what exists today (piece 2). Only the replacements that
  the cleanup forces (see To-dos).
- A native phone app. The phone uses the same web UI.
- Bundling any video. Reframe ships none.
- Getting into the official Umbrel App Store. The community store comes first;
  the official store needs a separate submission and review.

## Repository

Name: `reframe`. License: MIT. Layout:

```
reframe/
  app/                  Node.js server and web UI, no runtime dependencies
    server/             widgets, sources, control, http
    web/                UI, CSS, fonts, i18n/en.json, i18n/de.json
    test/               unit tests and fixtures
  host/                 hardware helpers, run inside the kiosk container
    reframe-display     backlight and screen on/off
    reframe-ambient     webcam brightness (optional)
    reframe-kiosk       seatd + cage + Chromium
  docker/
    Dockerfile          one image, amd64 and arm64
  compose.yaml          profiles: web, kiosk; optional airplay
  umbrel-app-store.yml  community store manifest
  reframe-dashboard/    Umbrel app: umbrel-app.yml, docker-compose.yml
  docs/                 install, configuration, hardware, umbrel, widgets
  media/                empty; users put their own clips here (README only)
  .github/workflows/    test, build and push image
  LICENSE  ATTRIBUTION.md  README.md  SECURITY.md
```

The Umbrel store files sit at the repository root next to the code. A
community store only looks at directories that contain an `umbrel-app.yml`, so
the other directories do not interfere. Check this against the current Umbrel
app documentation when building the store files.

## What is removed

| Item | Why |
| --- | --- |
| Knuddl integration (`knuddl.js`, `minifunk` widget, tests, env keys) | Personal service of the author. The database URL and invite handling go with it. |
| Spotify Connect (go-librespot, `sources/spotify.js`, tests) | Did not work reliably. AirPlay stays. |
| Debian installer stick, preseed, Broadcom Wi-Fi driver, kernel guard | Tied to one laptop. |
| Dell battery BIOS handling, `xps-*` names, `xps.local`, `umbrel.local` alias | Same. |
| Umbrel container updater (`xps_update_*`), rollback scripts | Belongs to piece 3 and to the fork. |
| Mixkit clips, `backgrounds.txt`, `fetch-backgrounds.sh` | Mixkit's terms forbid scripted bulk download and handing items to third parties. |
| `docs/superpowers/*` references, production evidence | Internal working notes. |
| Names ("Paul", "Jane"), Hamburg, example addresses | Replaced by neutral demo data (see Demo data). |

Every removed item also gets removed from tests, docs and env examples. A final
scan (below) checks that nothing slipped through.

## Components

### Server (`app/server`)

Kept from the current dashboard: store, hub (server-sent events), http,
access control (DNS-rebinding and CSRF protection, optional PIN), layout,
control (modes, schedule, rules, feature switches), and the widgets weather,
calendar (ICS), services, server, backup, commute, home-assistant, wiki, music,
ambient.

Changes:

- **Config.** Today everything comes from `dashboard.env`. New order of
  precedence: environment variable, then `/data/config.json`, then default.
  The web UI writes `/data/config.json`. Secrets (API keys, tokens) may be set
  in either place; the UI never shows them again after saving.
- **First-run setup.** `/setup` walks through language, place (search backed by
  the Open-Meteo geocoding API, no key), time zone, calendar links, optional
  integrations. It is skippable; every widget works with demo data until
  configured.
- **Default place.** No default city. Until the user picks one, weather shows
  demo data marked "Example".
- **To-dos.** Replaces the Knuddl list. A local list stored in
  `/data/todos.json`, edited from the phone at `/control`. Same tile, same
  colours per assignee (names are free text, no defaults).
- **Services widget.** Keeps reading container state from a small collector.
  In the Umbrel app and the `web` profile the collector is off by default,
  because it needs the Docker socket. The tile then hides itself. Enabling it
  is documented, including the security cost.
- **Photos backup widget.** Reads the Umbrel Photos folder layout. Only useful
  on umbrelOS; hidden elsewhere unless a path is configured.
- **Music.** AirPlay metadata pipe from shairport-sync only. Spotify code and
  settings removed.

### Web UI (`app/web`)

- All user-visible strings move into `i18n/en.json` and `i18n/de.json`. English
  is the default; the language is a setting. Dates and numbers use `Intl` with
  the chosen locale. The German strings are the existing texts, so German stays
  complete.
- The fallback background is an animated gradient (CSS/canvas, no video
  decoding) with the existing four times of day (morning, day, evening, late).
  It is what screenshots show.
- Clip handling is unchanged in spirit: files named
  `<scene>-<name>.mp4` in the media directory are used; a `.jpg` poster is made
  by the image on first start with ffmpeg if missing. Names are free-form
  instead of Mixkit ids.

### Host helpers (`host/`)

Small shell or Python programs that run in the kiosk container and talk to
hardware through `/sys` and `/dev`. Each has one job and a plain CLI so it can
be tested without a display.

- `reframe-display`: set brightness in percent through the first
  `/sys/class/backlight/*` entry; switch the screen off and on with
  `wlr-randr`. Does nothing, and says so, when no backlight exists.
- `reframe-ambient`: optional webcam brightness measurement as today (a few
  frames in memory, median, only a number leaves). Off by default.
- `reframe-kiosk`: start `seatd`, `cage` and Chromium on the display with GPU
  video decoding where available.
- Battery care is only offered if
  `/sys/class/power_supply/BAT*/charge_control_end_threshold` exists.

The server asks the helpers over a Unix socket inside the container instead of
the current root-to-user systemd split. The kiosk container is one trust
domain; the Chromium process runs as an unprivileged user inside it.

### AirPlay

Optional sidecar `shairport-sync` (official image, GPL, unmodified) with the
metadata pipe in a shared volume. It is an opt-in compose profile, because
AirPlay needs host networking for mDNS and an audio device.

## Packaging

### Image

One multi-stage Dockerfile. Base: Debian slim, Node LTS, Chromium, `cage`,
`seatd`, `wlr-randr`, `ffmpeg`, Mesa VA-API drivers. Built for amd64 and arm64
by GitHub Actions and pushed to GHCR, tagged by version and by digest. Only
the kiosk entrypoint needs the heavy packages; the `web` profile uses the same
image with a different command, which keeps one thing to test and release.

### Compose profiles

- `web`: port 7777, volume `/data`, no devices. Demo data until configured.
- `kiosk`: adds `/dev/dri`, `/dev/input`, `/dev/tty*`, a read-write `/sys`
  backlight mount and optionally `/dev/video*`. It runs privileged because
  `seatd` and VT switching need it. This is documented as the price of driving
  a display from a container.
- `airplay`: the shairport-sync sidecar.

### Umbrel app

`reframe-dashboard/` contains `umbrel-app.yml` (manifest, gallery, release
notes, support links) and `docker-compose.yml` with the usual `app_proxy`
service. The web UI sits behind Umbrel's login, which replaces the PIN for
phone control. The kiosk talks to the server inside its own container and
needs no login. The image reference is pinned by digest. Users add the
repository URL as a community app store in umbrelOS and install the app.

## Hardware and umbrelOS: what we cannot verify here

This session has no display, no GPU and no umbrelOS. The kiosk container is
built from established patterns (seatd and cage in a container with DRM
access) but untested on hardware. Deliverables for this risk:

- the `web` profile is complete and tested on its own,
- `docs/hardware.md` lists the exact checks to run on a laptop and how to
  report results,
- the README states what is tested (web profile, unit tests, CI image build)
  and what is community-tested (kiosk on specific hardware), and it keeps that
  list current.

Points that may fail on umbrelOS and are described in the docs rather than
hidden: umbrelOS may own the first virtual console, so the kiosk uses a free
one; privileged mode may not be accepted by every store policy, which is fine
for a community store and one reason the official store is out of scope.

## Licensing and attribution

- Reframe code: MIT, copyright the author.
- Font Onest: SIL OFL, license text stays next to the font files.
- No video, no Mixkit material. User-supplied clips are the user's business;
  the docs say so and recommend CC0 or own footage. A later CC0 media pack
  would get its own attribution file.
- Data APIs (Open-Meteo, Wikipedia, TomTom): named in `ATTRIBUTION.md` with
  their terms. TomTom stays optional and needs the user's own key.
- shairport-sync (GPL): used as an unmodified separate container, referenced
  not bundled.
- The repository contains no Umbrel source code.

## Privacy and security

Carried over: no webcam image is stored, the ambient service writes one number,
changes are accepted only from the dashboard's own pages under home-network
host names, optional PIN outside Umbrel. Reviewed again for the container: the
Docker socket is never mounted by default; secrets are not logged; the setup
page is open only until the first configuration is saved or the PIN is set.

## History plan

The repository starts empty with its own history, not a filtered copy of the
fork. Roughly 30 commits, each leaving the tests green:

1. License, gitignore, project skeleton, empty README.
2. Server core: store, hub, http, access, with tests.
3. Config layer with `/data/config.json`, with tests.
4. Layout and control, with tests.
5. i18n layer, English and German strings.
6. Widgets in groups (time and weather, calendar, system, services, wiki,
   commute, home assistant, backup), each with tests.
7. Local to-do list.
8. Music: AirPlay source and UI.
9. Web UI: tiles, glass, edit mode, control page, setup page.
10. Backgrounds: gradient scenes, clip handling.
11. Host helpers with tests.
12. Dockerfile, compose profiles, AirPlay profile.
13. Umbrel store files.
14. CI: tests, image build, compose validation.
15. Docs, screenshots, README, ATTRIBUTION, SECURITY.

Author is the user, with their GitHub `noreply` address. Each commit carries a
`Co-Authored-By: Claude` trailer. Commit dates are the real ones.

## Testing and verification

- Unit and contract tests move with the code and must pass in CI.
- New tests for: config precedence, i18n key coverage (every key in both
  languages), local to-dos, display helper with a fake sysfs, clip pool with
  free-form names.
- `docker compose config` for every profile in CI, image build for amd64 and
  arm64.
- Demo mode run in a headless browser to produce 1920×1080 screenshots of the
  four times of day, the music mode and the control page.
- Release gate scan before the first push, over the files and the history:
  - patterns for keys and tokens, the Knuddl database host, personal names,
    the old hostnames, `xps`, `Mixkit`, `Hamburg`, email addresses;
  - no file larger than 1 MB except fonts and screenshots;
  - no `.env` files.
  The scan runs again in CI so it cannot regress.

## Delivery

The session may only access `paulweber-co/umbrel2.0docker`, so it cannot create
the new repository. Preferred path: the user creates an empty `reframe`
repository and gives this session access (`add_repo` with push access); the
commits are then pushed there. Fallback: the repository is built locally with
its full history and the user pushes it.

## Risks

| Risk | Mitigation |
| --- | --- |
| Kiosk container fails on some GPU or on umbrelOS | `web` profile independent; hardware doc and honest status in README |
| Mixkit-free build looks plain | Gradient scenes look good by themselves; user clips are first-class; media pack later |
| Rename and i18n refactor breaks German text | Key-coverage test, German strings kept verbatim |
| Hidden personal data in fixtures | Release gate scan over files and history, repeated in CI |
| Umbrel store format changes | Check current Umbrel app docs while building the store files |
| Large scope | Split into three specs; only the core is in scope here |

## Open items for the review

None blocking. Decisions taken in the brainstorm: language English with German
UI, approach A (one image, profiles), name Reframe, license MIT, Spotify out,
AirPlay in, Knuddl out, no bundled video.
