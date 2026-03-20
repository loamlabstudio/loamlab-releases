# ============================================================
# LoamLab 一鍵發佈腳本 (release.ps1)
# 使用方式: .\release.ps1 -version "1.3.0" -notes "修復渲染問題"
# ============================================================
param(
    [Parameter(Mandatory = $true)]
    [string]$version,
    
    [Parameter(Mandatory = $true)]
    [string]$notes
)

$ROOT = "c:\Users\qingwen\.gemini\antigravity\playground\luminescent-einstein"
$BACKEND = "$ROOT\loamlab_backend"
$CONFIG = "$ROOT\loamlab_plugin\config.rb"
$OUT_RBZ = "$ROOT\loamlab_plugin.rbz"
$OUT_ZIP = "$ROOT\loamlab_plugin.zip"

# GitHub Releases 的下載連結模板 (請確認 Repo 名稱正確)
$GITHUB_USER = "loamlabstudio"
$GITHUB_REPO = "loamlab-camera-backend"
$DOWNLOAD_URL = "https://github.com/$GITHUB_USER/$GITHUB_REPO/releases/download/v$version/loamlab_plugin.rbz"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  LoamLab Release Script v$version" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# ---------------------------------------------------------
# Step 1: 打包 .rbz 插件 (自動切換 ENV_MODE = production)
# ---------------------------------------------------------
Write-Host ""
Write-Host "[1/4] 打包插件 .rbz ..." -ForegroundColor Yellow

if (Test-Path $OUT_ZIP) { Remove-Item $OUT_ZIP -Force }
if (Test-Path $OUT_RBZ) { Remove-Item $OUT_RBZ -Force }

$configContent = Get-Content $CONFIG -Raw

# 強制切換為正式環境
$prodContent = $configContent -replace 'ENV_MODE = "development"', 'ENV_MODE = "production"'
# 同時更新版本號
$prodContent = $prodContent -replace "VERSION = '.*?'", "VERSION = '$version'"
Set-Content -Path $CONFIG -Value $prodContent -Encoding UTF8

# 打包
$itemsToCompress = @("$ROOT\loamlab_plugin.rb", "$ROOT\loamlab_plugin")
Compress-Archive -Path $itemsToCompress -DestinationPath $OUT_ZIP -Force

# 還原開發環境 (讓版本號也更新)
$devContent = $prodContent -replace 'ENV_MODE = "production"', 'ENV_MODE = "development"'
Set-Content -Path $CONFIG -Value $devContent -Encoding UTF8

Rename-Item -Path $OUT_ZIP -NewName "loamlab_plugin.rbz" -Force
Write-Host "   [OK] loamlab_plugin.rbz 已生成" -ForegroundColor Green

# ---------------------------------------------------------
# Step 2: 更新 version.json (供插件自動更新機制使用)
# ---------------------------------------------------------
Write-Host ""
Write-Host "[2/4] 更新 version.json ..." -ForegroundColor Yellow

$versionJson = @{
    latest_version = $version
    release_notes  = $notes
    download_url   = $DOWNLOAD_URL
} | ConvertTo-Json -Depth 3

$versionFile = "$BACKEND\api\version.json"
Set-Content -Path $versionFile -Value $versionJson -Encoding UTF8
Write-Host "   [OK] version.json 已更新為 v$version" -ForegroundColor Green

# ---------------------------------------------------------
# Step 3: Git push 後端 → 觸發 Vercel 自動部署
# ---------------------------------------------------------
Write-Host ""
Write-Host "[3/4] 推送後端代碼至 GitHub (觸發 Vercel 自動부署) ..." -ForegroundColor Yellow

Set-Location $BACKEND

$gitStatus = git status --porcelain 2>&1
if ($gitStatus) {
    git add .
    git commit -m "release: v$version - $notes"
    git push origin main
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   [OK] Git push 成功 → Vercel 將在 30 秒內自動部署" -ForegroundColor Green
    }
    else {
        Write-Host "   [WARN] Git push 失敗，請檢查 GitHub 連線或先執行 .\init_git.ps1" -ForegroundColor Red
    }
}
else {
    Write-Host "   [SKIP] 後端沒有變更，略過 push" -ForegroundColor Gray
}

Set-Location $ROOT

# ---------------------------------------------------------
# Step 4: 提示手動上傳 .rbz 到 GitHub Releases
# ---------------------------------------------------------
Write-Host ""
Write-Host "[4/4] 最後一步 (需手動完成):" -ForegroundColor Yellow
Write-Host ""
Write-Host "   請至 GitHub 建立新 Release:" -ForegroundColor White
Write-Host "   https://github.com/$GITHUB_USER/$GITHUB_REPO/releases/new" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Tag:   v$version" -ForegroundColor White
Write-Host "   Title: LoamLab v$version" -ForegroundColor White
Write-Host "   Notes: $notes" -ForegroundColor White
Write-Host "   File:  $OUT_RBZ" -ForegroundColor White
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  Release v$version 準備完成！" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
