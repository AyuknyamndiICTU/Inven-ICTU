# Runbook — DESFire master keys (ADR-0008)

Only needed once ICTU orders DESFire EV3 cards. Until then, `desfire_master_keys` stays empty and **Settings → Card security** stays on "Card number only".

People:

- **Custodians (3):** LabPass owner, ICTU IT, Registrar. Any 2 of them can rebuild the keys.
- **Operator:** the person running the personalisation station.

## 1. Generate the keys (once, offline)

1. Use a laptop with no network, booted from a live USB (e.g. Tails or Ubuntu live). Nothing is saved to disk.
2. Generate version 1 of the LAK master key (16 bytes):

   ```sh
   openssl rand -hex 16 | tr a-f A-F    # e.g. 3F9A…  (32 hex characters)
   ```

3. Split it into 2-of-3 Shamir shares, e.g. with `ssss-split -t 2 -n 3` (package `ssss`). Print each share with the key version and date. Do not write the key itself anywhere.
4. Put each share in a tamper-evident envelope. Each custodian signs the register (date, version, envelope number) and stores the envelope in a different safe.
5. Test the shares before shutting down: `ssss-combine -t 2` with two of them must print the same key.

## 2. Load the key on the server

```sh
# on the server, typed by a custodian (never pasted through chat or email)
printf '1:%s\n' '<32 hex>' > deploy/secrets/desfire_master_keys && chmod 600 deploy/secrets/desfire_master_keys
lp up -d api worker
```

The API logs `DESFire key versions loaded: 1`. It never logs or returns the key itself. Then:

1. Personalise the card batch (card spec Part B3, `docs/protocols/card-personalisation-v1.md`).
2. Import the supplier's card batch file (Admin → Import → _Card batch from the supplier_).
3. Switch **Settings → Card security** to "Secure check when possible".
4. Once every card in circulation is personalised, switch it to "Secure check required".

## 3. Rotate (compromise, or a custodian leaves)

Every card binding records the key version it was personalised with, so several versions work side by side.

1. Generate version 2 as in §1, with new shares.
2. Append it to the secret: the file then holds both `1:<old>` and `2:<new>`, one per line. Run `lp up -d api worker`. Newly personalised cards use the highest version.
3. Re-personalise the cards still on version 1 at the help desk. Automatic re-keying on the next kiosk tap (ADR-0008) needs the real reader and is scheduled with the hardware work (M1). On a compromise, also switch Card security back to "Card number only" until the old cards are re-keyed.
4. When no active card remains on version 1, remove the `1:` line and restart. Check with:

   ```sh
   lp exec postgres psql -U labpass labpass -c 'SELECT "keyVersion", count(*) FROM card_bindings WHERE status = '"'ACTIVE'"' GROUP BY 1;'
   ```

5. Destroy the old envelopes in front of two custodians and record it in the register.

## 4. Recovery

If the server is lost, restore it ([backup-restore.md](./backup-restore.md)). Two custodians then rebuild the key with `ssss-combine` on an offline laptop and load it as in §2. The backups deliberately do **not** contain the keys.
