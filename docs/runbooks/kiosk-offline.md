# Runbook — Kiosk offline mode (decision Q6)

**Owner:** lab administrator. **Design:** ARCH §5 F9 and [ADR-0009](../adr/0009-kiosk-offline-mode.md).

## 1. What the kiosk does when the server is unreachable

- After 10 seconds without the API the status capsule turns **amber: "Offline — loans will sync"** with a pending counter.
- Students can still borrow and return:
  - **Card:** works for cards already used at this kiosk while it was online. Other cards → matricule + assistant.
  - **Android phone tap** and **LabPass app response QR (LPR1)**: verified on the kiosk.
  - **Web-app (iPhone) codes** and **matricule entry**: a **lab assistant** confirms with their assistant PIN.
- Returns are possible for loans that existed before the outage. Items borrowed during the outage are returned after it.
- Receipts say **"Offline — will sync"**.
- After `offlineMaxHours` (Settings → Kiosk, default 8 h) the kiosk becomes **read-only**: returns only. A lab assistant can
  allow 2 more hours: hold the LabPass logo 2 s → service PIN → _Allow offline loans for 2 more hours_.

## 2. When the server comes back

The kiosk syncs automatically within 30 seconds (heartbeat): it sends the journal in order, then downloads a fresh bundle.
The pending counter returns to 0. Nothing needs to be done unless conflicts appear.

## 3. Conflicts (Admin → **Offline sync**)

| Reason                            | Typical cause                                    | Usual decision                                                                      |
| --------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Not enough stock when synced      | Stock was changed elsewhere during the outage    | Check the shelf; **Accept** if the items really left (the stock is corrected first) |
| Card or phone revoked             | The credential was revoked during the outage     | Verify with the student; Accept or Void                                             |
| Student not active                | Account deactivated during the outage            | Accept (to track the items) and follow up                                           |
| Identity could not be re-verified | Forged or corrupted evidence                     | **Void** and investigate                                                            |
| Kiosk data too old                | Bundle version unknown to the server             | Verify, then Accept or Void                                                         |
| Loan line already settled         | Returned twice (e.g. force-returned by an admin) | Void                                                                                |

Every decision needs a reason and is written to the audit log.

## 4. Turning offline mode off

1. Make sure no kiosk shows pending items (Admin → Kiosks, or the overlay's _Waiting to sync_).
2. Settings → Kiosk → `offlineMaxHours = 0`. Kiosks then show "LabPass server unreachable" during outages (K9).

## 5. Security notes

- The offline cache and journal are AES-256-GCM encrypted with a key wrapped by Windows DPAPI for the kiosk account.
- Revoking or unregistering a kiosk wipes the cache immediately.
- Student PIN hashes, contacts, photos and card UIDs are never in the bundle; raw UIDs exist only in pending journal entries.

## 6. Drill (S13)

Stop the API during lab hours → do 20 borrows/returns (card, phone, assistant) → start the API → wait 30 s → check
Admin → Offline sync is empty (or reviewed) and `pnpm ops:reconcile` reports 0 drift → run the sync again: nothing changes.
