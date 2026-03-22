// 實時進度條計時器與背景列隊計數器
let renderTimer = null;
let currentPct = 0;
let totalScenesToRender = 0;
let finishedScenesCount = 0;

// =========================================================
// 工具切換系統 (Tool Switcher)
// =========================================================
let currentActiveTool = 1;
let selectedShotStyle = 'dramatic';

const PROXY_PREFIX = "This interior design scene contains simple geometric proxy shapes (boxes/blocks/cylinders) representing furniture placeholders. Replace each proxy with a realistic, high-quality piece of furniture of the indicated type while preserving its exact position, scale, and spatial relationship. ";

const NINEGRID_PREFIX = "Generate a single 3×3 nine-panel grid composition image showing this interior from 9 distinct dramatic camera angles in a magazine-style layout: [1.Wide angle overview] [2.Eye-level straight-on] [3.Bird's eye top-down] [4.Worm's eye looking up] [5.45° corner diagonal] [6.Entrance threshold] [7.Close-up material detail] [8.Golden hour window shot] [9.Cinematic low dramatic angle]. Each panel separated by thin white dividing lines. ";

const SHOT_MODIFIERS = {
    industrial: "Hard dramatic shadows, high contrast, exposed concrete and raw industrial materials, cool tones. ",
    natural: "Soft diffused daylight, warm earth tones, organic textures, airy and breathing atmosphere. ",
    dramatic: "Golden hour side lighting, cinematic depth of field, bold light-shadow contrasts, editorial feel. ",
    minimal: "Clean white walls, extreme negative space, calm and serene minimalist atmosphere, neutral palette. "
};

const TOOL_FURNITURE_TAGS = [
    { label: '沙發', tag: 'sofa' }, { label: '單椅', tag: 'armchair' },
    { label: '餐桌椅', tag: 'dining table and chairs' }, { label: '床組', tag: 'bed frame with mattress' },
    { label: '衣櫃', tag: 'wardrobe' }, { label: '書桌', tag: 'desk' },
    { label: '落地燈', tag: 'floor lamp' }, { label: '茶几', tag: 'coffee table' }
];

function setActiveTool(n) {
    currentActiveTool = n;

    // Sidebar 樣式切換
    document.querySelectorAll('.sidebar-tool-btn').forEach(btn => {
        const bar = btn.querySelector('.sidebar-active-bar');
        btn.classList.remove('bg-white/10', 'border', 'border-white/20');
        btn.classList.add('text-white/50');
        btn.classList.remove('text-white');
        if (bar) bar.classList.add('hidden');
    });
    const activeBtn = document.getElementById(`sidebar-tool-${n}`);
    if (activeBtn) {
        activeBtn.classList.add('bg-white/10', 'border', 'border-white/20', 'text-white');
        activeBtn.classList.remove('text-white/50');
        const bar = activeBtn.querySelector('.sidebar-active-bar');
        if (bar) bar.classList.remove('hidden');
    }

    const hintBanner = document.getElementById('tool-hint-banner');
    const shotStyleSelector = document.getElementById('shot-style-selector');
    const materialTagsDiv = document.getElementById('material-tags');
    const promptInput = document.getElementById('user-prompt-input');
    const titleEl = document.querySelector('[data-i18n="title"]');

    if (hintBanner) hintBanner.classList.add('hidden');
    if (shotStyleSelector) shotStyleSelector.classList.add('hidden');
    if (materialTagsDiv) materialTagsDiv.classList.remove('hidden');

    if (n === 1) {
        if (titleEl) titleEl.textContent = (UI_LANG[currentLang] || UI_LANG['en-US'])['title'];
        rebuildMaterialTags();
        if (promptInput) promptInput.placeholder = (UI_LANG[currentLang] || UI_LANG['en-US'])['prompt_ph'];
    } else if (n === 2) {
        const lang2 = UI_LANG[currentLang] || UI_LANG['en-US'];
        if (titleEl) titleEl.textContent = lang2['tool_furniture'];
        if (hintBanner) {
            hintBanner.className = 'w-full rounded-lg px-3 py-2.5 text-[11px] leading-relaxed bg-amber-500/10 border border-amber-500/20 text-amber-200/70';
            hintBanner.textContent = lang2['tool_furniture_hint'];
        }
        rebuildFurnitureTags();
        if (promptInput) promptInput.placeholder = lang2['tool_furniture_ph'];
    } else if (n === 3) {
        const lang3 = UI_LANG[currentLang] || UI_LANG['en-US'];
        if (titleEl) titleEl.textContent = lang3['tool_multi_angle'];
        if (hintBanner) {
            hintBanner.className = 'w-full rounded-lg px-3 py-2.5 text-[11px] leading-relaxed bg-blue-500/10 border border-blue-500/20 text-blue-200/70';
            hintBanner.textContent = lang3['tool_ninegrid_hint'];
        }
        if (shotStyleSelector) shotStyleSelector.classList.remove('hidden');
        if (materialTagsDiv) materialTagsDiv.classList.add('hidden');
        if (promptInput) promptInput.placeholder = lang3['tool_ninegrid_ph'];
    }

    updateCostPreview();
}

function rebuildMaterialTags() {
    const container = document.getElementById('material-tags');
    if (!container) return;
    const tags = [
        { label: 'Wood', tag: 'wood material' }, { label: 'Glass', tag: 'clear glass' },
        { label: 'Concrete', tag: 'concrete texture' }, { label: 'Marble', tag: 'marble texture' },
        { label: 'Metal', tag: 'metallic finish' }, { label: 'Fabric', tag: 'fabric material' },
        { label: 'Leather', tag: 'leather material' }
    ];
    const cls = 'text-[10px] uppercase font-bold px-2 py-1 rounded bg-black/40 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 hover:border-white/30 cursor-pointer transition-all active:scale-95 tracking-wide select-none';
    container.innerHTML = tags.map(t => `<span class="${cls}" data-tag="${t.tag}">${t.label}</span>`).join('');
    container.querySelectorAll('span[data-tag]').forEach(span => {
        span.addEventListener('click', () => appendToPrompt(span.getAttribute('data-tag')));
    });
}

function rebuildFurnitureTags() {
    const container = document.getElementById('material-tags');
    if (!container) return;
    const cls = 'text-[10px] uppercase font-bold px-2 py-1 rounded bg-black/40 border border-amber-500/20 text-amber-200/60 hover:text-amber-100 hover:bg-amber-500/10 hover:border-amber-400/40 cursor-pointer transition-all active:scale-95 tracking-wide select-none';
    container.innerHTML = TOOL_FURNITURE_TAGS.map(t => `<span class="${cls}" data-tag="${t.tag}">${t.label}</span>`).join('');
    container.querySelectorAll('span[data-tag]').forEach(span => {
        span.addEventListener('click', () => appendToPrompt(span.getAttribute('data-tag')));
    });
}

function appendToPrompt(val) {
    const textPrompt = document.getElementById('user-prompt-input');
    if (!textPrompt || !val) return;
    const cur = textPrompt.value.trim();
    textPrompt.value = cur ? (cur.endsWith(',') ? cur + ' ' + val : cur + ', ' + val) : val;
}

// 工具 3：渲染開始時顯示 9 格骨架
function showNineGridPlaceholder() {
    const placeholderEl = document.getElementById('preview-placeholder');
    const gridEl = document.getElementById('preview-grid');
    if (placeholderEl) placeholderEl.classList.add('hidden');
    if (gridEl) {
        gridEl.innerHTML = Array(9).fill(0).map(() =>
            `<div class="aspect-video bg-white/[0.03] rounded-xl border border-white/[0.04] overflow-hidden relative">
                <div class="absolute inset-0 animate-pulse bg-gradient-to-br from-white/[0.02] to-transparent"></div>
             </div>`
        ).join('');
        gridEl.className = 'w-full h-full px-6 grid grid-cols-3 gap-3 content-start items-start overflow-y-auto custom-scrollbar pb-6';
        gridEl.classList.remove('hidden');
    }
}

// =========================================================
// 動態更新渲染按鈕上的預計點數消耗
function updateCostPreview() {
    const costLabel = document.getElementById('render-cost-preview');
    if (!costLabel) return;
    const resRadio = document.querySelector('input[name="resolution"]:checked');
    const costPerScene = resRadio ? parseInt(resRadio.getAttribute('data-cost') || '15', 10) : 15;
    const checkboxes = document.querySelectorAll('input[name="scene"]:checked');
    const count = checkboxes.length;
    if (count === 0) {
        costLabel.textContent = `· ${costPerScene} pts/scene`;
    } else {
        costLabel.textContent = `· ${count * costPerScene} pts`;
    }
    costLabel.classList.remove('hidden');
}

