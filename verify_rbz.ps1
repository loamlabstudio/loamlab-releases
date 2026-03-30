$rbz = 'c:\Users\qingwen\.gemini\antigravity\workspaces\土窟設計su渲染插件\loamlab_plugin.rbz'
$out = "$env:TEMP\loamlab_verify"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null
Expand-Archive -Path $rbz -DestinationPath $out -Force

Write-Host '=== 解壓後檔案結構 ===' -ForegroundColor Cyan
Get-ChildItem $out -Recurse -File | ForEach-Object { Write-Host "  $($_.FullName -replace [regex]::Escape($out), '')" }

Write-Host ''
Write-Host '=== [updater.rb 修復驗證] ===' -ForegroundColor Cyan
$updater = "$out\loamlab_plugin\updater.rb"
if (Test-Path $updater) {
    $c = Get-Content $updater -Raw
    if ($c -match 'Thread\.new') { Write-Host '[FAIL] 仍有 Thread.new' -ForegroundColor Red }
    else { Write-Host '[OK] 無 Thread.new' -ForegroundColor Green }
    if ($c -match 'UI\.start_timer') { Write-Host '[OK] 有 UI.start_timer' -ForegroundColor Green }
    else { Write-Host '[FAIL] 缺少 UI.start_timer' -ForegroundColor Red }
    if ($c -match 'main\.rb') { Write-Host '[OK] 包含 main.rb 重載' -ForegroundColor Green }
    else { Write-Host '[FAIL] 缺少 main.rb 重載' -ForegroundColor Red }
    if ($c -match 'show_dialog') { Write-Host '[OK] 包含 show_dialog 重開 dialog' -ForegroundColor Green }
    else { Write-Host '[FAIL] 缺少 show_dialog' -ForegroundColor Red }
    if ($c -match '\.rbz') { Write-Host '[OK] 下載副檔名為 .rbz' -ForegroundColor Green }
    else { Write-Host '[WARN] 下載副檔名非 .rbz' -ForegroundColor Yellow }
} else { Write-Host '[FAIL] updater.rb 不存在' -ForegroundColor Red }

Write-Host ''
Write-Host '=== [config.rb BUILD_TYPE & VERSION] ===' -ForegroundColor Cyan
$cfg = "$out\loamlab_plugin\config.rb"
if (Test-Path $cfg) {
    $cc = Get-Content $cfg -Raw
    if ($cc -match 'BUILD_TYPE = "release"') { Write-Host '[OK] BUILD_TYPE = release' -ForegroundColor Green }
    else { Write-Host '[FAIL] BUILD_TYPE 非 release' -ForegroundColor Red }
    $verMatch = [regex]::Match($cc, "VERSION = '([^']+)'")
    if ($verMatch.Success) { Write-Host "[OK] VERSION = $($verMatch.Groups[1].Value)" -ForegroundColor Green }
    else { Write-Host '[FAIL] 無法解析 VERSION' -ForegroundColor Red }
}

Write-Host ''
Write-Host '=== 清理測試目錄 ===' -ForegroundColor Gray
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Done.'
