# Runbook — Monitoring and alerts

LabPass runs [Uptime Kuma](https://github.com/louislam/uptime-kuma) next to the stack:

```sh
lp --profile monitoring up -d uptime-kuma
```

It listens only on `127.0.0.1:3001`. Open it through an SSH tunnel (`ssh -L 3001:127.0.0.1:3001 <server>`, then browse to `http://localhost:3001`), create the admin account, and enable 2FA in its settings.

## 1. Monitors

| Monitor                                                | Type                        | Interval | Alert when  | Notes                                                                                                                                                                                      |
| ------------------------------------------------------ | --------------------------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `https://<domain>/api/ready`                           | HTTP(s)                     | 60 s     | 2 failures  | Database **and** Redis reachable. Enable "Certificate expiry notification" (14 days).                                                                                                      |
| `https://<admin-domain>/login`                         | HTTP(s)                     | 120 s    | 2 failures  | Admin console up                                                                                                                                                                           |
| `https://<domain>/`                                    | HTTP(s) – keyword `LabPass` | 300 s    | 2 failures  | Student web app served                                                                                                                                                                     |
| `https://<domain>/api/health/kiosks`                   | HTTP(s)                     | 120 s    | 3 failures  | Returns 503 when an active kiosk has not sent a heartbeat for 5 min. Add a **maintenance window** outside lab hours (e.g. 19:00–07:30 and Sundays) so switched-off PCs do not page anyone. |
| Backup heartbeat                                       | Push                        | 25 h     | No push     | Copy the push URL into `BACKUP_PUSH_URL` (use `http://uptime-kuma:3001/api/push/<token>` inside compose), then `lp up -d backup`.                                                          |
| `postgres`, `redis`, `api`, `worker`, `web` containers | Docker container            | 60 s     | Not running | Mount `/var/run/docker.sock:ro` into uptime-kuma only if IT accepts the risk; otherwise rely on the HTTP checks.                                                                           |

## 2. Notification channels

Add at least two channels in Settings → Notifications, and tick them on every monitor:

- **Email** (SMTP, same relay as LabPass) to the lab owner and ICTU IT.
- **Telegram, WhatsApp or SMS** for the on-call person. Uptime Kuma supports Telegram, several SMS gateways and WhatsApp providers natively.

LabPass's own low-stock and overdue alerts are separate and configured in Admin → Settings → Notifications.

## 3. What to do when an alert fires

| Alert                | First checks                                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/ready` down    | `lp ps`, then `lp logs --tail=200 api`. A 503 body names the dependency (`db` or `redis`); check `lp logs postgres redis` and disk space (`df -h`).               |
| Admin down           | `lp logs --tail=100 admin`, then `lp restart admin`.                                                                                                              |
| Kiosks stale         | See [kiosk.md §4](./kiosk.md) (PC on? network? reader?). Kiosks keep lending offline ([kiosk-offline.md](./kiosk-offline.md)), so this alert is not an emergency. |
| Backup missed        | `lp logs --tail=50 backup`. Common causes: disk full, `BACKUP_AGE_RECIPIENT` not set, or Postgres unreachable. Run `lp exec backup labpass-backup` once fixed.    |
| Certificate expiring | `lp logs web                                                                                                                                                      | grep -i acme`. Port 80 must be reachable for renewal, or replace the ICTU certificate files. |

## 4. Logs and errors

- API and worker logs are structured JSON (pino). Request logs record the route template, status and timing, not request bodies.
- Docker rotates them (5 × 20 MB per container): `lp logs --since 1h api | grep '"level":50'` lists errors.
- Every administrative action is also in Admin → **Audit log**.
- An error tracker (GlitchTip or Sentry) is not wired in v1. If ICTU wants one, add `@sentry/node` to the API, set its DSN in `.env.prod`, and update the threat model for the new outbound connection.
