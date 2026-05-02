param([switch]$ew)

$sourceDir = $PSScriptRoot
$configFile = "$sourceDir\loamlab_plugin\config.rb"

# Show commits since last tag (informational only)
try {
    $lastTag = git describe --tags --abbrev=0
    if ($LASTEXITCODE -eq 0 -and $lastTag) {
        $pendingCommits = git log "$lastTag..HEAD" --oneline
        if ($pendingCommits) {
            Write-Host ""
            Write-Host "Commits since $lastTag :" -ForegroundColor Cyan
            $pendingCommits | ForEach-Object { Write-Host "  $_ " -ForegroundColor White }
            Write-Host ""
        }
    }
} catch {}

# Determine output name and exclude list
if ($ew) {
    $outRbzName = "loamlab_plugin_ew.rbz"
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

# Patch config.rb to release before packaging
$configContent = Get-Content $configFile -Raw
$prodContent = $configContent -replace 'BUILD_TYPE = "dev"', 'BUILD_TYPE = "release"'
if ($ew) {
    $prodContent = $prodContent -replace 'DIST_CHANNEL = "direct"', 'DIST_CHANNEL = "store"'
    Write-Host "[Deploy] BUILD_TYPE -> release, DIST_CHANNEL -> store (EW)" -ForegroundColor Cyan
} else {
    Write-Host "[Deploy] BUILD_TYPE -> release, DIST_CHANNEL = direct" -ForegroundColor Cyan
}
Set-Content -Path $configFile -Value $prodContent -Encoding UTF8

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

    Add-ToZip $archive "$sourceDir\loamlab_plugin.rb" "loamlab_plugin.rb"

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
    # Restore config.rb to dev (always runs even on error)
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
    Write-Host "EW build: updater.rb excluded, DIST_CHANNEL=store" -ForegroundColor Yellow
}
Write-Host "==========================================================" -ForegroundColor Green
