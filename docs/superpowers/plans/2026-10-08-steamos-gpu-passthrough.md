# SteamOS-Gaming-VM mit iGPU-Passthrough – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Umbrel-Machine bekommt die iGPU des Mini-PCs samt HDMI-Port, ausgewählte USB-Geräte und feste CPU-Kerne, damit SteamOS am TV im Gaming Mode läuft.

**Architecture:** Ansatz A der Spec. umbreld erweitert die Machine-Definition um optionale Passthrough-, Pinning- und NVMe-Felder und erzeugt daraus libvirt-`<hostdev>`/`<cputune>`. Der Fork-Build von umbrelOS liefert IOMMU-Kernel-Parameter und VFIO-Module. Stufe 1 gibt die iGPU dauerhaft der VM. Stufe 2 (Übergabe bei Bedarf) folgt erst, wenn Stufe 1 auf der Hardware läuft.

**Tech Stack:** TypeScript (umbreld, vitest, zod, tRPC), React (packages/ui), libvirt 11.3 / QEMU (Debian trixie), Rugix-OS-Build, Bash.

**Spec:** [`docs/superpowers/specs/2026-10-08-steamos-gpu-passthrough-design.md`](../specs/2026-10-08-steamos-gpu-passthrough-design.md)

**Gate:** Task 0 (Hardware-Abnahme) muss bestanden sein, bevor Task 1 beginnt. Die offenen Entscheidungen in Spec-Abschnitt 8 müssen beantwortet sein.

## Global Constraints

- Machines ohne die neuen Felder erzeugen **byte-gleiches** Domain-XML wie umbrelOS 2.0.0.
- Alle neuen Felder in `MachineDefinition` sind optional, `version` bleibt `1`, und das Store-Schema bleibt nicht-`strict`.
- ROM-Dateien liegen nur relativ im Machine-Verzeichnis (Regex `^media/[a-z0-9._-]+\.rom$`), nie an beliebigen Host-Pfaden.
- PCI-Adressen haben die Form `^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$`, USB-IDs `^[0-9a-f]{4}$`.
- Fehlercodes folgen dem Muster `[machine-…]`: `[machine-passthrough-device-missing]`, `[machine-passthrough-group-not-isolated]`, `[machine-passthrough-device-busy]`, `[machine-passthrough-unavailable]`.
- Die Container-Variante (`compose.yaml`, `BASE_VARIANT=-container`) und die Pi-Images bleiben unverändert. Ohne IOMMU meldet umbreld schlicht keine Passthrough-Kandidaten.
- Neue OS-Build-Optionen sind standardmäßig leer: Ohne gesetzte Build-Argumente entsteht dasselbe Image wie upstream (bis auf `iommu=pt`, siehe Task 5).
- Code-Stil wie im Repo: Tabs, Prettier (`npm run format:check`), Tests als `*.unit.test.ts` neben dem Code.

## Review Focus

1. **Die GPU-Adresse verschwindet** (BIOS-Update, Wiederherstellung aus einem Backup auf anderer Hardware): Der Start muss sofort mit `[machine-passthrough-device-missing]` scheitern, nicht hängen. Test in Task 6.
2. **Die IOMMU-Gruppe bekommt ein weiteres Gerät** (BIOS-Option geändert): Der Start wird verweigert, statt fremde Geräte mitzureißen. Test in Task 6.
3. **Zwei Machines mit derselben GPU:** Die zweite wird mit `[machine-passthrough-device-busy]` abgelehnt. Test in Task 6.
4. **umbreld startet neu, während die SteamOS-VM läuft:** Die GPU bleibt bei der VM, und umbreld hält sie nicht für frei. Test in Task 6 (Busy-Erkennung über den laufenden Domain-Zustand, nicht über einen Speicherzustand).
5. **Offizielles OTA nach dem Fork-Build:** Die Definition mit `passthrough` lässt sich mit dem unveränderten Schema von 2.0.0 parsen. Test in Task 1.

---

### Task 0: Hardware-Abnahme mit Live-USB (manuell, kein Code)

**Files:** keine (nutzt `scripts/gaming-vm/passthrough-preflight` und `scripts/gaming-vm/fetch-steamos-image`)