function finalizeRenderUI() {
    stopRenderTimer();
    updateProgressUI('Done!', 100);
    setTimeout(() => {
        const progressBlock = document.getElementById('progress-wrapper');
        if (progressBlock) progressBlock.classList.add('opacity-0');
        setTimeout(() => { if (progressBlock) progressBlock.classList.add('hidden'); }, 700);

        const btnRender = document.getElementById('btn-render');
        if (btnRender) {
            btnRender.disabled = false;
            btnRender.classList.remove('rendering-pulse');
        }
        const previewArea = document.getElementById('main-preview-area');
        if (previewArea) previewArea.classList.remove('is-rendering');

        // [KPI 2] 移除自動開啟資料夾（會觸發 UI.openURL 中文路徑導致 SU 凍結）
    }, 1000);
}

function startRenderTimer() {
    if (renderTimer) clearInterval(renderTimer);
    currentPct = 0;
    showProgressBar();
    const progressLang = UI_LANG[currentLang] || UI_LANG['en-US'];
    updateProgressUI(progressLang['progress_analyzing'], currentPct);

    renderTimer = setInterval(() => {
        if (currentPct < 50) {
            currentPct += Math.random() * 3;
        } else if (currentPct < 85) {
            currentPct += Math.random() * 0.8;
        } else if (currentPct < 98) {
            currentPct += Math.random() * 0.1;
        }

        const pl = UI_LANG[currentLang] || UI_LANG['en-US'];
        let msg = pl['progress_uploading'];
        if (currentPct > 15) msg = pl['progress_rendering'];
        if (currentPct > 60) msg = pl['progress_refining'];
        if (currentPct > 85) msg = pl['progress_almost'];

        updateProgressUI(msg, Math.floor(currentPct));
    }, 800);
}

function stopRenderTimer() {
    if (renderTimer) clearInterval(renderTimer);
}

// 場景名稱翻譯：Ruby 傳來的固定中文 key 對應 i18n
function translateSceneName(name) {
    if (name === '當前即時視角') return (UI_LANG[currentLang] || UI_LANG['en-US'])['live_viewport_scene'] || name;
    return name;
}

