# scripts/pre_release_check.ps1
# Release Gate - pre-package safety checks
# Usage: powershell -ExecutionPolicy Bypass -File scripts\pre_release_check.ps1
# Returns: exit 0 = PASS, exit 1 = FAIL (build_rbz.ps1 will abort on FAIL)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ROOT = Resolve-Path "$PSScriptRoot\.."
$PASS = $true
$ERRORS = @()
$WARNINGS = @()

Write-Host ""
Write-Host "=== Release Gate Check ===" -ForegroundColor Cyan

# -- Git diff baseline: since last tag, fallback to HEAD~1 -----------------------
$lastTag = $null
try {
    $lastTag = (git -C $ROOT tag --sort=-version:refname 2>$null | Select-Object -First 1)
} catch {}

if ($lastTag) {
    $diffFiles = (git -C $ROOT diff "$lastTag..HEAD" --name-only 2>$null) -split "`n" |
        Where-Object { $_ -ne '' -and $_ -notmatch '\.rbz$' }
    Write-Host "[Diff base] since tag: $lastTag ($($diffFiles.Count) files)" -ForegroundColor Gray
} else {
    $diffFiles = (git -C $ROOT diff "HEAD~1" "HEAD" --name-only 2>$null) -split "`n" |
        Where-Object { $_ -ne '' -and $_ -notmatch '\.rbz$' }
    Write-Host "[Diff base] HEAD~1 (no tags found, $($diffFiles.Count) files)" -ForegroundColor Gray
}

# -- CHECK 1: WIP feature leak ---------------------------------------------------
Write-Host ""
Write-Host "[Check 1] WIP feature leak..." -ForegroundColor Cyan

$flagsPath = "$ROOT\FEATURE_FLAGS.md"
$wipBlockedFiles = @()

if (-not (Test-Path $flagsPath)) {
    $WARNINGS += "FEATURE_FLAGS.md not found, skipping WIP check (recommended to create)"
    Write-Host "[WARN] FEATURE_FLAGS.md not found" -ForegroundColor Yellow
} else {
    Get-Content $flagsPath | ForEach-Object {
        if ($_ -match '^\|\s*`([^`]+)`\s*\|\s*`wip`\s*\|\s*([^|]+)\|') {
            $feat = $matches[1]
            # Strip backticks and whitespace, keep only items that look like file paths (contain /)
            $rawFiles = $matches[2].Replace('`', '').Trim()
            $files = $rawFiles -split '\s+' | Where-Object { $_ -match '/' }
            if ($files.Count -gt 0) {
                $wipBlockedFiles += $files
                Write-Host "  [WIP] $feat blocked files: $($files -join ', ')" -ForegroundColor Yellow
            } else {
                Write-Host "  [WIP] ${feat} (wip, no file-level blocks -- gated by code)" -ForegroundColor DarkYellow
            }
        }
    }

    $violations = $diffFiles | Where-Object { $wipBlockedFiles -contains $_ }
    if ($violations.Count -gt 0) {
        $violations | ForEach-Object { $ERRORS += "WIP file in diff: $_ (stash or branch it first)" }
        $PASS = $false
        Write-Host "[FAIL] WIP files found in diff:" -ForegroundColor Red
        $violations | ForEach-Object { Write-Host "  x $_" -ForegroundColor Red }
    } else {
        Write-Host "[OK] No WIP feature leak" -ForegroundColor Green
    }
}

# -- CHECK 2: Version 3-way sync -------------------------------------------------
Write-Host ""
Write-Host "[Check 2] Version 3-way sync..." -ForegroundColor Cyan