- [ ] **Schritt 1: BIOS einstellen.** SVM an, IOMMU an, CSM aus, Secure Boot aus, UMA-Grafikspeicher 4–8 GB, Re-Size BAR aus.
- [ ] **Schritt 2: Debian-13-Live-USB booten** und `sudo apt install qemu-system-x86 ovmf curl bzip2` ausführen.
- [ ] **Schritt 3: Preflight.** `sudo ./passthrough-preflight` muss `RESULT: READY` oder `READY WITH WARNINGS` melden. Die GPU-Adresse, die Audio-Funktion und die Kernvorschläge notieren.
- [ ] **Schritt 4: VBIOS sichern.** `sudo cat /sys/firmware/acpi/tables/VFCT > vfct.bin`, dann mit dem Extraktor aus [isc30/ryzen-gpu-passthrough-proxmox](https://github.com/isc30/ryzen-gpu-passthrough-proxmox) `vbios_<device>.bin` erzeugen. Zusätzlich den passenden `AMDGopDriver.rom` von dort für die Audio-Funktion holen.
- [ ] **Schritt 5: Image holen.** `./fetch-steamos-image --output-dir .` muss mit `Done:` enden.
- [ ] **Schritt 6: Die iGPU an vfio-pci binden.** Von einer Text-Konsole (Strg+Alt+F3) aus `sudo modprobe vfio-pci`. Dann für die GPU- und die Audio-Adresse jeweils `echo vfio-pci | sudo tee /sys/bus/pci/devices/<addr>/driver_override` und `echo <addr> | sudo tee /sys/bus/pci/devices/<addr>/driver/unbind`, danach `echo <addr> | sudo tee /sys/bus/pci/drivers_probe`. Schlägt das Unbinden fehl oder friert es ein, neu booten mit den Kernel-Parametern `modprobe.blacklist=amdgpu vfio-pci.ids=<gpu-id>,<audio-id>` und das Ergebnis notieren. Es entscheidet über Task 5, Schritt 3.
- [ ] **Schritt 7: Testlauf.** `qemu-img create -f qcow2 steamos.qcow2 128G`, dann:

  ```sh
  sudo qemu-system-x86_64 -enable-kvm -machine q35 -cpu host,kvm=off -smp 8,cores=4,threads=2 -m 16G \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
    -drive if=pflash,format=raw,file=OVMF_VARS_4M.fd \
    -device vfio-pci,host=<gpu-addr>,romfile=vbios_<device>.bin \
    -device vfio-pci,host=<audio-addr>,romfile=AMDGopDriver.rom \
    -vga none -display none \
    -drive if=virtio,format=raw,readonly=off,snapshot=on,file=steamos-recovery-3.8.14.img \
    -drive if=none,id=target,file=steamos.qcow2 -device nvme,drive=target,serial=umbrel \
    -device qemu-xhci -device usb-host,vendorid=0x<vid>,productid=0x<pid> \
    -nic user,model=virtio-net-pci
  ```

  Vorher eine beschreibbare Kopie `OVMF_VARS_4M.fd` aus `/usr/share/OVMF/` anlegen.
- [ ] **Schritt 8: Abnahme.** Der TV zeigt den Recovery-Desktop. „Wipe Device & Install SteamOS“ läuft durch. Nach dem Neustart (ohne Recovery-Platte, Zielplatte weiterhin als NVMe) läuft der Gaming Mode mit Bild und Ton über HDMI, und der Controller funktioniert. Danach die VM stoppen und wieder starten. Notieren, ob die GPU ohne Host-Neustart wiederkommt (Reset-Bug ja/nein).
- [ ] **Schritt 9: Ergebnis festhalten.** Die Befunde aus den Schritten 6–8 in Spec-Abschnitt 6 eintragen und committen:

  ```bash
  git add docs/superpowers/specs/2026-10-08-steamos-gpu-passthrough-design.md
  git commit -m "Record gaming VM hardware acceptance results"
  ```

  **Scheitert Schritt 8:** Stopp. Mit dem Nutzer Bazzite, Ansatz C oder die Rückgabe entscheiden.

### Task 1: PCI- und USB-Passthrough im Domain-XML

**Files:**
- Modify: `packages/umbreld/source/modules/machines/domain.ts` (Typen, `buildDomainXml`)
- Modify: `packages/umbreld/source/modules/machines/machine-store.ts` (Schema)
- Create: `packages/umbreld/source/modules/machines/fixtures/domain-default.xml` (Golden File, aus dem *unveränderten* Code erzeugt)
- Test: `packages/umbreld/source/modules/machines/domain.unit.test.ts`, `machine-store.unit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MachinePassthrough = {
  	pci: Array<{address: string; romFile?: string}>
  	usb: Array<{vendorId: string; productId: string}>
  }
  // MachineDefinition.passthrough?: MachinePassthrough
  export function machineHasGpuPassthrough(definition: MachineDefinition): boolean // true, wenn pci nicht leer ist
  ```

- [ ] **Schritt 1: Golden-Test schreiben.** `test('keeps the domain XML of machines without passthrough unchanged')` vergleicht `buildDomainXml` für die bestehende `definition()`-Fixture mit `fixtures/domain-default.xml`. Die Datei vor jeder Codeänderung aus dem aktuellen Code erzeugen.
- [ ] **Schritt 2: Passthrough-Tests schreiben.**
  - `test('passes a GPU and its HDMI audio function through and makes HDMI the only display')`: erwartet zwei `<hostdev mode='subsystem' type='pci' managed='yes'>` mit `<address domain='0x0000' bus='0xc5' slot='0x00' function='0x0'/>` bzw. `function='0x1'`, `<rom file='/data/machines/test/media/vbios.rom'/>` nur am ersten, `<video><model type='none'/></video>`, `<kvm><hidden state='on'/></kvm>`, **kein** `type='egl-headless'`, VNC-Socket weiterhin vorhanden.
  - `test('passes USB devices through by vendor and product id')`: erwartet `<hostdev mode='subsystem' type='usb' managed='yes'><source><vendor id='0x045e'/><product id='0x0b12'/></source></hostdev>`.
  - In `machine-store.unit.test.ts`: `test('rejects ROM files outside the machine directory')` (`romFile: '../../etc/shadow'` → Parse-Fehler) und `test('reads passthrough definitions with the 2.0.0 schema by dropping the field')` (Review Focus 5: eine Kopie des alten Schemas parst und entfernt `passthrough`).
- [ ] **Schritt 3: Tests laufen lassen, sie müssen fehlschlagen.** `cd packages/umbreld && npx vitest --run source/modules/machines/domain.unit.test.ts source/modules/machines/machine-store.unit.test.ts`. Erwartet: FAIL nur bei den neuen Tests, der Golden-Test ist grün.
- [ ] **Schritt 4: Implementieren.** Die Felder kommen in `MachineDefinition` und `machineDefinitionSchema`. `buildDomainXml` hängt die `hostdev`-Blöcke nach `${tpm}` an. `<kvm><hidden/>` kommt nur bei einer GPU in `<features>`, und das Video-Modell `none` nur bei einer GPU.
- [ ] **Schritt 5: Tests laufen lassen, alle müssen grün sein.** Gleicher Befehl, dazu `npx vitest --run source/modules/machines --exclude '**/*.vm.test.ts' --exclude '**/*.integration.test.ts'`. Erwartet: alles grün bis auf die zwei bekannten IPv6-Fehler in `safe-download.unit.test.ts` (nur in IPv6-losen Umgebungen).
- [ ] **Schritt 6: Commit.** `git commit -m "Pass PCI and USB devices through to machines"`

### Task 2: CPU-Pinning

**Files:** Modify `domain.ts`, `machine-store.ts`, `routes.ts` (`updateSettings`). Test: `domain.unit.test.ts`.

**Interfaces:** Produces `MachineDefinition.cpuPinning?: {hostThreads: number[]; threadsPerCore: 1 | 2}`. `hostThreads` ist eindeutig, hat die Länge `cores` (in umbreld ist `cores` die Zahl der vCPUs) und listet Geschwister-Threads nebeneinander.

- [ ] **Schritt 1: Test** `test('pins vCPUs to host threads and reports a matching SMT topology')`. Mit `cores: 8, cpuPinning: {hostThreads: [4, 12, 5, 13, 6, 14, 7, 15], threadsPerCore: 2}` erwartet er `<vcpupin vcpu='0' cpuset='4'/>` bis `<vcpupin vcpu='7' cpuset='15'/>`, `<emulatorpin cpuset='4-7,12-15'/>` und `<topology sockets='1' dies='1' cores='4' threads='2'/>`.
- [ ] **Schritt 2: Laufen lassen, er muss fehlschlagen.**
- [ ] **Schritt 3: Implementieren.** `updateSettings` prüft `hostThreads` gegen `os.cpus().length`, die Länge gegen `cores` und die Teilbarkeit von `cores` durch `threadsPerCore`, mit dem Fehler `[machine-cpu-pinning-invalid]`.
- [ ] **Schritt 4: Laufen lassen, er muss grün sein.** Golden-Test aus Task 1 eingeschlossen.
- [ ] **Schritt 5: Commit.** `git commit -m "Pin machine vCPUs to host threads"`

### Task 3: NVMe-Zielplatte (mit Experiment)

**Files:** Modify `domain.ts`, `machine-store.ts`. Test: `domain.unit.test.ts`. Experiment-Notizen kommen in die Spec, Abschnitt 4.1.

**Interfaces:** Produces `diskBus: 'virtio' | 'sata' | 'nvme'` (`machineDiskBus`, `machineDiskTarget`).

- [ ] **Schritt 1: Experiment im Container** (ohne KVM, mit TCG): Debian-trixie-Pakete `libvirt-daemon-system qemu-system-x86 ovmf` installieren. Eine Domain mit Platte `bus='sata'`, `<alias name='ua-umbrel-disk'/>` und `<qemu:override><qemu:device alias='ua-umbrel-disk'><qemu:frontend><qemu:property name='driver' type='string' value='nvme'/><qemu:property name='serial' type='string' value='umbrel'/></qemu:frontend></qemu:device></qemu:override>` per `virsh create` starten. `virsh qemu-monitor-command <dom> --hmp 'info qtree'` muss ein `nvme`-Gerät zeigen. Klappt das nicht, libvirt ≥ 11.5 aus trixie-backports mit `bus='nvme'` testen.
- [ ] **Schritt 2: Test** `test('attaches the system disk as an NVMe drive for installers that expect nvme0n1')`, mit den XML-Fragmenten des erfolgreichen Wegs aus Schritt 1.
- [ ] **Schritt 3: Laufen lassen, er muss fehlschlagen.**
- [ ] **Schritt 4: Implementieren.** Falls der Backports-Weg gewinnt, kommt dazu die Paketquelle in `packages/os/umbrelos.Dockerfile` (eigener Commit, mit VM-Test aus Task 5).
- [ ] **Schritt 5: Laufen lassen, er muss grün sein.**
- [ ] **Schritt 6: Commit.** `git commit -m "Support NVMe system disks for machines"`

### Task 4: Recovery-Image als Installationsplatte

**Files:** Modify `machines.ts` (`create`), `domain.ts`, `machine-store.ts`, `routes.ts`. Test: `machine-install.unit.test.ts`, `domain.unit.test.ts`.

**Interfaces:**
- Consumes: `diskBus: 'nvme'` (Task 3)
- Produces: Option `imageRole?: 'disk' | 'installer'` für `create({imagePath})`, und `MachineDefinition.installerDisk?: 'media/installer.qcow2'`

- [ ] **Schritt 1: Tests.**
  - `test('creates a blank NVMe system disk and boots a custom .img as installer disk')` in `machine-install.unit.test.ts`. Erwartet: Die Systemplatte ist leer (`diskSizeGb`). `media/installer.qcow2` wird per `qemu-img convert` aus dem `.img` erzeugt, wie heute bei eigenen Images (`qemuImageConvertArguments`), sodass die Machine nicht von der Datei in Files abhängt. `installerDisk` ist gesetzt.
  - In `domain.unit.test.ts`: `test('boots the installer disk first and the system disk second')`. Erwartet: `virtio`-Platte mit `<boot order='1'/>` und Systemplatte mit `<boot order='2'/>`.
- [ ] **Schritt 2: Laufen lassen, sie müssen fehlschlagen.**
- [ ] **Schritt 3: Implementieren.** Das Entfernen der Installationsplatte nach der Installation läuft über denselben Weg wie das Auswerfen von `installMedia` heute. Die Oberfläche zeigt dafür „Installationsmedium entfernen“.
- [ ] **Schritt 4: Laufen lassen, sie müssen grün sein.**
- [ ] **Schritt 5: Commit.** `git commit -m "Boot custom disk images as installer disks"`

### Task 5: Fork-Build: Kernel-Parameter, VFIO, OTA

**Files:**
- Modify: `packages/os/rugix/recipes/umbrelos-boot/files/grub.cfg`, `packages/os/rugix/recipes/umbrelos-boot/steps/00-install.sh` (Build-Argument einsetzen)
- Create: `packages/os/overlay/etc/modules-load.d/umbrel-vfio.conf`
- Modify: `packages/umbreld/source/modules/system/update.ts` (keine Updates, wenn `/etc/umbrel-fork-build` existiert)
- Test: `packages/umbreld/source/modules/system/update.unit.test.ts` (neu), `packages/umbreld/source/modules/system/system.vm.test.ts`

**Interfaces:** Build-Argument `UMBREL_EXTRA_KERNEL_ARGS` (Standard leer) und Marker-Datei `/etc/umbrel-fork-build`.

- [ ] **Schritt 1: Tests.**
  - Unit: `test('reports no update on fork builds')`. Mit Marker liefert der Update-Check `{available: false}` ohne Anfrage an `api.umbrel.com`.
  - VM: `test('boots with IOMMU passthrough mode and VFIO loaded')`. `/proc/cmdline` enthält `iommu=pt`, und `lsmod` zeigt `vfio_pci`.
- [ ] **Schritt 2: Laufen lassen, sie müssen fehlschlagen.** Unit lokal. Der VM-Test über `npm run test:vm` braucht KVM, also auf einem Linux-Rechner oder dem Remote-Builder.
- [ ] **Schritt 3: Implementieren.** `grub.cfg` bekommt `iommu=pt @UMBREL_EXTRA_KERNEL_ARGS@`. `00-install.sh` ersetzt den Platzhalter. Für Intel-Hardware `UMBREL_EXTRA_KERNEL_ARGS="intel_iommu=on"`. Falls Task 0, Schritt 6 Blacklisting braucht: `"modprobe.blacklist=amdgpu vfio-pci.ids=<gpu-id>,<audio-id>"`.
- [ ] **Schritt 4: Laufen lassen, sie müssen grün sein.**
- [ ] **Schritt 5: Image bauen** mit `npm --prefix packages/os run build:amd64:rugix` (Docker mit privilegierten Rechten), dann den USB-Installer: `npm --prefix packages/os run build:amd64:usb-installer`.
- [ ] **Schritt 6: Commit.** `git commit -m "Build umbrelOS with IOMMU passthrough support"`

### Task 6: GPU-Erkennung und Start-Prüfungen

**Files:**
- Create: `packages/umbreld/source/modules/machines/gpu-passthrough.ts`
- Create: `packages/umbreld/source/modules/machines/fixtures/sysfs/` (AMD-780M- und Intel-Bäume wie in `scripts/gaming-vm/passthrough-preflight.test`)
- Modify: `libvirt.ts` (Start), `routes.ts` (`passthroughCandidates`)
- Test: `packages/umbreld/source/modules/machines/gpu-passthrough.unit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PassthroughCandidate = {
  	address: string; vendorId: string; deviceId: string; driver: string | undefined
  	iommuGroup: string | undefined; isolated: boolean; companions: string[]
  	resetMethods: string[]; vbiosSource: 'vfct' | 'none' | 'not-applicable'
  }
  export async function listPassthroughCandidates(sysfsRoot?: string): Promise<PassthroughCandidate[]>
  export async function assertPassthroughStartable(definition: MachineDefinition, runningDefinitions: MachineDefinition[], sysfsRoot?: string): Promise<void>
  ```

- [ ] **Schritt 1: Tests** (Fixtures wie im Preflight-Test). Sie decken Review Focus 1–4 ab:
  - `test('lists the 780M with its HDMI audio function as an isolated candidate')`
  - `test('marks an Intel iGPU without IOMMU group as unavailable')`
  - `test('refuses to start when the GPU address no longer exists')`: `[machine-passthrough-device-missing]`
  - `test('refuses to start when the IOMMU group gained a foreign device')`: `[machine-passthrough-group-not-isolated]`
  - `test('refuses a second running machine with the same GPU')`: `[machine-passthrough-device-busy]`. Die laufenden Machines kommen aus `virsh list`, nicht aus einem gespeicherten Zustand.
- [ ] **Schritt 2: Laufen lassen, sie müssen fehlschlagen.**
- [ ] **Schritt 3: Implementieren.** `libvirt.ts` ruft `assertPassthroughStartable` vor `buildDomainXml` auf. Passthrough-Machines bekommen keinen virgl-Render-Node und keinen `createWithGraphicsFallback`-Rückfall.
- [ ] **Schritt 4: Laufen lassen, sie müssen grün sein.** Dazu alle Machines-Unit-Tests und `npm run typecheck`.
- [ ] **Schritt 5: Commit.** `git commit -m "Detect passthrough-capable GPUs and guard machine starts"`

### Task 7: Oberfläche „Grafik & HDMI“

**Files:**
- Modify: `packages/ui/src/features/machines/components/machine-settings.tsx`, `packages/ui/src/features/machines/settings.ts`
- Übersetzungen: `packages/ui/translations` (Ablauf aus `update-translations.yml`)
- Test: `packages/ui/src/features/machines/components/machine-settings.test.tsx` (neu, vitest wie `spec-form.test.tsx`)

**Interfaces:** Consumes die tRPC-Routen `machines.passthroughCandidates` (Task 6) und `machines.updateSettings` mit `passthrough` und `cpuPinning` (Tasks 1 und 2).

- [ ] **Schritt 1: Tests.**
  - `test('hides the HDMI section when the host reports no candidates')`
  - `test('enabling GPU passthrough also selects its companion functions and suggests pinned cores')`
- [ ] **Schritt 2: Laufen lassen, sie müssen fehlschlagen.**
- [ ] **Schritt 3: Implementieren.**
- [ ] **Schritt 4: Laufen lassen, sie müssen grün sein.** Befehl: `npm --prefix packages/ui test`.
- [ ] **Schritt 5: Commit.** `git commit -m "Add graphics and HDMI passthrough settings for machines"`

### Task 8: Hardware-Abnahme auf umbrelOS (manuell)

- [ ] Den Fork-Build per USB-Installer auf dem Mini-PC installieren.
- [ ] `fetch-steamos-image` im umbrelOS-Terminal ausführen.
- [ ] Eine Machine aus `Home/Downloads/steamos-recovery-3.8.14.img` als Installer anlegen (NVMe, 128 GB, 8 vCPUs gepinnt, 16 GB RAM), Passthrough aktivieren und SteamOS installieren.
- [ ] Erfolgskriterien 1–5 der Spec abhaken. Gleichzeitig Jellyfin (CPU-Transkodierung) und eine Ubuntu-Desktop-Machine laufen lassen.

### Später (eigene Pläne, erst nach Task 8)

- **Stufe 2, Übergabe bei Bedarf:** Apps mit `/dev/dri` und virgl-Machines nach Bestätigung stoppen, mit `managed='yes'` umbinden, nach dem Stopp zurückgeben und neu starten. Nur wenn Task 0, Schritt 8 keinen Reset-Bug zeigt.
- **Bridge-Netzwerk:** `macvtap` (`<interface type='direct'>`), damit die LAN-Erkennung von Steam Remote Play funktioniert.
- **Release-Ablauf:** `upstream` mergen, Tests, Build, USB-Installer. Optional ein eigener Update-Server statt `api.umbrel.com`.