// 全域方法，用以接收來自 Ruby 的 JSON 資料
window.receiveFromRuby = function (data) {
    console.log('[Ruby]', data);

    // 如果是單純的動作指令，直接處理並返回
    if (data.action === 'updateSaveDir') {
        window.updateSaveDir(data.path);
        return;
    }

    const statusText = document.getElementById('status-text');
    const langObj = UI_LANG[currentLang];

    if (data.status === 'success') {
        if (data.api_base) {
            API_BASE = data.api_base;
            console.log("API_BASE updated to:", API_BASE);
        }
        if (data.build_type === 'dev') {
            const badge = document.createElement('div');
            badge.textContent = 'DEV';
            badge.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:#dc2626;color:white;font-size:10px;font-weight:900;padding:2px 12px;border-radius:4px;z-index:9999;letter-spacing:3px;pointer-events:none;box-shadow:0 0 12px rgba(220,38,38,0.6);';
            document.body.appendChild(badge);
        }
        const langStr = data.lang || 'en-US';
        document.getElementById('lang-select').value = langStr;
        window.setLanguage(langStr);
        if (data.save_path) window.updateSaveDir(data.save_path);

        if (data.user_email && data.user_email !== "") {
            window.loamlabUserEmail = data.user_email;
            window.updateLoginUI(data.user_email, "...");
            window.fetchUserPoints(data.user_email);
        }

        statusText.textContent = `${UI_LANG[currentLang]['status_success']}：v${data.version}`;
        statusText.classList.replace('text-gray-400', 'text-green-500');
        renderScenesList(data.scenes);

        // Header 顯示版本號
        const versionLabel = document.getElementById('current-version-label');
        if (versionLabel && data.version) versionLabel.textContent = `v${data.version}`;

        // 啟動時靜默自動檢查（有新版才提示，已是最新不打擾）
        if (window.sketchup) {
            window._silentUpdateCheck = true;
            setTimeout(() => sketchup.auto_update({}), 2000);
        }

        // 初始化時主動請求第一張預覽圖
        if (window.sketchup) {
            setTimeout(() => { sketchup.sync_preview({}); }, 200);
        }
    } else if (data.status === 'rendering') {
        statusText.textContent = langObj['status_rendering'] || '傳送場景至大腦中...';
        statusText.classList.replace('text-green-500', 'text-red-400');

        const btnRender = document.getElementById('btn-render');
        btnRender.disabled = true;
        btnRender.classList.add('rendering-pulse');

        const previewArea = document.getElementById('main-preview-area');
        if (previewArea) previewArea.classList.add('is-rendering');

        startRenderTimer();
        if (currentActiveTool === 3) showNineGridPlaceholder();
    } else if (data.status === 'uploading') {
        statusText.textContent = langObj['status_uploading'] || '正在建構魔法...';
        // 進度由 startRenderTimer 控制
    } else if (data.status === 'update_latest') {
        stopUpdateSpinner();
        // 靜默自動檢查時不顯示 toast，手動點擊才提示
        if (!window._silentUpdateCheck) showUpdateToast(`✅ 已是最新版本 (v${data.version})`);
        window._silentUpdateCheck = false;
    } else if (data.status === 'update_available') {
        stopUpdateSpinner();
        window._silentUpdateCheck = false;
        document.getElementById('update-dot')?.classList.remove('hidden');
        showUpdateBanner(data.version, data.notes, data.url);
    } else if (data.status === 'update_downloading') {
        showUpdateToast('⬇️ 下載更新中，請稍候...');
    } else if (data.status === 'update_error') {
        stopUpdateSpinner();
        showUpdateToast(`⚠️ ${data.msg || '更新失敗'}`);
    } else if (data.status === 'update_checked') {
        // legacy fallback
        stopUpdateSpinner();
        showUpdateToast('✅ 已是最新版本');
    } else if (data.status === 'preview_updated') {
        const gridEl = document.getElementById('preview-grid');
        const placeholderEl = document.getElementById('preview-placeholder');

        // 停止同步按鈕動畫
        const btnSync = document.getElementById('btn-sync-preview');
        if (btnSync) {
            const bulb = btnSync.querySelector('span');
            if (bulb) bulb.classList.replace('bg-white', 'bg-[#dc2626]');
        }

        if (data.batch_data && data.batch_data.length > 0) {
            if (placeholderEl) placeholderEl.classList.add('hidden');
            if (gridEl) {
                gridEl.classList.remove('hidden');
                gridEl.innerHTML = '';

                const count = data.batch_data.length;
                let gridClass = 'grid-cols-1';
                if (count === 1) gridClass = 'grid-cols-1';
                else if (count === 2) gridClass = 'grid-cols-2';
                else gridClass = 'grid-cols-2 lg:grid-cols-3';

                // 動態賦予網格布局
                gridEl.className = `w-full h-full px-6 grid gap-5 overflow-y-auto custom-scrollbar content-start items-start ${gridClass}`;

                data.batch_data.forEach(item => {
                    const card = document.createElement('div');
                    card.className = 'flex flex-col bg-white/[0.02] rounded-2xl border border-white/[0.08] shadow-[0_8px_30px_rgba(0,0,0,0.3)] hover:border-white/20 transition-all duration-300 overflow-hidden relative pointer-events-auto group/card';
                    card.innerHTML = `
                        <div class="relative w-full overflow-hidden bg-black aspect-video flex-shrink-0">
                            <img src="${item.image_data}" class="w-full h-full object-cover opacity-60 transition-opacity duration-500 group-hover/card:opacity-100">
                        </div>
                        <div class="px-4 py-3 flex justify-between items-center bg-black/50 backdrop-blur-xl absolute bottom-0 w-full z-20 border-t border-white/[0.05]">
                            <span class="text-[12px] font-semibold text-white/90 tracking-widest truncate pr-2 drop-shadow-md" data-scene="${item.scene}">${translateSceneName(item.scene)}</span>
                            <span class="text-[9px] text-white bg-[#dc2626] px-2.5 py-1 rounded shadow-md flex-shrink-0 font-bold uppercase tracking-widest">Ready</span>
                        </div>
                    `;
                    gridEl.appendChild(card);
                });
            }
        } else {
            if (gridEl) {
                gridEl.innerHTML = '';
                gridEl.classList.add('hidden');
            }
            if (placeholderEl) {
                placeholderEl.classList.remove('hidden');
                const textSpan = placeholderEl.querySelector('#placeholder-text');
                if (textSpan) textSpan.textContent = (UI_LANG[currentLang] || UI_LANG['en-US'])['preview_select_hint'];
            }
        }
    } else if (data.status === 'export_done') {
        const langObj3 = UI_LANG[currentLang];
        statusText.textContent = langObj3['export_done'] || 'All scenes sent. Rendering in cloud...';
        statusText.classList.replace('text-red-400', 'text-amber-400');
    } else if (data.status === 'render_success') {
        finishedScenesCount++;
        const langObj = UI_LANG[currentLang];

        // 自動更新點數餘額 (後端回傳 points_remaining)
        if (data.points_remaining !== undefined) {
            const pb = document.getElementById('point-balance');
            if (pb) pb.textContent = data.points_remaining;
        }

        if (finishedScenesCount >= totalScenesToRender) {
            const langObj4 = UI_LANG[currentLang];
            statusText.textContent = langObj4['render_all_done'] || 'All renders complete!';
            statusText.classList.replace('text-amber-400', 'text-green-500');
            statusText.classList.replace('text-red-400', 'text-green-500');
            finalizeRenderUI();
        } else {
            const langObj4 = UI_LANG[currentLang];
            statusText.textContent = `${langObj4['render_progress'] || 'Rendering'} (${finishedScenesCount}/${totalScenesToRender})...`;
            statusText.classList.replace('text-red-400', 'text-amber-400');
        }

        // 利用標題來尋找是哪一張卡片算完了，並替換圖片
        const targetScene = data.scene_name;
        const targetUrl = data.url;

        if (targetScene && targetUrl) {
            const gridEl = document.getElementById('preview-grid');
            if (gridEl) {
                // 尋找卡片內的標題是不是符合
                const cards = gridEl.querySelectorAll('div > span.truncate');
                cards.forEach(span => {
                    if ((span.getAttribute('data-scene') || span.textContent) === targetScene) {
                        const card = span.closest('.flex-col');
                        const imgContainer = card.querySelector('div.aspect-video');
                        if (imgContainer) {
                            const originalImgSrc = imgContainer.querySelector('img').src;

                            // 打破舊有的容器，重新建構為震懾視覺的上下切割對比圖卡
                            imgContainer.className = "w-full flex flex-col relative bg-black";
                            imgContainer.innerHTML = `
                                <div class="relative w-full overflow-hidden bg-black aspect-video group cursor-crosshair">
                                    <div class="absolute top-2 left-2 bg-black/60 backdrop-blur-md border border-white/10 text-white/50 text-[8px] px-2 py-1 rounded shadow-sm z-10 font-mono tracking-widest hover:opacity-0 transition-opacity">SKETCHUP</div>
                                    <img src="${originalImgSrc}" class="w-full h-full object-cover opacity-50 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-[800ms] blur-[2px] hover:blur-none" title="懸停查看原圖">
                                </div>
                                <div class="relative w-full overflow-hidden bg-black aspect-video border-t border-white/[0.05] group">
                                    <div class="absolute top-2 left-2 bg-[#dc2626] text-white text-[9px] px-2.5 py-1 rounded shadow-lg z-10 font-bold tracking-widest">AI RENDERED</div>
                                    <img src="${targetUrl}" class="w-full h-full object-cover animate-fade-in transition-transform duration-[3s] group-hover:scale-[1.04]" title="點擊檢視大圖" onclick="window.open('${targetUrl}', '_blank')">
                                </div>
                            `;
                        }

                        const badge = span.nextElementSibling;
                        if (badge && !badge.closest('.btn-container')) {
                            // 打造一個按鈕容器
                            const btnContainer = document.createElement('div');
                            btnContainer.className = "btn-container flex gap-1.5 items-center";

                            // 更新原本的 Badge
                            badge.textContent = 'RENDERED';
                            badge.classList.replace('text-rose-300', 'text-amber-300');
                            badge.classList.replace('bg-rose-500/10', 'bg-amber-500/10');
                            badge.classList.replace('border-rose-500/20', 'border-amber-400/20');

                            // 打造專業的「儲存」按鍵
                            const saveBtn = document.createElement('button');
                            saveBtn.className = "text-[9px] px-2.5 py-1 rounded border border-white/20 text-white/90 hover:bg-white hover:text-black hover:border-white transition-all cursor-pointer font-medium uppercase tracking-widest flex items-center gap-1 active:scale-90 shadow-sm";
                            saveBtn.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> SAVE`;

                            saveBtn.onclick = (e) => {
                                e.stopPropagation(); // 防止點擊事件擴散
                                const promptText = document.getElementById('user-prompt-input')?.value || "";
                                // 呼叫 Ruby 後端的 save_image
                                if (window.sketchup) {
                                    sketchup.save_image({ url: targetUrl, prompt: promptText, lang: currentLang });
                                }
                            };

                            // 把原本 badge 的位置換成這個容器
                            badge.parentNode.replaceChild(btnContainer, badge);
                            btnContainer.appendChild(badge);
                            btnContainer.appendChild(saveBtn);

                            // SWAP 按鈕（工具 1/2 才顯示，工具 3 九宮格不做局部替換）
                            if (currentActiveTool !== 3) {
                                const swapBtn = document.createElement('button');
                                swapBtn.className = "text-[9px] px-2.5 py-1 rounded border border-amber-500/30 text-amber-300/80 hover:bg-amber-500/20 hover:text-amber-200 hover:border-amber-400/50 transition-all cursor-pointer font-medium uppercase tracking-widest flex items-center gap-1 active:scale-90 shadow-sm";
                                swapBtn.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> SWAP`;
                                swapBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    openSwapModal(originalImgSrc, targetUrl);
                                };
                                btnContainer.appendChild(swapBtn);
                            }

                            // SHARE 按鈕（已登入且有邀請碼才顯示）
                            if (window.loamlabUserReferralCode) {
                                const shareBtn = document.createElement('button');
                                shareBtn.className = "text-[9px] px-2.5 py-1 rounded border border-green-500/30 text-green-300/80 hover:bg-green-500/20 hover:text-green-200 hover:border-green-400/50 transition-all cursor-pointer font-medium uppercase tracking-widest flex items-center gap-1 active:scale-90 shadow-sm";
                                shareBtn.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg> SHARE`;
                                shareBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(window.loamlabUserReferralCode).then(() => {
                                        showUpdateToast(`\uD83C\uDF9F\uFE0F 邀請碼 ${window.loamlabUserReferralCode} 已複製！好友首次算圖後您得 300 點，好友得 100 點`);
                                    });
                                };
                                btnContainer.appendChild(shareBtn);
                            }
                        }

                        // Rating Bar（需有 transaction_id）
                        const transactionId = data.transaction_id;
                        if (transactionId) {
                            const lang = UI_LANG[currentLang] || UI_LANG['en-US'];
                            const ratingBar = document.createElement('div');
                            ratingBar.className = "rating-bar flex items-center gap-1.5 mt-1.5 ml-0.5";
                            ratingBar.innerHTML = `
                                <span class="text-[9px] text-white/30 mr-0.5">${lang['feedback_rate_q'] || 'How was this?'}</span>
                                <button class="rate-up text-[9px] px-2 py-0.5 rounded border border-white/15 text-white/50 hover:border-green-500/40 hover:text-green-300 transition-all">👍 ${lang['feedback_thumbs_up'] || 'Great'}</button>
                                <button class="rate-down text-[9px] px-2 py-0.5 rounded border border-white/15 text-white/50 hover:border-rose-500/40 hover:text-rose-300 transition-all">👎 ${lang['feedback_thumbs_down'] || 'Not satisfied'}</button>
                            `;
                            const submitRating = (rating, tags = []) => {
                                submitFeedback({ type: 'rating', rating, tags, transaction_id: transactionId });
                                ratingBar.innerHTML = `<span class="text-[9px] text-green-400/60">${lang['feedback_thanks'] || 'Thanks!'}</span>`;
                            };
                            ratingBar.querySelector('.rate-up').onclick = () => submitRating(5);
                            ratingBar.querySelector('.rate-down').onclick = () => {
                                ratingBar.innerHTML = `
                                    <div class="flex flex-wrap gap-1.5 items-center">
                                        <span class="text-[9px] text-white/40">${lang['feedback_why'] || 'What went wrong?'}</span>
                                        <label class="flex items-center gap-1 text-[9px] text-white/50 cursor-pointer"><input type="checkbox" class="tag-cb" value="style_wrong"> ${lang['feedback_tag_style'] || 'Wrong style'}</label>
                                        <label class="flex items-center gap-1 text-[9px] text-white/50 cursor-pointer"><input type="checkbox" class="tag-cb" value="detail_missing"> ${lang['feedback_tag_detail'] || 'Missing details'}</label>
                                        <label class="flex items-center gap-1 text-[9px] text-white/50 cursor-pointer"><input type="checkbox" class="tag-cb" value="color_off"> ${lang['feedback_tag_color'] || 'Color issues'}</label>
                                        <label class="flex items-center gap-1 text-[9px] text-white/50 cursor-pointer"><input type="checkbox" class="tag-cb" value="other"> ${lang['feedback_tag_other'] || 'Other'}</label>
                                        <button class="tag-submit text-[9px] px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/25 text-rose-300 hover:bg-rose-500/25 transition-all">${lang['feedback_submit'] || 'Submit'}</button>
                                    </div>
                                `;
                                ratingBar.querySelector('.tag-submit').onclick = () => {
                                    const selectedTags = [...ratingBar.querySelectorAll('.tag-cb:checked')].map(cb => cb.value);
                                    submitRating(1, selectedTags);
                                };
                            };
                            card.appendChild(ratingBar);
                        }
                    }
                });
            }
        }
    } else if (data.status === 'render_failed') {
        finishedScenesCount++;
        // 解析度方案限制 → 自動開啟定價牆
        if (data.error === 'resolution_limit') {
            if (typeof openPricingModal === 'function') openPricingModal();
        }
        const langObj5 = UI_LANG[currentLang];
        let failMsg = data.message || langObj5['render_failed'] || 'Render Failed';
        if (data.points_refunded) {
            failMsg += ` (${langObj5['points_refunded'] || 'Points Refunded'})`;
        }
        statusText.textContent = `${langObj5['error_label'] || 'Error'}: ${failMsg} (${finishedScenesCount}/${totalScenesToRender})`;
        statusText.classList.replace('text-green-500', 'text-[#dc2626]');
        statusText.classList.replace('text-amber-400', 'text-[#dc2626]');
        statusText.classList.replace('text-red-400', 'text-[#dc2626]');

        // 錯誤回報按鈕（複用或新建）
        let reportBtn = document.getElementById('render-error-report-btn');
        if (!reportBtn) {
            reportBtn = document.createElement('button');
            reportBtn.id = 'render-error-report-btn';
            reportBtn.className = "text-[9px] mt-1 px-2 py-0.5 rounded border border-white/15 text-white/40 hover:border-rose-500/40 hover:text-rose-300 transition-all";
            statusText.parentNode.insertBefore(reportBtn, statusText.nextSibling);
        }
        reportBtn.textContent = langObj5['feedback_report_error'] || 'Report Issue';
        reportBtn.disabled = false;
        reportBtn.classList.remove('hidden');
        reportBtn.onclick = () => {
            submitFeedback({ type: 'error_report', content: failMsg, metadata: { error_code: data.error || 'unknown' } });
            reportBtn.textContent = langObj5['feedback_reported'] || 'Reported, thanks';
            reportBtn.disabled = true;
        };

        if (finishedScenesCount >= totalScenesToRender) {
            finalizeRenderUI();
        }
    }
};

// 將 SketchUp 抓到的場景名單繪製成 Checkbox
function renderScenesList(scenes) {
    const container = document.getElementById('scenes-container');
    const langObj = UI_LANG[currentLang];

    if (!scenes || scenes.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center py-8 text-gray-500">
                <svg class="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                <span class="text-sm font-medium">${langObj['scene_empty']}</span>
            </div>`;
        return;
    }

    const html = scenes.map(scene => `
        <label class="flex items-center space-x-3 my-2.5 p-3.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] transition-all cursor-pointer border border-white/5 hover:border-white/20 group shadow-sm">
            <input type="checkbox" name="scene" value="${scene}" class="appearance-none w-5 h-5 rounded hover:bg-white/20 bg-black/40 border border-white/20 checked:bg-[#dc2626] checked:border-[#dc2626] transition-colors relative check-tick flex-shrink-0 shadow-inner">
            <span class="text-[14px] font-semibold text-white/80 group-hover:text-white transition-colors tracking-wide">${scene}</span>
        </label>
    `).join('');

    container.innerHTML = `
        <style>
            .check-tick:checked::after {
                content: '';
                position: absolute;
                left: 6px;
                top: 2px;
                width: 5px;
                height: 10px;
                border: solid white;
                border-width: 0 2px 2px 0;
                transform: rotate(45deg);
            }
        </style>
        <div class="flex justify-between items-center mb-0 px-2 pt-2 pb-2 border-b border-white/5 shrink-0">
            <h3 class="text-[11px] font-bold text-white/60 tracking-wider uppercase" data-i18n="scene_select">Select Perspectives</h3>
            <span id="scene-count-label" data-count="${scenes.length}" class="text-[9px] text-white font-bold tracking-widest bg-[#dc2626] px-2.5 py-1 rounded-full shadow-md">Total ${scenes.length} Scenes</span>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-1 pt-1 custom-scrollbar w-full relative" id="scene-scroll-area">
            ${html}
        </div>
    `;

    // 為場景加入點擊即預覽的監聽事件
    const inputs = container.querySelectorAll('input[name="scene"]');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            updateCostPreview();
            const checkboxes = document.querySelectorAll('input[name="scene"]:checked');
            const selectedScenes = Array.from(checkboxes).map(cb => cb.value);
            if (window.sketchup) {
                // 發動全場景截圖時，UI 顯示提示文字
                const placeholderEl = document.getElementById('preview-placeholder');
                const gridEl = document.getElementById('preview-grid');
                if (placeholderEl && (!gridEl || gridEl.classList.contains('hidden'))) {
                    const textSpan = placeholderEl.querySelector('#placeholder-text');
                    if (textSpan) textSpan.textContent = (UI_LANG[currentLang] || UI_LANG['en-US'])['preview_storyboard_hint'];
                }
                setTimeout(() => sketchup.sync_preview({ scenes: selectedScenes }), 50);
            }
        });
    });
}

function showProgressBar() {
    const progressBlock = document.getElementById('progress-wrapper');
    progressBlock.classList.remove('hidden');
    // slight delay for transition
    setTimeout(() => {
        progressBlock.classList.remove('opacity-0');
        progressBlock.classList.add('opacity-100');
    }, 10);
}

function updateProgressUI(text, percentage) {
    const bar = document.getElementById('progress-bar');
    const pctLabel = document.getElementById('progress-percent');
    const txtLabel = document.getElementById('progress-text');

    if (bar) bar.style.width = `${percentage}%`;
    if (pctLabel) pctLabel.textContent = `${percentage}%`;
    if (txtLabel && text) txtLabel.textContent = text;
}

// 綁定 DOM Events
document.addEventListener("DOMContentLoaded", () => {

    // 主動向 Ruby 索取初始資料 (版本號、場景清單)
    if (window.sketchup) {
        try {
            sketchup.getInitialData({});
        } catch (e) {
            console.error('Failed to call sketchup.getInitialData', e);
        }
    } else {
        console.warn('不在 SketchUp 環境內，無法呼叫 Ruby API。轉為預覽模式。');
        window.receiveFromRuby({
            status: 'success',
            version: 'Local-Dev',
            lang: 'zh-TW',
            scenes: ['客廳-透視1', '臥室-全景', '廚房-正立面']
        });
    }

    // 解析度切換時更新按鈕點數預覽
    document.querySelectorAll('input[name="resolution"]').forEach(radio => {
        radio.addEventListener('change', updateCostPreview);
    });
    // 初始化時立即顯示預設成本
    updateCostPreview();

    // 材質標籤點擊事件 (組合提示詞迴圈)
    const textPrompt = document.getElementById('user-prompt-input');
    const materialTags = document.querySelectorAll('#material-tags span');
    materialTags.forEach(tag => {
        tag.addEventListener('click', () => {
            const val = tag.getAttribute('data-tag');
            if (val) {
                // 如果原本有字且最後不是逗號或空白，補個逗號
                let currentVal = textPrompt.value.trim();
                let appendText = val;
                if (currentVal && !currentVal.endsWith(',')) {
                    appendText = ', ' + val;
                } else if (currentVal && currentVal.endsWith(',')) {
                    appendText = ' ' + val;
                }
                textPrompt.value = currentVal + appendText;

                // 視覺回饋: 讓標籤閃爍一下
                const ogClass = tag.className;
                tag.classList.add('bg-white/30', 'text-white', 'border-white/50');
                setTimeout(() => {
                    tag.classList.remove('bg-white/30', 'text-white', 'border-white/50');
                }, 200);
            }
        });
    });

    // 渲染按鈕綁定與額度攔截 (Paywall)
    document.getElementById('btn-render').addEventListener('click', () => {
        // 未登入攔截：直接開啟登入流程，不發送任何請求
        if (!window.loamlabUserEmail) {
            openLoginModal();
            return;
        }

        const checkboxes = document.querySelectorAll('input[name="scene"]:checked');
        const selectedScenes = Array.from(checkboxes).map(cb => cb.value);
        const userPrompt = textPrompt ? textPrompt.value.trim() : "";

        // 依工具組裝最終 Prompt
        let finalPrompt = userPrompt;
        if (currentActiveTool === 2) {
            finalPrompt = PROXY_PREFIX + userPrompt;
        } else if (currentActiveTool === 3) {
            finalPrompt = NINEGRID_PREFIX + SHOT_MODIFIERS[selectedShotStyle] + userPrompt;
        }

        // 重置多重算圖計數器
        totalScenesToRender = selectedScenes.length;
        finishedScenesCount = 0;

        // 取得使用者選擇的解析度與消耗點數
        const resRadio = document.querySelector('input[name="resolution"]:checked');
        const resolution = resRadio ? resRadio.value : "1k";
        const costPerScene = resRadio ? parseInt(resRadio.getAttribute('data-cost') || "15", 10) : 15;

        if (selectedScenes.length === 0) {
            alert(UI_LANG[currentLang]['alert_no_scene'] || '請先選擇一個場景喔！');
            return;
        }

        // 計算總花費
        const totalCost = selectedScenes.length * costPerScene;

        // 取得目前點數 (透過 DOM)
        const pointStr = document.getElementById('point-balance').innerText;
        const currentPoints = parseInt(pointStr, 10); // 若為 NaN (如 '...') 則不阻擋

        // 額度不足防線：只在點數「確實已載入且不足」時才阻擋
        // 若 currentPoints 是 NaN (點數還在載入中)，跳過前端檢查讓 Vercel 後端決定
        if (!isNaN(currentPoints) && totalCost > currentPoints) {
            if (typeof openPricingModal === 'function') openPricingModal();
            return; // 阻擋送出，保護算力
        }

        if (window.sketchup) {
            sketchup.render_scene({ scenes: selectedScenes, prompt: finalPrompt, resolution: resolution, expected_cost: totalCost });
        } else {
            console.log('Simulating render req for:', selectedScenes, 'Prompt:', userPrompt, 'Res:', resolution, 'Cost:', totalCost);
            // 本地模擬扣款特效
            document.getElementById('point-balance').innerText = Math.max(0, currentPoints - totalCost);
            window.receiveFromRuby({ status: 'rendering' });
            setTimeout(() => window.receiveFromRuby({ status: 'uploading' }), 1500);
            setTimeout(() => window.updateProgressUI('Refining Details...', 75), 3000);
            setTimeout(() => window.receiveFromRuby({ status: 'export_done' }), 5000);
        }
    });

    // 選擇儲存目錄按鈕
    const btnChooseDir = document.getElementById('btn-choose-dir');
    const saveDirDisplay = document.getElementById('save-dir-display');
    if (btnChooseDir) {
        btnChooseDir.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.sketchup) {
                sketchup.choose_save_dir({});
            }
        });
    }
    if (saveDirDisplay) {
        saveDirDisplay.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.sketchup) {
                sketchup.choose_save_dir({});
            }
        });
    }

    // 顯眼的 Debug API 按鈕
    const btnDebugApi = document.getElementById('btn-debug-api');
    if (btnDebugApi) {
        btnDebugApi.addEventListener('click', (e) => {
            e.preventDefault(); // 避免預設行為
            if (window.sketchup) {
                console.log("發動第一性原理 API 直連測試...");
                sketchup.debug_coze({});
            }
        });
    }

    // 鏡頭風格標籤切換 (工具 3)
    document.querySelectorAll('.shot-style-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            selectedShotStyle = tag.getAttribute('data-style');
            document.querySelectorAll('.shot-style-tag').forEach(t => {
                t.classList.remove('bg-blue-500/20', 'border-blue-400/40', 'text-blue-200');
                t.classList.add('bg-black/40', 'border-white/10', 'text-white/60');
            });
            tag.classList.remove('bg-black/40', 'border-white/10', 'text-white/60');
            tag.classList.add('bg-blue-500/20', 'border-blue-400/40', 'text-blue-200');
        });
    });

    // Swap Modal 控制按鈕
    document.getElementById('btn-close-swap')?.addEventListener('click', closeSwapModal);
    document.getElementById('btn-clear-mask')?.addEventListener('click', clearSwapMask);
    document.getElementById('btn-execute-swap')?.addEventListener('click', executeSwap);

    // Swap Modal 快捷 Tags → 附加到 swap-prompt-input
    document.querySelectorAll('.swap-item-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const input = document.getElementById('swap-prompt-input');
            if (!input) return;
            const val = tag.getAttribute('data-tag');
            const cur = input.value.trim();
            input.value = cur ? (cur.endsWith(',') ? cur + ' ' + val : cur + ', ' + val) : val;
        });
    });
});

