<#
  Creates the `cue` role and database in your existing local PostgreSQL.

  Run it from the repo root:

      powershell -ExecutionPolicy Bypass -File scripts\setup-db.ps1

  It will prompt for your PostgreSQL superuser password — the one you chose when
  you installed PostgreSQL. Nothing is written to disk or logged.
#>

param(
  [string]$SuperUser = "postgres",
  [string]$PgHost    = "localhost",
  [int]   $Port      = 5432,
  [string]$AppUser   = "cue",
  [string]$AppPass   = "cue",
  [string]$AppDb     = "cue"
)

$ErrorActionPreference = "Stop"

# Find psql without needing it on PATH.
$psql = Get-Command psql -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $psql) {
  $candidates = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName "bin\psql.exe" } |
    Where-Object { Test-Path $_ }
  $psql = $candidates | Select-Object -First 1
}
if (-not $psql) { throw "Could not find psql.exe. Add PostgreSQL's bin folder to PATH and retry." }

Write-Host "Using $psql" -ForegroundColor DarkGray

$secure = Read-Host "PostgreSQL password for '$SuperUser'" -AsSecureString
$env:PGPASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password

try {
  # CREATE ROLE / CREATE DATABASE cannot run inside a DO block, so check first
  # and only issue the statement when it is actually missing.
  $roleExists = & $psql -U $SuperUser -h $PgHost -p $Port -d postgres -tAc `
    "select 1 from pg_roles where rolname = '$AppUser';"
  if ($roleExists -ne "1") {
    & $psql -U $SuperUser -h $PgHost -p $Port -d postgres -c `
      "create role $AppUser with login password '$AppPass';"
    Write-Host "created role $AppUser" -ForegroundColor Green
  } else {
    Write-Host "role $AppUser already exists" -ForegroundColor DarkGray
  }

  $dbExists = & $psql -U $SuperUser -h $PgHost -p $Port -d postgres -tAc `
    "select 1 from pg_database where datname = '$AppDb';"
  if ($dbExists -ne "1") {
    & $psql -U $SuperUser -h $PgHost -p $Port -d postgres -c `
      "create database $AppDb owner $AppUser;"
    Write-Host "created database $AppDb" -ForegroundColor Green
  } else {
    Write-Host "database $AppDb already exists" -ForegroundColor DarkGray
  }

  # Needed on PG15+ where PUBLIC no longer has CREATE on the public schema.
  & $psql -U $SuperUser -h $PgHost -p $Port -d $AppDb -c `
    "grant all on schema public to $AppUser;"

  Write-Host ""
  Write-Host "Done. Your .env should contain:" -ForegroundColor Cyan
  Write-Host "DATABASE_URL=postgres://${AppUser}:${AppPass}@${PgHost}:${Port}/${AppDb}"
  Write-Host ""
  Write-Host "Next:  npm run db:push   then   npm run seed   then   npm run dev"
}
finally {
  # Do not leave the superuser password sitting in the session environment.
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
