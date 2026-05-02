# check_cjs.ps1 — 部署前驗證 api/*.js 無 ESM/CJS 混用，並報告函式數量
# 用法：powershell -ExecutionPolicy Bypass -File scripts\check_cjs.ps1

$apiDir = Join-Path $PSScriptRoot "..\loamlab_backend\api"
$files = Get-ChildItem -Path $apiDir -Filter "*.js" -Recurse |
         Where-Object { $_.FullName -notmatch "node_modules" }

$ok = $true

Write-Host ""
Write-Host "=== Vercel Function Count ===" -ForegroundColor Cyan
Write-Host "Found: $($files.Count) / 12 functions" -ForegroundColor $(if ($files.Count -gt 12) { "Red" } else { "Green" })
if ($files.Count -gt 12) {
    Write-Host "ERROR: Exceeds Vercel Hobby plan limit (12). Remove a function before deploying." -ForegroundColor Red
    $ok = $false
}
$files | ForEach-Object { Write-Host "  $($_.FullName.Replace($apiDir, 'api'))" -ForegroundColor Gray }

Write-Host ""
Write-Host "=== Mixed ESM/CJS Check ===" -ForegroundColor Cyan
Write-Host "(Pure ESM or pure CJS is fine; mixing both in one file causes 404)" -ForegroundColor Gray

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $hasRequire = $content -match '(?m)^(?:const|let|var)\s+.+=\s*require\s*\('
    $hasEsmExport = $content -match '(?m)^export\s+(default|const|function|class|async)'
    $hasEsmImport = $content -match '(?m)^import\s+.+\s+from\s+'

    $isEsm = $hasEsmExport -or $hasEsmImport
    $isCjs = $hasRequire

    if ($isEsm -and $isCjs) {
        $rel = $file.FullName.Replace((Resolve-Path "$apiDir\..").Path + "\", "")
        Write-Host "FAIL $rel — mixes require() with import/export default" -ForegroundColor Red
        $ok = $false
    }
}

Write-Host ""
if ($ok) {
    Write-Host "All checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "Fix the above issues before deploying." -ForegroundColor Red
    exit 1
}
