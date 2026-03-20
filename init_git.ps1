# ============================================================
# LoamLab Git 初始化腳本 (只需執行一次)
# 將 loamlab_backend 與 GitHub Repository 連接
# 使用方式: .\init_git.ps1 -repoUrl "https://github.com/loamlabstudio/loamlab-camera-backend.git"
# ============================================================
param(
    [Parameter(Mandatory = $true)]
    [string]$repoUrl
)

$BACKEND = "c:\Users\qingwen\.gemini\antigravity\playground\luminescent-einstein\loamlab_backend"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  LoamLab Git 初始化 (一次性設定)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

Set-Location $BACKEND

# 確認 git 是否已安裝
$gitVersion = git --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] 請先安裝 Git: https://git-scm.com/download/win" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Git 版本: $gitVersion" -ForegroundColor Green

# 初始化 Git repo
if (-not (Test-Path ".git")) {
    git init
    Write-Host "[OK] Git 初始化完成" -ForegroundColor Green
}
else {
    Write-Host "[SKIP] 已是 Git 倉庫" -ForegroundColor Gray
}

# 設定 .gitignore（確保不上傳機密檔案）
$gitignoreContent = @"
node_modules/
.env.local
.env
.vercel/
*.log
"@
Set-Content -Path ".gitignore" -Value $gitignoreContent -Encoding UTF8
Write-Host "[OK] .gitignore 設定完成（排除 .env.local、node_modules）" -ForegroundColor Green

# 綁定 Remote
$existingRemote = git remote get-url origin 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[SKIP] Remote 已存在: $existingRemote" -ForegroundColor Gray
    Write-Host "       如需更換，請先執行: git remote remove origin" -ForegroundColor Gray
}
else {
    git remote add origin $repoUrl
    Write-Host "[OK] Remote 已綁定至: $repoUrl" -ForegroundColor Green
}

# 第一次推送
Write-Host ""
Write-Host "正在執行首次 git push..." -ForegroundColor Yellow
git add .
git commit -m "chore: initial commit - LoamLab backend"
git branch -M main
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  成功! 後端已連接至 GitHub" -ForegroundColor Green
    Write-Host "  Vercel 請前往 Dashboard -> Import Git Repository" -ForegroundColor Green
    Write-Host "  選擇: $repoUrl" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
}
else {
    Write-Host ""
    Write-Host "[ERROR] Push 失敗。可能需要先在 GitHub 建立空的 Repository:" -ForegroundColor Red
    Write-Host "        $repoUrl" -ForegroundColor Red
    Write-Host "        建立時不要勾選 'Initialize with README'" -ForegroundColor Red
}
