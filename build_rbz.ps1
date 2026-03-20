$sourceDir = $PSScriptRoot
$outZip = "$sourceDir\loamlab_plugin.zip"
$outRbz = "$sourceDir\loamlab_plugin.rbz"
$configFile = "$sourceDir\loamlab_plugin\config.rb"

Write-Host "Packaging LoamLab Plugin (Commercial Release)..."

if (Test-Path $outZip) { Remove-Item $outZip -Force }
if (Test-Path $outRbz) { Remove-Item $outRbz -Force }

# ★ Phase 16: 環境自動隔離 (替換為正式營運環境)
$configContent = Get-Content $configFile -Raw
$prodContent = $configContent -replace 'ENV_MODE = "development"', 'ENV_MODE = "production"'
Set-Content -Path $configFile -Value $prodContent -Encoding UTF8
Write-Host "[Deploy] 已成功將設定檔強制寫入正網環境 (production)" -ForegroundColor Cyan

# 目前先打包所有明碼開發檔
$itemsToCompress = @("$sourceDir\loamlab_plugin.rb", "$sourceDir\loamlab_plugin")
Compress-Archive -Path $itemsToCompress -DestinationPath $outZip -Force

# ★ Phase 16: 打包完畢後，安全還原為開發環境
Set-Content -Path $configFile -Value $configContent -Encoding UTF8
Write-Host "[Deploy] Config restored to development mode." -ForegroundColor Cyan

Rename-Item -Path $outZip -NewName "loamlab_plugin.rbz" -Force

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Done! RBZ Plugin (Production Version) packaged at: $outRbz" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

