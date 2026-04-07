# ============================================================
# LoamLab One-Click Release Script (release.ps1)
# Usage: .\release.ps1 -version "1.3.0" -notes "Fix render issue"
# ============================================================
param(
    [Parameter(Mandatory = $true)]
    [string]$version,

    [Parameter(Mandatory = $true)]
    [string]$notes
)

$ROOT       = $PSScriptRoot
$BACKEND    = "$ROOT\loamlab_backend"
$CONFIG     = "$ROOT\loamlab_plugin\config.rb"
$VERSION_JS = "$BACKEND\api\version.js"
$OUT_RBZ    = "$ROOT\loamlab_plugin.rbz"
$OUT_ZIP    = "$ROOT\loamlab_plugin.zip"

$GITHUB_USER = "loamlabstudio"
$GITHUB_REPO = "loamlab-releases"
$DOWNLOAD_URL = "https://github.com/$GITHUB_USER/$GITHUB_REPO/releases/download/v$version/loamlab_plugin.rbz"

# Safety constants
$MAX_RBZ_SIZE_BYTES = 1048576  # 1 megabyte
$FORBIDDEN_PATTERNS = @('node_modules/', '.git/', '__pycache__/', '.testsprite/')

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  LoamLab Release Script v$version" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# ---------------------------------------------------------
# Step 1: Package .rbz plugin
# ---------------------------------------------------------
Write-Host ""
Write-Host "[1/5] Packaging .rbz ..." -ForegroundColor Yellow

if (Test-Path $OUT_ZIP) { Remove-Item $OUT_ZIP -Force }
if (Test-Path $OUT_RBZ) { Remove-Item $OUT_RBZ -Force }

$configOriginal = Get-Content $CONFIG -Raw
$loaderFile = "$ROOT\loamlab_plugin.rb"
$loaderOriginal = Get-Content $loaderFile -Raw

