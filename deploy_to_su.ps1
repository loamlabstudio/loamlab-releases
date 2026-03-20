# This script copies the development files to SketchUp's plugin folder
# For SketchUp 2024 on Windows. Adjust the version year if different.
$sourceDir = "c:\Users\qingwen\.gemini\antigravity\playground\luminescent-einstein"
$appData = [System.Environment]::GetFolderPath('ApplicationData')
$suPluginDir = "$appData\SketchUp\SketchUp 2024\SketchUp\Plugins"

if (-not (Test-Path $suPluginDir)) {
    Write-Host "Warning: SketchUp 2024 Plugins folder not found at $suPluginDir."
    Write-Host "Please adjust the path to match your SketchUp version."
    exit
}

Write-Host "Copying LoamLab Plugin to SketchUp 2024 Plugins folder..."
Copy-Item "$sourceDir\loamlab_plugin.rb" -Destination $suPluginDir -Force
Copy-Item "$sourceDir\loamlab_plugin" -Destination $suPluginDir -Recurse -Force
Write-Host "Done! Please restart SketchUp to load the plugin."
