# ADR-0009 — Kiosk offline mode: what is cached and how it is re-verified

- **Status:** Accepted (S11.5, 2026-10-26)
- **Context:** Decision Q6 requires the kiosk to keep lending while the API is unreachable (ARCH §5 F9). Two facts
  constrain the design:
  1. The server stores card UIDs only as `HMAC(UID_PEPPER, uid)`. It therefore **cannot** pre-compute the
     `HMAC(KioskOfflineKey, uid)` card lookups that F9 sketched, and the pepper must never leave the server.
  2. Student PIN hashes must not be cached on a kiosk (F9), so offline matricule entry needs a lab assistant.
- **Decision:**
  - **Bundle** (`GET /kiosk/offline-bundle`, refreshed every 5 min, only when the journal is empty): equipment and
    availability, students (ACTIVE or with open loans) with open loan lines and an overdue flag, ACTIVE credential public
    keys, lab-assistant argon2 PIN hashes, and the lending policy. A new `KioskOfflineKey` version is created with every
    bundle (last 3 kept); `cards` is empty. No contacts, photos, student PIN hashes or UIDs are included.
  - **Cards offline = learned lookups.** After each successful **online** card identification the kiosk stores
    `HMAC(kioskLocalKey, uid) → studentId` (120-day expiry) in its encrypted store. Offline, only cards seen at this kiosk
    are recognised; others go to matricule + assistant. The raw UID is kept in the encrypted journal entry and sent at sync
    (`evidence.uid`), so the server re-checks the **current** binding through the pepper.
  - **Phones offline:** the kiosk issues its own 16-byte nonces (single use, 60 s) and verifies HCE and `LPR1` signatures
    against the cached SPKI. `LPR2` (web-app passkeys) is not verified offline (it needs the RP origin and counters); those
    students are confirmed by an assistant.
  - **Storage:** AES-256-GCM JSON file, random data key wrapped with `safeStorage` (DPAPI); atomic writes; wiped on
    revocation or _Unregister_.
  - **Sync** (`POST /kiosk/offline-sync`): ordered by `seq`; evidence re-verified (signature, binding, credential status,
    timestamp inside the declared offline window ± 5 min); replay through the normal F5/F6 transactions with the **txId as
    idempotency key** (scope `kiosk.offline:{kioskId}`), so re-syncing is a no-op. Offline borrows skip the overdue and
    item-limit checks (the kiosk applied them with cached data and the equipment has already left), but never the stock
    check: shortfalls, inactive students, revoked or unverifiable credentials and settled lines become
    `OfflineSyncConflict` rows for admin review, and I2 is never broken.
  - **Review:** _Accept_ records what physically happened (stock conflicts first get a `CORRECTION` movement that raises
    the total, so availability never goes negative); _Void_ records nothing. Both are audited.
- **Consequences:** Offline card coverage depends on the kiosk having seen the card before (with one kiosk in the lab, this
  covers returning students). A stolen kiosk disk reveals nothing without the Windows account's DPAPI key; with it, an
  attacker learns names/matricules of active students and the equipment list — the same data the kiosk shows on screen.
