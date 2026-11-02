# Entscheidungen und zurückgestellte Punkte

Vollständige Entscheidungen aus dem Ausführungsprotokoll zum freigegebenen Plan.
Produktivwechsel und Nachprüfung am 2. November 2026 erfolgreich; historische
Angaben über ausstehende Prüfungen beschreiben den damaligen Entscheidungszeitpunkt.
Die endgültigen Ergebnisse stehen im [Validierungsbericht](2026-11-01-xps-container-updates.md).

- Ruling: test snapshot paths/defaults through injected temporary config, production validates root-owned configuration — no product test switches.

- Ruling: local Docker Desktop initially stopped; start it for isolated tests. Production containers are not test fixtures.

- Ruling: no-migration releases snapshot all Umbrel/app configuration plus app data and named volumes; unchanged media/index/thumbnail caches excluded. Full snapshot required for declared migrations — matches spec's affected-data scope; cost if wrong is a missed migration, so gated lifecycle tests and release compatibility review are mandatory.

- Ruling: a rollback that itself fails leaves the container stopped; do not resume an image against unknown data. Regression RED→GREEN in test_failed_rollback_is_never_success.

- Ruling: shared overlay drop-in only passes an explicitly configured systemd environment variable; moved from early container layer to final shared overlay to preserve base build cache; ordinary devices lack this variable and retain old updater.

- Ruling: fault injection breaks candidate healthcheck only in disposable Compose config; old baseline health remains real so rollback can be tested. This exercises the actual health-failure path without publishing a knowingly broken image.

- Ruling: added POST /v1/acknowledge with empty body for safe terminal failures only (rolled-back or pre-switch failure). It only dismisses the error overlay; interrupted/failed recovery stays blocked. Prevents forcing user into a repeat-update loop after successful rollback. Cost if wrong: misleading recovery UI, so explicit safe/unsafe tests added RED→GREEN.

- Ruling: no global Homebrew PATH in final image; retain explicit Watchman symlinks. Actual OpenSSL certificate generation RED on bridge image, GREEN with system PATH and Watchman still available. Full suite will rerun on corrected image.

- Ruling: unit test HTTP client sends complete small packets to avoid early-rejection BrokenPipe racing the test's body write. Server rejection limit unchanged.

- Final: minor (deferred): custom backupRoot outside systemd ReadWritePaths is unsupported; default private host path works. Document restriction, no expansion of host write privileges.

- Final: minor (deferred): detailed subprocess stderr is intentionally not copied into the journal because it may include credentials; sanitized stage/exception class now logged as part of recovery work. Root tools provide further diagnostics.

- Final: Ruling: production/music/physical USB unchanged during review — deployment remains gated; original music path/size verification and deletion remain final; cost if wrong: hidden production-only regression, so actual post-install checks required.

- Final: Ruling: pending CI was not counted as pass; complete supported-runtime suites now confirmed: backend136 files/1618 tests, UI117 files/889 tests; cost if wrong: untested lifecycle, still gated separately.

- Final: Ruling: GitHub environment name alone is not protection — inspect actual settings before publication; cost if wrong: unauthorized stable release.

- Final: Ruling: mDNS/Tailscale/published ports need actual new-image validation — preserve production until that check is possible; cost if wrong: loss of LAN/remote access.

- Final: Ruling: unrelated read-only media/cache exclusion retained; effective writable Home mounts included — avoids unnecessary131GB snapshot but blocks unsafe writable layouts; cost if wrong: omitted mutable data.

- Final: Ruling: host-root/protected-repository compromise remains outside socket trust boundary; immutable allowlist applies to unprivileged callers — cost if wrong: compromised root can already replace all data and services.

- Final: Ruling: legacy raw rollback/general host updates retained outside new button path and documented as image-only; new updater always restores snapshot with old image — cost if wrong: manual legacy rollback can miss migrated data.

- Final: Ruling: physical power-loss behavior not fault injected; atomic file/directory fsync and fail-closed interrupted state used — cost if wrong: manual recovery after hardware failure.

- Final: Ruling: app-image binary and browser runtime symlinks preserve their links without archiving nonexistent image/runtime targets; real relative persistent targets are included, escapes rejected. Actual XPS has three Codex binary links and three browser lock/socket links, no external mutable target. Cost if wrong: overlooked persistent symlink target; Docker RW mount discovery remains an independent guard.

- Final: Ruling: Network directory is a mount namespace, not network configuration (config stored in umbrel.yaml); exclude remote contents like External while discovering and rejecting writable network app mounts. Added parser RED→GREEN regression; cost if wrong: unsupported share requires explicit backup policy rather than unsafe update.

- Final: Ruling: fault fixture retains production five-minute health startup grace for both images; only probe interval accelerated. Removing grace globally could reject the good baseline during rollback before its HTTP server boots. Cost if wrong: five extra minutes in failure test; avoiding false rollback failure is required. Test-only configuration corrected before next integration run; product health configuration unchanged.

- Final: Ruling: integrate reviewed code plus corrected test fixture into master before repeating the canonical full lifecycle — local53update/79hostcases green, real update AND data/image rollback already passed; remaining CI failure was an explicitly diagnosed unmanaged test-baseline reset. Stable publisher accepts only successful master runs, so canonical master CI still gates every release/deployment. Cost if wrong: master temporarily contains an unvalidated edge case; running XPS and stable release remain unchanged until canonical run passes. Avoid duplicate feature/master full image tests; do not mark task7/8complete or deploy on this ruling alone.

- Final: Ruling: include confirmed existing exFAT formatter defect in initial2.0.1 release, before stablepromotion — user's cross-platformbackupsteeringrequirescorrectGPTtypes; keepsLinuxext4unchanged. NewhelpercreateExternalPartitionTable testedagainstactualregularGPTimages(no realdrives) REDmissingexport→GREENexfatBasicData/ext4Linux. Costifwrong: repeatcanonicalimage/LCvalidationanddelaysecuritydeployment; no realUSBformattingornewdata loss. Separatebranchcodex-usb-exfat-gpt fromorigin/masterff8.

- Final: Ruling: real Tailscale cross-device connection could not be tested because Mac Tailscale service is not running and route goes via LAN gateway; XPS Tailscale reports Running, online, no health warnings — preserve VPN settings and state, report validation limit — cost if wrong: remote reachability requires a later connected-client test.

- Final: Ruling: no new production owner login or password reset for testing; authenticated root API/MCP and LAN HTTP verified, real password login passed isolated lifecycle — preserve owner credentials — cost if wrong: a browser-specific existing-session problem would need separate validation.

- Final: Ruling: retain permanent sanitized evidence and exhaustive decisions in tracked documentation before deleting temporary plan scratch — preserve auditable results without shipping private helpers or bulky build logs — cost if wrong: detailed transient reproduction logs are no longer locally available.
