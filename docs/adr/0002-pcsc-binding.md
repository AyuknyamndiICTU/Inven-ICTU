# ADR-0002 — PC/SC access from the Electron kiosk

- **Status:** Accepted for the software (S11, 2026-10-26). The native build of `@pokusew/pcsclite` for the shipped Electron
  ABI is verified on the lab PC with the real reader in M1 (hardware pending).
- **Context:** `nfc-pcsc` (last release 2021) depends on `@pokusew/pcsclite` (2020, `nan` + node-gyp, no prebuilt binaries).
  It may fail to build against current Electron and Node ABIs. The kiosk must also keep running if the reader driver fails.
- **Decision:** The kiosk talks to readers only through a `ReaderDriver` port (`onCardPresent`, `onCardRemoved`, `transceive(apdu)`, `getUid()`).
  The implementations, in order of preference:
  1. **`PcscDriver`** on `@pokusew/pcsclite`, loaded in an Electron `utilityProcess` and rebuilt with `@electron/rebuild`.
     It uses the raw PC/SC API (SCardTransmit), not the `nfc-pcsc` wrapper, so we control APDU flow (SELECT-then-UID, DESFire relay).
  2. If (1) cannot be built: a **sidecar** process speaking JSON lines over stdio (a .NET `PCSC` or Rust `pcsc` binary), behind the same port.
  3. **`FakeReader`**: replays the shared tap-protocol vectors for development, tests and demos.
- **Consequences:** A driver failure isolates the reader only, and the kiosk shows state K9 ("reader unavailable") instead of crashing (I8).
  The utilityProcess boundary also keeps native code out of the renderer.

## Implementation notes (S11)

- `apps/kiosk/src/main/reader/`: `driver.ts` (port), `pcsc-driver.ts` (raw PC/SC: SCardConnect/Transmit/Control; the
  ACR1252U SAM slot is ignored; LED and buzzer through the vendor escape command), `reader-host.ts` (runs the driver in a
  `utilityProcess`), `utility-driver.ts` (main-process proxy, restarts the host with backoff), `fake-reader.ts` and
  `dev-reader.ts` (FakeReader with cards, phones, locked phones, DESFire cards and the shared vectors).
- The binding is loaded lazily with `createRequire`; when it is missing or ABI-mismatched the reader reports `ERROR`
  and the kiosk shows K9 with the matricule fallback. It is added to the installer only after it builds with
  `@electron/rebuild` on the lab PC (M1), as an unpacked native module (`asarUnpack: **/*.node`).
- `TapService` implements SELECT-then-UID, the HCE SIGN with a pool challenge, locked-phone detection (no answer to
  SELECT + random `08` NUID) and the 1.5 s debounce, independently of the driver.