$configRelease = $configOriginal `
    -replace 'BUILD_TYPE = "dev"',          'BUILD_TYPE = "release"' `
    -replace 'ENV_MODE = "development"',     'ENV_MODE = "production"' `
    -replace "VERSION = '[^']*'",            "VERSION = '$version'"
Set-Content -Path $CONFIG -Value $configRelease -Encoding UTF8

$loaderRelease = $loaderOriginal -replace "ext\.version\s*=\s*'[^']*'", "ext.version     = '$version'"
Set-Content -Path $loaderFile -Value $loaderRelease -Encoding UTF8

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$stream = [System.IO.File]::Open($OUT_ZIP, [System.IO.FileMode]::Create)
$archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)

function Add-ToArchive($archive, $filePath, $entryName) {
    $entry = $archive.CreateEntry($entryName)
    $entryStream = $entry.Open()
    $fileStream = [System.IO.File]::OpenRead($filePath)
    $fileStream.CopyTo($entryStream)
    $fileStream.Dispose()
    $entryStream.Dispose()
}

Add-ToArchive $archive $loaderFile "loamlab_plugin.rb"

$excludePatterns = @('node_modules', 'test_', 'package-lock.json', 'package.json', '.testsprite', 'test_screenshot', '.git', '.agents')
Get-ChildItem -Path "$ROOT\loamlab_plugin" -Recurse -File | Where-Object {
    $fp = $_.FullName
    $skip = $false
    foreach ($pat in $excludePatterns) {
        if ($fp -match "[\\/]$pat[\\/]" -or $fp -like "*\$pat" -or $fp -like "*\$pat.*") { $skip = $true; break }
    }
    -not $skip
} | ForEach-Object {
    # 使用 Substring(Length) 避開 Replace 可能產生的編碼/規範化比對失敗 (尤其是中文路徑)
    $relative = $_.FullName.Substring($ROOT.Length).TrimStart("\").Replace('\', '/')
    Add-ToArchive $archive $_.FullName $relative
}

$archive.Dispose()
$stream.Dispose()

$configDev = $configRelease -replace 'BUILD_TYPE = "release"', 'BUILD_TYPE = "dev"'
Set-Content -Path $CONFIG -Value $configDev -Encoding UTF8

Rename-Item -Path $OUT_ZIP -NewName "loamlab_plugin.rbz" -Force
Write-Host "   [OK] loamlab_plugin.rbz packaged" -ForegroundColor Green

# ---------------------------------------------------------
# Step 2: Validate RBZ integrity
# ---------------------------------------------------------
Write-Host ""
Write-Host "[2/5] Validating RBZ ..." -ForegroundColor Yellow

$rbzInfo = Get-Item $OUT_RBZ
$rbzSize = $rbzInfo.Length
$sizeKb = [math]::Round($rbzSize / 1024, 1)
Write-Host "   File size: $sizeKb kB" -ForegroundColor Gray

if ($rbzSize -gt $MAX_RBZ_SIZE_BYTES) {
    Write-Host ""
    Write-Host "   ======================================================" -ForegroundColor Red
    $sizeMb = [math]::Round($rbzSize / 1048576, 2)
    Write-Host "   FATAL: RBZ is $sizeMb megabytes - likely contains node_modules" -ForegroundColor Red
    Write-Host "   Release ABORTED." -ForegroundColor Red
    Write-Host "   ======================================================" -ForegroundColor Red
    exit 1
}
Write-Host '   [OK] Size check passed' -ForegroundColor Green

$verifyStream = [System.IO.File]::OpenRead($OUT_RBZ)
$verifyArchive = [System.IO.Compression.ZipArchive]::new($verifyStream, [System.IO.Compression.ZipArchiveMode]::Read)
$entryCount = 0
$totalUncompressed = 0
$hasForbidden = $false

Write-Host ""
Write-Host "   RBZ contents:" -ForegroundColor Gray
foreach ($entry in $verifyArchive.Entries) {
    $entryCount++
    $totalUncompressed += $entry.Length
    $eSize = [math]::Round($entry.Length / 1024, 1)
    $eName = $entry.FullName
    Write-Host "     $eName - $eSize kB" -ForegroundColor DarkGray

    foreach ($forbidden in $FORBIDDEN_PATTERNS) {
        if ($eName -like "*$forbidden*") {
            Write-Host "   [BAD] Forbidden path: $eName" -ForegroundColor Red
            $hasForbidden = $true
        }
    }
}
$verifyArchive.Dispose()
$verifyStream.Dispose()

if ($hasForbidden) {
    Write-Host ""
    Write-Host "   ======================================================" -ForegroundColor Red
    Write-Host "   FATAL: Forbidden paths found in RBZ. Release ABORTED." -ForegroundColor Red
    Write-Host "   ======================================================" -ForegroundColor Red
    exit 1
}

Write-Host ""
$totalKb = [math]::Round($totalUncompressed / 1024, 1)
Write-Host "   [OK] Structure OK - $entryCount files, $totalKb kB uncompressed" -ForegroundColor Green

# ---------------------------------------------------------
# Step 3: Update version.js for auto-update
# ---------------------------------------------------------
Write-Host ""
Write-Host "[3/5] Updating version.js ..." -ForegroundColor Yellow

$vc = Get-Content $VERSION_JS -Raw
$vc = $vc -replace 'latest_version: "[^"]*"', "latest_version: `"$version`""
$vc = $vc -replace 'release_notes: "[^"]*"',  "release_notes: `"$notes`""
$vc = $vc -replace 'download_url: "[^"]*"',   "download_url: `"$DOWNLOAD_URL`""
Set-Content -Path $VERSION_JS -Value $vc -Encoding UTF8

Write-Host "   [OK] version.js updated to v$version" -ForegroundColor Green
Write-Host "        download_url: $DOWNLOAD_URL" -ForegroundColor Gray

# ---------------------------------------------------------
# Step 3.5: Generate tutorial docs
# ---------------------------------------------------------
Write-Host ""
Write-Host "[3.5/5] Generating tutorial docs ..." -ForegroundColor Yellow

$pyCheck = python --version 2>&1
if ($LASTEXITCODE -eq 0) {
    python "$ROOT\scripts\gen_docs.py" --version $version
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   [OK] Tutorial docs generated -> docs/generated/" -ForegroundColor Green
    } else {
        Write-Host "   [WARN] gen_docs.py failed, continuing release" -ForegroundColor Yellow
    }
} else {
    Write-Host "   [SKIP] Python not found, skipping doc generation" -ForegroundColor Yellow
}

