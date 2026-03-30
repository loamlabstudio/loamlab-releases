# ============================================================
# test_update_flow.ps1  ─  模擬 updater.rb download_and_install
# 使用方式：.\test_update_flow.ps1 -url <download_url>
# ============================================================
param(
    [string]$url = "https://github.com/loamlabstudio/loamlab-releases/releases/download/v1.2.5-beta/loamlab_plugin.rbz"
)

$ROOT      = "$PSScriptRoot"
$testDir   = "$env:TEMP\loamlab_update_test_$(Get-Date -Format 'yyyyMMddHHmmss')"
$zip_path  = "$testDir\loamlab_update_test.rbz"
$dest_dir  = "$testDir\extract_result"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  LoamLab Update Flow Test" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  URL:  $url" -ForegroundColor Gray
Write-Host "  TMP:  $testDir" -ForegroundColor Gray
Write-Host ""

New-Item -ItemType Directory -Force -Path $testDir | Out-Null

# ─── Step A: 下載 .rbz ───────────────────────────────────────
Write-Host "[Step A] 下載 .rbz ..." -ForegroundColor Yellow
try {
    Invoke-WebRequest -Uri $url -OutFile $zip_path
    if (!(Test-Path $zip_path) -or (Get-Item $zip_path).Length -lt 10000) {
        Write-Host "   [FAIL] 下載失敗或檔案太小 ($($(Get-Item $zip_path -ErrorAction SilentlyContinue).Length) bytes)" -ForegroundColor Red
        exit 1
    }
    $sizeMb = [math]::Round((Get-Item $zip_path).Length / 1KB, 1)
    Write-Host "   [OK] 下載完成：$zip_path ($sizeMb KB)" -ForegroundColor Green
} catch {
    Write-Host "   [FAIL] 下載例外：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ─── Step B: 解壓縮到測試目錄 ──────────────────────────────
Write-Host ""
Write-Host "[Step B] 解壓縮 .rbz ..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $dest_dir | Out-Null
try {
    Expand-Archive -Path $zip_path -DestinationPath $dest_dir -Force
    Write-Host "   [OK] 解壓目錄：$dest_dir" -ForegroundColor Green
} catch {
    Write-Host "   [FAIL] 解壓例外：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ─── Step C: 驗證解壓結構 ──────────────────────────────────
Write-Host ""
Write-Host "[Step C] 驗證解壓後的目錄結構 ..." -ForegroundColor Yellow

$expectedFiles = @(
    "loamlab_plugin\main.rb",
    "loamlab_plugin\updater.rb",
    "loamlab_plugin\config.rb",
    "loamlab_plugin\coze_api.rb",
    "loamlab_plugin\ui\index.html",
    "loamlab_plugin\ui\app.js"
)

$allOk = $true
foreach ($f in $expectedFiles) {
    $full = Join-Path $dest_dir $f
    if (Test-Path $full) {
        Write-Host "   [OK] $f" -ForegroundColor Green
    } else {
        Write-Host "   [MISS] $f" -ForegroundColor Red
        $allOk = $false
    }
}

# ─── Step D: 驗證 updater.rb 包含修復後的關鍵代碼 ─────────
Write-Host ""
Write-Host "[Step D] 驗證 updater.rb 的修復代碼 ..." -ForegroundColor Yellow

$updaterPath = Join-Path $dest_dir "loamlab_plugin\updater.rb"
if (Test-Path $updaterPath) {
    $updaterContent = Get-Content $updaterPath -Raw
    if ($updaterContent -match "UI\.start_timer" -and $updaterContent -notmatch "Thread\.new") {
        Write-Host "   [OK] 已包含修復後的 UI.start_timer（無 Thread.new）" -ForegroundColor Green
    } else {
        Write-Host "   [FAIL] updater.rb 仍包含舊的 Thread.new 或缺少 UI.start_timer！" -ForegroundColor Red
        $allOk = $false
    }
    if ($updaterContent -match "main\.rb") {
        Write-Host "   [OK] 包含 main.rb 的重載邏輯" -ForegroundColor Green
    } else {
        Write-Host "   [FAIL] 缺少 main.rb 重載！" -ForegroundColor Red
        $allOk = $false
    }
    if ($updaterContent -match "show_dialog") {
        Write-Host "   [OK] 包含 show_dialog 重開視窗邏輯" -ForegroundColor Green
    } else {
        Write-Host "   [FAIL] 缺少 show_dialog！" -ForegroundColor Red
        $allOk = $false
    }
} else {
    Write-Host "   [FAIL] updater.rb 不存在於解壓目錄" -ForegroundColor Red
    $allOk = $false
}

# ─── Step E: 驗證新版本號 ───────────────────────────────────
Write-Host ""
Write-Host "[Step E] 驗證版本號 ..." -ForegroundColor Yellow
$configPath = Join-Path $dest_dir "loamlab_plugin\config.rb"
if (Test-Path $configPath) {
    $configContent = Get-Content $configPath -Raw
    if ($configContent -match "VERSION = '([^']+)'") {
        $ver = $matches[1]
        Write-Host "   [OK] 插件版本：$ver" -ForegroundColor Green
    }
    if ($configContent -match 'BUILD_TYPE = "release"') {
        Write-Host "   [OK] BUILD_TYPE = release" -ForegroundColor Green
    } else {
        Write-Host "   [WARN] BUILD_TYPE 不是 release（可能是 dev build）" -ForegroundColor Yellow
    }
}

# ─── 清理與結果 ────────────────────────────────────────────
Remove-Item -Path $testDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
if ($allOk) {
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  ✅ 所有驗證通過！更新流程可以正常運行" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
} else {
    Write-Host "=============================================" -ForegroundColor Red
    Write-Host "  ❌ 驗證失敗，請修復後再發布" -ForegroundColor Red
    Write-Host "=============================================" -ForegroundColor Red
    exit 1
}