try {
    $configRbPath  = "$ROOT\loamlab_plugin\config.rb"
    $pluginRbPath  = "$ROOT\loamlab_plugin.rb"
    $versionJsPath = "$ROOT\loamlab_backend\api\version.js"

    $configRb  = Get-Content $configRbPath  -Raw -ErrorAction Stop
    $pluginRb  = Get-Content $pluginRbPath  -Raw -ErrorAction Stop
    $versionJs = Get-Content $versionJsPath -Raw -ErrorAction Stop

    $vConfig = if ($configRb  -match "VERSION\s*=\s*'([^']+)'")         { $matches[1] } else { $null }
    $vPlugin = if ($pluginRb  -match "ext\.version\s*=\s*'([^']+)'")    { $matches[1] } else { $null }
    $vJs     = if ($versionJs -match 'latest_version:\s*"([^"]+)"')      { $matches[1] } else { $null }

    if ($vConfig -and $vPlugin -and $vJs -and ($vConfig -eq $vPlugin) -and ($vPlugin -eq $vJs)) {
        Write-Host "[OK] Version consistent: v$vConfig" -ForegroundColor Green
    } else {
        $ERRORS += "Version mismatch -- config.rb: $vConfig | loamlab_plugin.rb: $vPlugin | version.js: $vJs"
        $PASS = $false
        Write-Host "[FAIL] Version mismatch:" -ForegroundColor Red
        Write-Host "  config.rb         = $vConfig" -ForegroundColor Red
        Write-Host "  loamlab_plugin.rb = $vPlugin" -ForegroundColor Red
        Write-Host "  version.js        = $vJs" -ForegroundColor Red
    }
} catch {
    $WARNINGS += "Version check failed: $($_.Exception.Message)"
    Write-Host "[WARN] Version check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

# -- CHECK 3: verified_diff whitelist -------------------------------------------
Write-Host ""
Write-Host "[Check 3] verified_diff whitelist..." -ForegroundColor Cyan

$sprintPath = "$ROOT\SPRINT.md"
$verifiedDiff = @()

if (Test-Path $sprintPath) {
    $inBlock = $false
    Get-Content $sprintPath | ForEach-Object {
        if ($_ -match '^verified_diff\s*:') { $inBlock = $true; return }
        if ($inBlock -and $_ -match '^\s{2}-\s+(.+)$') {
            $verifiedDiff += $matches[1].Trim()
        }
        if ($inBlock -and $_ -match '^[a-zA-Z_]+\s*:' -and $_ -notmatch '^verified_diff') {
            $inBlock = $false
        }
        if ($inBlock -and ($_ -match '^##\s' -or $_ -match '^status:')) {
            $inBlock = $false
        }
    }
}

if ($verifiedDiff.Count -eq 0) {
    $WARNINGS += "SPRINT.md has no verified_diff block -- required-files check skipped (add ## RELEASE_GATE section)"
    Write-Host "[WARN] SPRINT.md: no verified_diff block, skipping required-files check" -ForegroundColor Yellow
} else {
    # Only verify that expected sprint files ARE in the diff (not that diff has NO others)
    # Broad baselines (many commits since last tag) make "no unexpected" checks too noisy
    $missing = $verifiedDiff | Where-Object { $diffFiles -notcontains $_ }

    if ($missing.Count -gt 0) {
        $missing | ForEach-Object { $WARNINGS += "Expected file not in diff: $_ (sprint task may be incomplete)" }
        Write-Host "[WARN] Expected sprint files not found in diff:" -ForegroundColor Yellow
        $missing | ForEach-Object { Write-Host "  ? $_" -ForegroundColor Yellow }
    } else {
        Write-Host "[OK] All $($verifiedDiff.Count) sprint files confirmed in diff" -ForegroundColor Green
    }
}

# -- CHECK 4: SQL Migration reminder --------------------------------------------
Write-Host ""
Write-Host "[Check 4] SQL Migration check..." -ForegroundColor Cyan

$sqlInDiff = $diffFiles -contains "loamlab_backend/supabase_setup.sql"

if ($sqlInDiff) {
    $WARNINGS += "supabase_setup.sql changed -- run the latest Phase ALTER TABLE in Supabase Dashboard > SQL Editor before going live"
    Write-Host "[WARN] SQL Migration required!" -ForegroundColor Yellow
    Write-Host "  -> Supabase Dashboard > SQL Editor > run the latest Phase in supabase_setup.sql" -ForegroundColor Yellow
} else {
    Write-Host "[OK] No SQL migration" -ForegroundColor Green
}

# -- Final output ---------------------------------------------------------------
Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan

if ($WARNINGS.Count -gt 0) {
    Write-Host "WARNINGS ($($WARNINGS.Count)):" -ForegroundColor Yellow
    $WARNINGS | ForEach-Object { Write-Host "  ! $_" -ForegroundColor Yellow }
    Write-Host ""
}

if (-not $PASS) {
    Write-Host "ERRORS ($($ERRORS.Count)):" -ForegroundColor Red
    $ERRORS | ForEach-Object { Write-Host "  x $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "RESULT: FAIL -- packaging aborted" -ForegroundColor Red
    Write-Host "===========================================" -ForegroundColor Red
    exit 1
} else {
    Write-Host "RESULT: PASS -- safe to package" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Green
    exit 0
}
