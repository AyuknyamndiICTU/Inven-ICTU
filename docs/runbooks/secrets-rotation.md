# Runbook — Secrets rotation and administrator accounts

All server secrets live in `deploy/.env.prod` (mode 600) and `deploy/secrets/`, with a copy in the ICTU IT password vault. After any change: `lp up -d` (recreates the containers that use the value).

## 1. What each secret protects

| Secret                                          | Protects                                                                                                                                      | Rotation impact                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LABPASS_DB_PASSWORD`                           | Database login                                                                                                                                | None for users. Change the password in Postgres first (§2).                                                                                                                                                                                                                                                                                      |
| `APP_SECRET`                                    | Signed short-lived tokens (student access tokens, kiosk tap sessions), OTP and kiosk-registration code hashes, offline lab-assistant MAC keys | Students silently refresh; pending OTPs and registration codes stop working; **offline journals signed before the change fail verification**, so rotate only when every kiosk shows "online" and Admin → Offline sync has no pending batches. Kiosks pick up new assistant keys with their next bundle (refreshed every 5 minutes while online). |
| `UID_PEPPER`                                    | Card UID lookups (only peppered HMACs are stored)                                                                                             | **Do not rotate.** Every card binding would stop matching; every student would have to re-link their card. Treat it as permanent, and as compromised only together with a database leak.                                                                                                                                                         |
| `DATA_KEY`                                      | Encrypted-at-rest secrets: admin TOTP seeds, SIS connector credentials, SMS/WhatsApp provider tokens, kiosk offline lookup keys               | v1 has no re-encryption tool. Rotate only if the key is compromised: see §3.                                                                                                                                                                                                                                                                     |
| `SMTP_PASSWORD`, `VAPID_*`, `EXPO_ACCESS_TOKEN` | Outbound email, web push, Android push                                                                                                        | Changing the VAPID keys unsubscribes every browser; students re-enable notifications in the app.                                                                                                                                                                                                                                                 |
| WhatsApp / SMS tokens                           | Entered in Admin → Alerts → Providers (stored with `DATA_KEY`)                                                                                | Paste the new token in the console; no restart needed.                                                                                                                                                                                                                                                                                           |
| DESFire master keys                             | Card authentication                                                                                                                           | See [desfire-keys.md](./desfire-keys.md).                                                                                                                                                                                                                                                                                                        |
| Backup age key                                  | Backup confidentiality                                                                                                                        | Generate a new key pair and update `BACKUP_AGE_RECIPIENT`. Keep the old private key until the last backup encrypted with it has expired (14 days).                                                                                                                                                                                               |

Generate new values on the server: `openssl rand -base64 48` (`DATA_KEY`: `openssl rand -base64 32`).

## 2. Database password

```sh
lp exec postgres psql -U labpass -d labpass -c "ALTER USER labpass PASSWORD '<new>';"
sed -i 's/^LABPASS_DB_PASSWORD=.*/LABPASS_DB_PASSWORD=<new>/' deploy/.env.prod
lp up -d
```

## 3. `DATA_KEY` compromised

1. Put the new key in `.env.prod`, then run `lp up -d`.
2. A SUPER_ADMIN uses Admin → Users → **Reset 2-step** for every user. Each user then signs in with their password and enrols TOTP again. Each lab assistant also sets their kiosk assistant PIN again (Settings → **My kiosk assistant PIN**).
3. Re-enter the SIS connector credentials (Admin → Import → connector) and the SMS/WhatsApp tokens (Admin → Alerts → Providers), and rotate them at the provider too.
4. Kiosks fetch a fresh offline bundle automatically. If a kiosk reports a bundle error, unregister and re-register it ([kiosk.md §7](./kiosk.md)).

## 4. Administrator accounts

- **Add:** SUPER_ADMIN → Admin → **Users** → _Add user_. Choose the role:
  - `SUPER_ADMIN` (Super admin): everything, including settings and users.
  - `LAB_ADMIN` (Lab admin): equipment, students, imports, loans, alerts, reports.
  - `LAB_ASSISTANT` (Lab assistant): loans and kiosk confirmations.
  - `VIEWER`: read-only.

  Give the new user the temporary password (12+ characters) in person. They change it and enrol TOTP at first sign-in.

- **Remove:** Admin → Users → _Deactivate_. Their sessions end immediately. Never share accounts; the audit log records the person.
- **Lost TOTP device:** another SUPER_ADMIN clicks _Reset 2-step_. If the only SUPER_ADMIN is locked out, ICTU IT runs the seed command with `LABPASS_SEED_ADMIN_EMAIL=<new address>` ([deploy.md §2](./deploy.md)), which creates an additional SUPER_ADMIN. Deactivate the lost account afterwards.
- **Kiosk PINs:** each lab assistant sets their own PIN in Settings → **My kiosk assistant PIN**. The kiosk service PIN is set at kiosk registration ([kiosk.md](./kiosk.md)).
