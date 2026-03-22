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

$ROOT       = "c:\Users\qingwen\.gemini\antigravity\workspaces\土窟設計su渲染插件"
$BACKEND    = "$ROOT\loamlab_backend"
$CONFIG     = "$ROOT\loamlab_plugin\config.rb"
$VERSION_JS = "$BACKEND\api\version.js"
$OUT_RBZ    = "$ROOT\loamlab_plugin.rbz"
$OUT_ZIP    = "$ROOT\loamlab_plugin.zip"

$GITHUB_USER = "loamlabstudio"
$GITHUB_REPO = "loamlab-releases"
$DOWNLOAD_URL = "https://github.com/$GITHUB_USER/$GITHUB_REPO/releases/download/v$version/loamlab_plugin.rbz"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  LoamLab Release Script v$version" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# ---------------------------------------------------------
# Step 1: 打包 .rbz 插件
#   - BUILD_TYPE: dev → release  (移除 DEV badge)
#   - ENV_MODE:   development → production（若為 dev 模式則切換）
#   - VERSION:    更新為新版號
# ---------------------------------------------------------
Write-Host ""
Write-Host "[1/4] 打包插件 .rbz ..." -ForegroundColor Yellow

if (Test-Path $OUT_ZIP) { Remove-Item $OUT_ZIP -Force }
if (Test-Path $OUT_RBZ) { Remove-Item $OUT_RBZ -Force }

$configOriginal = Get-Content $CONFIG -Raw

$configRelease = $configOriginal `
    -replace 'BUILD_TYPE = "dev"',          'BUILD_TYPE = "release"' `
    -replace 'ENV_MODE = "development"',     'ENV_MODE = "production"' `
    -replace "VERSION = '[^']*'",            "VERSION = '$version'"

Set-Content -Path $CONFIG -Value $configRelease -Encoding UTF8

$itemsToCompress = @("$ROOT\loamlab_plugin.rb", "$ROOT\loamlab_plugin")
Compress-Archive -Path $itemsToCompress -DestinationPath $OUT_ZIP -Force

# 還原 BUILD_TYPE 與 ENV_MODE，但保留新版號
$configDev = $configRelease `
    -replace 'BUILD_TYPE = "release"',  'BUILD_TYPE = "dev"' `
    -replace 'ENV_MODE = "production"', 'ENV_MODE = "development"'

Set-Content -Path $CONFIG -Value $configDev -Encoding UTF8

Rename-Item -Path $OUT_ZIP -NewName "loamlab_plugin.rbz" -Force
Write-Host "   [OK] loamlab_plugin.rbz 已生成 (BUILD_TYPE=release, VERSION=$version)" -ForegroundColor Green

# ---------------------------------------------------------
# Step 2: 更新 version.js（供插件 auto-update 使用）
# ---------------------------------------------------------
Write-Host ""
Write-Host "[2/4] 更新 version.js ..." -ForegroundColor Yellow

$vc = Get-Content $VERSION_JS -Raw
$vc = $vc -replace 'latest_version: "[^"]*"', "latest_version: `"$version`""
$vc = $vc -replace 'release_notes: "[^"]*"',  "release_notes: `"$notes`""
$vc = $vc -replace 'download_url: "[^"]*"',   "download_url: `"$DOWNLOAD_URL`""
Set-Content -Path $VERSION_JS -Value $vc -Encoding UTF8

Write-Host "   [OK] version.js 已更新 → v$version" -ForegroundColor Green
Write-Host "        download_url: $DOWNLOAD_URL" -ForegroundColor Gray

# ---------------------------------------------------------
# Step 3: Git commit + push（含 config.rb 版號 + version.js）
# ---------------------------------------------------------
Write-Host ""
Write-Host "[3/4] 推送至 GitHub (觸發 Vercel 自動部署) ..." -ForegroundColor Yellow

Set-Location $ROOT

$gitStatus = git status --porcelain 2>&1
if ($gitStatus) {
    git add loamlab_backend/api/version.js loamlab_plugin/config.rb
    git commit -m "release: v$version - $notes"
    git push origin main
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   [OK] Git push 成功 → Vercel 將在 30 秒內自動部署" -ForegroundColor Green
    } else {
        Write-Host "   [WARN] Git push 失敗，請手動執行 git push" -ForegroundColor Red
    }
} else {
    Write-Host "   [SKIP] 沒有變更，略過 push" -ForegroundColor Gray
}

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
Write-Host "   ⚠️  確保 GitHub Release 的 .rbz 上傳完成後，auto-update 才會生效" -ForegroundColor Yellow
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  Release v$version 準備完成！" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
