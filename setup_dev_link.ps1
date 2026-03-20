$sourceDevDir = $PSScriptRoot
$appData = [System.Environment]::GetFolderPath('ApplicationData')
$suPluginDir = "$appData\SketchUp\SketchUp 2024\SketchUp\Plugins"

if (-not (Test-Path $suPluginDir)) {
    Write-Host "SketchUp 2024 Plugins folder not found. Exiting."
    exit
}

$loaderContent = "require '$sourceDevDir/loamlab_plugin.rb'"
$loaderPath = "$suPluginDir\loamlab_dev_loader.rb"

Set-Content -Path $loaderPath -Value $loaderContent -Encoding UTF8

Write-Host "Dev loader script created at: $loaderPath"
Write-Host "Now SketchUp will automatically load your live code from the development folder!"