// 同步預覽畫面事件
const btnSync = document.getElementById('btn-sync-preview');
if (btnSync) {
    btnSync.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('input[name="scene"]:checked');
        const selectedScenes = Array.from(checkboxes).map(cb => cb.value);

        const bulb = btnSync.querySelector('span');
        if (bulb) bulb.classList.replace('bg-[#dc2626]', 'bg-white');

        if (window.sketchup) {
            const placeholderEl = document.getElementById('preview-placeholder');
            const gridEl = document.getElementById('preview-grid');
            if (placeholderEl && (!gridEl || gridEl.classList.contains('hidden'))) {
                const textSpan = placeholderEl.querySelector('#placeholder-text');
                if (textSpan) textSpan.textContent = (UI_LANG[currentLang] || UI_LANG['en-US'])['syncing_viewport'];
            }

            setTimeout(() => {
                sketchup.sync_preview({ scenes: selectedScenes });
            }, 50);
        } else {
            console.log('Simulation: sync_preview requested', selectedScenes);
            if (bulb) setTimeout(() => bulb.classList.replace('bg-white', 'bg-[#dc2626]'), 500);
        }
    });
}

// 語言切換事件
document.getElementById('lang-select').addEventListener('change', (e) => {
    window.setLanguage(e.target.value);
});

