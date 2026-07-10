# run-local.ps1 - Start DRRG Patient Onboarding against a local Supabase database.
# Requires Docker Desktop running. Runs from wherever this file sits (next to package.json).

Set-Location $PSScriptRoot

Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed." -ForegroundColor Red; exit 1 }

Write-Host "Starting local Supabase (Docker)..." -ForegroundColor Cyan
npx supabase start
if ($LASTEXITCODE -ne 0) { Write-Host "supabase start failed. Is Docker running?" -ForegroundColor Red; exit 1 }

Write-Host "Applying migrations and resetting local data..." -ForegroundColor Cyan
npx supabase db reset

Write-Host "Seeding a local staff login (doctor@drrg.local / LocalTest123!)..." -ForegroundColor Cyan
npm run seed:local:staff

Write-Host "Starting dev server (Ctrl+C to stop). Sign in at http://localhost:3000/login" -ForegroundColor Green
npm run dev
