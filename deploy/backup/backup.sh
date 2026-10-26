#!/bin/sh
# LabPass nightly backup (S14): pg_dump (custom format) + stored files, encrypted with age, kept for
# BACKUP_RETENTION_DAYS days in /backups. Copy /backups off the server (see docs/runbooks/backup-restore.md).
#   labpass-backup            one backup now
#   labpass-backup --schedule run every day at BACKUP_AT (HH:MM, container TZ)
set -u

: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT (age public key) is required: backups are never written unencrypted}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
OUT_DIR="${BACKUP_DIR:-/backups}"

fail() {
  echo "[backup] FAILED: $1" >&2
  return 1
}

run_backup() {
  stamp="$(date +%Y%m%d-%H%M%S)"
  work="$(mktemp -d)" || fail "mktemp" || return 1
  target="$OUT_DIR/labpass-$stamp.tar.age"
  echo "[backup] $stamp starting"
  pg_dump --format=custom --no-owner --file="$work/labpass.dump" || { rm -rf "$work"; fail "pg_dump"; return 1; }
  if [ -d /data/storage ]; then
    tar -C /data -czf "$work/storage.tar.gz" storage || { rm -rf "$work"; fail "storage archive"; return 1; }
  fi
  (cd "$work" && sha256sum ./*.dump ./*.gz 2>/dev/null > SHA256SUMS)
  tar -C "$work" -cf "$work.tar" . || { rm -rf "$work" "$work.tar"; fail "bundle"; return 1; }
  rm -rf "$work"
  age -r "$BACKUP_AGE_RECIPIENT" -o "$target.partial" "$work.tar" || { rm -f "$work.tar" "$target.partial"; fail "encrypt"; return 1; }
  rm -f "$work.tar"
  mv "$target.partial" "$target" || { fail "rename"; return 1; }
  find "$OUT_DIR" -name 'labpass-*.tar.age' -type f -mtime +"$RETENTION" -delete
  find "$OUT_DIR" -name '*.partial' -type f -mtime +1 -delete
  echo "[backup] $stamp done: $(du -h "$target" | cut -f1)"
  date +%s > "$OUT_DIR/.last-success"
  # Optional heartbeat for an Uptime Kuma "Push" monitor (docs/runbooks/monitoring.md).
  if [ -n "${BACKUP_PUSH_URL:-}" ]; then
    wget -q -O /dev/null "$BACKUP_PUSH_URL?status=up&msg=$stamp" || echo "[backup] heartbeat failed" >&2
  fi
}

seconds_until() {
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) $1" +%s) || next=$((now + 86400))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  echo $((next - now))
}

if [ "${1:-}" = "--schedule" ]; then
  at="${BACKUP_AT:-02:30}"
  echo "[backup] scheduled daily at $at ($(date +%Z)), retention ${RETENTION} days"
  while true; do
    sleep "$(seconds_until "$at")"
    run_backup || true
  done
else
  run_backup
fi