// 更新存檔目錄路徑顯示
window.updateSaveDir = function (path) {
    const display = document.getElementById('save-dir-display');
    if (display) {
        if (path && path.trim() !== '') {
            display.textContent = path;
            display.title = path;
        } else {
            const emptyHint = (UI_LANG[currentLang] || UI_LANG['en-US'])['save_dir_empty'];
            display.textContent = emptyHint;
            display.title = emptyHint;
        }
    }
};

// 付費牆 / 登入彈窗控制邏輯
const loginModal = document.getElementById('login-modal');
const loginModalOverlay = document.getElementById('login-modal-overlay');
const loginModalContent = document.getElementById('login-modal-content');

const pricingModal = document.getElementById('pricing-modal');
const pricingModalContent = document.getElementById('pricing-modal-content');

function refreshPricingModalBadge() {
    const plan = window.loamlabSubscriptionPlan;
    const planBtnMap = { starter: 'btn-plan-starter', pro: 'btn-plan-pro', studio: 'btn-plan-studio' };
    const originalText = { 'btn-plan-topup': 'BUY NOW', 'btn-plan-starter': 'SUBSCRIBE', 'btn-plan-pro': 'UPGRADE NOW', 'btn-plan-studio': 'SUBSCRIBE' };

    // 重設所有按鈕
    Object.entries(originalText).forEach(([id, txt]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = false;
        btn.textContent = txt;
        btn.style.opacity = '';
        btn.style.cursor = '';
    });

    // 高亮當前方案
    if (plan && planBtnMap[plan]) {
        const activeBtn = document.getElementById(planBtnMap[plan]);
        if (activeBtn) {
            activeBtn.disabled = true;
            activeBtn.textContent = '✓ CURRENT PLAN';
            activeBtn.style.opacity = '0.6';
            activeBtn.style.cursor = 'not-allowed';
        }
    }
}

