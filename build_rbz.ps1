param([switch]$ew)

$sourceDir = $PSScriptRoot
$configFile = "$sourceDir\loamlab_plugin\config.rb"

# ─── 顯示自上次 tag 以來的 commit 摘要 ──────────────────────────
$lastTag = git describe --tags --abbrev=0 2>$null
if ($lastTag) {
    $pendingCommits = git log "$lastTag..HEAD" --oneline 2>$null
    if ($pendingCommits) {
        Write-Host ""
        Write-Host "📦 本次 Release 包含以下更新（$lastTag 之後）：" -ForegroundColor Cyan
        $pendingCommits | ForEach-Object { Write-Host "  · $_" -ForegroundColor White }
        Write-Host ""
    } else {
        Write-Host "（無新 commit，與 $lastTag 相同）" -ForegroundColor DarkGray
    }
} else {
    Write-Host "（找不到上一個 tag，跳過 commit 摘要）" -ForegroundColor DarkGray
}

# ─── 決定輸出檔名與排除清單 ───────────────────────────────────
if ($ew) {
    $outRbzName = "loamlab_plugin_ew.rbz"
    # EW 版排除 updater.rb：審核員看不到任何更新相關 Ruby 代碼
    $excludePatterns = @('node_modules', 'test_', 'package-lock.json', 'package.json', '.testsprite', 'test_screenshot', 'updater.rb')
    Write-Host "Packaging LoamLab Plugin (EW Submission Build)..." -ForegroundColor Yellow
} else {
    $outRbzName = "loamlab_plugin.rbz"
    $excludePatterns = @('node_modules', 'test_', 'package-lock.json', 'package.json', '.testsprite', 'test_screenshot')
    Write-Host "Packaging LoamLab Plugin (Direct Release Build)..."
}

$outZip = "$sourceDir\loamlab_plugin.zip"
$outRbz = "$sourceDir\$outRbzName"

if (Test-Path $outZip) { Remove-Item $outZip -Force }
if (Test-Path $outRbz) { Remove-Item $outRbz -Force }

# ★ 環境隔離：打包前強制寫入 release 設定
$configContent = Get-Content $configFile -Raw
$prodContent = $configContent -replace 'BUILD_TYPE = "dev"', 'BUILD_TYPE = "release"'
if ($ew) {
    $prodContent = $prodContent -replace 'DIST_CHANNEL = "direct"', 'DIST_CHANNEL = "store"'
    Write-Host "[Deploy] BUILD_TYPE → release, DIST_CHANNEL → store (EW)" -ForegroundColor Cyan
} else {
    Write-Host "[Deploy] BUILD_TYPE → release, DIST_CHANNEL = direct" -ForegroundColor Cyan
}
Set-Content -Path $configFile -Value $prodContent -Encoding UTF8

# 手動建 zip，確保路徑分隔符為 /（跨平台相容 Mac）
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

try {
    $stream = [System.IO.File]::Open($outZip, [System.IO.FileMode]::Create)
    $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)

    function Add-ToZip($archive, $filePath, $entryName) {
        $entry = $archive.CreateEntry($entryName)
        $entryStream = $entry.Open()
        $fileStream = [System.IO.File]::OpenRead($filePath)
        $fileStream.CopyTo($entryStream)
        $fileStream.Dispose()
        $entryStream.Dispose()
    }

    # 加入入口檔案
    Add-ToZip $archive "$sourceDir\loamlab_plugin.rb" "loamlab_plugin.rb"

    # 加入 loamlab_plugin/ 目錄
    Get-ChildItem -Path "$sourceDir\loamlab_plugin" -Recurse -File | Where-Object {
        $fullPath = $_.FullName
        $skip = $false
        foreach ($pat in $excludePatterns) {
            if ($fullPath -like "*$pat*") { $skip = $true; break }
        }
        -not $skip
    } | ForEach-Object {
        $relative = $_.FullName.Substring($sourceDir.Length + 1).Replace('\', '/')
        Add-ToZip $archive $_.FullName $relative
    }

    $archive.Dispose()
    $stream.Dispose()

    Rename-Item -Path $outZip -NewName $outRbzName -Force
} finally {
    # ★ 打包完畢後明確還原為 dev 模式（try/finally 確保任何錯誤都能還原）
    $restoredContent = $prodContent -replace 'BUILD_TYPE = "release"', 'BUILD_TYPE = "dev"'
    if ($ew) {
        $restoredContent = $restoredContent -replace 'DIST_CHANNEL = "store"', 'DIST_CHANNEL = "direct"'
    }
    Set-Content -Path $configFile -Value $restoredContent -Encoding UTF8
    Write-Host "[Deploy] config.rb restored to dev" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Done! Output: $outRbz" -ForegroundColor Green
if ($ew) {
    Write-Host "⚠ EW build: updater.rb excluded, DIST_CHANNEL=store" -ForegroundColor Yellow
}
Write-Host "==========================================================" -ForegroundColor Green

