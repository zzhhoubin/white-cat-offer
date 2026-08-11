# Start backend + web frontend in separate windows
$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"
$BackendDir = Join-Path $Root "interview-assistant\backend"
$WebDir = Join-Path $Root "interview-assistant\web"

if (-not (Test-Path $VenvPython)) {
    Write-Host "[ERROR] .venv not found. Run: py -3.12 -m venv .venv" -ForegroundColor Red
    Write-Host "See start.md for setup." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path (Join-Path $WebDir "node_modules"))) {
    Write-Host "[INFO] Installing web dependencies (npm install)..." -ForegroundColor Yellow
    Push-Location $WebDir
    npm install
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
    Pop-Location
}

Write-Host ""
Write-Host "Starting services..." -ForegroundColor Cyan
Write-Host "  Backend:  http://127.0.0.1:8765" -ForegroundColor Green
Write-Host "  Frontend: http://127.0.0.1:5173 (if port busy, check vite window for actual port)" -ForegroundColor Green
Write-Host "  Tip: close old backend/vite windows before restart to avoid proxy HTTP 500" -ForegroundColor Yellow
Write-Host ""

$backendCmd = "Set-Location '$BackendDir'; & '$VenvPython' app.py"
$webCmd = "Set-Location '$WebDir'; npm run dev"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
Start-Sleep -Seconds 1
Start-Process powershell -ArgumentList "-NoExit", "-Command", $webCmd

Write-Host "Done. Close each window to stop that service." -ForegroundColor Cyan