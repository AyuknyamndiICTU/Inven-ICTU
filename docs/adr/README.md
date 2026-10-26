# Architecture decision records

Each ADR records one decision, its context and its consequences. Add a new file `NNNN-short-title.md` with the next number; never renumber or delete. Supersede an ADR by writing a new one and updating the status line of the old one.

| ADR                                        | Decision                                                                                  | Status   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- | -------- |
| [0001](./0001-reader-hardware.md)          | Kiosk NFC reader hardware (PC/SC, ACR1252U class)                                         | Accepted |
| [0002](./0002-pcsc-binding.md)             | PC/SC binding for Electron (`@pokusew/pcsclite` in a utility process)                     | Accepted |
| [0003](./0003-card-identification.md)      | Card identification: peppered UID HMAC; DESFire EV3 mutual auth when available            | Accepted |
| [0004](./0004-sis-integration.md)          | Student records: file import first, SIS connector behind an adapter                       | Accepted |
| [0005](./0005-contract-first.md)           | Contract-first API (`@labpass/contracts`: zod schemas, route registry, generated OpenAPI) | Accepted |
| [0006](./0006-stock-ledger-idempotency.md) | Stock as an append-only ledger with idempotency keys                                      | Accepted |
| [0007](./0007-android-attestation.md)      | Android key attestation stored for audit, not enforced (v1)                               | Accepted |
| [0008](./0008-desfire-key-custody.md)      | DESFire master keys: 2-of-3 Shamir escrow, Docker secret, versioned rotation              | Proposed |
| [0009](./0009-kiosk-offline-mode.md)       | Kiosk offline mode: signed bundle, encrypted journal, server-side replay and conflicts    | Accepted |
| [0010](./0010-student-app-hardening.md)    | Student app: PWA + Android HCE, passkeys, refresh token storage per platform              | Accepted |

Related: [threat model](../security/threat-model.md), [protocols](../protocols/), [runbooks](../runbooks/README.md).
