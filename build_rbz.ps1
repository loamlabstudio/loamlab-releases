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

# 目前先打包所有明碼開發檔
$itemsToCompress = @("$sourceDir\loamlab_plugin.rb", "$sourceDir\loamlab_plugin")
Compress-Archive -Path $itemsToCompress -DestinationPath $outZip -Force

# ★ 打包完畢後還原為 dev 模式
Set-Content -Path $configFile -Value $configContent -Encoding UTF8
Write-Host "[Deploy] BUILD_TYPE restored to dev" -ForegroundColor Cyan

Rename-Item -Path $outZip -NewName "loamlab_plugin.rbz" -Force

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Done! RBZ Plugin (Production Version) packaged at: $outRbz" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

