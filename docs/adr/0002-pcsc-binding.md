# ADR-0002 — PC/SC access from the Electron kiosk

- **Status:** Proposed (2026-10-23). Finalised in S11 slice (a), when the binding is compiled for the current Electron.
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
