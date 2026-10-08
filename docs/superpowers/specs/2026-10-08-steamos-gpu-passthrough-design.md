# SteamOS-Gaming-VM mit iGPU-Passthrough auf umbrelOS – Design

- **Stand:** 2026-10-08, Entwurf. Wartet auf deine Entscheidungen in Abschnitt 8.
- **Branch:** `claude/umbrella-steamos-gpu-passthrough-mjmphx`
- **Basis:** umbrelOS 2.0.0 (`getumbrel/umbrel` master `11e7f5b`, Fork ist 0 Commits dahinter)
- **Plan:** [`docs/superpowers/plans/2026-10-08-steamos-gpu-passthrough.md`](../plans/2026-10-08-steamos-gpu-passthrough.md)

## 1. Ziel

**Was du gesagt hast**

- Ein Mini-PC im LAN, darauf umbrelOS (headless).
- Eine Umbrel-Machine mit SteamOS. Startet diese VM, wird der HDMI-Port des Mini-PCs aktiv: die iGPU wird an die VM durchgereicht.
- Sonst nutzt umbrelOS die iGPU nur für Hardwarebeschleunigung (z. B. Jellyfin).
- Kerne aufteilen, z. B. 4 von 8 für SteamOS.
- Am TV Retro-Spiele, die Steam-Bibliothek und Steam Remote Play nutzen.
- Keine bestehende Umbrel-Funktion darf kaputtgehen.

**Was ich angenommen habe (bitte korrigieren)**

- Der Mini-PC ist noch nicht gekauft. Die Hardware-Empfehlung gehört deshalb zum Design.
- Controller und Tastatur hängen per USB oder Bluetooth direkt am Mini-PC und sollen in der VM landen.
- Remote Play heißt vor allem: die SteamOS-VM streamt Spiele von einem anderen Gaming-PC (VM als Client). SteamOS als Streaming-Host ist zweitrangig.
- Es gibt einen Bildschirm, den TV am HDMI-Port.

**Erfolgskriterien**

1. Die SteamOS-VM bootet in den Gaming Mode, Bild und Ton kommen über den HDMI-Port des Mini-PCs.
2. Ein Controller funktioniert in SteamOS.
3. Dashboard, Apps und andere Machines laufen weiter, während die VM läuft.
4. Nach dem Stoppen der VM läuft umbrelOS stabil weiter. Im schlechtesten Fall braucht die iGPU einen Neustart, Daten gehen nie verloren.
5. Machines ohne Passthrough verhalten sich genau wie heute.

## 2. Machbarkeit (Ergebnis des Spikes)

**Kurz: machbar, aber nicht Plug-and-Play. Es hängt am iGPU-Modell, und es braucht Änderungen an umbrelOS selbst.**

### 2.1 SteamOS auf Nicht-Steam-Deck-Hardware

