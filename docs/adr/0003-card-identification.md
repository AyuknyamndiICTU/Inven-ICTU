# ADR-0003 — Physical card identification: DESFire EV3 with relayed AES authentication

- **Status:** Accepted (2026-10-20, decision Q1). Sample-card validation is pending hardware.
- **Context:** ICTU ID cards do not yet have NFC chips; the chips are being added to new cards. UID-only identification is clonable.
  ICTU can still choose the chip.
- **Decision:**
  - Cards use **MIFARE DESFire EV3**, personalised per `docs/protocols/card-personalisation-v1.md`: Random ID off, LabPass AID `0x4C5031`, AN10922-diversified AES keys.
  - The kiosk relays `AuthenticateEV2First` between the card and the API (S06.5). Keys stay on the server.
  - Setting `cardAuthMode` selects `UID`, `DESFIRE_PREFERRED` (default after rollout) or `DESFIRE_REQUIRED`.
  - The supplier's `card_uid,matricule` file binds cards to students in bulk.
- **Consequences:**
  - Offline mode (F9) can only use UID matching, and flags those loans.
  - Until cards arrive, students identify with phones or matricule + PIN.
  - A card replacement creates a new binding and revokes the old one.
