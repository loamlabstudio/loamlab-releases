# publish.ps1 - Run after build_rbz.ps1 to create GitHub Release + deploy Vercel
param([string]$notes = "")
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# === Branch Safety Guard (publish always requires main) ===
$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($currentBranch -ne "main") {
    Write-Host "[ABORT] publish.ps1 只能在 main 分支執行。目前在：$currentBranch" -ForegroundColor Red
    Write-Host "        請完成功能後 merge 到 main 再發布。緊急修復請先 git checkout main。" -ForegroundColor Yellow
    exit 1
}
# ===========================================================

$ROOT = $PSScriptRoot
$CONFIG = "$ROOT\loamlab_plugin\config.rb"
$RBZ = "$ROOT\loamlab_plugin.rbz"

# Read version from config.rb
$configRaw = Get-Content $CONFIG -Raw -Encoding UTF8
if ($configRaw -match "VERSION = '([^']+)'") { $version = $matches[1] }
else { Write-Host "[ABORT] Cannot read version from config.rb" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $RBZ)) {
    Write-Host "[ABORT] loamlab_plugin.rbz not found. Run build_rbz.ps1 first." -ForegroundColor Red; exit 1
}

if (-not $notes) { $notes = "v$version release" }

Write-Host ""
Write-Host "===== Publishing v$version =====" -ForegroundColor Cyan

# Step 1: GitHub Release
Write-Host "[1/2] Creating GitHub Release v$version ..." -ForegroundColor Yellow
gh release view "v$version" --repo "loamlabstudio/loamlab-releases" | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "      Already exists, deleting and recreating ..." -ForegroundColor Yellow
    gh release delete "v$version" --repo "loamlabstudio/loamlab-releases" --yes | Out-Null
}
gh release create "v$version" --repo "loamlabstudio/loamlab-releases" --title "LoamLab v$version" --notes $notes $RBZ
if ($LASTEXITCODE -ne 0) { Write-Host "[ABORT] GitHub Release failed" -ForegroundColor Red; exit 1 }
Write-Host "[OK] https://github.com/loamlabstudio/loamlab-releases/releases/tag/v$version" -ForegroundColor Green

# Step 2: Vercel deploy (must run from repo root; Vercel project root is set to loamlab_backend in project settings)
Write-Host ""
Write-Host "[2/2] Deploying backend to Vercel ..." -ForegroundColor Yellow
Set-Location $ROOT
vercel --prod
if ($LASTEXITCODE -ne 0) { Write-Host "[WARN] Vercel deploy failed. Run manually: vercel --prod" -ForegroundColor Red }
else { Write-Host "[OK] Vercel deploy complete" -ForegroundColor Green }

Write-Host ""
Write-Host "===== v$version published =====" -ForegroundColor Green
