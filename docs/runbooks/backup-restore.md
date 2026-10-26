# Runbook — Backups and restore

## 1. What is backed up

The `backup` container runs every night at `BACKUP_AT` (default 02:30, Africa/Douala). Each run produces one file, `deploy/backups/labpass-YYYYMMDD-HHMMSS.tar.age`, which contains:

- `labpass.dump`: `pg_dump --format=custom` of the whole database (students, cards, credentials, loans, stock ledger, audit log, settings).
- `storage.tar.gz`: uploaded files (student photos, import files, exports).
- `SHA256SUMS`

The file is encrypted with [age](https://age-encryption.org) for `BACKUP_AGE_RECIPIENT`. **The private key never lives on the server.** Backups older than `BACKUP_RETENTION_DAYS` (14) are deleted, and `deploy/backups/.last-success` holds the time of the last good run (monitored, see [monitoring.md](./monitoring.md)).

Not in the backup:

- `.env.prod` and `deploy/secrets/`: keep them in the IT password vault.
- DESFire master keys: Shamir escrow, see [desfire-keys.md](./desfire-keys.md).
- Redis: queues only; the outbox in Postgres is the source of truth.

## 2. Off-site copy (daily)

Copy the newest file to a second location, such as the ICTU file server or an external disk kept in another building, for example from a cron job on the file server:

```sh
rsync -a labpass@<server>:/opt/labpass/deploy/backups/ /srv/backups/labpass/
```

## 3. Restore

1. Stop writers: `lp stop api worker admin web`.
2. Decrypt on an admin workstation that holds the private key, then copy the folder to the server:

   ```sh
   age -d -i labpass-backup.key labpass-<stamp>.tar.age | tar -x -C restore/
   (cd restore && sha256sum -c SHA256SUMS)
   ```

3. Restore the database into a fresh database, then swap it in:

   ```sh
   lp exec -T postgres createdb -U labpass labpass_restore
   lp exec -T postgres pg_restore -U labpass -d labpass_restore --no-owner < restore/labpass.dump
   lp exec -T postgres psql -U labpass -d postgres -c "ALTER DATABASE labpass RENAME TO labpass_broken;"
   lp exec -T postgres psql -U labpass -d postgres -c "ALTER DATABASE labpass_restore RENAME TO labpass;"
   ```

4. Restore the files:

   ```sh
   lp run --rm -v "$PWD/restore:/restore" --entrypoint sh api \
     -c 'tar -xzf /restore/storage.tar.gz -C /data'
   ```

5. Start the stack again with `lp up -d`. Then:
   - run `lp --profile tools run --rm tools pnpm --filter @labpass/api ops:reconcile`; it must exit 0;
   - test one kiosk tap.
6. Kiosks that were offline during the outage sync their journals automatically. Review Admin → **Offline sync**.
7. Once you are confident, drop `labpass_broken`. Write an incident note: what was lost (the time between the backup and the failure) and why.

## 4. Quarterly drill

Run the drill on a copy, never in production:

```sh
pwsh scripts/ops/restore-drill.ps1 -Container labpass-postgres-1 -Database labpass
```

The script dumps the database, restores it into `labpass_restore_drill`, runs the reconcile and writes `docs/evidence/restore-<date>.json`. The S13 run passed in 23.1 s: 200 students and 30 items restored, reconcile reported 0 drift ([evidence](../evidence/restore-2026-10-26.json)). Once a year, also decrypt a real nightly file to prove the age key escrow works.
