param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("OKF-V0.2-CUTOVER")]
  [string]$Confirm
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $repoRoot "backups/okf-v02-$stamp"
$databaseBackup = Join-Path $backupDir "postgres.dump"
$containerBackup = "/tmp/av-okf-v02-$stamp.dump"

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Push-Location $repoRoot
try {
  docker compose stop caddy web worker
  if ($LASTEXITCODE -ne 0) { throw "Failed to stop application services." }
  docker compose exec -T postgres pg_dump -U av_okf -d av_okf -Fc -f $containerBackup
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL backup command failed." }
  docker compose cp "postgres:$containerBackup" $databaseBackup
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL backup copy failed." }
  if (!(Test-Path -LiteralPath $databaseBackup) -or (Get-Item -LiteralPath $databaseBackup).Length -eq 0) {
    throw "PostgreSQL backup was not created. Production remains stopped."
  }

  docker compose run --rm --no-deps `
    -v "${backupDir}:/cutover-backup" `
    -v "${backupDir}:/docs/debug" `
    -e AV_OKF_KNOWLEDGE_ROOT=/data/knowledge `
    -e AV_OKF_CUTOVER_BACKUP_ROOT=/cutover-backup/vault `
    web `
    node node_modules/tsx/dist/cli.mjs scripts/migrate-okf-v02.mts `
    --apply `
    --confirm $Confirm `
    --database-backup /cutover-backup/postgres.dump
  if ($LASTEXITCODE -ne 0) { throw "OKF v0.2 migration command failed." }

  docker compose up -d web worker caddy
  if ($LASTEXITCODE -ne 0) { throw "Cutover succeeded, but application services failed to restart." }
  Write-Host "OKF v0.2 cutover completed. Database backup: $databaseBackup"
} catch {
  Write-Error "OKF v0.2 cutover failed. Web and worker remain stopped. $_"
  throw
} finally {
  Pop-Location
}