# ---------------------------------------------------------
# Step 4: Git commit + push
# ---------------------------------------------------------
Write-Host ""
Write-Host "[4/5] Pushing to GitHub ..." -ForegroundColor Yellow

Set-Location $ROOT

$gitStatus = git status --porcelain 2>&1
if ($gitStatus) {
    git add loamlab_backend/api/version.js loamlab_plugin/config.rb loamlab_plugin.rb docs/generated/
    git commit -m "release: v$version - $notes"
    git push origin main
    if ($LASTEXITCODE -eq 0) {
        Write-Host "   [OK] Git push success - Vercel will auto-deploy in 30s" -ForegroundColor Green
    } else {
        Write-Host "   [WARN] Git push failed, please push manually" -ForegroundColor Red
    }
} else {
    Write-Host "   [SKIP] No changes to push" -ForegroundColor Gray
}

# ---------------------------------------------------------
# Step 5: Create GitHub Release + upload RBZ
# ---------------------------------------------------------
Write-Host ""
Write-Host "[5/5] Creating GitHub Release ..." -ForegroundColor Yellow

$ghCheck = gh --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "   [FAIL] gh CLI not installed: https://cli.github.com/" -ForegroundColor Red
    exit 1
}

$existCheck = gh release view "v$version" --repo "$GITHUB_USER/$GITHUB_REPO" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   [WARN] v$version already exists, deleting and recreating ..." -ForegroundColor Yellow
    gh release delete "v$version" --repo "$GITHUB_USER/$GITHUB_REPO" --yes 2>&1
    git push origin ":refs/tags/v$version" 2>&1
    git tag -d "v$version" 2>&1
}

gh release create "v$version" `
    --repo "$GITHUB_USER/$GITHUB_REPO" `
    --title "LoamLab v$version" `
    --notes "$notes" `
    "$OUT_RBZ"

if ($LASTEXITCODE -ne 0) {
    Write-Host "   [FAIL] GitHub Release creation failed!" -ForegroundColor Red
    exit 1
}

Write-Host "   [OK] GitHub Release v$version created" -ForegroundColor Green

# Verify remote asset
Write-Host ""
Write-Host "   Verifying remote asset ..." -ForegroundColor Gray
$assetJson = gh release view "v$version" --repo "$GITHUB_USER/$GITHUB_REPO" --json assets 2>&1
$localSize = (Get-Item $OUT_RBZ).Length

$sizeRegex = [regex]'"size"\s*:\s*(\d+)'
$sizeMatch = $sizeRegex.Match($assetJson)
if ($sizeMatch.Success) {
    $remoteSize = [int64]$sizeMatch.Groups[1].Value
    if ($remoteSize -eq $localSize) {
        Write-Host "   [OK] Remote asset verified: local=$localSize remote=$remoteSize" -ForegroundColor Green
    } else {
        Write-Host "   [WARN] Size mismatch: local=$localSize remote=$remoteSize" -ForegroundColor Red
    }
} else {
    Write-Host "   [INFO] Could not auto-verify remote size" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "  Release v$version complete!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Download: $DOWNLOAD_URL" -ForegroundColor Cyan
Write-Host "  Release:  https://github.com/$GITHUB_USER/$GITHUB_REPO/releases/tag/v$version" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------
# Step 6: Extension Warehouse manual upload reminder
# ---------------------------------------------------------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Magenta
Write-Host "  [6] Extension Warehouse 手動上傳提醒" -ForegroundColor Magenta
Write-Host "=============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  前往：https://extensions.sketchup.com/developer" -ForegroundColor Cyan
Write-Host "  上傳檔案：$OUT_RBZ" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Fields to fill:" -ForegroundColor Yellow
Write-Host "    Version Number  : $version" -ForegroundColor White
Write-Host "    Encryption Type : Encrypt" -ForegroundColor White
Write-Host "    Release Notes   : $notes" -ForegroundColor White
Write-Host "    SketchUp Compat : All" -ForegroundColor White
Write-Host "    OS Compat       : Win + Mac" -ForegroundColor White
Write-Host ""
Write-Host "  Note: Review takes 1-3 days." -ForegroundColor Yellow
Write-Host ""
