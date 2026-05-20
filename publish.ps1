# publish.ps1 — 在 build_rbz.ps1 之後執行，完成 GitHub Release + Vercel 部署
# 用法: .\publish.ps1 [-notes "說明文字"]
param([string]$notes = "")
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ROOT = $PSScriptRoot
$CONFIG = "$ROOT\loamlab_plugin\config.rb"
$RBZ = "$ROOT\loamlab_plugin.rbz"

# 讀版本號
$configRaw = Get-Content $CONFIG -Raw -Encoding UTF8
if ($configRaw -match "VERSION = '([^']+)'") { $version = $matches[1] }
else { Write-Host "[ABORT] 無法讀取 config.rb 版本號" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $RBZ)) {
    Write-Host "[ABORT] loamlab_plugin.rbz 不存在，請先執行 build_rbz.ps1" -ForegroundColor Red; exit 1
}

if (-not $notes) { $notes = "v$version release" }

Write-Host ""
Write-Host "===== 發佈 v$version =====" -ForegroundColor Cyan

# Step 1: GitHub Release
Write-Host "[1/2] 建立 GitHub Release v$version ..." -ForegroundColor Yellow
gh release view "v$version" --repo "loamlabstudio/loamlab-releases" | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "      已存在，刪除後重建 ..." -ForegroundColor Yellow
    gh release delete "v$version" --repo "loamlabstudio/loamlab-releases" --yes | Out-Null
}
gh release create "v$version" --repo "loamlabstudio/loamlab-releases" --title "LoamLab v$version" --notes $notes $RBZ
if ($LASTEXITCODE -ne 0) { Write-Host "[ABORT] GitHub Release 失敗" -ForegroundColor Red; exit 1 }
Write-Host "[OK] https://github.com/loamlabstudio/loamlab-releases/releases/tag/v$version" -ForegroundColor Green

# Step 2: Vercel 部署
Write-Host ""
Write-Host "[2/2] 部署後端至 Vercel ..." -ForegroundColor Yellow
powershell -ExecutionPolicy Bypass -Command "vercel --prod"
if ($LASTEXITCODE -ne 0) { Write-Host "[WARN] Vercel 部署失敗，請手動執行: vercel --prod" -ForegroundColor Red }
else { Write-Host "[OK] Vercel 部署完成" -ForegroundColor Green }

Write-Host ""
Write-Host "===== v$version 發佈完成 =====" -ForegroundColor Green