function openPricingModal() {
    pricingModal.classList.remove('hidden');
    updatePlanCostLabels(currentLang);
    refreshPricingModalBadge();
    setTimeout(() => {
        pricingModal.classList.remove('opacity-0');
        pricingModalContent.classList.remove('scale-95');
    }, 10);
}

function closePricingModal() {
    pricingModal.classList.add('opacity-0');
    pricingModalContent.classList.add('scale-95');
    setTimeout(() => {
        pricingModal.classList.add('hidden');
    }, 300);
}

window.openPricingModal = openPricingModal; // 讓共用邏輯呼叫

let authPollTimer = null;
let API_BASE = "https://loamlab-camera-backend.vercel.app";

// =========================================================
// 反饋系統 (Feedback System)
// =========================================================
function submitFeedback({ type, rating, content, tags, transaction_id, metadata }) {
    const body = { type, rating, content, tags, transaction_id, metadata };
    const headers = { 'Content-Type': 'application/json' };
    if (window.loamlabUserEmail) headers['X-User-Email'] = window.loamlabUserEmail;
    fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    }).catch(e => console.warn('[LoamLab Feedback]', e));
}

function openFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.querySelector('.feedback-modal-box')?.classList.remove('scale-95', 'opacity-0'), 10);
    }
}

function closeFeedbackModal() {
    const modal = document.getElementById('feedback-modal');
    if (!modal) return;
    const box = modal.querySelector('.feedback-modal-box');
    if (box) { box.classList.add('scale-95', 'opacity-0'); }
    setTimeout(() => modal.classList.add('hidden'), 200);
}

window.openFeedbackModal = openFeedbackModal;
window.closeFeedbackModal = closeFeedbackModal;

window.sendFeedbackModal = function() {
    const modal = document.getElementById('feedback-modal');
    if (!modal) return;
    const type = modal.querySelector('#feedback-type-select')?.value || 'general';
    const content = modal.querySelector('#feedback-content-input')?.value?.trim() || '';
    if (!content) return;
    submitFeedback({ type, content });
    const box = modal.querySelector('.feedback-modal-box');
    if (box) box.innerHTML = `<div class="text-center py-8 text-white/60 text-sm">${(UI_LANG[currentLang] || UI_LANG['en-US'])['feedback_sent'] || 'Thank you!'}</div>`;
    setTimeout(closeFeedbackModal, 1500);
};

// =========================================================
// LemonSqueezy Variant IDs & Beta 折扣碼
// ★ 請至 LemonSqueezy 後台 Products > Variants 取得真實 ID 後更新此處
// =========================================================
// 幣種成本參考（各方案每張 2K 渲染成本）
// =========================================================
const COST_CURRENCY = {
    'zh-TW': { symbol: 'NT$', rate: 33 },
    'zh-CN': { symbol: '¥', rate: 7.3 },
    'en-US': { symbol: '$', rate: 1 },
    'es-ES': { symbol: '€', rate: 0.93 },
    'pt-BR': { symbol: 'R$', rate: 5.1 },
    'ja-JP': { symbol: '¥', rate: 150 },
};
// 各方案 2K 渲染成本（USD）：方案金額 ÷ Credits 數量 × 20 pts
const PLAN_RENDER_COST_USD = {
    topup: 1.80,  // $18 / 200 pts × 20
    starter: 1.60,  // $24 / 300 pts × 20
    pro: 0.52,  // $52 / 2000 pts × 20
    studio: 0.31,  // $139 / 9000 pts × 20
};

function updatePlanCostLabels(lang) {
    const currency = COST_CURRENCY[lang] || COST_CURRENCY['en-US'];
    document.querySelectorAll('[data-plan-cost]').forEach(el => {
        const plan = el.getAttribute('data-plan-cost');
        const usd = PLAN_RENDER_COST_USD[plan];
        if (!usd) return;
        const localCost = (usd * currency.rate).toFixed(currency.rate >= 10 ? 0 : 2);
        el.textContent = `2K ≈ ${currency.symbol}${localCost}`;
    });
}

// ★ webhook.js 的 VARIANT_* 常數必須與此同步
// =========================================================
const LS_VARIANTS = {
    TOPUP: 1432023,   // ← 替換為 Top-up Variant ID
    STARTER: 1432194,   // ← 替換為 Starter Variant ID
    PRO: 1432198,   // ← 替換為 Pro Variant ID
    STUDIO: 1432205    // ← 替換為 Studio Variant ID
};
const BETA_DISCOUNT_CODE = 'LOAM_BETA_30';

window.updateLoginUI = function (email, points, refCode, referredBy) {
    const btnLogin = document.getElementById('btn-login');
    const pointBalance = document.getElementById('point-balance');

    // 如果登入按鈕有綁定點擊事件，先清空 (用 cloneNode 最安全)
    const newBtnLogin = btnLogin.cloneNode(true);
    btnLogin.parentNode.replaceChild(newBtnLogin, btnLogin);

    const btnRef = document.getElementById('btn-show-referral');

    if (email) {
        // Change to Logged In State
        const namePart = email.split('@')[0];
        const display = namePart.length > 8 ? namePart.substring(0, 8) + '..' : namePart;
        newBtnLogin.innerHTML = `
            <span class="text-[11px] font-bold text-white/90 group-hover:text-white transition-colors tracking-wide">${display}</span>
            <div class="w-6 h-6 rounded-full bg-gradient-to-tr from-green-500 to-[#059669] flex items-center justify-center shadow-[inset_0_2px_4px_rgba(255,255,255,0.4)] hover:from-red-500 hover:to-rose-600 transition-colors" onclick="window.logoutUser(event)" title="點擊登出此帳號">
                <span class="text-white font-bold text-[10px] drop-shadow-md">✓</span>
            </div>
        `;

        if (points !== undefined && points !== null) {
            pointBalance.textContent = points;
        }

        if (btnRef) btnRef.classList.remove('hidden');
        window.loamlabUserReferralCode = refCode || null;
        if (refCode) {
            const domMyCode = document.getElementById('my-referral-code');
            if (domMyCode) domMyCode.textContent = refCode;
        }
        if (referredBy) {
            // 已綁定，隱藏輸入框顯示成功標籤
            const inputArea = document.getElementById('referral-input-area');
            const statusArea = document.getElementById('referral-bind-status');
            const boundCode = document.getElementById('bound-referrer-code');
            if (inputArea) inputArea.classList.add('hidden');
            if (statusArea) statusArea.classList.remove('hidden');
            if (boundCode) boundCode.textContent = referredBy;
        }

    } else {
        // Reset
        newBtnLogin.innerHTML = `
            <span class="text-[11px] font-bold text-white/70 group-hover:text-white transition-colors tracking-wide" data-i18n="login">Log In</span>
            <div class="w-6 h-6 rounded-full bg-gradient-to-tr from-gray-600 to-gray-400 flex items-center justify-center shadow-[inset_0_2px_4px_rgba(255,255,255,0.3)] group-hover:shadow-[0_0_8px_rgba(255,255,255,0.2)]">
                <span class="text-white font-bold text-[10px] drop-shadow-md">G</span>
            </div>
        `;
        newBtnLogin.addEventListener('click', openLoginModal);
        pointBalance.textContent = "--";

        if (btnRef) btnRef.classList.add('hidden');
    }
}

window.logoutUser = function (e) {
    e.stopPropagation();
    window.loamlabUserEmail = null;
    if (window.sketchup) {
        sketchup.logout_user({});
    }
    window.updateLoginUI(null, null, null, null);
}