- Seit **SteamOS 3.8 (Juni 2026)** erlaubt Valve die Installation auf beliebigen PCs **mit AMD-GPU**. NVIDIA wird nicht unterstützt, Intel nicht offiziell ([PC Gamer](https://www.pcgamer.com/hardware/steam-machines/valve-greenlights-steamos-installs-on-normal-pcs-with-amd-gpus-so-you-can-go-make-your-own-steam-machine-if-you-dont-wanna-fork-over-usd1-049/), [Tech Times](https://www.techtimes.com/articles/318939/20260623/steamos-nvidia-support-confirmed-valve-has-growing-team-amd-builds-work-now.htm)).
- Installiert wird über das **Recovery-Image**. Einen klassischen Installer gibt es nicht.
- Aktuelles Image, von mir am 2026-10-08 geladen und geprüft:

  | | Wert |
  | --- | --- |
  | URL | `https://steamdeck-images.steamos.cloud/recovery/steamdeck-oobe-repair-20260707.10-3.8.14.img.bz2` (Ziel von `steamdeck-repair-latest.img.bz2`) |
  | Größe gepackt | 3.357.999.306 Bytes |
  | SHA-256 gepackt | `4254ee02ec34ae8add9aceef1881a2ce675a9d0176171df92e0eaa1bf014c594` |
  | Größe entpackt | 8.120.172.544 Bytes (GPT: `esp`, `efi-A`, `rootfs-A`, `var-A`, `home`) |
  | SHA-256 entpackt | `f9aa0fa2dd618febf28a5e2a583d1e2b5a8ca3f1205be965da584602ac962f40` |

  Valve veröffentlicht keine Prüfsummen. Diese stammen aus meinem Download.
- Der Installer im Image schreibt fest auf **`/dev/nvme0n1`**. In QEMU muss die Zielplatte deshalb ein emuliertes NVMe-Laufwerk sein, das Recovery-Image hängt als zweite Platte daneben ([Igalia](https://blogs.igalia.com/berto/2022/07/05/running-the-steam-decks-os-in-a-virtual-machine-using-qemu/)).
- Mit emulierter Grafik läuft der **Gaming Mode nicht** in einer VM (gamescope). Ab 3.7 erkennt SteamOS eine VM und startet direkt in den Desktop-Modus. Mit durchgereichter AMD-iGPU sieht SteamOS echte Hardware, dann sollte der Gaming Mode laufen. Das muss auf echter Hardware bestätigt werden (Risiko R2).
- **Fallback: [Bazzite](https://bazzite.gg)** bringt den gleichen Steam-Gaming-Mode mit, hat einen normalen ISO-Installer (läuft schon heute mit Umbrels „Custom ISO“) und unterstützt AMD, Intel und NVIDIA.

### 2.2 iGPU-Passthrough mit HDMI-Ausgabe

| iGPU | Lage | Quelle |
| --- | --- | --- |
| **AMD Radeon 780M** (Ryzen 7 7840HS/8845HS) | Am besten dokumentiert. Braucht das VBIOS als ROM-Datei (aus der ACPI-Tabelle `VFCT`) und den GOP-Treiber, die HDMI-Audio-Funktion wird mitgegeben. **Reset-Bug:** nach einem VM-Stopp bleibt die iGPU oft bis zum Host-Neustart unbrauchbar. | [Proxmox: 8700G 780M](https://forum.proxmox.com/threads/8700g-igpu-780m-passthrough.164429/), [Proxmox: Reset-Bug 8845HS](https://forum.proxmox.com/goto/post?id=788488), isc30/ryzen-gpu-passthrough-proxmox |
| AMD Radeon 890M (Strix Point) | Kaum Erfolge, Code 43, vendor-reset unterstützt sie nicht. **Für dieses Projekt nicht kaufen.** | [Proxmox: HX 370](https://forum.proxmox.com/posts/807349/) |
| Intel N100/N97 | HDMI mit passendem IGD-Option-ROM berichtet, aber fummelig. | [Proxmox: N100 Win11](https://forum.proxmox.com/goto/post?id=696296) |
| Intel N150 | Weitgehend ungelöst (HDMI bleibt dunkel). | [Proxmox: N150](https://forum.proxmox.com/threads/n150-igpu-passthrough.163704/) |

Bei Intel kommt dazu: Der Debian-Kernel von umbrelOS (6.12, trixie) ist mit `CONFIG_INTEL_IOMMU_DEFAULT_ON_INTGPU_OFF=y` gebaut ([Debian-Kernelconfig](https://salsa.debian.org/kernel-team/linux/-/raw/debian/6.12/trixie/debian/config/kernelarch-x86/config)). Die Intel-iGPU bekommt also keine IOMMU-Gruppe, solange `intel_iommu=on` nicht auf der Kernel-Kommandozeile steht. Und SteamOS selbst unterstützt offiziell nur AMD.

**Hardware-Empfehlung:** ein Mini-PC mit **Ryzen 7 7840HS oder 8845HS (Radeon 780M)**, 8 Kerne / 16 Threads, **32 GB RAM**, im BIOS einstellbarer UMA-Grafikspeicher (4–8 GB), Platz für eine zweite NVMe. Gleich nach der Lieferung, innerhalb der Rückgabefrist, `scripts/gaming-vm/passthrough-preflight` laufen lassen (siehe Plan, Phase 0).

### 2.3 Was umbrelOS 2.0 heute kann (Code-Stand)

| Thema | Stand | Wo |
| --- | --- | --- |
| VMs | libvirt/QEMU. umbreld erzeugt das Domain-XML **bei jedem Start neu**, ein `virsh edit` geht also verloren. Es gibt kein `<hostdev>`. | `packages/umbreld/source/modules/machines/domain.ts` (`buildDomainXml`) |
| iGPU heute | virgl über `egl-headless` mit `/dev/dri/renderD*`, nur für Ubuntu/Fedora/Debian-Desktop, Android und Omarchy: 3D im VNC-Bild, keine HDMI-Ausgabe, kein Vulkan. | `machines/libvirt.ts` (`findGpuRenderNode`, `supportsVirglGraphics`) |
| Eigene Images | `.iso` hängt als CD-ROM, `.img` wird zur Systemplatte. Busse: virtio, sata, ide, **kein NVMe**. Eine Platte plus Installationsmedien. | `machines/machines.ts` (`CUSTOM_IMAGE_EXTENSIONS`, `create`) |
| Netzwerk | Isoliertes NAT-Netz `10.203.0.0/24` mit TCP/UDP-Portweiterleitungen. | `machines/machine-network.ts`, `domain.ts` |
| Ressourcen | Kerne und RAM pro Machine einstellbar, kein CPU-Pinning. | `machines/machines.ts` |
| Kernel-Kommandozeile | Fest in `grub.cfg` auf der A/B-Bootpartition. | `packages/os/rugix/recipes/umbrelos-boot/files/grub.cfg` |
| Persistenz | Nur `/data` überlebt einen Neustart, das Root-Dateisystem wird zurückgesetzt. | `packages/os/rugix/recipes/setup-rugix/files/state-data.toml` |
| Hook | `/home/umbrel/umbrel/custom-hooks/pre-start` läuft bei jedem Boot als root vor umbreld (liegt in `/data`). | `packages/os/overlay/opt/umbrel-custom-hooks/run-pre-start` |
| Kernel | `CONFIG_VFIO_PCI=m`, AMD-IOMMU standardmäßig an, Intel siehe oben. | Debian trixie 6.12 |
| Updates | OTA von `api.umbrel.com`. Ein offizielles Update ersetzt ein selbst gebautes umbrelOS. | `packages/umbreld/source/modules/system/update.ts` |

**Folgerung:** Mit dem offiziellen umbrelOS geht Passthrough nicht. Nötig ist entweder ein eigener umbrelOS-Build aus diesem Fork (Ansatz A) oder ein Hook-Hack (Ansatz B).

## 3. Ansätze

### A – Umbrel-nativ im Fork, eigener umbrelOS-Build (Empfehlung)

umbreld bekommt GPU- und USB-Passthrough, eine NVMe-Zielplatte, CPU-Pinning und einen SteamOS-Installationsweg. Das OS-Image bekommt die Kernel-Parameter und die VFIO-Module. In den Machine-Einstellungen gibt es einen Schalter dafür.

- \+ Sauber, mit Tests, in der Oberfläche bedienbar, überlebt Neustarts, später auch für Intel nutzbar.
- \+ Lässt sich Umbrel als Pull Request anbieten.
- − Eigener OS-Build und eigener Update-Weg: Für jedes Umbrel-Release `upstream` mergen und neu bauen. Das offizielle OTA muss im Fork aus sein, sonst ersetzt es den Build. Die Daten in `/data` bleiben dabei erhalten, die SteamOS-Machine bootet dann nur ohne GPU.
- − Der größte Aufwand, mehrere Tage.

### B – Hook-Hack auf dem offiziellen umbrelOS (nur AMD)

Der offizielle `pre-start`-Hook bindet die iGPU beim Boot an `vfio-pci`, legt einen QEMU-Wrapper über `/usr/bin/qemu-system-x86_64` (nur die SteamOS-Machine bekommt `-device vfio-pci…` und NVMe) und erweitert das AppArmor-Profil.

- \+ Das offizielle OTA bleibt, und das Löschen des Hooks macht alles rückgängig.
- − Spröde: Jedes umbrelOS-Update kann es brechen (libvirt-Fähigkeitsprüfung, AppArmor). Die iGPU gehört dauerhaft der VM (Jellyfin verliert die Hardwarebeschleunigung). Keine Oberfläche, kein Intel.

### C – Proxmox als Host, umbrelOS und SteamOS als VMs

- \+ Das ausgereifteste Passthrough-Werkzeug, umbrelOS bleibt offiziell.
- − umbrelOS ist nicht mehr der Host, Umbrel-Machines laufen verschachtelt, mehr Administration. Nicht das, was du beschrieben hast.

**Empfehlung: A, in Stufen.** Zuerst Phase 0: die Hardware mit einem Live-USB-Stick ohne Umbrel prüfen. Erst wenn dort HDMI-Bild, Gaming Mode und Controller funktionieren, wird umbrelOS umgebaut. C ist der Plan B, falls der Mini-PC sich als ungeeignet erweist.

## 4. Architektur von Ansatz A

```
             ┌────────────── Mini-PC (Ryzen 7 8845HS, 780M) ───────────────┐
             │ umbrelOS (Fork-Build)                                       │
 Browser ───►│  umbreld ── Machines ── libvirt/QEMU ─┬─ andere Machines    │
 (LAN)       │     │                                 │   (virtio-Grafik)   │
             │     │ GPU-Übergabe                    └─ SteamOS-Machine    │
             │     ▼                                       │ vfio-pci      │
             │  Apps (Jellyfin …) ◄─ /dev/dri ─ iGPU ◄─────┘ (HDMI + Ton)──┼──► TV
             │                                   USB/BT-Controller ───────┤
             └─────────────────────────────────────────────────────────────┘
```

### 4.1 Komponenten

1. **OS-Image (Fork-Build)**
   - `grub.cfg`: `iommu=pt` immer, `intel_iommu=on` für Intel-Systeme.
   - `modules-load.d`: `vfio`, `vfio_pci`, `vfio_iommu_type1`.
   - OTA im Fork-Build abgeschaltet oder auf ein eigenes Release umgeleitet.
2. **Machine-Definition** (`domain.ts`, abwärtskompatibel, alles optional):
   - `passthrough?: {pci: {address, romFile?}[]; usb: {vendorId, productId}[]}`: aus den PCI-Adressen werden `<hostdev managed='yes'>`. Bei durchgereichter GPU kommt `<video><model type='none'/>`, damit HDMI das einzige Display ist, und `<kvm><hidden state='on'/>`.
   - `cpuPinning?: {hostThreads, threadsPerCore}`: wird zu `<cputune><vcpupin>` und einer passenden `<topology>`. Bei 8 Kernen / 16 Threads bekommt die VM zum Beispiel die Kerne 4–7 mit ihren Geschwister-Threads 12–15, und umbrelOS behält die Kerne 0–3 (das ist der Vorschlag von `passthrough-preflight`).
   - `diskBus: 'nvme'`: libvirt 11.3 in trixie kann `bus='nvme'` noch nicht (kam erst mit 11.5). Der Weg wird in Plan-Task 3 per Experiment entschieden, erst `<qemu:override>`, dann libvirt aus den Backports.
   - `installerDisk?: 'media/installer.qcow2'`: Beim Anlegen kopiert umbreld das Recovery-Image als qcow2 ins Machine-Verzeichnis, wie heute bei eigenen `.img`. Die Kopie hängt als zweite virtio-Platte mit Boot-Priorität 1, bis die Installation fertig ist. Das Original in Files bleibt unberührt.
3. **GPU-Arbitrierung** (neu, `machines/gpu-handoff.ts`)
   - Stufe 1, *dediziert*: Die iGPU gehört ab dem Boot der VM, die Apps nutzen die CPU. Einfach und robust gegen den Reset-Bug. Das ist der erste Meilenstein.
   - Stufe 2, *bei Bedarf*: Vor dem VM-Start stoppt umbreld nach einer Bestätigung in der Oberfläche alle Apps, deren Container `/dev/dri` nutzen, und hält virgl-Machines an. libvirt (`managed='yes'`) übernimmt das Umbinden. Nach dem VM-Stopp gibt libvirt die GPU zurück, und umbreld startet die Apps wieder. Hat die GPU keine Reset-Methode (`reset_method` leer), bleibt sie bis zum Neustart bei `vfio-pci`. Die Oberfläche bietet dann „Neustart, um die GPU zurückzugeben“ an.
4. **Oberfläche**: Unter Machine → Einstellungen → „Grafik & HDMI“ ein Schalter „iGPU durchreichen“, der nur erscheint, wenn umbreld eine passthrough-fähige GPU meldet. Dazu die Auswahl der USB-Geräte und eine Kernauswahl mit Vorschlag (wie `passthrough-preflight`).
5. **Netzwerk / Remote Play**: Als Remote-Play-Client funktioniert die VM hinter dem NAT über Steams Kontoverbindung. Als Host gehen die Portweiterleitungen UDP 27031–27036 und TCP 27036–27037 über die bestehende Oberfläche. Optional (Stufe 3) eine Bridge per `macvtap` (`<interface type='direct'>`), damit die VM eine eigene LAN-IP bekommt und die LAN-Erkennung von Steam funktioniert.

### 4.2 Fehlerbehandlung

| Fall | Verhalten |
| --- | --- |
| GPU nicht passthrough-fähig (keine IOMMU-Gruppe, Gruppe nicht isoliert) | Der Schalter ist ausgegraut, mit Grund (gleiche Prüfungen wie `passthrough-preflight`). |
| VM-Start mit Passthrough schlägt fehl | Apps werden wieder gestartet und der Fehler angezeigt. **Kein** automatischer Rückfall auf virgl, weil das ein ganz anderer Modus ist. |
| GPU kommt nach dem VM-Stopp nicht zurück (Reset-Bug) | Die Apps bleiben ohne GPU gestoppt, Hinweis „Neustart nötig“. Kein Datenverlust. |
| Offizielles Umbrel-OTA installiert (Fork-Build überschrieben) | Das Store-Schema (`machine-store.ts`) ist nicht `strict`. Das offizielle umbreld verwirft das unbekannte Feld `passthrough` also still (beim nächsten Speichern ist es weg), und die VM bootet mit virtio-Grafik ohne HDMI. Die Daten bleiben. |
| GPU-Adresse existiert nicht mehr (BIOS-Update, Backup auf anderer Hardware) | Der Start bricht mit `[machine-passthrough-device-missing]` ab, und die Oberfläche bietet „Passthrough ausschalten“ an. |
| Zwei Machines wollen dieselbe GPU | Die zweite bricht mit `[machine-passthrough-device-busy]` ab. |
| Recovery-Image fehlt oder hat die falsche Prüfsumme | Die Installation startet nicht. Die Meldung verweist auf `fetch-steamos-image`. |

### 4.3 Testen

- **Unit-Tests** (vitest, laufen hier im Container): das Domain-XML für Passthrough, NVMe, Pinning und Recovery-Medium, das Parsen von sysfs (gleiche Logik wie das Preflight) und die Auswahl der Apps, die gestoppt werden müssen.
- **Regressionsschutz:** Alle bestehenden Machines-Unit-Tests bleiben unverändert grün. Snapshot-Vergleiche des Domain-XML für Machines *ohne* Passthrough müssen byte-gleich bleiben.
- **VM-Tests** (umbreld-Harness, braucht KVM): Der Fork-Build bootet, `/proc/cmdline` enthält `iommu=pt`, und eine Machine ohne Passthrough startet wie bisher.
- **Hardware-Abnahme** (manuell, Checkliste im Plan): die Erfolgskriterien 1–5 auf dem echten Mini-PC.

## 5. Recovery-Image und Git LFS

**Entscheidung: kein Git LFS, sondern ein verifizierter Download direkt von Valve.**

- GitHub Free erlaubt **höchstens 2 GB pro LFS-Datei** ([GitHub Docs](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)). Das Image hat 3,36 GB gepackt und 8,1 GB entpackt, Git LFS würde es ablehnen.
- Kontingent: 10 GiB Speicher und **10 GiB Bandbreite im Monat**, und jeder Download zählt gegen dein Konto ([GitHub Docs](https://docs.github.com/en/billing/concepts/product-billing/git-lfs)). Das reicht für etwa 3 Klone im Monat, danach ist LFS bis zum Monatsende gesperrt.
- Dein Fork ist **öffentlich**. SteamOS enthält proprietäre Valve-Software, ein Upload wäre eine öffentliche Weiterverbreitung.
- umbrelOS lädt Machine-Images schon heute aus den Original-Quellen und pinnt sie per SHA-256 (`builtinMachinesCatalog` in `machines.ts`). Dasselbe Prinzip nutzt `scripts/gaming-vm/fetch-steamos-image`. Es lädt direkt von Valve (fortsetzbar), prüft beide Prüfsummen und legt das `.img` in Files → Home → Downloads ab.

## 6. Risiken

| # | Risiko | Gegenmaßnahme |
| --- | --- | --- |
| R1 | Die 780M liefert in der VM kein HDMI-Bild | Phase 0 vor jedem Umbau. Sonst Bazzite, Ansatz C oder Rückgabe. |
| R2 | Der Gaming Mode startet trotz echter GPU nicht | Hypervisor verstecken (`<kvm><hidden/>`, SMBIOS), manuell in den Gaming Mode wechseln, sonst Bazzite |
| R3 | Reset-Bug: die GPU kommt nach dem VM-Stopp nicht zurück | Stufe 1 (dediziert) zuerst, Stufe 2 nur bei funktionierendem Reset |
| R4 | Fork-Build hinkt Umbrel-Releases hinterher | Merge-und-Build-Ablauf im Plan, OTA im Fork aus |
| R5 | `intel_iommu=on` verursacht auf manchen Intel-Systemen Grafikfehler | Nur Intel betroffen, mit der AMD-Empfehlung nicht relevant |
| R6 | Valve ändert Image-Format oder Installer | Das Image ist gepinnt, eine neue Version lässt sich per Umgebungsvariable pinnen |

## 7. Was schon vorbereitet ist (dieser Branch)

| Datei | Zweck |
| --- | --- |
| `scripts/gaming-vm/passthrough-preflight` (+ `.test`) | Nur-lesender Hardware-Check: Virtualisierung, IOMMU, GPU-IOMMU-Gruppe, HDMI-Audio-Funktion, Reset-Methode, VBIOS-Quelle, Kernaufteilung. |
| `scripts/gaming-vm/fetch-steamos-image` (+ `.test`) | Verifizierter, fortsetzbarer Download des SteamOS-Recovery-Images (siehe Abschnitt 5). |
| Dieses Dokument und der Plan | Design und Umsetzungsplan |

Nichts davon ändert umbreld, die Oberfläche, das OS-Image oder das Docker-Setup.

## 8. Offene Entscheidungen

1. **Ansatz:** A (Fork-Build, empfohlen), B (Hook-Hack) oder C (Proxmox)?
2. **Hardware:** Bleibst du bei der Empfehlung AMD 780M, oder hast du ein bestimmtes Gerät im Blick?
3. **Gastsystem:** SteamOS (offiziell, nur AMD) oder Bazzite (AMD und Intel, einfachere Installation)?
4. **GPU-Modus:** Reicht dir Stufe 1 (iGPU dauerhaft für die VM, Jellyfin per CPU), oder brauchst du Stufe 2 (Übergabe bei Bedarf)?
