# ADR-0001 — NFC reader hardware: ACS ACR1252U

- **Status:** Accepted (2026-10-23). Purchase pending ICTU budget approval.
- **Context:** The kiosk must read DESFire EV3 cards (ISO 14443-4) and talk to Android phones in HCE mode through PC/SC on Windows 10/11.
  The common ACR122U has known problems with Android HCE (ISO-DEP activation, short timeouts) and is end-of-life.
- **Decision:** Standardise on the **ACS ACR1252U** (USB, PC/SC, CCID; supports ISO 14443-4 and extended APDUs).
  Buy two: one in service, one spare. Acceptable alternatives: ACS ACR1552U or HID Omnikey 5022.
- **Consequences:** It uses the Windows inbox CCID driver, so no vendor driver is needed. LED and buzzer are controlled through ACS escape commands (S11).
  Hardware validation in S01 is blocked until purchase. All software is built against the `FakeReader` meanwhile.