window.fetchUserPoints = function (email) {
    const targetUrl = `${API_BASE}/api/user?email=${encodeURIComponent(email)}`;
    console.log('[LoamLab] fetchUserPoints ->', targetUrl);
    fetch(targetUrl)
        .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status} from ${targetUrl}`);
            return r.json();
        })
        .then(data => {
            console.log('[LoamLab] user data:', data);
            if (data && data.points !== undefined) {
                window.loamlabSubscriptionPlan = data.subscription_plan || null;
                window.loamlabLastTopupAt = data.last_topup_at || null;
                window.updateLoginUI(email, data.points, data.referral_code, data.referred_by);
                if (data.is_new_user) {
                    showWelcomeToast();
                    // 新用戶且尚未綁定邀請碼 → 1.5 秒後自動開 modal，提示輸入好友邀請碼
                    if (!data.referred_by) {
                        setTimeout(() => {
                            openReferralModal();
                            document.getElementById('input-referral-code')?.focus();
                        }, 1500);
                    }
                }
            } else {
                alert('[LoamLab] /api/user 回傳了資料但沒有 points 欄位: ' + JSON.stringify(data));
            }
        }).catch(e => {
            console.error('[LoamLab] fetchUserPoints failed:', targetUrl, e);
            const pb = document.getElementById('point-balance');
            if (pb) pb.textContent = 'ERR';
        });
}

function showWelcomeToast() {
    const toast = document.getElementById('welcome-toast');
    if (!toast) return;
    toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
    }, 5000);
}

function stopUpdateSpinner() {
    clearTimeout(window._updateSpinnerTimeout);
    const btn = document.getElementById('btn-check-update');
    if (!btn) return;
    const svg = btn.querySelector('svg');
    if (svg) svg.classList.remove('animate-spin');
}

function showUpdateToast(msg) {
    const toast = document.getElementById('update-toast');
    if (!toast) return;
    toast.querySelector('#update-toast-msg').textContent = msg;
    toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
    clearTimeout(window._updateToastTimer);
    window._updateToastTimer = setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
    }, 4000);
}

function showUpdateBanner(version, notes, url) {
    const banner = document.getElementById('update-banner');
    if (!banner) return;
    banner.querySelector('#update-banner-version').textContent = `v${version}`;
    banner.querySelector('#update-banner-notes').textContent = notes;
    banner.setAttribute('data-url', url);
    banner.classList.remove('hidden');
}

function executeUpdate(url) {
    document.getElementById('update-banner')?.classList.add('hidden');
    showUpdateToast('⬇️ 下載更新中，請稍候...');
    if (window.sketchup) {
        sketchup.execute_update({ url });
    }
}

function openLoginModal() {
    loginModal.classList.remove('pointer-events-none');
    setTimeout(() => {
        loginModal.classList.remove('opacity-0');
        loginModalContent.classList.remove('scale-95');
    }, 10);

    // 開始 OAuth Polling
    startOAuthFlow();
}

// 結帳並跳轉 LemonSqueezy
window.openCheckout = function (variantId) {
    if (!window.loamlabUserEmail) {
        alert("請先登入 Google 帳號再進行儲值。\nPlease log in first before purchasing credits.");
        openLoginModal();
        return;
    }

    // 已訂閱相同方案 guard（防止誤觸重複購買）
    const planMap = { [LS_VARIANTS.STARTER]: 'starter', [LS_VARIANTS.PRO]: 'pro', [LS_VARIANTS.STUDIO]: 'studio' };
    const targetPlan = planMap[variantId];
    if (targetPlan && window.loamlabSubscriptionPlan === targetPlan) {
        alert(i18n('already_subscribed'));
        return;
    }

    // LemonSqueezy 支援透過 ?checkout[email]= 來預填並鎖死結帳信箱，加上 custom 以供 Webhook 辨識防錯
    const storeUrl = "https://loamlabstudio.lemonsqueezy.com/checkout/buy/";
    const finalUrl = `${storeUrl}${variantId}?checkout[email]=${encodeURIComponent(window.loamlabUserEmail)}&checkout[custom][user_email]=${encodeURIComponent(window.loamlabUserEmail)}&checkout[discount_code]=${BETA_DISCOUNT_CODE}`;

    if (window.sketchup) {
        sketchup.open_browser(finalUrl);
    } else {
        window.open(finalUrl, '_blank');
    }

    // 支付後輪詢：用 last_topup_at 時間戳偵測充值成功（解決同值無法偵測的問題）
    const topupBefore = window.loamlabLastTopupAt;
    let pollCount = 0;
    const paymentPollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount > 100) { clearInterval(paymentPollTimer); return; }
        try {
            const r = await fetch(`${API_BASE}/api/user`, {
                headers: { 'X-User-Email': window.loamlabUserEmail }
            });
            const d = await r.json();
            if (d.last_topup_at && d.last_topup_at !== topupBefore) {
                clearInterval(paymentPollTimer);
                window.loamlabSubscriptionPlan = d.subscription_plan || null;
                window.loamlabLastTopupAt = d.last_topup_at;
                const pb = document.getElementById('point-balance');
                pb.textContent = d.points;
                pb.style.color = '#4ade80';
                setTimeout(() => { pb.style.color = ''; }, 2000);
                refreshPricingModalBadge();
            }
        } catch(e) {}
    }, 3000);
}


function closeLoginModal() {
    if (authPollTimer) clearInterval(authPollTimer);
    loginModal.classList.add('opacity-0');
    loginModalContent.classList.add('scale-95');
    setTimeout(() => {
        loginModal.classList.add('pointer-events-none');
    }, 300);
}

function startOAuthFlow() {
    let sessionUuid;
    if (typeof crypto.randomUUID === 'function') {
        sessionUuid = crypto.randomUUID();
    } else {
        sessionUuid = '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    const loginUrl = `${API_BASE}/api/auth/login?session_id=${sessionUuid}`;

    if (window.sketchup) {
        sketchup.open_browser(loginUrl);
    } else {
        window.open(loginUrl, "_blank");
    }

    if (authPollTimer) clearInterval(authPollTimer);
    let attempts = 0;

    authPollTimer = setInterval(async () => {
        attempts++;
        if (attempts > 300) {
            clearInterval(authPollTimer);
            closeLoginModal();
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/api/auth/poll?session_id=${sessionUuid}`);
            const data = await res.json();

            if (data.status === 'success') {
                clearInterval(authPollTimer);
                window.loamlabUserEmail = data.email;
                if (window.sketchup) {
                    sketchup.save_email(data.email);
                }
                window.fetchUserPoints(data.email);
                closeLoginModal();
            } else if (data.status === 'device_limit') {
                clearInterval(authPollTimer);
                closeLoginModal();
                alert(`Device limit reached.\n${data.message}\n\nUpgrade your plan to connect more devices.`);
                if (typeof openPricingModal === 'function') openPricingModal();
            }
        } catch (e) {
            console.error("Polling error:", e);
        }
    }, 2000);
}

// =========================================================
// 安全的中文化 / Emoji 解析通道 (來自 Ruby 的 Base64)
// =========================================================
window.receiveFromRubyBase64 = function (b64Str) {
    try {
        const binaryStr = atob(b64Str);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        const decodedStr = new TextDecoder('utf-8').decode(bytes);
        const payload = JSON.parse(decodedStr);
        window.receiveFromRuby(payload);
    } catch (e) {
        console.error('Base64 Payload decode error:', e);
    }
};

const btnLogin = document.getElementById('btn-login');
if (btnLogin) btnLogin.addEventListener('click', openLoginModal);

const btnCloseModal = document.getElementById('btn-close-modal');
if (btnCloseModal) btnCloseModal.addEventListener('click', closeLoginModal);
if (loginModalOverlay) loginModalOverlay.addEventListener('click', closeLoginModal);

// Pricing Modal 事件
const btnShowPricing = document.getElementById('btn-show-pricing');
if (btnShowPricing) btnShowPricing.addEventListener('click', openPricingModal);

const btnClosePricing = document.getElementById('btn-close-pricing');
if (btnClosePricing) btnClosePricing.addEventListener('click', closePricingModal);
if (pricingModal) pricingModal.addEventListener('click', (e) => {
    if (e.target === pricingModal) closePricingModal();
});

// 彈窗內的儲值按鈕事件
const btnRenewAction = document.getElementById('btn-renew-action');
if (btnRenewAction) {
    btnRenewAction.addEventListener('click', () => {
        console.log('Redirecting to Checkout...');
        closeLoginModal();
        if (window.sketchup) {
            sketchup.open_checkout({});
        } else {
            alert('Simulation: Account/Checkout page opened.');
        }
    });
}

// 邀請碼 Modal 事件與點擊邏輯
const referralModal = document.getElementById('referral-modal');
const referralModalContent = document.getElementById('referral-modal-content');

function openReferralModal() {
    if (referralModal) {
        referralModal.classList.remove('hidden');
        setTimeout(() => {
            referralModal.classList.remove('opacity-0');
            if (referralModalContent) referralModalContent.classList.remove('scale-95');
        }, 10);
    }
}

function closeReferralModal() {
    if (referralModal) {
        referralModal.classList.add('opacity-0');
        if (referralModalContent) referralModalContent.classList.add('scale-95');
        setTimeout(() => {
            referralModal.classList.add('hidden');
        }, 300);
    }
}

const btnShowReferral = document.getElementById('btn-show-referral');
if (btnShowReferral) btnShowReferral.addEventListener('click', openReferralModal);

const btnCloseReferral = document.getElementById('btn-close-referral');
if (btnCloseReferral) btnCloseReferral.addEventListener('click', closeReferralModal);
if (referralModal) referralModal.addEventListener('click', (e) => {
    if (e.target === referralModal) closeReferralModal();
});

