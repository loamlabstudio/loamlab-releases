$sourceDir = $PSScriptRoot
$outZip = "$sourceDir\loamlab_plugin.zip"
$outRbz = "$sourceDir\loamlab_plugin.rbz"
$configFile = "$sourceDir\loamlab_plugin\config.rb"

Write-Host "Packaging LoamLab Plugin (Commercial Release)..."

if (Test-Path $outZip) { Remove-Item $outZip -Force }
if (Test-Path $outRbz) { Remove-Item $outRbz -Force }

# ★ 環境隔離：打包前強制寫入 release 設定
$configContent = Get-Content $configFile -Raw
$prodContent = $configContent -replace 'BUILD_TYPE = "dev"', 'BUILD_TYPE = "release"'
Set-Content -Path $configFile -Value $prodContent -Encoding UTF8
Write-Host "[Deploy] BUILD_TYPE → release" -ForegroundColor Cyan

# 手動建 zip，確保路徑分隔符為 /（跨平台相容 Mac）
# 同時排除 node_modules、測試檔、開發工具
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

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

# 加入 loamlab_plugin/ 目錄，排除 node_modules、測試檔、開發工具
$excludePatterns = @('node_modules', 'test_', 'package-lock.json', 'package.json', '.testsprite', 'test_screenshot')
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

# ★ 打包完畢後明確還原為 dev 模式（不依賴原始快照，硬編碼保證結果恆為 dev）
$restoredContent = $prodContent -replace 'BUILD_TYPE = "release"', 'BUILD_TYPE = "dev"'
Set-Content -Path $configFile -Value $restoredContent -Encoding UTF8
Write-Host "[Deploy] BUILD_TYPE restored to dev" -ForegroundColor Cyan

Rename-Item -Path $outZip -NewName "loamlab_plugin.rbz" -Force

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Done! RBZ Plugin (Production Version) packaged at: $outRbz" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

