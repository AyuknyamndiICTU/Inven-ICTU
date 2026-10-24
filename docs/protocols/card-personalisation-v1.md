# ICTU Student ID Card — NFC Chip & Personalisation Specification v1

|          |                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Status   | **DRAFT for supplier** (send Part A now). Part B is frozen after the sample-card validation in S01         |
| Owner    | ICTU LabPass project · Cisco Lab                                                                           |
| Decision | Q1 (2026-10-20): new ICTU ID cards use **NXP MIFARE DESFire EV3**                                          |
| Related  | [ARCH §6 "Physical cards"](../../plans/ictu-labpass/01-architecture.md) · ADR-0003 · ADR-0008 · step S06.5 |

This document has three parts. **Part A** lists what the card supplier must do for every card it produces. **Part B** describes the
LabPass application on the chip; it can be written by ICTU after delivery. **Part C** is the acceptance test ICTU runs on delivered cards.

> **Never store personal data on the chip.** The chip carries only its serial number (UID) and the LabPass keys. Names, photos and
> matricules stay in ICTU's systems.

---

## Part A — Supplier requirements (send now)

### A1. Chip

| Item      | Requirement                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Chip      | **NXP MIFARE DESFire EV3** (MF3D23/MF3D43/MF3D83 or MF3DH23/43/83). **Not** DESFire Light, not EV1/EV2, not MIFARE Classic, not NTAG/Ultralight |
| Memory    | **2 KB minimum** (4 KB acceptable)                                                                                                              |
| Interface | ISO/IEC 14443-A, with ISO/IEC 7816-4 APDU wrapping (standard on EV3)                                                                            |
| Antenna   | ID-1 card format (85.60 × 53.98 mm); read range ≥ 2 cm on a standard ACS ACR1252U reader                                                        |
| UID       | The 7-byte unique UID programmed by NXP                                                                                                         |

### A2. Mandatory configuration

1. **Random UID (Random ID) must NOT be enabled.** On DESFire EV3 the Random ID option _cannot be switched off_ once activated,
   so a card with Random ID enabled is unusable for LabPass and will be rejected (Part C, test C4).
2. Do not create any application with AID `0x4C5031` (reserved for LabPass, Part B).
3. **PICC master key:** deliver cards in **one** of these states, agreed in writing with ICTU before production:
   - **(A2-a, preferred)** PICC master key changed to the **AES-128 transport key** supplied by ICTU through a sealed key exchange.
     ICTU rotates it later, during personalisation.
   - **(A2-b)** factory default PICC master key (DES, all zeros). Cards are stored securely and delivered only to ICTU, and ICTU
     changes the key during personalisation, before cards reach students.
4. PICC key settings must keep "**create/delete application requires PICC master key authentication**" (the factory default).
   Do not enable free application creation.
5. If the supplier uses the chip for other ICTU applications (e.g. access control or the library), list each AID and its purpose
   in the delivery note. LabPass will not touch other applications.

### A3. Delivery file: `card_uid,matricule` (mandatory, one per batch)

For **every batch** of cards, deliver a CSV file. ICTU imports it into LabPass to link each card to its student automatically.

| Rule         | Value                                                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File name    | `ICTU-cards-<batch_id>-<YYYYMMDD>.csv`                                                                                                                                                    |
| Encoding     | UTF-8 (no BOM preferred, BOM accepted), comma-separated, one header row                                                                                                                   |
| Columns      | `card_uid,matricule,batch_id,printed_at`                                                                                                                                                  |
| `card_uid`   | **14 upper-case hex characters** = the 7-byte UID **exactly as returned by the PC/SC command `FF CA 00 00 00`** (anticollision byte order; NXP UIDs start with `04`). No spaces or colons |
| `matricule`  | The student's matricule exactly as printed on the card                                                                                                                                    |
| `batch_id`   | Supplier batch reference                                                                                                                                                                  |
| `printed_at` | ISO date `YYYY-MM-DD`                                                                                                                                                                     |
| Uniqueness   | Each `card_uid` and each `matricule` appears at most once per file. A reprinted card gets a new row in the next batch                                                                     |
| Transfer     | Encrypted: a password-protected ZIP with the password sent by SMS or phone, or ICTU SFTP. Never by plain email                                                                            |

Example (fictitious data):

```csv
card_uid,matricule,batch_id,printed_at
04A1B2C3D4E580,ICTU20240001,B2026-11-01,2026-11-03
04A1B2C3D4E5F1,ICTU20240002,B2026-11-01,2026-11-03
```

### A4. Samples before mass production

Send **10 sample cards** from the production chip lot, configured as above, plus their delivery file. ICTU runs Part C on them and
confirms in writing before mass production continues.

---

## Part B — LabPass application (written by ICTU, or by the supplier under a key ceremony)

### B1. Personalisation options (decided in ADR-0008)