// 複製推薦碼按鈕特效
const btnCopyReferral = document.getElementById('btn-copy-referral');
if (btnCopyReferral) {
    btnCopyReferral.addEventListener('click', () => {
        const codeText = document.getElementById('my-referral-code')?.textContent;
        if (codeText && codeText !== '------') {
            navigator.clipboard.writeText(codeText).then(() => {
                const ogText = btnCopyReferral.textContent;
                btnCopyReferral.textContent = 'COPIED!';
                btnCopyReferral.classList.replace('text-white', 'text-emerald-400');
                setTimeout(() => {
                    btnCopyReferral.textContent = ogText;
                    btnCopyReferral.classList.replace('text-emerald-400', 'text-white');
                }, 2000);
            });
        }
    });
}

// 送出綁定推薦人
const btnSubmitReferral = document.getElementById('btn-submit-referral');
const inputReferralCode = document.getElementById('input-referral-code');
if (btnSubmitReferral && inputReferralCode) {
    btnSubmitReferral.addEventListener('click', async () => {
        const code = inputReferralCode.value.trim().toUpperCase();
        if (!code) return alert('請輸入推薦人的代碼！\nPlease enter invite code.');
        if (!window.loamlabUserEmail) return alert('連線異常，請重新登入。');

        const ogText = btnSubmitReferral.textContent;
        btnSubmitReferral.textContent = '...';
        btnSubmitReferral.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/api/referral`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: window.loamlabUserEmail, code: code })
            });
            const data = await res.json();

            if (data.code === 0) {
                alert(data.msg);
                // 成功後，重刷點數與狀態 (這會隱藏輸入框並拉出成功字樣)
                window.fetchUserPoints(window.loamlabUserEmail);
            } else {
                alert(data.msg || '綁定失敗，請確認代碼是否輸入正確。');
            }
        } catch (e) {
            console.error('Referral bind error:', e);
            alert('系統連線異常，請稍後再試。');
        } finally {
            btnSubmitReferral.textContent = ogText;
            btnSubmitReferral.disabled = false;
        }
    });
}

// 將檢查更新設為真正的自動更新
const btnCheckUpdate = document.getElementById('btn-check-update');
if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', () => {
        // SVG 旋轉動畫示意處理中
        const svg = btnCheckUpdate.querySelector('svg');
        if (svg) svg.classList.add('animate-spin');

        if (window.sketchup) {
            window._silentUpdateCheck = false;
            sketchup.auto_update({});
            // 10 秒兜底：如果 Ruby 沒回應就自動停止
            window._updateSpinnerTimeout = setTimeout(() => {
                stopUpdateSpinner();
                showUpdateToast('⚠️ 無法連接伺服器，請稍後再試');
            }, 10000);
        } else {
            console.log("Auto update triggered (Local Mock)");
            setTimeout(() => { if (svg) svg.classList.remove('animate-spin'); }, 1000);
        }
    });
}

// Dev Reload 按鈕
const btnDevReload = document.getElementById('btn-dev-reload');
if (btnDevReload) {
    btnDevReload.addEventListener('click', () => {
        if (window.sketchup) {
            sketchup.dev_reload({});
        } else {
            location.reload();
        }
    });
}

// =========================================================
// SWAP Modal — 遮罩替換彈窗
// =========================================================
let swapIsDrawing = false;
let swapCanvas = null;
let swapCtx = null;
let swapRenderedUrl = null;

function openSwapModal(sketchupImgSrc, renderedImgUrl) {
    swapRenderedUrl = renderedImgUrl;
    const modal = document.getElementById('swap-modal');
    if (!modal) return;

    // 設定底圖（已渲染結果）
    const baseImg = document.getElementById('swap-base-image');
    if (baseImg) baseImg.src = renderedImgUrl;

    // 初始化 canvas
    swapCanvas = document.getElementById('swap-mask-canvas');
    if (swapCanvas) {
        // 等底圖載入完後再同步 canvas 尺寸
        if (baseImg) {
            const syncSize = () => {
                swapCanvas.width = baseImg.offsetWidth || 512;
                swapCanvas.height = baseImg.offsetHeight || 288;
                swapCtx = swapCanvas.getContext('2d');
                swapCtx.strokeStyle = 'rgba(255,100,50,0.85)';
                swapCtx.lineWidth = parseInt(document.getElementById('swap-brush-size')?.value || '20', 10);
                swapCtx.lineCap = 'round';
                swapCtx.lineJoin = 'round';
            };
            if (baseImg.complete) syncSize();
            else baseImg.onload = syncSize;
        }
    }

    // 重置 prompt
    const promptInput = document.getElementById('swap-prompt-input');
    if (promptInput) promptInput.value = '';

    // 顯示 modal
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);

    // 綁定刷子繪製事件（避免重複綁定）
    if (swapCanvas && !swapCanvas._swapBound) {
        swapCanvas._swapBound = true;

        const getPos = (e) => {
            const rect = swapCanvas.getBoundingClientRect();
            const src = e.touches ? e.touches[0] : e;
            return { x: (src.clientX - rect.left) * (swapCanvas.width / rect.width), y: (src.clientY - rect.top) * (swapCanvas.height / rect.height) };
        };

        swapCanvas.addEventListener('mousedown', (e) => { swapIsDrawing = true; const p = getPos(e); swapCtx.beginPath(); swapCtx.moveTo(p.x, p.y); });
        swapCanvas.addEventListener('mousemove', (e) => { if (!swapIsDrawing) return; const p = getPos(e); swapCtx.lineTo(p.x, p.y); swapCtx.stroke(); });
        swapCanvas.addEventListener('mouseup', () => { swapIsDrawing = false; });
        swapCanvas.addEventListener('mouseleave', () => { swapIsDrawing = false; });

        swapCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); swapIsDrawing = true; const p = getPos(e); swapCtx.beginPath(); swapCtx.moveTo(p.x, p.y); }, { passive: false });
        swapCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); if (!swapIsDrawing) return; const p = getPos(e); swapCtx.lineTo(p.x, p.y); swapCtx.stroke(); }, { passive: false });
        swapCanvas.addEventListener('touchend', () => { swapIsDrawing = false; });
    }

    // 刷子尺寸同步
    document.getElementById('swap-brush-size')?.addEventListener('input', (e) => {
        if (swapCtx) swapCtx.lineWidth = parseInt(e.target.value, 10);
    });
}

function closeSwapModal() {
    const modal = document.getElementById('swap-modal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

function clearSwapMask() {
    if (swapCtx && swapCanvas) {
        swapCtx.clearRect(0, 0, swapCanvas.width, swapCanvas.height);
    }
}

async function executeSwap() {
    const btn = document.getElementById('btn-execute-swap');
    const refUrl = document.getElementById('swap-reference-url')?.value.trim() || '';
    const prompt = document.getElementById('swap-prompt-input')?.value.trim() || '';

    if (!swapCanvas || !swapRenderedUrl) return;

    // 將遮罩 canvas 匯出為 base64 PNG（黑底白遮罩格式）
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = swapCanvas.width;
    maskCanvas.height = swapCanvas.height;
    const mCtx = maskCanvas.getContext('2d');
    mCtx.fillStyle = '#000000';
    mCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    mCtx.globalCompositeOperation = 'destination-out';
    mCtx.drawImage(swapCanvas, 0, 0);
    mCtx.globalCompositeOperation = 'source-over';
    // 反轉：白色為遮罩區域
    const maskData = mCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    for (let i = 0; i < maskData.data.length; i += 4) {
        maskData.data[i] = 255 - maskData.data[i];
        maskData.data[i + 1] = 255 - maskData.data[i + 1];
        maskData.data[i + 2] = 255 - maskData.data[i + 2];
    }
    mCtx.putImageData(maskData, 0, 0);
    const maskBase64 = maskCanvas.toDataURL('image/png');

    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

    try {
        const resp = await fetch(`${API_BASE}/api/inpaint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: swapRenderedUrl, mask_base64: maskBase64, reference_url: refUrl, prompt })
        });
        const result = await resp.json();
        if (result.code === 0 && result.url) {
            // 替換成功：關閉 modal 並顯示提示
            closeSwapModal();
            alert('Swap complete! Result: ' + result.url);
        } else {
            alert(result.msg || 'Furniture swap is coming in the next update.');
        }
    } catch (err) {
        alert('Swap coming soon — backend not yet configured.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Execute SWAP'; }
    }
}
