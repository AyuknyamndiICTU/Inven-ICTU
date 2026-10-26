<#
.SYNOPSIS
  Backup/restore drill (S13 task 7, S14 runbook): dump the LabPass database, restore it into a fresh database,
  and run the stock reconcile against the restored copy. Writes evidence to docs/evidence/restore-<date>.json.
.EXAMPLE
  pwsh scripts/ops/restore-drill.ps1                       # dev: docker container labpass-postgres
  pwsh scripts/ops/restore-drill.ps1 -Container labpass-db -Database labpass
#>
param(
  [string]$Container = 'labpass-postgres',
  [string]$Database = 'labpass',
  [string]$User = 'labpass',
  [string]$RestoreDatabase = 'labpass_restore_drill'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
$dump = "/tmp/labpass-$stamp.dump"
$sw = [Diagnostics.Stopwatch]::StartNew()

Write-Host "1/4 Dumping $Database ..."
docker exec $Container pg_dump -U $User -d $Database -Fc -f $dump
if ($LASTEXITCODE) { throw 'pg_dump failed' }
$size = (docker exec $Container stat -c %s $dump).Trim()

Write-Host "2/4 Restoring into $RestoreDatabase ..."
docker exec $Container dropdb -U $User --if-exists $RestoreDatabase
docker exec $Container createdb -U $User $RestoreDatabase
docker exec $Container pg_restore -U $User -d $RestoreDatabase --no-owner $dump
if ($LASTEXITCODE) { throw 'pg_restore failed' }

Write-Host '3/4 Comparing row counts ...'
$tables = 'students', 'equipment', 'loans', 'loan_lines', 'stock_movements', 'card_bindings', 'mobile_credentials', 'audit_logs'
$counts = @{}
foreach ($t in $tables) {
  $a = (docker exec $Container psql -U $User -d $Database -tAc "SELECT count(*) FROM $t").Trim()
  $b = (docker exec $Container psql -U $User -d $RestoreDatabase -tAc "SELECT count(*) FROM $t").Trim()
  $counts[$t] = @{ source = [int]$a; restored = [int]$b }
  if ($a -ne $b) { throw "Row count mismatch in ${t}: $a vs $b" }
}

Write-Host '4/4 Reconcile on the restored database ...'
$env:LABPASS_DB_NAME = $RestoreDatabase
Push-Location (Join-Path $root 'apps/api')
$reconcile = node -r @swc-node/register src/ops/reconcile.cli.ts 2>&1 | Out-String
$code = $LASTEXITCODE
Pop-Location
Remove-Item Env:LABPASS_DB_NAME

docker exec $Container rm -f $dump | Out-Null
docker exec $Container dropdb -U $User --if-exists $RestoreDatabase

$evidence = [ordered]@{
  date = (Get-Date).ToString('o')
  source = $Database
  dumpBytes = [int64]$size
  seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  rowCounts = $counts
  reconcileExitCode = $code
  reconcileOutput = $reconcile.Trim()
}
$out = Join-Path $root "docs/evidence/restore-$($stamp.Substring(0,10)).json"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$evidence | ConvertTo-Json -Depth 5 | Set-Content $out
Write-Host "Evidence: $out"
if ($code) { throw 'Reconcile reported drift on the restored database' }