| Option                | Who writes the LabPass application                                                                                       | Pros                                                          | Cons                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **B-1 (recommended)** | ICTU, after delivery, with the LabPass personalisation tool on the lab reader (≈ 2 s per card), during card distribution | Keys never leave ICTU; independent of the supplier's schedule | Staff time at distribution                                                                   |
| B-2                   | The supplier, during production                                                                                          | No extra step at ICTU                                         | Needs a formal key ceremony and a SAM/HSM at the supplier; the supplier must not retain keys |

### B2. Application layout

| Item                 | Value                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application ID (AID) | `0x4C5031` ("LP1"). DESFire commands carry the AID **LSB first**: `31 50 4C`                                                                                      |
| Key type             | AES-128, **2 keys**                                                                                                                                               |
| Key 0                | Application master key (AMK): changes keys and settings only. Never used at the kiosk                                                                             |
| Key 1                | **LabPass authentication key (LAK)**: used by the kiosk relay for `AuthenticateEV2First`                                                                          |
| Key settings         | Configuration changeable with the AMK only; key change requires the AMK; no free directory listing                                                                |
| Files                | **None required.** Optional: standard data file `0x01` (16 bytes, read access = key 1) holding `LP1`, the format version and the issue date. **No personal data** |

### B3. Key diversification (per-card keys)

Each card gets its own keys, derived from ICTU master keys with **NXP AN10922 (AES-128, CMAC-based)**. A stolen card therefore reveals nothing about other cards.

```
Input M  = 0x01 ‖ UID (7 bytes) ‖ AID (3 bytes, LSB first: 31 50 4C) ‖ SystemIdentifier ("ICTU-LABPASS", 12 ASCII bytes)
Key_card = AES-CMAC(MasterKey_n, M)        # AN10922: |M| = 23 bytes < 32, so M is padded (0x80 00…) to 32 bytes and K2 is used
```

- `MasterKey_0` (for the AMK) and `MasterKey_1` (for the LAK) are different 128-bit keys. Each is versioned (`keyVersion`, starting at 1).
- ICTU generates the master keys on an offline machine and splits them into **2-of-3 escrow shares** (ADR-0008).
  They are loaded only into the LabPass server's secret store. With option B-2 they are also loaded into the supplier's SAM, for the duration of production only.
- The kiosk **never** holds any key. It only relays bytes between the card and the LabPass server (ARCH §6).

### B4. Authentication at the kiosk (summary)

1. The kiosk reads the UID (`FF CA 00 00 00`) and calls `POST /kiosk/card-auth/start {uid}`.
2. The server derives the `LAK` for that UID and returns the first DESFire command, wrapped as ISO 7816:
   `90 5A 00 00 03 31 50 4C 00` (`SelectApplication` LP1). After `91 00` it sends
   `90 71 00 00 02 01 00 00` (`AuthenticateEV2First`, key 1, no PCD capabilities).
3. The kiosk relays the card's answers to `POST /kiosk/card-auth/step` until done. The server completes the 3-pass AES mutual
   authentication. It accepts the card only if the decrypted `RndA'` matches, and then returns the student's identity.
   Each step returns a new single-use session id that is valid for 5 s and bound to the kiosk.

---

## Part C — Acceptance test (ICTU, on every sample set and every batch)

Run with the LabPass card tool on an ACR1252U reader. Test **all 10 samples**, and **at least 2 % (minimum 20 cards) of each production batch**.

| #   | Test                                                                              | Pass condition                                                                                                                     |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Chip identification (`GetVersion`: `90 60 00 00 00`, then `90 AF 00 00 00` twice) | Vendor `0x04` (NXP), hardware type `0x01` (DESFire), **hardware major version `0x33` (EV3)**, storage ≥ 2 KB                       |
| C2  | UID length                                                                        | 7 bytes                                                                                                                            |
| C3  | UID stability                                                                     | Same UID on 3 reads, with the card removed between reads                                                                           |
| C4  | Random ID disabled                                                                | The anticollision UID (`FF CA 00 00 00`) is the same in every session and equals the authenticated `GetCardUID` result             |
| C5  | Delivery file                                                                     | Every tested card's UID is in the batch file, with the matricule printed on the card; the file has no duplicate UIDs or matricules |
| C6  | PICC key state                                                                    | Matches the option agreed in A2-3 (the transport key authenticates, or the default key authenticates under A2-b)                   |
| C7  | No LabPass AID before personalisation                                             | `GetApplicationIDs` does not list `0x4C5031` (unless option B-2 applies)                                                           |
| C8  | Read range                                                                        | Detected at ≥ 2 cm on the ACR1252U                                                                                                 |

A batch is **rejected** if any card fails C1–C4, or if more than 1 % of the tested cards fail C5–C8.

---

## Change history

| Version  | Date       | Change                                                                   |
| -------- | ---------- | ------------------------------------------------------------------------ |
| v1 draft | 2026-10-23 | First draft: Part A for the supplier, Parts B and C for the LabPass team |
