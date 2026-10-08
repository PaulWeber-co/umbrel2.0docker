# Gaming VM tools

Preparation tools for running SteamOS in an Umbrel Machine with the mini PC's
integrated GPU (and its HDMI port) passed through. Design and plan:

- [`docs/superpowers/specs/2026-10-08-steamos-gpu-passthrough-design.md`](../../docs/superpowers/specs/2026-10-08-steamos-gpu-passthrough-design.md)
- [`docs/superpowers/plans/2026-10-08-steamos-gpu-passthrough.md`](../../docs/superpowers/plans/2026-10-08-steamos-gpu-passthrough.md)

Neither tool changes umbrelOS. Both run on umbrelOS (Settings → Advanced →
Terminal → umbrelOS) or on any Linux live USB stick.

| Tool | What it does |
| --- | --- |
| `passthrough-preflight` | Read-only hardware check: virtualization, IOMMU, the GPU's IOMMU group, HDMI audio function, reset support, VBIOS source and a CPU split suggestion. Exit status 0 means no blocking problem. |
| `fetch-steamos-image` | Downloads Valve's SteamOS recovery image (resumable), verifies the pinned SHA-256 checksums and unpacks it. On umbrelOS it lands in Files → Home → Downloads. |

Run the tests after changing either tool:

```sh
scripts/gaming-vm/passthrough-preflight.test
scripts/gaming-vm/fetch-steamos-image.test
```

The SteamOS image is not stored in this repository or in Git LFS: it is larger
than GitHub's 2 GB LFS file limit and proprietary to Valve. See section 5 of the
design doc.
