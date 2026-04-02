const HIDE_UNFINISHED_FEATURES = true;
console.log('[LoamLab] app.js initialized (v1.2.7-compat)');

// i18n helper — 自動 fallback: 當前語言 → en-US → key 名稱（便於 debug）
function t(key) {
    var langSet = UI_LANG[currentLang] || UI_LANG['en-US'];
    var val = langSet[key];
    if (val === undefined || val === null) {
        val = UI_LANG['en-US'][key];
    }
    return (val !== undefined && val !== null) ? val : key;
}

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
let _baseImageEntry = null; // 工具 2/3/4：從歷史選取的底圖
let _referenceImageBase64 = null; // 工具 2：本地上傳的參考圖 base64

const PROXY_PREFIX = "This interior design scene contains simple geometric proxy shapes (boxes/blocks/cylinders) representing furniture placeholders. Replace each proxy with a realistic, high-quality piece of furniture of the indicated type while preserving its exact position, scale, and spatial relationship. ";

const NINEGRID_PREFIX = "Generate a single 3×3 nine-panel grid composition image showing this interior from 9 distinct dramatic camera angles in a magazine-style layout: [1.Wide angle overview] [2.Eye-level straight-on] [3.Bird's eye top-down] [4.Worm's eye looking up] [5.45° corner diagonal] [6.Entrance threshold] [7.Close-up material detail] [8.Golden hour window shot] [9.Cinematic low dramatic angle]. Each panel separated by thin white dividing lines. ";

const SHOT_MODIFIERS = {
    industrial: "Hard dramatic shadows, high contrast, exposed concrete and raw industrial materials, cool tones. ",
    natural: "Soft diffused daylight, warm earth tones, organic textures, airy and breathing atmosphere. ",
    dramatic: "Golden hour side lighting, cinematic depth of field, bold light-shadow contrasts, editorial feel. ",
    minimal: "Clean white walls, extreme negative space, calm and serene minimalist atmosphere, neutral palette. "
};

// 軟硬裝 Tag 群組資料（唯一來源，新增 tag 只改這裡）
const SWAP_TAG_GROUPS = {
    soft: {
        label: '軟裝',
        tags: [
            { label: '沙發', tag: 'sofa' },
            { label: '單椅', tag: 'armchair' },
            { label: '餐桌椅', tag: 'dining table and chairs' },
            { label: '床組', tag: 'bed frame with mattress' },
            { label: '衣櫃', tag: 'wardrobe' },
            { label: '書桌', tag: 'desk' },
            { label: '落地燈', tag: 'floor lamp' },
            { label: '茶几', tag: 'coffee table' },
            { label: '窗簾', tag: 'curtains' },
            { label: '地毯', tag: 'rug' },
        ]
    },
    hard: {
        label: '硬裝',
        tags: [
            { label: '磁磚', tag: 'ceramic tiles' },
            { label: '木地板', tag: 'wood flooring' },
            { label: '牆漆', tag: 'wall paint' },
            { label: '石材', tag: 'stone surface' },
            { label: '壁紙', tag: 'wallpaper' },
            { label: '混凝土', tag: 'concrete wall' },
            { label: '大理石', tag: 'marble floor' },
        ]
    }
};

function setActiveTool(n) {
    currentActiveTool = n;

    // Smart Canvas pending indicator：只在 Tool 2/4 時顯示
    const ind = document.getElementById('sc-pending-indicator');
    if (ind && SmartCanvas.pendingSwap) {
        if (n === 2 || n === 4) {
            ind.classList.remove('hidden'); ind.classList.add('flex');
        } else {
            ind.classList.add('hidden'); ind.classList.remove('flex');
        }
    }

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
    const scenesContainer = document.getElementById('scenes-container');
    const renderLabel = document.getElementById('btn-render-label');
    const advancedDetails = document.querySelector('details.group');

    if (hintBanner) hintBanner.classList.add('hidden');
    if (shotStyleSelector) shotStyleSelector.classList.add('hidden');
    if (materialTagsDiv) materialTagsDiv.classList.remove('hidden');
    var refPicker = document.getElementById('reference-image-picker');
    if (refPicker) refPicker.classList.add('hidden');
    clearReferenceImage();
    // 重置：切換工具時恢復 scenes-container，恢復按鈕文字，恢復 picker 樣式
    if (scenesContainer) scenesContainer.classList.remove('hidden');
    if (renderLabel) renderLabel.textContent = t('btn_render');
    const pickerLabel = document.getElementById('base-image-picker-label');
    const pickBtn = document.getElementById('base-image-pick-btn');
    const pickEmpty = document.getElementById('base-image-empty');
    if (pickerLabel) pickerLabel.className = 'text-[11px] font-semibold tracking-wider text-white/50 uppercase';
    if (pickBtn) pickBtn.className = 'w-full rounded-xl border-2 border-dashed border-white/15 bg-black/20 cursor-pointer hover:border-amber-500/40 hover:bg-amber-500/5 transition-all group overflow-hidden relative';
    if (pickEmpty) pickEmpty.className = 'flex flex-col items-center justify-center gap-2 text-white/30 group-hover:text-amber-400/50 transition-colors p-4';
    // 離開副工具時：清除底圖預覽佔位卡，重置 thumb 大小
    const gridEl0 = document.getElementById('preview-grid');
    if (gridEl0 && gridEl0.querySelector('[data-base-preview]')) {
        gridEl0.innerHTML = '';
        gridEl0.classList.add('hidden');
        var placeholder = document.getElementById('preview-placeholder');
        if (placeholder) placeholder.classList.remove('hidden');
    }
    const baseThumb0 = document.getElementById('base-image-thumb');
    if (baseThumb0) { baseThumb0.style.maxHeight = '96px'; baseThumb0.style.display = ''; }
    const filled0 = document.getElementById('base-image-filled');
    if (filled0) filled0.style.minHeight = '';

    if (n === 1) {
        if (titleEl) titleEl.textContent = (UI_LANG[currentLang] || UI_LANG['en-US'])['title'];
        rebuildMaterialTags();
        if (promptInput) promptInput.placeholder = (UI_LANG[currentLang] || UI_LANG['en-US'])['prompt_ph'];
    } else if (n === 2) {
        const lang2 = UI_LANG[currentLang] || UI_LANG['en-US'];
        if (titleEl) titleEl.textContent = lang2['tool_furniture'];
        if (hintBanner) {
            hintBanner.className = 'w-full rounded-lg px-3 py-2.5 text-[11px] leading-relaxed bg-blue-500/10 border border-blue-500/20 text-blue-200/70';
            hintBanner.textContent = lang2['tool_furniture_hint'];
            hintBanner.classList.remove('hidden');
        }
        // Tool 2: 隱藏場景列表、tags，Advanced Settings 預設收起（同步工具 3）
        if (scenesContainer) scenesContainer.classList.add('hidden');
        if (advancedDetails) advancedDetails.open = false;
        if (materialTagsDiv) materialTagsDiv.classList.add('hidden');
        // 參考圖已移至 Smart Canvas 每個區域的 🖼 切換，主面板不顯示
        if (promptInput) promptInput.placeholder = lang2['tool_furniture_ph'];
        if (pickerLabel) { pickerLabel.className = 'text-[11px] font-semibold tracking-wider text-blue-400/80 uppercase'; pickerLabel.textContent = (lang2['base_image_label'] || '底圖 Base Image') + '  ★ ' + (lang2['required'] || 'Required'); }
        if (pickBtn) pickBtn.className = 'w-full rounded-xl border-2 border-dashed border-blue-500/30 bg-black/20 cursor-pointer hover:border-blue-500/60 hover:bg-blue-500/5 transition-all group overflow-hidden relative';
        if (pickEmpty) pickEmpty.className = 'flex flex-col items-center justify-center gap-2 text-white/30 group-hover:text-blue-400/50 transition-colors py-5';
    } else if (n === 3) {
        const lang3 = UI_LANG[currentLang] || UI_LANG['en-US'];
        if (titleEl) titleEl.textContent = lang3['tool_multi_angle'];
        if (hintBanner) {
            hintBanner.className = 'w-full rounded-lg px-3 py-2.5 text-[11px] leading-relaxed bg-blue-500/10 border border-blue-500/20 text-blue-200/70';
            hintBanner.textContent = lang3['tool_ninegrid_hint'];
            hintBanner.classList.remove('hidden');
        }
        // Tool 3: 隱藏場景列表，底圖必填 (blue 色系)
        if (scenesContainer) scenesContainer.classList.add('hidden');
        if (advancedDetails) advancedDetails.open = false;
        if (shotStyleSelector) shotStyleSelector.classList.remove('hidden');
        if (materialTagsDiv) materialTagsDiv.classList.add('hidden');
        if (promptInput) promptInput.placeholder = lang3['tool_ninegrid_ph'];
        if (pickerLabel) { pickerLabel.className = 'text-[11px] font-semibold tracking-wider text-blue-400/80 uppercase'; pickerLabel.textContent = (lang3['base_image_label'] || '底圖 Base Image') + '  ★ ' + (lang3['required'] || 'Required'); }
        if (pickBtn) pickBtn.className = 'w-full rounded-xl border-2 border-dashed border-blue-500/30 bg-black/20 cursor-pointer hover:border-blue-500/60 hover:bg-blue-500/5 transition-all group overflow-hidden relative';
        if (pickEmpty) pickEmpty.className = 'flex flex-col items-center justify-center gap-2 text-white/30 group-hover:text-blue-400/50 transition-colors py-5';
    } else if (n === 4) {
        const lang4 = UI_LANG[currentLang] || UI_LANG['en-US'];
        if (titleEl) titleEl.textContent = lang4['tool_swap'] || 'Material SWAP';
        if (hintBanner) {
            hintBanner.className = 'w-full rounded-lg px-3 py-2.5 text-[11px] leading-relaxed bg-blue-500/10 border border-blue-500/20 text-blue-200/70';
            hintBanner.textContent = lang4['tool_swap_hint'] || '';
            hintBanner.classList.remove('hidden');
        }
        // Tool 4: 隱藏場景列表、tags，Advanced Settings 預設收起（同步工具 3）
        if (scenesContainer) scenesContainer.classList.add('hidden');
        if (advancedDetails) advancedDetails.open = false;
        if (materialTagsDiv) materialTagsDiv.classList.add('hidden');
        if (promptInput) promptInput.placeholder = 'e.g. marble texture, oak wood floor...';
        if (renderLabel) renderLabel.textContent = lang4['btn_mask_editor'] || 'Paint Mask →';
        // Tool 4 底圖必填，blue 色系（同步工具 3）
        if (pickerLabel) { pickerLabel.className = 'text-[11px] font-semibold tracking-wider text-blue-400/80 uppercase'; pickerLabel.textContent = (lang4['base_image_required_label'] || '底圖 Base Image') + '  ★ ' + (lang4['required'] || 'Required'); }
        if (pickBtn) pickBtn.className = 'w-full rounded-xl border-2 border-dashed border-blue-500/30 bg-black/20 cursor-pointer hover:border-blue-500/60 hover:bg-blue-500/5 transition-all group overflow-hidden relative';
        if (pickEmpty) pickEmpty.className = 'flex flex-col items-center justify-center gap-2 text-white/30 group-hover:text-blue-400/50 transition-colors py-5';
    }

    // 底圖選擇器：工具 2/3/4 顯示，工具 1 隱藏
    const picker = document.getElementById('base-image-picker');
    if (picker) picker.classList.toggle('hidden', n === 1);
    clearBaseImageSelection();

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
    container.innerHTML = SWAP_TAG_GROUPS.soft.tags.map(t => `<span class="${cls}" data-tag="${t.tag}">${t.label}</span>`).join('');
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
    if (data.action === 'historyList') {
        const rubyFiles = data.files || [];
        const sessionItems = (window._sessionRenders || [])
            .filter(s => !rubyFiles.some(r => r.cloud_url === s.cloud_url || r.file_url === s.cloud_url))
            .map(s => ({ cloud_url: s.cloud_url, scene: s.scene, resolution: s.resolution, prompt: s.prompt, timestamp: s.timestamp }));
        renderHistoryGrid([...rubyFiles, ...sessionItems]);
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
            window._isDev = true;
            const badge = document.createElement('div');
            badge.textContent = 'DEV';
            badge.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:#dc2626;color:white;font-size:10px;font-weight:900;padding:2px 12px;border-radius:4px;z-index:9999;letter-spacing:3px;pointer-events:none;box-shadow:0 0 12px rgba(220,38,38,0.6);';
            document.body.appendChild(badge);
            // Dev 模式：顯示所有開發中工具
            document.querySelectorAll('.dev-only-tool').forEach(el => el.classList.remove('hidden'));
        }
        const langStr = data.lang || 'en-US';
        (document.getElementById('lang-select') || document.createElement('div')).value = langStr;
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
        var updateDot = document.getElementById('update-dot');
        if (updateDot) updateDot.classList.remove('hidden');
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
        const channelB64 = data.channel_base64 || '';

        if (targetScene && targetUrl) {
            // Session 快取：記錄本次 session 的渲染結果，確保歷史面板即使未設定存檔資料夾也能顯示
            window._sessionRenders = window._sessionRenders || [];
            var resEl = document.querySelector('input[name="resolution"]:checked');
            var promptEl = document.getElementById('user-prompt-input');
            window._sessionRenders.unshift({
                cloud_url: targetUrl,
                scene: targetScene,
                resolution: (resEl ? resEl.value : '2k'),
                prompt: (promptEl ? promptEl.value : ''),
                timestamp: new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/(\d{8})(\d{6})/, '$1_$2')
            });

            // AI 渲染結果自動存檔（Ruby 下載圖片 → save_path + 更新 JSON 索引）
            if (window.sketchup) {
                var resEl2 = document.querySelector('input[name="resolution"]:checked');
                var promptEl2 = document.getElementById('user-prompt-input');
                sketchup.auto_save_render({
                    url: targetUrl,
                    scene: targetScene,
                    resolution: (resEl2 ? resEl2.value : '2k'),
                    prompt: (promptEl2 ? promptEl2.value : '')
                });
            }

            // 工具 2 結果：全寬結果卡（家具替換前後對比）
            if (currentActiveTool === 2) {
                const gridEl2 = document.getElementById('preview-grid');
                if (gridEl2) {
                    var thumbEl = document.getElementById('base-image-thumb');
                    const baseThumbSrc = (thumbEl ? thumbEl.src : '') || '';
                    gridEl2.className = 'w-full h-full px-6 flex flex-col gap-4 overflow-y-auto custom-scrollbar pb-6 pt-4';
                    gridEl2.innerHTML = `
                        <div data-tool2-result="true" class="relative w-full rounded-2xl overflow-hidden bg-black border border-white/[0.06]">
                            <div class="absolute top-3 left-3 bg-blue-600 text-white text-[9px] px-2.5 py-1 rounded shadow-lg z-10 font-bold tracking-widest">FURNITURE SWAP · AI</div>
                            ${baseThumbSrc ? `<div class="w-full flex flex-col">
                                <div class="relative w-full overflow-hidden bg-black aspect-video">
                                    <div class="absolute top-2 left-2 bg-black/60 backdrop-blur-md border border-white/10 text-white/50 text-[8px] px-2 py-1 rounded z-10 font-mono tracking-widest">BEFORE</div>
                                    <img src="${baseThumbSrc}" class="w-full h-full object-cover opacity-50 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-700">
                                </div>
                                <div class="relative w-full overflow-hidden bg-black aspect-video border-t border-white/[0.05]">
                                    <div class="absolute top-2 left-2 bg-blue-600 text-white text-[9px] px-2.5 py-1 rounded shadow-lg z-10 font-bold tracking-widest">AFTER</div>
                                    <img src="${targetUrl}" class="w-full h-full object-cover animate-blur-clear" onclick="window.open('${targetUrl}', '_blank')">
                                </div>
                            </div>` : `<img src="${targetUrl}" class="w-full object-contain animate-blur-clear" onclick="window.open('${targetUrl}', '_blank')">`}
                            <div class="px-4 py-3 flex items-center justify-between border-t border-white/[0.05] bg-black/40">
                                <span class="text-[10px] text-white/30 truncate max-w-[60%]">${(document.getElementById('user-prompt-input') ? (document.getElementById('user-prompt-input') || document.createElement('div')).value : '') || 'Furniture Swap'}</span>
                                <div class="flex items-center gap-2">
                                    ${!HIDE_UNFINISHED_FEATURES ? `<button id="tool2-swap-btn" class="text-[9px] px-2.5 py-1 rounded border border-amber-500/30 text-amber-300/80 hover:bg-amber-500/20 hover:text-amber-200 hover:border-amber-400/50 transition-all cursor-pointer font-medium uppercase tracking-widest flex items-center gap-1 active:scale-90 shadow-sm"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> SWAP</button>` : ''}
                                    <button id="tool2-save-btn" class="text-[9px] px-2.5 py-1 rounded border border-white/20 text-white/90 hover:bg-white hover:text-black transition-all cursor-pointer font-medium uppercase tracking-widest flex items-center gap-1 active:scale-90"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> SAVE</button>
                                </div>
                            </div>
                        </div>
                    `;
                    (document.getElementById('tool2-swap-btn') || document.createElement('div')).addEventListener('click', () => openSmartCanvas(channelB64, targetUrl, targetScene));
                    (document.getElementById('tool2-save-btn') || document.createElement('div')).addEventListener('click', () => {
                        const p = (document.getElementById('user-prompt-input') || document.createElement('div')).value || '';
                        if (window.sketchup) sketchup.save_image({ url: targetUrl, prompt: p, lang: currentLang });
                    });
                }
                return;
            }

            // 九宮格結果：直接替換 9 格骨架為全寬結果卡
            if (currentActiveTool === 3) {
                const gridEl3 = document.getElementById('preview-grid');
                if (gridEl3) {
                    const promptText3 = (document.getElementById('user-prompt-input') || document.createElement('div')).value || '';
                    gridEl3.className = 'w-full h-full px-6 flex flex-col gap-4 overflow-y-auto custom-scrollbar pb-6 pt-4';
                    gridEl3.innerHTML = `
                        <div data-ninegrid-result="true" class="relative w-full rounded-2xl overflow-hidden bg-black border border-white/[0.06]">
                            <div class="absolute top-3 left-3 bg-[#dc2626] text-white text-[9px] px-2.5 py-1 rounded shadow-lg z-10 font-bold tracking-widest">9-GRID · AI RENDERED</div>
                            <img src="${targetUrl}" class="w-full object-contain animate-blur-clear" title="點擊檢視大圖" onclick="window.open('${targetUrl}', '_blank')">
                            <div class="px-4 py-3 flex items-center justify-between border-t border-white/[0.05] bg-black/40">
                                <span class="text-[10px] text-white/30 truncate max-w-[60%]">${promptText3 || 'Multi-angle Gen'}</span>
                                <button id="ninegrid-save-btn" class="text-[9px] px-2.5 py-1 rounded border border-white/20 text-white/90 hover:bg-white hover:text-black hover:border-white transition-all cursor-pointer font-medium uppercase tracking-widest flex items-center gap-1 active:scale-90 shadow-sm"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> SAVE</button>
                            </div>
                        </div>
                    `;
                    (document.getElementById('ninegrid-save-btn') || document.createElement('div')).addEventListener('click', () => {
                        const p = (document.getElementById('user-prompt-input') || document.createElement('div')).value || '';
                        if (window.sketchup) sketchup.save_image({ url: targetUrl, prompt: p, lang: currentLang });
                    });
                }
                return; // 跳過後續 span.truncate 查找邏輯
            }

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

                            // 保持 aspect-video 高度，改用 overlay 疊加對比（hover 查看 SKETCHUP 原圖）
                            imgContainer.className = "relative w-full overflow-hidden bg-black aspect-video flex-shrink-0";
                            imgContainer.innerHTML = `
                                <img src="${targetUrl}" class="w-full h-full object-cover transition-transform duration-[3s] hover:scale-[1.04]" onclick="window.open('${targetUrl}', '_blank')" title="點擊開大圖" style="cursor:pointer">
                                <div class="absolute top-2 left-2 bg-[#dc2626] text-white text-[9px] px-2.5 py-1 rounded shadow-lg z-10 font-bold tracking-widest pointer-events-none">AI RENDERED</div>
                                <div class="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                                    <img src="${originalImgSrc}" class="w-full h-full object-cover opacity-90">
                                    <div class="absolute top-2 left-2 bg-black/70 backdrop-blur-md border border-white/10 text-white/60 text-[8px] px-2 py-1 rounded z-10 font-mono tracking-widest">SKETCHUP</div>
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
                                var promptEl = document.getElementById('user-prompt-input');
                                const promptText = (promptEl ? promptEl.value : "") || "";
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
                            if (!HIDE_UNFINISHED_FEATURES && currentActiveTool !== 3) {
                                const swapBtn = document.createElement('button');
                                swapBtn.className = "text-[9px] px-2.5 py-1 rounded border border-amber-500/30 text-amber-300/80 hover:bg-amber-500/20 hover:text-amber-200 hover:border-amber-400/50 transition-all cursor-pointer font-medium uppercase tracking-widest flex items-center gap-1 active:scale-90 shadow-sm";
                                swapBtn.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> SWAP`;
                                swapBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    channelB64 ? openSmartCanvas(channelB64, targetUrl, targetScene) : openSwapModal(originalImgSrc, targetUrl);
                                };
                                btnContainer.appendChild(swapBtn);

                                // EXTRACT 按鈕 — 從渲染圖框選材質存入素材庫
                                const extractBtn = document.createElement('button');
                                extractBtn.className = "text-[9px] px-2.5 py-1 rounded border border-sky-500/30 text-sky-300/80 hover:bg-sky-500/20 hover:text-sky-200 hover:border-sky-400/50 transition-all cursor-pointer font-medium uppercase tracking-widest flex items-center gap-1 active:scale-90 shadow-sm";
                                extractBtn.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg> EXTRACT`;
                                extractBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    startExtractMode(targetUrl);
                                };
                                btnContainer.appendChild(extractBtn);
                            }

                            // SHARE 按鈕（已登入且有邀請碼才顯示，直接顯示 LINE / WA）
                            if (window.loamlabUserReferralCode) {
                                const shareBtnClass = "text-[9px] px-2.5 py-1 rounded border border-green-500/30 text-green-300/80 hover:bg-green-500/20 hover:text-green-200 hover:border-green-400/50 transition-all cursor-pointer font-medium uppercase tracking-widest active:scale-90 shadow-sm";
                                const lineBtn = document.createElement('button');
                                lineBtn.className = shareBtnClass;
                                lineBtn.textContent = 'LINE';
                                lineBtn.onclick = (e) => { e.stopPropagation(); openSharePlatform('line'); };
                                const waBtn = document.createElement('button');
                                waBtn.className = shareBtnClass;
                                waBtn.textContent = 'WA';
                                waBtn.onclick = (e) => { e.stopPropagation(); openSharePlatform('wa'); };
                                btnContainer.appendChild(lineBtn);
                                btnContainer.appendChild(waBtn);
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
            if (typeof openPricingModal === 'function') openPricingModal({ highlight: 'pro' });
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
            <div class="flex flex-col px-4 py-6 gap-4">
                <div class="flex flex-col gap-2">
                    <p class="text-[11px] text-white/40 font-bold uppercase tracking-widest">${langObj['scene_empty_title'] || 'No Scenes Found'}</p>
                    <p class="text-[11px] text-white/30 leading-relaxed">${langObj['scene_empty_desc'] || 'Add scenes in SketchUp first, then click refresh.'}</p>
                </div>
                <div class="flex flex-col gap-2.5">
                    <div class="flex items-start gap-2.5">
                        <span class="text-[10px] font-bold bg-[#dc2626] text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">1</span>
                        <span class="text-[11px] text-white/50 leading-relaxed">${langObj['scene_empty_step1'] || 'Switch to the angle you want to render in SketchUp'}</span>
                    </div>
                    <div class="flex items-start gap-2.5">
                        <span class="text-[10px] font-bold bg-[#dc2626] text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">2</span>
                        <span class="text-[11px] text-white/50 leading-relaxed">${langObj['scene_empty_step2'] || 'Go to View → Animation → Add Scene'}</span>
                    </div>
                    <div class="flex items-start gap-2.5">
                        <span class="text-[10px] font-bold bg-[#dc2626] text-white rounded-full w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">3</span>
                        <span class="text-[11px] text-white/50 leading-relaxed">${langObj['scene_empty_step3'] || 'Click ↺ Refresh above to load your scenes'}</span>
                    </div>
                </div>
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
            <div class="flex items-center gap-2">
                <button id="btn-select-all-scenes" class="text-[9px] text-white/40 hover:text-white/80 tracking-widest transition-colors">全選</button>
                <span id="scene-count-label" data-count="${scenes.length}" class="text-[9px] text-white font-bold tracking-widest bg-[#dc2626] px-2.5 py-1 rounded-full shadow-md">Total ${scenes.length} Scenes</span>
            </div>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-1 pt-1 custom-scrollbar w-full relative" id="scene-scroll-area">
            ${html}
        </div>
    `;

    // 全選 / 全不選 切換
    const btnSelectAll = container.querySelector('#btn-select-all-scenes');
    if (btnSelectAll) {
        btnSelectAll.addEventListener('click', () => {
            const allInputs = container.querySelectorAll('input[name="scene"]');
            const allChecked = Array.from(allInputs).every(cb => cb.checked);
            allInputs.forEach(cb => { cb.checked = !allChecked; });
            btnSelectAll.textContent = allChecked ? '全選' : '全不選';
            updateCostPreview();
        });
    }

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

    // 解析度切換時更新按鈕點數預覽，並顯示 4K 方案限制提示
    document.querySelectorAll('input[name="resolution"]').forEach(radio => {
        radio.addEventListener('change', () => {
            updateCostPreview();
            const hint = document.getElementById('res-4k-hint');
            if (!hint) return;
            const is4k = radio.value === '4k' && radio.checked;
            const plan = window.loamlabSubscriptionPlan;
            const canUse4k = plan === 'pro' || plan === 'studio';
            hint.classList.toggle('hidden', !(is4k && !canUse4k));
        });
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
                tag.classList.add('bg-white/30', 'text-white', 'border-white/50');
                setTimeout(() => {
                    tag.classList.remove('bg-white/30', 'text-white', 'border-white/50');
                }, 200);
            }
        });
    });

    // 渲染按鈕綁定與額度攔截 (Paywall)
    (document.getElementById('btn-render') || document.createElement('div')).addEventListener('click', () => {
        // 未登入攔截：直接開啟登入流程，不發送任何請求
        if (!window.loamlabUserEmail) {
            openLoginModal();
            return;
        }

        // Smart Canvas 待執行攔截：直接執行替換，不走 SketchUp 截圖流程
        if (SmartCanvas.pendingSwap && SmartCanvas.regions.length > 0) {
            executeSmartSwap();
            return;
        }

        const langObj = UI_LANG[currentLang] || UI_LANG['zh-TW'];

        // 工具 4 (Material SWAP): 直接開 SWAP modal，不走 Coze 渲染
        if (currentActiveTool === 4) {
            if (!_baseImageEntry) {
                showUpdateToast('⚠️ ' + (langObj['base_image_required'] || '請先從歷史選擇一張底圖'));
                return;
            }
            openSmartCanvas('', _baseImageEntry.file_url, _baseImageEntry.scene || '');
            return;
        }

        // 工具 2/3：必須先選擇底圖
        if ((currentActiveTool === 2 || currentActiveTool === 3) && !_baseImageEntry) {
            showUpdateToast('⚠️ ' + (langObj['base_image_required'] || '請先從歷史選擇一張底圖'));
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
            finalPrompt = SHOT_MODIFIERS[selectedShotStyle] + userPrompt;
        }

        // 工具 2/3 有底圖時：以底圖取代 SketchUp 截圖，不需選場景
        const usingBaseImage = _baseImageEntry && (currentActiveTool === 2 || currentActiveTool === 3);

        // 重置多重算圖計數器
        totalScenesToRender = usingBaseImage ? 1 : selectedScenes.length;
        finishedScenesCount = 0;

        // 取得使用者選擇的解析度與消耗點數
        const resRadio = document.querySelector('input[name="resolution"]:checked');
        const resolution = resRadio ? resRadio.value : "1k";
        const costPerScene = resRadio ? parseInt(resRadio.getAttribute('data-cost') || "15", 10) : 15;

        if (!usingBaseImage && selectedScenes.length === 0) {
            const allSceneCheckboxes = document.querySelectorAll('input[name="scene"]');
            if (allSceneCheckboxes.length === 0) {
                showUpdateToast('⚠️ ' + (langObj['alert_no_scene_setup'] || '此模型尚未建立任何場景！請在 SketchUp 中點選「視窗 → 場景」新增場景。'));
            } else {
                showUpdateToast('⚠️ ' + (langObj['alert_no_scene'] || '請至少勾選一個場景進行渲染！'));
            }
            return;
        }

        // 計算總花費
        const totalCost = usingBaseImage ? costPerScene : selectedScenes.length * costPerScene;

        // 取得目前點數 (透過 DOM)
        const pointStr = document.getElementById('point-balance').innerText;
        const currentPoints = parseInt(pointStr, 10); // 若為 NaN (如 '...') 則不阻擋

        // 額度不足防線
        if (!isNaN(currentPoints) && totalCost > currentPoints) {
            if (typeof openPricingModal === 'function') openPricingModal({ cost: totalCost, balance: currentPoints });
            return;
        }

        if (window.sketchup) {
            sketchup.render_scene({
                scenes: usingBaseImage ? [] : selectedScenes,
                prompt: finalPrompt,
                resolution,
                expected_cost: totalCost,
                tool: currentActiveTool,
                ...(usingBaseImage && {
                    base_image_url: _baseImageEntry.file_url,
                    base_image_scene: _baseImageEntry.scene || '底圖'
                }),
                ...(currentActiveTool === 2 && _referenceImageBase64 && {
                    reference_image_base64: _referenceImageBase64
                })
            });
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

    // 資料夾按鈕（綠色圖示）= 開啟資料夾
    // 路徑文字顯示區（藍色）= 點擊更改路徑
    const btnChooseDir = document.getElementById('btn-choose-dir');
    const saveDirDisplay = document.getElementById('save-dir-display');
    if (btnChooseDir) {
        btnChooseDir.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.sketchup) sketchup.open_save_dir({});
        });
    }
    if (saveDirDisplay) {
        saveDirDisplay.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.sketchup) sketchup.choose_save_dir({});
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

    // 工具 3：Advanced Settings 開合時，同步切換底圖縮圖顯示
    (document.querySelector('details.group') || document.createElement('div')).addEventListener('toggle', (e) => {
        if (currentActiveTool !== 3) return;
        const thumb = document.getElementById('base-image-thumb');
        const filled = document.getElementById('base-image-filled');
        if (!filled || filled.classList.contains('hidden')) return;
        if (e.target.open) {
            // 展開：壓縮為 meta 列
            if (thumb) thumb.style.display = 'none';
            if (filled) filled.style.minHeight = '40px';
        } else {
            // 收起：顯示底圖預覽
            if (thumb) { thumb.style.display = ''; thumb.style.maxHeight = '180px'; }
            if (filled) filled.style.minHeight = '';
        }
    });

    // Swap Modal 控制按鈕
    (document.getElementById('btn-close-swap') || document.createElement('div')).addEventListener('click', closeSwapModal);
    (document.getElementById('btn-clear-mask') || document.createElement('div')).addEventListener('click', clearSwapMask);
    (document.getElementById('btn-execute-swap') || document.createElement('div')).addEventListener('click', executeSwap);

    // Swap Modal Tag 群組：資料驅動初始化（預設顯示軟裝）
    renderSwapTags('soft');
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
(document.getElementById('lang-select') || document.createElement('div')).addEventListener('change', (e) => {
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

function updatePlanBadge(plan) {
    const badge = document.getElementById('plan-badge');
    if (!badge) return;
    if (plan === 'pro') {
        badge.textContent = 'PRO';
        badge.className = 'text-[10px] font-bold tracking-[0.2em] text-amber-400/80';
    } else if (plan === 'studio') {
        badge.textContent = 'STUDIO';
        badge.className = 'text-[10px] font-bold tracking-[0.2em] text-violet-300/70';
    } else {
        badge.textContent = 'Points:';
        badge.className = 'text-white/40 tracking-wider text-[11px] font-semibold';
    }
}

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

function openPricingModal(ctx = null) {
    const banner = document.getElementById('paywall-context-banner');
    if (banner) {
        if (ctx && ctx.cost !== undefined && ctx.balance !== undefined && ctx.cost > ctx.balance) {
            banner.textContent = `⚡ 此次渲染需 ${ctx.cost} 點，目前餘額 ${ctx.balance} 點，差 ${ctx.cost - ctx.balance} 點`;
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }
    pricingModal.classList.remove('hidden');
    updatePlanCostLabels(currentLang);
    refreshPricingModalBadge();
    applyBetaDiscountDisplay();
    setTimeout(() => {
        pricingModal.classList.remove('opacity-0');
        pricingModalContent.classList.remove('scale-95');
        if (ctx && ctx.highlight === 'pro') {
            const proBtn = document.getElementById('btn-plan-pro');
            const proCard = proBtn && proBtn.closest('[class*="gradient-to-b"]');
            if (proCard) {
                proCard.classList.add('ring-2', 'ring-white/60');
                setTimeout(() => proCard.classList.remove('ring-2', 'ring-white/60'), 1200);
            }
        }
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
let API_BASE = "https://loamlabbackend.vercel.app";

window.LOAMLAB_CONFIG = null;
async function fetchGlobalConfig() {
    try {
        const res = await fetch(`${API_BASE}/api/config`);
        const data = await res.json();
        if (data.code === 0 && data.config) {
            window.LOAMLAB_CONFIG = data.config;
            applyConfigToUI();
        }
    } catch (e) {
        console.warn('[LoamLab] Failed to fetch config', e);
    }
}

function applyConfigToUI() {
    const cfg = window.LOAMLAB_CONFIG;
    if (!cfg) return;

    if (cfg.render_costs) {
        if (document.getElementById('ui-cost-1k')) (document.getElementById('ui-cost-1k') || document.createElement('div')).textContent = cfg.render_costs['1k'] + ' pts';
        if (document.getElementById('ui-cost-2k')) (document.getElementById('ui-cost-2k') || document.createElement('div')).textContent = cfg.render_costs['2k'] + ' pts';
        if (document.getElementById('ui-cost-4k')) (document.getElementById('ui-cost-4k') || document.createElement('div')).textContent = cfg.render_costs['4k'] + ' pts';
        
        if (document.getElementById('ui-pricing-cost-1k')) (document.getElementById('ui-pricing-cost-1k') || document.createElement('div')).textContent = cfg.render_costs['1k'];
        if (document.getElementById('ui-pricing-cost-2k')) (document.getElementById('ui-pricing-cost-2k') || document.createElement('div')).textContent = cfg.render_costs['2k'];
        if (document.getElementById('ui-pricing-cost-4k')) (document.getElementById('ui-pricing-cost-4k') || document.createElement('div')).textContent = cfg.render_costs['4k'];
        
        const r1k = document.querySelector('input[name="resolution"][value="1k"]');
        if (r1k) r1k.setAttribute('data-cost', cfg.render_costs['1k']);
        const r2k = document.querySelector('input[name="resolution"][value="2k"]');
        if (r2k) r2k.setAttribute('data-cost', cfg.render_costs['2k']);
        const r4k = document.querySelector('input[name="resolution"][value="4k"]');
        if (r4k) r4k.setAttribute('data-cost', cfg.render_costs['4k']);
    }

}

fetchGlobalConfig();

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
        setTimeout(() => modal.querySelector('.feedback-modal-box').classList.remove('scale-95', 'opacity-0'), 10);
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
    var typeEl = modal.querySelector('#feedback-type-select');
    const type = (typeEl ? typeEl.value : '') || 'general';
    var contentEl = modal.querySelector('#feedback-content-input');
    const content = (contentEl && contentEl.value ? contentEl.value.trim() : '') || '';
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
// 各方案 2K 渲染實際成本（USD，已含公測 -30% 折扣）
const PLAN_RENDER_COST_USD = {
    topup: 1.26,    // $18 × 0.7 / 200 pts × 20
    starter: 1.12,  // $24 × 0.7 / 300 pts × 20
    pro: 0.36,      // $52 × 0.7 / 2000 pts × 20
    studio: 0.22,   // $139 × 0.7 / 9000 pts × 20
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
// 支付平台配置：'LS' (LemonSqueezy) 或 'DODO' (Dodo Payments)
const CURRENT_PAYMENT_PLATFORM = 'DODO'; 

const LS_VARIANTS = {
    TOPUP: 1432023,
    STARTER: 1432194,
    PRO: 1432198,
    STUDIO: 1432205
};

const DODO_VARIANTS = {
    TOPUP: 'pdt_0NblIvgNSETSCveL7Xmk',
    STARTER: 'pdt_0NblmUvFrwJe36ymTELWV',
    PRO: 'pdt_0NblmafncbUuGNrMRvJp4',
    STUDIO: 'pdt_0Nblmhwbr5WXfNyDHpaA2'
};
const BETA_DISCOUNT_CODE = 'LOAM_BETA_30';
const BETA_DISCOUNT_RATE = 0.70; // 公測 -30% 折扣

function applyBetaDiscountDisplay() {
    document.querySelectorAll('[data-original-price]').forEach(container => {
        const original = parseFloat(container.getAttribute('data-original-price'));
        const period = container.getAttribute('data-price-period') || 'mo';
        const discounted = Math.round(original * BETA_DISCOUNT_RATE);
        const periodLabel = period === 'one-time' ? '/one-time' : '/mo';
        container.innerHTML = `
            <div class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1.5">
                    <span class="text-[12px] text-white/30 line-through">$${original}</span>
                    <span class="text-[9px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-bold tracking-wider">-30% BETA</span>
                </div>
                <div class="flex items-end gap-1">
                    <span class="text-3xl font-bold text-white">$${discounted}</span>
                    <span class="text-[10px] text-white/40 mb-1.5">${periodLabel}</span>
                </div>
            </div>`;
    });
}

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
                updatePlanBadge(window.loamlabSubscriptionPlan);
                window.updateLoginUI(email, data.points, data.referral_code, data.referred_by);

                // 邀請人到帳 Toast：比對上次快取的成功邀請數，有增加就通知
                const newRefCount = data.referral_success_count || 0;
                const prevRefCount = parseInt(localStorage.getItem('loamlab_referral_count') || '-1');
                if (prevRefCount >= 0 && newRefCount > prevRefCount) {
                    const lang = UI_LANG[currentLang] || UI_LANG['en-US'];
                    setTimeout(() => showUpdateToast(lang['referral_toast'] || '🎉 你的朋友完成了首次算圖，+300 點已到帳！'), 800);
                }
                localStorage.setItem('loamlab_referral_count', newRefCount);

                if (data.is_new_user) {
                    showWelcomeToast();
                    // 新用戶且尚未綁定邀請碼 → 1.5 秒後自動開 modal，提示輸入好友邀請碼
                    if (!data.referred_by) {
                        setTimeout(() => {
                            openReferralModal();
                            var refCodeInput = document.getElementById('input-referral-code');
                            if (refCodeInput) refCodeInput.focus();
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

function openHistoryModal() {
    const modal = document.getElementById('history-modal');
    if (!modal) return;
    const grid = document.getElementById('history-grid');
    if (grid) grid.innerHTML = '<div class="text-center text-white/30 text-[12px] py-10">⏳</div>';
    
    modal.classList.remove('hidden');
    
    // Yield to let the browser paint the modal before the potentially heavy Ruby IPC call
    setTimeout(function() {
        if (window.sketchup) {
            sketchup.list_saved_renders({});
        } else {
            const lang = UI_LANG[currentLang] || UI_LANG['en-US'];
            if (grid) grid.innerHTML = `<div class="text-center text-white/30 text-[12px] py-10">${lang['history_empty'] || 'No renders yet'}</div>`;
        }
    }, 50);
}

function renderHistoryGrid(files) {
    const grid = document.getElementById('history-grid');
    if (!grid) return;
    const lang = UI_LANG[currentLang] || UI_LANG['en-US'];
    if (!files || files.length === 0) {
        grid.innerHTML = `<div class="col-span-2 text-center text-white/30 text-[12px] py-10">${lang['history_empty'] || 'No renders yet'}</div>`;
        return;
    }
    window._historyFiles = files;
    grid.innerHTML = files.map((e, i) => {
        const date = (e.timestamp || '').replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, '$1/$2/$3 $4:$5');
        const promptSnippet = (e.prompt || '').slice(0, 40) + ((e.prompt || '').length > 40 ? '…' : '');
        const imgSrc = e.file_url || e.cloud_url || '';
        return `
        <div class="relative group rounded-xl overflow-hidden border border-white/8 hover:border-white/20 transition-colors bg-black/40 flex flex-col">
            <div class="relative aspect-video bg-white/5 overflow-hidden">
                ${imgSrc
                    ? `<img src="${imgSrc}" class="w-full h-full object-cover block" draggable="false"
                            onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center text-white/20 text-[10px]\\'>No Preview</div>'">`
                    : `<div class="w-full h-full flex items-center justify-center text-white/20 text-[10px]">No Preview</div>`
                }
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-3">
                    ${window._historyPickMode
                        ? `<button onclick="pickBaseImage(window._historyFiles[${i}])"
                            class="text-[10px] px-4 py-1.5 rounded-full bg-green-500/90 hover:bg-green-400 text-black font-bold tracking-wider transition-all shadow-lg">
                            ✓ 選為底圖
                           </button>`
                        : `<button onclick="applyHistorySettings(window._historyFiles[${i}])"
                            class="text-[10px] px-4 py-1.5 rounded-full bg-amber-500/90 hover:bg-amber-400 text-black font-bold tracking-wider transition-all shadow-lg">
                            ${lang['history_rerender'] || '重用設定'}
                           </button>`
                    }</div>
            </div>
            <div class="px-3 py-2 flex flex-col gap-0.5">
                <div class="flex items-center gap-1.5">
                    <span class="text-[11px] text-white/75 font-medium truncate flex-1">${e.scene || '—'}</span>
                    <span class="text-[9px] text-white/35 font-mono shrink-0">${(e.resolution || '').toUpperCase()}</span>
                </div>
                <div class="flex items-center justify-between">
                    <span class="text-[9px] text-white/30 truncate flex-1">${promptSnippet}</span>
                    <span class="text-[9px] text-white/20 shrink-0 ml-1">${date}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function closeHistoryModal() {
    window._historyPickMode = false;
    var histModal = document.getElementById('history-modal');
    if (histModal) histModal.classList.add('hidden');
}

// 底圖選取模式：從 History 選一張圖作為工具 2/3/4 的底圖
function openHistoryModalForPick() {
    window._historyPickMode = true;
    openHistoryModal();
}

function pickBaseImage(entry) {
    _baseImageEntry = entry;
    window._historyPickMode = false;
    const thumb = document.getElementById('base-image-thumb');
    const empty = document.getElementById('base-image-empty');
    const filled = document.getElementById('base-image-filled');
    const meta = document.getElementById('base-image-meta');
    if (thumb) thumb.src = entry.file_url || '';
    if (empty) empty.classList.add('hidden');
    if (filled) filled.classList.remove('hidden');
    if (meta) {
        const date = (entry.timestamp || '').replace(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/, '$1/$2/$3 $4:$5');
        meta.textContent = [entry.scene, (entry.resolution || '').toUpperCase(), date].filter(Boolean).join('  ·  ');
    }
    closeHistoryModal();
    // 副工具 (2/3/4)：依 Advanced Settings 開合決定縮圖模式
    if (currentActiveTool === 2 || currentActiveTool === 3 || currentActiveTool === 4) {
        const advDet = document.querySelector('details.group');
        const thumb3 = document.getElementById('base-image-thumb');
        const filled3 = document.getElementById('base-image-filled');
        if (advDet && advDet.open) {
            if (thumb3) thumb3.style.display = 'none';
            if (filled3) filled3.style.minHeight = '40px';
        } else {
            if (thumb3) { thumb3.style.display = ''; thumb3.style.maxHeight = '180px'; }
            if (filled3) filled3.style.minHeight = '';
        }
    }

    // 副工具 (2/3/4)：選底圖後，若左側 grid 無 AI 渲染結果，顯示底圖預覽
    if (currentActiveTool === 2 || currentActiveTool === 3 || currentActiveTool === 4) {
        const gridEl = document.getElementById('preview-grid');
        const hasRendered = gridEl && gridEl.querySelector('.btn-container, [data-ninegrid-result]');
        if (!hasRendered) {
            const placeholder = document.getElementById('preview-placeholder');
            if (placeholder) placeholder.classList.add('hidden');
            gridEl.classList.remove('hidden');
            gridEl.className = 'w-full h-full px-6 flex flex-col gap-4 overflow-y-auto custom-scrollbar pb-6 pt-4';
            gridEl.innerHTML = `
                <div data-base-preview="true" class="relative w-full rounded-2xl overflow-hidden bg-black border border-white/[0.06]">
                    <div class="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white/50 text-[9px] px-2.5 py-1 rounded z-10 font-mono tracking-widest">BASE IMAGE</div>
                    <img src="${entry.file_url}" class="w-full object-cover">
                </div>
            `;
        }
    }

    // 工具 2/4：選完底圖直接開 Smart Canvas
    if (currentActiveTool === 2 || currentActiveTool === 4) {
        openSmartCanvas('', entry.file_url, entry.scene || '');
    }
}

// 工具 2：參考圖 FileReader
document.addEventListener('DOMContentLoaded', () => {
    const refInput = document.getElementById('ref-image-input');
    if (refInput) {
        refInput.addEventListener('change', (e) => {
            var fileArr = e.target.files;
            const file = (fileArr && fileArr.length > 0) ? fileArr[0] : null;
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                _referenceImageBase64 = ev.target.result; // data:image/...;base64,...
                const thumb = document.getElementById('ref-image-thumb');
                const empty = document.getElementById('ref-image-empty');
                const filled = document.getElementById('ref-image-filled');
                if (thumb) thumb.src = _referenceImageBase64;
                if (empty) empty.classList.add('hidden');
                if (filled) filled.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        });
    }
});

// 工具 2：Ctrl+V 貼上參考圖
document.addEventListener('paste', (e) => {
    const refPicker = document.getElementById('reference-image-picker');
    if (!refPicker || refPicker.classList.contains('hidden')) return;
    var clipData = e.clipboardData;
    const items = clipData ? clipData.items : null;
    if (!items) return;
    for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
            _referenceImageBase64 = ev.target.result;
            const thumb = document.getElementById('ref-image-thumb');
            const empty = document.getElementById('ref-image-empty');
            const filled = document.getElementById('ref-image-filled');
            if (thumb) thumb.src = _referenceImageBase64;
            if (empty) empty.classList.add('hidden');
            if (filled) filled.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
        break;
    }
});

function clearReferenceImage(e) {
    if (e) e.preventDefault();
    _referenceImageBase64 = null;
    const input = document.getElementById('ref-image-input');
    const thumb = document.getElementById('ref-image-thumb');
    const empty = document.getElementById('ref-image-empty');
    const filled = document.getElementById('ref-image-filled');
    if (input) input.value = '';
    if (thumb) thumb.src = '';
    if (empty) empty.classList.remove('hidden');
    if (filled) filled.classList.add('hidden');
}

function clearBaseImageSelection() {
    _baseImageEntry = null;
    const thumb = document.getElementById('base-image-thumb');
    const empty = document.getElementById('base-image-empty');
    const filled = document.getElementById('base-image-filled');
    if (thumb) thumb.src = '';
    if (empty) empty.classList.remove('hidden');
    if (filled) filled.classList.add('hidden');
}

function applyHistorySettings(entry) {
    const promptEl = document.getElementById('user-prompt-input');
    if (promptEl) promptEl.value = entry.prompt || '';
    const radios = document.querySelectorAll('input[name="resolution"]');
    radios.forEach(r => { r.checked = (r.value === entry.resolution); });
    closeHistoryModal();
}

function openSharePlatform(platform) {
    const code = window.loamlabUserReferralCode;
    if (!code) return;
    const lang = UI_LANG[currentLang] || UI_LANG['en-US'];
    const text = (lang['share_text'] || '邀請碼 {code}').replace('{code}', code);
    const hint = platform === 'line'
        ? (lang['share_copied_line'] || '✓ 已複製，開啟 LINE 貼給好友')
        : (lang['share_copied_wa'] || '✓ 已複製，開啟 WhatsApp 貼給好友');
    navigator.clipboard.writeText(text).then(() => {
        showUpdateToast(hint);
    }).catch(() => {
        showUpdateToast('✓ 訊息已複製');
    });
}

// Invite Modal LINE/WA 按鈕
    var btnShareLine = document.getElementById('btn-share-line-referral');
    if (btnShareLine) btnShareLine.addEventListener('click', function() { openSharePlatform('line'); });
    var btnShareWa = document.getElementById('btn-share-wa-referral');
    if (btnShareWa) btnShareWa.addEventListener('click', function() { openSharePlatform('wa'); });

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
    (document.getElementById('update-banner') || document.createElement('div')).classList.add('hidden');
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
        showUpdateToast('⚠️ 請先登入 Google 帳號再進行儲值');
        openLoginModal();
        return;
    }

    // 已訂閱相同方案 guard（防止誤觸重複購買）
    const planMap = { [LS_VARIANTS.STARTER]: 'starter', [LS_VARIANTS.PRO]: 'pro', [LS_VARIANTS.STUDIO]: 'studio' };
    const targetPlan = planMap[variantId];
    if (targetPlan && window.loamlabSubscriptionPlan === targetPlan) {
        showUpdateToast('✓ ' + i18n('already_subscribed'));
        return;
    }

    // 根據平台選擇 Store URL 與參數
    let finalUrl = "";
    if (CURRENT_PAYMENT_PLATFORM === 'DODO') {
        const storeUrl = "https://checkout.dodopayments.com/buy";
        finalUrl = `${storeUrl}?variant_id=${variantId}&customer_email=${encodeURIComponent(window.loamlabUserEmail)}`;
    } else {
        const storeUrl = "https://loamlabstudio.lemonsqueezy.com/checkout/buy/";
        finalUrl = `${storeUrl}${variantId}?checkout[email]=${encodeURIComponent(window.loamlabUserEmail)}&checkout[custom][user_email]=${encodeURIComponent(window.loamlabUserEmail)}&checkout[discount_code]=${BETA_DISCOUNT_CODE}`;
    }

    if (window.sketchup) {
        sketchup.open_browser(finalUrl);
    } else {
        window.open(finalUrl, '_blank');
    }

    // 關閉 Modal，顯示等待提示
    closePricingModal();
    showUpdateToast('🔄 瀏覽器已開啟付款頁面，完成付款後將自動入帳...');

    // 支付後輪詢：用 last_topup_at 時間戳偵測充值成功（解決同值無法偵測的問題）
    const topupBefore = window.loamlabLastTopupAt;
    const pointsBefore = parseInt((document.getElementById('point-balance') || document.createElement('div')).textContent) || 0;
    let pollCount = 0;
    const paymentPollTimer = setInterval(async () => {
        pollCount++;
        if (pollCount > 100) {
            clearInterval(paymentPollTimer);
            showUpdateToast('⚠️ 驗證超時，如已付款請稍後重新整理，或聯繫支援');
            return;
        }
        try {
            const r = await fetch(`${API_BASE}/api/user`, {
                headers: { 'X-User-Email': window.loamlabUserEmail }
            });
            const d = await r.json();
            if (d.last_topup_at && d.last_topup_at !== topupBefore) {
                clearInterval(paymentPollTimer);
                window.loamlabSubscriptionPlan = d.subscription_plan || null;
                window.loamlabLastTopupAt = d.last_topup_at;
                updatePlanBadge(window.loamlabSubscriptionPlan);
                const newPoints = d.points || 0;
                (document.getElementById('point-balance') || document.createElement('div')).textContent = newPoints;
                const delta = newPoints - pointsBefore;
                const deltaStr = delta > 0 ? `+${delta} 點` : '';
                showUpdateToast(`🎉 付款成功！${deltaStr} 已入帳，目前共 ${newPoints} 點`);
                refreshPricingModalBadge();
                // 升級後重新評估 4K 解析度鎖定提示
                const hint4k = document.getElementById('res-4k-hint');
                if (hint4k) {
                    const checked4k = document.querySelector('input[name="resolution"]:checked');
                    const canUse4k = window.loamlabSubscriptionPlan === 'pro' || window.loamlabSubscriptionPlan === 'studio';
                    if (checked4k && checked4k.value === '4k' && canUse4k) hint4k.classList.add('hidden');
                }
            }
        } catch(e) {}
    }, 3000);
}


function openLoginModal() {
    loginModal.classList.remove('pointer-events-none');
    setTimeout(() => {
        loginModal.classList.remove('opacity-0');
        loginModalContent.classList.remove('scale-95');
    }, 10);

    // Initial state: show options
    const optView = document.getElementById('login-options-view');
    const otpView = document.getElementById('login-otp-view');
    const pollView = document.getElementById('login-polling-view');
    if (optView) optView.classList.remove('hidden');
    if (optView) optView.classList.add('flex');
    if (otpView) { otpView.classList.remove('flex'); otpView.classList.add('hidden'); }
    if (pollView) { pollView.classList.remove('flex'); pollView.classList.add('hidden'); }
    
    const statusMsg = document.getElementById('otp-status-msg');
    if (statusMsg) { statusMsg.classList.add('hidden'); statusMsg.textContent = ''; }
    
    // Clear inputs
    const emailInput = document.getElementById('login-email-input');
    const codeInput = document.getElementById('login-code-input');
    if (emailInput) emailInput.value = '';
    if (codeInput) codeInput.value = '';
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
    // 切換到 Polling UI
    const optView = document.getElementById('login-options-view');
    const pollView = document.getElementById('login-polling-view');
    if (optView) { optView.classList.remove('flex'); optView.classList.add('hidden'); }
    if (pollView) { pollView.classList.remove('hidden'); pollView.classList.add('flex'); }

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
// Email OTP 工作流 (方案B)
// =========================================================
(document.getElementById('btn-google-login') || document.createElement('div')).addEventListener('click', startOAuthFlow);

(document.getElementById('btn-cancel-polling') || document.createElement('div')).addEventListener('click', () => {
    if (authPollTimer) clearInterval(authPollTimer);
    const optView = document.getElementById('login-options-view');
    const pollView = document.getElementById('login-polling-view');
    if (pollView) { pollView.classList.remove('flex'); pollView.classList.add('hidden'); }
    if (optView) { optView.classList.remove('hidden'); optView.classList.add('flex'); }
});

(document.getElementById('btn-send-otp') || document.createElement('div')).addEventListener('click', async () => {
    const emailInput = document.getElementById('login-email-input');
    const email = emailInput ? emailInput.value.trim() : '';
    const statusMsg = document.getElementById('otp-status-msg');
    const btn = document.getElementById('btn-send-otp');
    
    if (!email || !email.includes('@')) {
        if (statusMsg) {
            statusMsg.textContent = 'Please enter a valid email address';
            statusMsg.classList.remove('hidden');
        }
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';
    if (statusMsg) statusMsg.classList.add('hidden');

    try {
        const res = await fetch(`${API_BASE}/api/auth/otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        
        if (data.code === 0) {
            // 切換視圖
            const optView = document.getElementById('login-options-view');
            const otpView = document.getElementById('login-otp-view');
            if (optView) { optView.classList.remove('flex'); optView.classList.add('hidden'); }
            if (otpView) { otpView.classList.remove('hidden'); otpView.classList.add('flex'); }
            
            const sentEmailSpan = document.getElementById('otp-sent-email');
            if (sentEmailSpan) sentEmailSpan.textContent = email;
            
            const codeInput = document.getElementById('login-code-input');
            if (codeInput) { codeInput.value = ''; codeInput.focus(); }
        } else {
            if (statusMsg) {
                statusMsg.textContent = data.msg || 'Failed to send OTP';
                statusMsg.classList.remove('hidden');
            }
        }
    } catch (e) {
        if (statusMsg) {
            statusMsg.textContent = 'Network error: ' + e.message;
            statusMsg.classList.remove('hidden');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send Code';
    }
});

(document.getElementById('btn-otp-back') || document.createElement('div')).addEventListener('click', () => {
    const optView = document.getElementById('login-options-view');
    const otpView = document.getElementById('login-otp-view');
    if (otpView) { otpView.classList.remove('flex'); otpView.classList.add('hidden'); }
    if (optView) { optView.classList.remove('hidden'); optView.classList.add('flex'); }
    
    const btnVerify = document.getElementById('btn-verify-otp');
    if (btnVerify) {
        btnVerify.disabled = false;
        btnVerify.textContent = 'VERIFY CODE';
    }
});

(document.getElementById('btn-verify-otp') || document.createElement('div')).addEventListener('click', async () => {
    const email = (document.getElementById('login-email-input') || document.createElement('div')).value.trim();
    const token = (document.getElementById('login-code-input') || document.createElement('div')).value.trim();
    const btn = document.getElementById('btn-verify-otp');
    
    if (!token || token.length < 6) return;

    btn.disabled = true;
    btn.textContent = 'VERIFYING...';
    
    try {
        const res = await fetch(`${API_BASE}/api/auth/otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, token })
        });
        const data = await res.json();
        
        if (data.code === 0 && data.email) {
            btn.textContent = 'SUCCESS!';
            btn.classList.replace('from-[#ef4444]', 'from-green-500');
            btn.classList.replace('to-[#dc2626]', 'to-green-600');
            setTimeout(() => {
                window.loamlabUserEmail = data.email;
                if (window.sketchup) {
                    sketchup.save_email(data.email);
                }
                window.fetchUserPoints(data.email);
                closeLoginModal();
                
                // 恢復按鈕狀態以備下次使用
                setTimeout(() => {
                    btn.classList.replace('from-green-500', 'from-[#ef4444]');
                    btn.classList.replace('to-green-600', 'to-[#dc2626]');
                    btn.textContent = 'VERIFY CODE';
                    btn.disabled = false;
                }, 500);
            }, 800);
        } else {
            alert(data.msg || 'Invalid code');
            btn.disabled = false;
            btn.textContent = 'VERIFY CODE';
        }
    } catch (e) {
        alert('Verification error: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'VERIFY CODE';
    }
});


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

const btnHistory = document.getElementById('btn-history');
if (btnHistory) btnHistory.addEventListener('click', openHistoryModal);
const btnCloseHistory = document.getElementById('btn-close-history');
if (btnCloseHistory) btnCloseHistory.addEventListener('click', closeHistoryModal);
const historyModalEl = document.getElementById('history-modal');
if (historyModalEl) historyModalEl.addEventListener('click', (e) => { if (e.target === historyModalEl) closeHistoryModal(); });

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
        const codeText = (document.getElementById('my-referral-code') || document.createElement('div')).textContent;
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
// =========================================================
// 素材庫 — Material Library (localStorage)
// =========================================================

function saveMaterial(name, thumbnailBase64) {
    const KEY = 'loamlab_materials';
    const isPaid = window.loamlabSubscriptionPlan === 'pro' || window.loamlabSubscriptionPlan === 'studio';
    const maxItems = isPaid ? 200 : 20;
    const item = { id: Date.now().toString(), name, thumbnail: thumbnailBase64, created_at: new Date().toISOString() };
    const materials = JSON.parse(localStorage.getItem(KEY) || '[]');
    materials.unshift(item);
    if (materials.length > maxItems) materials.pop();
    localStorage.setItem(KEY, JSON.stringify(materials));
    if (window.loamlabUserEmail) {
        fetch(`${API_BASE}/api/materials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Email': window.loamlabUserEmail },
            body: JSON.stringify({ id: item.id, name: item.name, thumbnail: item.thumbnail })
        }).catch(() => {});
    }
}

function deleteMaterial(id) {
    const KEY = 'loamlab_materials';
    const materials = JSON.parse(localStorage.getItem(KEY) || '[]');
    localStorage.setItem(KEY, JSON.stringify(materials.filter(m => m.id !== id)));
    renderMaterialLibrary();
    if (window.loamlabUserEmail) {
        fetch(`${API_BASE}/api/materials?id=${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'X-User-Email': window.loamlabUserEmail }
        }).catch(() => {});
    }
}

async function syncMaterialsFromCloud(email) {
    try {
        const res = await fetch(`${API_BASE}/api/materials`, { headers: { 'X-User-Email': email } });
        const data = await res.json();
        if (data.code === 0 && Array.isArray(data.materials) && data.materials.length > 0) {
            localStorage.setItem('loamlab_materials', JSON.stringify(data.materials));
            renderMaterialLibrary();
        }
    } catch (_) {}
}

function translateMaterialPrompt(text) {
    if (!text) return text;
    const dict = {
        '木紋地板': 'seamless wood grain floor texture',
        '大理石': 'marble stone texture',
        '混凝土': 'raw concrete texture',
        '水泥': 'concrete material',
        '磚牆': 'exposed brick wall',
        '磚塊': 'brick texture',
        '石材': 'natural stone texture',
        '金屬': 'metal texture',
        '不銹鋼': 'brushed stainless steel',
        '皮革': 'leather texture',
        '布料': 'fabric texture',
        '絨布': 'velvet fabric',
        '地毯': 'carpet texture',
        '瓷磚': 'ceramic tile',
        '玻璃': 'glass material',
        '藤編': 'rattan woven texture',
        '塑料': 'plastic material',
        '木頭': 'wood texture',
        '白色': 'white',
        '黑色': 'black',
        '灰色': 'gray',
        '米色': 'beige',
        '深色': 'dark',
        '淺色': 'light',
        '牆面': 'wall surface',
        '地板': 'floor',
        '天花板': 'ceiling',
        '沙發': 'sofa',
        '椅子': 'chair',
        '桌子': 'table'
    };
    let result = text;
    for (const [zh, en] of Object.entries(dict)) result = result.replaceAll(zh, en);
    return result;
}

function startExtractMode(imgUrl) {
    // 全螢幕 overlay，讓用戶框選材質區域
    const overlay = document.createElement('div');
    overlay.id = 'extract-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;';
    overlay.innerHTML = `
        <p style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:.1em;text-transform:uppercase;pointer-events:none;">拖拉框選要提取的材質區域　ESC 取消</p>
        <div style="position:relative;display:inline-block;" id="extract-img-wrap">
            <img id="extract-img" src="${imgUrl}" crossorigin="anonymous" style="max-width:90vw;max-height:80vh;display:block;border-radius:8px;" draggable="false">
            <div id="extract-rect" style="position:absolute;border:2px dashed rgba(56,189,248,0.9);background:rgba(56,189,248,0.08);pointer-events:none;display:none;"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const img = overlay.querySelector('#extract-img');
    const rectEl = overlay.querySelector('#extract-rect');
    let startX = 0, startY = 0, drawing = false;

    const getImgRect = () => img.getBoundingClientRect();

    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay || !img.complete) return;
        const r = getImgRect();
        startX = e.clientX - r.left;
        startY = e.clientY - r.top;
        drawing = true;
        rectEl.style.cssText += `;display:block;left:${startX}px;top:${startY}px;width:0;height:0;`;
    });

    overlay.addEventListener('mousemove', (e) => {
        if (!drawing) return;
        const r = getImgRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        const x = Math.min(startX, cx), y = Math.min(startY, cy);
        const w = Math.abs(cx - startX), h = Math.abs(cy - startY);
        rectEl.style.left = x + 'px'; rectEl.style.top = y + 'px';
        rectEl.style.width = w + 'px'; rectEl.style.height = h + 'px';
    });

    overlay.addEventListener('mouseup', (e) => {
        if (!drawing) return;
        drawing = false;
        const r = getImgRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        const x = Math.min(startX, cx), y = Math.min(startY, cy);
        const w = Math.abs(cx - startX), h = Math.abs(cy - startY);
        if (w < 10 || h < 10) return; // 太小忽略
        confirmExtract(imgUrl, { x, y, w, h, imgW: r.width, imgH: r.height });
    });

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

function confirmExtract(imgUrl, rect) {
    const name = window.prompt('為此材質命名：', '未命名材質');
    if (!name) { (document.getElementById('extract-overlay') || document.createElement('div')).remove(); return; }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        // 計算實際像素座標（rect 是 CSS 像素，需換算到圖片原始尺寸）
        const scaleX = img.naturalWidth / rect.imgW;
        const scaleY = img.naturalHeight / rect.imgH;
        const px = rect.x * scaleX, py = rect.y * scaleY;
        const pw = rect.w * scaleX, ph = rect.h * scaleY;

        // 裁切並縮至長邊 128px
        const maxEdge = 128;
        const scale = Math.min(maxEdge / pw, maxEdge / ph, 1);
        const tw = Math.round(pw * scale), th = Math.round(ph * scale);
        const canvas = document.createElement('canvas');
        canvas.width = tw; canvas.height = th;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, px, py, pw, ph, 0, 0, tw, th);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.82);

        saveMaterial(name.trim(), thumbnail);
        (document.getElementById('extract-overlay') || document.createElement('div')).remove();
        showUpdateToast('材質已存入，請在素材庫選取後塗遮罩執行替換');
        openSwapModal(imgUrl, imgUrl);
    };
    img.onerror = () => {
        // CORS 失敗：用純色佔位縮圖
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#334155';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(name.slice(0, 8), 32, 36);
        const thumbnail = canvas.toDataURL('image/png');
        saveMaterial(name.trim(), thumbnail);
        (document.getElementById('extract-overlay') || document.createElement('div')).remove();
        showUpdateToast('材質已存入，請在素材庫選取後塗遮罩執行替換');
        openSwapModal(imgUrl, imgUrl);
    };
    img.src = imgUrl;
}

// =========================================================
// SWAP Modal — 已整合入 Smart Canvas，openSwapModal 重導向
// =========================================================
function openSwapModal(_sketchupImgSrc, renderedImgUrl) {
    openSmartCanvas('', renderedImgUrl);
}

let selectedMaterialName = null;

function renderMaterialLibrary() {
    const grid = document.getElementById('material-library-grid');
    const countEl = document.getElementById('material-count');
    if (!grid) return;
    const materials = JSON.parse(localStorage.getItem('loamlab_materials') || '[]');
    if (countEl) countEl.textContent = `${materials.length} items`;
    if (materials.length === 0) {
        grid.innerHTML = '<p class="col-span-3 text-[10px] text-white/20 text-center py-4 leading-relaxed">尚無素材<br>在渲染圖上點 EXTRACT 提取</p>';
        return;
    }
    grid.innerHTML = materials.map(m => `
        <div class="material-tile group relative cursor-pointer rounded overflow-hidden border-2 border-transparent hover:border-sky-400/60 transition-all"
             data-id="${m.id}" data-name="${m.name.replace(/"/g, '&quot;')}" title="${m.name.replace(/"/g, '&quot;')}">
            <img src="${m.thumbnail}" class="w-full aspect-square object-cover bg-white/5" draggable="false">
            <div class="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-white/70 px-1 py-0.5 truncate leading-tight">${m.name}</div>
            <div class="material-selected-dot hidden absolute top-1 left-1 w-3 h-3 bg-sky-400 rounded-full shadow"></div>
            <button class="mat-del-btn absolute top-0.5 right-0.5 w-4 h-4 bg-red-600/80 hover:bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center z-10 opacity-0 group-hover:opacity-100 transition-opacity" data-id="${m.id}" title="刪除">×</button>
        </div>
    `).join('');
    grid.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.mat-del-btn');
        if (delBtn) { e.stopPropagation(); deleteMaterial(delBtn.getAttribute('data-id')); return; }
        const tile = e.target.closest('.material-tile');
        if (tile) selectMaterialTile(tile);
    });
}

function selectMaterialTile(tile) {
    document.querySelectorAll('.material-tile').forEach(t => {
        t.classList.remove('border-sky-400/60');
        t.querySelector('.material-selected-dot').classList.add('hidden');
    });
    tile.classList.add('border-sky-400/60');
    tile.querySelector('.material-selected-dot').classList.remove('hidden');
    selectedMaterialName = tile.getAttribute('data-name');
    const promptInput = document.getElementById('swap-prompt-input');
    if (promptInput && !promptInput.value.trim()) {
        promptInput.value = selectedMaterialName;
    }
}

function closeSwapModal() {
    // swap-modal 已移除，保留此函數作為向後相容空殼
}
function clearSwapMask() {}
function executeSwap() {}
function renderSwapTags() {}

function appendInpaintResultCard(url, promptText = 'Inpaint Result') {
    const gridEl = document.getElementById('preview-grid');
    if (!gridEl) return;
    const placeholder = document.getElementById('preview-placeholder');
    if (placeholder) placeholder.classList.add('hidden');

    const btnClass = "text-[9px] px-2.5 py-1 rounded border border-white/20 text-white/90 hover:bg-white hover:text-black transition-all font-medium uppercase tracking-widest flex items-center gap-1 active:scale-90 cursor-pointer";
    const card = document.createElement('div');
    card.className = 'relative flex flex-col rounded-xl overflow-hidden border border-sky-500/20 bg-black/60 group/card';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'relative overflow-hidden';
    imgWrap.innerHTML = `
        <div class="absolute top-2 left-2 bg-sky-500 text-white text-[9px] px-2.5 py-1 rounded shadow-lg z-10 font-bold tracking-widest uppercase">SWAPPED</div>
        <img src="${url}" class="w-full object-cover block cursor-zoom-in" onclick="window.open('${url}','_blank')" draggable="false">
    `;

    const footer = document.createElement('div');
    footer.className = 'px-3 py-2 flex justify-between items-center bg-black/50 border-t border-white/5 gap-1';

    const label = document.createElement('span');
    label.className = 'text-[11px] font-semibold text-white/80 tracking-widest truncate max-w-[80px]';
    label.title = promptText;
    label.textContent = promptText.slice(0, 20) || 'SWAPPED';

    const btnContainer = document.createElement('div');
    btnContainer.className = 'flex gap-1 flex-shrink-0';

    const saveBtn = document.createElement('button');
    saveBtn.className = btnClass;
    saveBtn.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg> SAVE`;
    saveBtn.onclick = () => { if (window.sketchup) sketchup.save_image({ url, prompt: promptText, lang: currentLang }); };

    const swapBtn = document.createElement('button');
    swapBtn.className = btnClass;
    swapBtn.textContent = 'SWAP';
    swapBtn.onclick = (e) => { e.stopPropagation(); openSwapModal(url, url); };

    const extractBtn = document.createElement('button');
    extractBtn.className = "text-[9px] px-2.5 py-1 rounded border border-sky-500/30 text-sky-300/80 hover:bg-sky-500/20 hover:text-sky-200 transition-all font-medium uppercase tracking-widest active:scale-90 cursor-pointer";
    extractBtn.textContent = 'EXTRACT';
    extractBtn.onclick = (e) => { e.stopPropagation(); startExtractMode(url); };

    btnContainer.appendChild(saveBtn);
    btnContainer.appendChild(swapBtn);
    btnContainer.appendChild(extractBtn);
    footer.appendChild(label);
    footer.appendChild(btnContainer);
    card.appendChild(imgWrap);
    card.appendChild(footer);
    gridEl.prepend(card);

    const count = gridEl.querySelectorAll('.group\\/card').length;
    if (count === 1) {
        gridEl.className = 'w-full h-full px-6 flex flex-col gap-3 overflow-y-auto custom-scrollbar pb-6 pt-4';
    } else {
        gridEl.className = 'w-full h-full px-6 grid grid-cols-2 gap-3 overflow-y-auto custom-scrollbar pb-6 pt-4 content-start';
        const tool2Card = gridEl.querySelector('[data-tool2-result="true"]');
        if (tool2Card) tool2Card.classList.add('col-span-2');
    }
}

// =============================================================
// Smart Canvas — 智能語義畫布模塊
// =============================================================

const SmartCanvas = {
    renderedUrl: '',       // 渲染結果圖 URL（用於發送 inpaint API）
    channelImgSrc: '',     // 通道圖 base64
    activeTool: 'wand',    // 'wand' | 'brush' | 'eraser'
    regions: [],           // [{ id, maskCanvas, label, color }]
    undoStack: [],         // draw-canvas 快照 ImageData[]
    redoStack: [],         // redo 快照
    hoveredMask: null,     // 當前 wand hover 的 flood fill 遮罩 Uint8Array
    edgeMap: null,         // Sobel 邊緣圖 Uint8Array（init 後計算一次）
    basePixels: null,      // 底圖像素 RGBA Uint8ClampedArray（供色差 flood fill 使用）
    lastWandX: -1, lastWandY: -1,  // 節流：上次 flood fill 座標
    focusedRegionIdx: null, // 快速標籤追加目標的 region index
    activeTagGroup: 'soft', // 當前快速標籤群組
    _lastDrawX: null, _lastDrawY: null,  // 筆刷連線插值用
    brushColor: '#ff6432',
    brushSize: 20,
    isDrawing: false,
    rafPending: false,

    // Canvas & Context 快捷參考（open 時賦值）
    baseImg: null,
    channelCanvas: null, channelCtx: null,
    highlightCanvas: null, highlightCtx: null,
    drawCanvas: null, drawCtx: null,
    canvasW: 0, canvasH: 0,
    pendingSwap: false,    // 已確認選取，等待渲染鍵執行
    baseScene: '',         // 底圖對應的場景名（用於存檔命名）
};

function _scHandleKey(e) {
    const modal = document.getElementById('smart-canvas-modal');
    if (modal.classList.contains('hidden')) return;
    // Alt：啟動筆刷大小調整模式
    if (e.key === 'Alt') { SmartCanvas._altKey = true; e.preventDefault(); return; }
    // 若焦點在文字輸入框，不攔截
    var activeEl = document.activeElement;
    var tag = activeEl ? activeEl.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            var undoBtn = document.getElementById('sc-undo');
            if (undoBtn) undoBtn.click();
            return;
        }
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
            e.preventDefault();
            var redoBtn = document.getElementById('sc-redo');
            if (redoBtn) redoBtn.click();
            return;
        }
    }
    // 工具切換：B=筆刷 E=橡皮擦 W=魔術棒 G=填充
    const toolMap = { b: 'brush', e: 'eraser', w: 'wand', g: 'fill' };
    const tool = toolMap[e.key.toLowerCase()];
    var toolBtn = document.querySelector('.sc-tool-btn[data-tool="' + tool + '"]');
    if (tool && toolBtn) { toolBtn.click(); return; }
    // [ ] 調整筆刷大小
    const sizeEl = document.getElementById('sc-brush-size');
    if (e.key === '[' && sizeEl) { sizeEl.value = Math.max(5, +sizeEl.value - 5); sizeEl.dispatchEvent(new Event('input')); }
    if (e.key === ']' && sizeEl) { sizeEl.value = Math.min(60, +sizeEl.value + 5); sizeEl.dispatchEvent(new Event('input')); }
}

function _scHandlePaste(e) {
    const modal = document.getElementById('smart-canvas-modal');
    if (modal.classList.contains('hidden')) return;
    const items = e.clipboardData.items || [];
    for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;
        const idx = SmartCanvas.focusedRegionIdx || (SmartCanvas.regions.length - 1);
        if (idx < 0) break;
        const reader = new FileReader();
        reader.onload = (ev) => {
            SmartCanvas.regions[idx].refImageBase64 = ev.target.result;
            _scRenderRegionList();
            showUpdateToast('✅ 參考圖已貼上');
        };
        reader.readAsDataURL(file);
        e.preventDefault();
        break;
    }
}

function openSmartCanvas(channelBase64, renderedUrl, sceneName) {
    SmartCanvas.renderedUrl = renderedUrl;
    SmartCanvas.channelImgSrc = channelBase64;
    SmartCanvas.baseScene = sceneName || '';
    SmartCanvas.regions = [];
    SmartCanvas.undoStack = [];
    SmartCanvas.activeTool = 'wand';
    SmartCanvas.hoveredColor = null;
    // 重置顏色到第一個（每次開啟 SmartCanvas 都從橙色重新開始）
    SmartCanvas.brushColor = '#ff6432';
    const _picker = document.getElementById('sc-color-picker');
    if (_picker) _picker.value = '#ff6432';

    if (!SmartCanvas._pasteListenerAdded) {
        document.addEventListener('paste', _scHandlePaste);
        document.addEventListener('keydown', _scHandleKey);
        document.addEventListener('keyup', (e) => { if (e.key === 'Alt') SmartCanvas._altKey = false; });
        SmartCanvas._pasteListenerAdded = true;
    }
    SmartCanvas._altKey = false;
    SmartCanvas._altResizeStartX = null;

    const modal = document.getElementById('smart-canvas-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // 清空區域列表
    _scRenderRegionList();

    // 重置工具按鈕狀態；wand 在 fallback 模式（底圖採樣）也可用
    const wandBtn = document.querySelector('.sc-tool-btn[data-tool="wand"]');
    if (wandBtn) {
        wandBtn.disabled = false;
        wandBtn.style.opacity = '';
        wandBtn.title = channelBase64 ? '魔術棒 (Smart Select)' : '魔術棒 (顏色採樣模式)';
    }
    SmartCanvas.activeTool = 'wand';
    document.querySelectorAll('.sc-tool-btn').forEach(b => b.classList.remove('sc-active'));
    document.querySelector('.sc-tool-btn[data-tool="wand"]').classList.add('sc-active');

    // 載入渲染圖
    SmartCanvas.baseImg = document.getElementById('sc-base-img');
    SmartCanvas.baseImg.onload = () => {
        // rAF 確保 layout 完成後再讀尺寸，避免快取圖片同步觸發 onload 時 getBoundingClientRect 回傳 0
        requestAnimationFrame(() => {
            const w = SmartCanvas.baseImg.naturalWidth;
            const h = SmartCanvas.baseImg.naturalHeight;
            const rect = SmartCanvas.baseImg.getBoundingClientRect();
            const dw = Math.round(rect.width)  || w;
            const dh = Math.round(rect.height) || h;
            SmartCanvas.canvasW = dw;
            SmartCanvas.canvasH = dh;
            _scInitCanvases(dw, dh, channelBase64);
            _scBindEvents();
        });
    };
    SmartCanvas.renderedUrl = renderedUrl;
    SmartCanvas.baseImg.src = renderedUrl;
}

function _scInitCanvases(w, h, channelBase64) {
    ['sc-channel-canvas', 'sc-highlight-canvas', 'sc-draw-canvas'].forEach(id => {
        const c = document.getElementById(id);
        c.width = w; c.height = h;
        c.style.width = w + 'px'; c.style.height = h + 'px';
    });

    SmartCanvas.channelCanvas = document.getElementById('sc-channel-canvas');
    SmartCanvas.channelCtx    = SmartCanvas.channelCanvas.getContext('2d');
    SmartCanvas.highlightCanvas = document.getElementById('sc-highlight-canvas');
    SmartCanvas.highlightCtx    = SmartCanvas.highlightCanvas.getContext('2d');
    SmartCanvas.drawCanvas = document.getElementById('sc-draw-canvas');
    SmartCanvas.drawCtx    = SmartCanvas.drawCanvas.getContext('2d');

    // 清空 draw/highlight canvas
    SmartCanvas.highlightCtx.clearRect(0, 0, w, h);
    SmartCanvas.drawCtx.clearRect(0, 0, w, h);

    // 將通道圖繪入隱藏 canvas（供像素採樣）
    if (channelBase64) {
        const img = new Image();
        img.onload = () => SmartCanvas.channelCtx.drawImage(img, 0, 0, w, h);
        img.src = channelBase64;
    }

    // 預計算 Sobel 邊緣圖（供 wand flood fill 使用）
    SmartCanvas.edgeMap = null;
    SmartCanvas.hoveredMask = null;
    SmartCanvas.lastWandX = -1; SmartCanvas.lastWandY = -1;
    if (SmartCanvas.baseImg && SmartCanvas.baseImg.complete) {
        SmartCanvas.edgeMap = _scComputeEdgeMap();
    } else {
        SmartCanvas.baseImg.addEventListener('load', () => {
            SmartCanvas.edgeMap = _scComputeEdgeMap();
        }, { once: true });
    }
}

function _scGetXY(e) {
    const rect = SmartCanvas.drawCanvas.getBoundingClientRect();
    const scaleX = SmartCanvas.canvasW / rect.width;
    const scaleY = SmartCanvas.canvasH / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: Math.round((clientX - rect.left) * scaleX),
        y: Math.round((clientY - rect.top)  * scaleY)
    };
}

function _scColorEquals(a, b, tol = 20) {
    if (!a || !b) return false;
    return Math.abs(a[0]-b[0]) < tol && Math.abs(a[1]-b[1]) < tol && Math.abs(a[2]-b[2]) < tol;
}

function _scHighlightByColor([r, g, b]) {
    // 先重繪持久 region 遮罩，再將 hover highlight 疊加在上方
    _scRenderOverlays();
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const src = SmartCanvas.channelCtx.getImageData(0, 0, w, h);
    const hoverCanvas = document.createElement('canvas');
    hoverCanvas.width = w; hoverCanvas.height = h;
    const hCtx = hoverCanvas.getContext('2d');
    const dst = hCtx.createImageData(w, h);
    const TOL = 18;
    for (let i = 0; i < src.data.length; i += 4) {
        if (Math.abs(src.data[i]-r) < TOL &&
            Math.abs(src.data[i+1]-g) < TOL &&
            Math.abs(src.data[i+2]-b) < TOL) {
            dst.data[i] = 80; dst.data[i+1] = 170; dst.data[i+2] = 255; dst.data[i+3] = 110;
        }
    }
    hCtx.putImageData(dst, 0, 0);
    SmartCanvas.highlightCtx.drawImage(hoverCanvas, 0, 0);
}

function _scBuildMaskFromColor([r, g, b]) {
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const src = SmartCanvas.channelCtx.getImageData(0, 0, w, h);
    const dst = ctx.createImageData(w, h);
    const TOL = 18;
    for (let i = 0; i < src.data.length; i += 4) {
        const match = Math.abs(src.data[i]-r) < TOL &&
                      Math.abs(src.data[i+1]-g) < TOL &&
                      Math.abs(src.data[i+2]-b) < TOL;
        dst.data[i] = 255; dst.data[i+1] = 255; dst.data[i+2] = 255;
        dst.data[i+3] = match ? 255 : 0;
    }
    ctx.putImageData(dst, 0, 0);
    return canvas;
}

function _scMergeMaskFromDraw() {
    // 從 draw canvas 提取遮罩：有筆刷的區域 alpha=255，其餘 alpha=0（透明）
    // 必須用 alpha=0 而非黑色像素，_scRenderOverlays 的 destination-in 才能正確裁切
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const src = SmartCanvas.drawCtx.getImageData(0, 0, w, h);
    const dst = ctx.createImageData(w, h);
    for (let i = 0; i < src.data.length; i += 4) {
        const painted = src.data[i+3] > 20;
        dst.data[i] = 255; dst.data[i+1] = 255; dst.data[i+2] = 255;
        dst.data[i+3] = painted ? 255 : 0;
    }
    ctx.putImageData(dst, 0, 0);
    return canvas;
}

// Sobel 邊緣偵測：對底圖灰階化後計算梯度，返回 Uint8Array（255=邊緣, 0=非邊緣）
function _scComputeEdgeMap() {
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tCtx = tmp.getContext('2d');
    tCtx.drawImage(SmartCanvas.baseImg, 0, 0, w, h);
    const imgData = tCtx.getImageData(0, 0, w, h);
    const data = imgData.data;
    SmartCanvas.basePixels = data; // 供 flood fill 色差比對
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        gray[p] = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    }
    const THRESHOLD = 25;
    const edges = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const gx = -gray[(y-1)*w+(x-1)] - 2*gray[y*w+(x-1)] - gray[(y+1)*w+(x-1)]
                      + gray[(y-1)*w+(x+1)] + 2*gray[y*w+(x+1)] + gray[(y+1)*w+(x+1)];
            const gy = -gray[(y-1)*w+(x-1)] - 2*gray[(y-1)*w+x] - gray[(y-1)*w+(x+1)]
                      + gray[(y+1)*w+(x-1)] + 2*gray[(y+1)*w+x] + gray[(y+1)*w+(x+1)];
            edges[y*w+x] = (Math.sqrt(gx*gx + gy*gy) > THRESHOLD) ? 255 : 0;
        }
    }
    return edges;
}

// BFS flood fill：從 (startX, startY) 開始，遇邊緣或色差過大時停止
// 雙重停止條件：Sobel 邊緣 + 與起始點的 RGB 歐氏距離 > 50（Photoshop Magic Wand 邏輯）
function _scFloodFill(startX, startY) {
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const edges = SmartCanvas.edgeMap;
    const pixels = SmartCanvas.basePixels;
    if (!edges) return null;
    const mask = new Uint8Array(w * h);
    const visited = new Uint8Array(w * h);
    const startIdx = startY * w + startX;
    if (startIdx < 0 || startIdx >= w * h) return mask;
    if (edges[startIdx]) return mask; // 點在邊線上，返回空遮罩
    // 採樣起始點顏色
    const COLOR_TOL_SQ = 12000; // ~110 combined（≈63 per channel），讓光影漸層連通
    const sr = pixels ? pixels[startIdx * 4]     : 0;
    const sg = pixels ? pixels[startIdx * 4 + 1] : 0;
    const sb = pixels ? pixels[startIdx * 4 + 2] : 0;
    const stack = [startIdx];
    visited[startIdx] = 1; mask[startIdx] = 1;
    const dirs = [-1, 1, -w, w];
    while (stack.length > 0) {
        const idx = stack.pop();
        const x = idx % w;
        for (const d of dirs) {
            if (d === -1 && x === 0) continue;
            if (d ===  1 && x === w - 1) continue;
            const nIdx = idx + d;
            if (nIdx < 0 || nIdx >= w * h) continue;
            if (visited[nIdx] || edges[nIdx]) continue;
            // 色差停止：與起始點 RGB 距離超過容差則不蔓延
            if (pixels) {
                const dr = pixels[nIdx * 4]     - sr;
                const dg = pixels[nIdx * 4 + 1] - sg;
                const db = pixels[nIdx * 4 + 2] - sb;
                if (dr * dr + dg * dg + db * db > COLOR_TOL_SQ) continue;
            }
            visited[nIdx] = 1; mask[nIdx] = 1;
            stack.push(nIdx);
        }
    }
    return mask;
}

// Uint8Array 遮罩 → canvas（painted 區域 alpha=255，其餘 alpha=0）
function _scMaskArrayToCanvas(mask) {
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
        imgData.data[i*4] = 255; imgData.data[i*4+1] = 255; imgData.data[i*4+2] = 255;
        imgData.data[i*4+3] = mask[i] ? 255 : 0;
    }
    ctx.putImageData(imgData, 0, 0);
    return c;
}

// 產生 annotated composite：底圖 + 各區域彩色疊加層（用於送 Coze）
function _scCreateAnnotatedComposite() {
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(SmartCanvas.baseImg, 0, 0, w, h);
    for (const region of SmartCanvas.regions) {
        const tint = document.createElement('canvas');
        tint.width = w; tint.height = h;
        const tCtx = tint.getContext('2d');
        tCtx.drawImage(region.maskCanvas, 0, 0);
        tCtx.globalCompositeOperation = 'source-in';
        tCtx.fillStyle = region.colorHex || '#ff6432';
        tCtx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(tint, 0, 0);
        ctx.globalAlpha = 1;
    }
    return c;
}

// Flood fill hover 高亮（疊加在持久 region overlays 上方）
function _scHighlightByFloodFill(mask) {
    _scRenderOverlays(); // 先保留持久 region 遮罩
    if (!mask) return;
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const hC = document.createElement('canvas');
    hC.width = w; hC.height = h;
    const hCtx = hC.getContext('2d');
    const dst = hCtx.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) {
            dst.data[i*4] = 80; dst.data[i*4+1] = 170;
            dst.data[i*4+2] = 255; dst.data[i*4+3] = 100;
        }
    }
    hCtx.putImageData(dst, 0, 0);
    SmartCanvas.highlightCtx.drawImage(hC, 0, 0);
}

function _scSaveUndo() {
    // 深拷貝 maskCanvas（淺拷貝會導致後續 drawImage 修改到快照）
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const snap = {
        canvas: SmartCanvas.drawCtx.getImageData(0, 0, w, h),
        regions: SmartCanvas.regions.map(r => {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(r.maskCanvas, 0, 0);
            return { ...r, maskCanvas: c };
        })
    };
    SmartCanvas.undoStack.push(snap);
    if (SmartCanvas.undoStack.length > 20) SmartCanvas.undoStack.shift();
    SmartCanvas.redoStack = [];
}

// 從底圖採樣 region 的平均代表色（用於 prompt 提示 Coze/Banana2 當前顏色）
function _scSampleBaseColor(maskCanvas) {
    try {
        const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        tmp.getContext('2d').drawImage(SmartCanvas.baseImg, 0, 0, w, h);
        const baseData = tmp.getContext('2d').getImageData(0, 0, w, h).data;
        const maskData = maskCanvas.getContext('2d').getImageData(0, 0, w, h).data;
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let i = 0; i < maskData.length; i += 4) {
            if (maskData[i+3] > 128) {
                rSum += baseData[i]; gSum += baseData[i+1]; bSum += baseData[i+2];
                count++;
            }
        }
        if (count === 0) return null;
        const toHex = v => Math.round(v / count).toString(16).padStart(2, '0');
        return `#${toHex(rSum)}${toHex(gSum)}${toHex(bSum)}`;
    } catch (_) { return null; }
}

// 區域遮罩持久疊加層：每次 regions 變動後重繪 highlight canvas
function _scRenderOverlays() {
    if (!SmartCanvas.highlightCtx) return;
    SmartCanvas.highlightCtx.clearRect(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH);
    SmartCanvas.regions.forEach(r => {
        const tmp = document.createElement('canvas');
        tmp.width = SmartCanvas.canvasW; tmp.height = SmartCanvas.canvasH;
        const tCtx = tmp.getContext('2d');
        tCtx.fillStyle = r.colorHex || '#ff6432';
        tCtx.fillRect(0, 0, tmp.width, tmp.height);
        tCtx.globalCompositeOperation = 'destination-in';
        tCtx.drawImage(r.maskCanvas, 0, 0, tmp.width, tmp.height);
        SmartCanvas.highlightCtx.globalAlpha = 0.45;
        SmartCanvas.highlightCtx.drawImage(tmp, 0, 0);
    });
    SmartCanvas.highlightCtx.globalAlpha = 1;
}

function _scShowLabelPopup(clientX, clientY, onConfirm) {
    const popup = document.getElementById('sc-label-popup');
    const input = document.getElementById('sc-label-input');
    if (!popup || !input) return;

    input.value = '';
    popup.style.left = Math.min(clientX, window.innerWidth - 260) + 'px';
    popup.style.top  = Math.max(clientY - 60, 10) + 'px';
    popup.classList.remove('hidden');
    input.focus();

    const confirm = () => {
        popup.classList.add('hidden');
        document.getElementById('sc-label-confirm').onclick = null;
        document.getElementById('sc-label-cancel').onclick = null;
        input.onkeydown = null;
        onConfirm(input.value.trim());
    };
    const cancel = () => {
        popup.classList.add('hidden');
        document.getElementById('sc-label-confirm').onclick = null;
        document.getElementById('sc-label-cancel').onclick = null;
        input.onkeydown = null;
    };

    document.getElementById('sc-label-confirm').onclick = confirm;
    document.getElementById('sc-label-cancel').onclick = cancel;
    input.onkeydown = (e) => {
        if (e.key === 'Enter') confirm();
        if (e.key === 'Escape') cancel();
    };
}

function _scRenderRegionList() {
    const list = document.getElementById('sc-region-list');
    const empty = document.getElementById('sc-region-empty');
    if (!list) return;
    // 清除舊的卡片與「＋」按鈕（保留 empty 文字）
    list.querySelectorAll('.sc-region-card, .sc-add-region-btn').forEach(el => el.remove());

    if (SmartCanvas.regions.length === 0) {
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';

    SmartCanvas.regions.forEach((region, idx) => {
        const hasRef = !!region.refImageBase64;
        const card = document.createElement('div');
        card.className = 'sc-region-card';
        card.innerHTML = `
            <div class="flex items-center gap-2">
                <div class="sc-region-swatch" style="background:${region.colorHex || '#ff6432'}"></div>
                <span class="text-[10px] text-white/50 font-semibold uppercase tracking-wide">區域 ${idx + 1}</span>
                <label class="ml-auto cursor-pointer text-[10px] px-1.5 py-0.5 rounded border ${hasRef ? 'border-[#ff6432]/60 text-[#ff6432]' : 'border-white/15 text-white/30'} hover:border-[#ff6432]/60 hover:text-[#ff6432] transition-all" title="${hasRef ? '已附加參考圖 (Ctrl+V 可替換)' : '附加參考圖'}">
                    ${hasRef ? '🖼' : '📎'}<input type="file" accept="image/*" class="hidden sc-ref-file-input" />
                </label>
                ${hasRef ? `<img src="${region.refImageBase64}" class="w-6 h-6 object-cover rounded border border-[#ff6432]/30 flex-shrink-0 cursor-pointer sc-ref-clear" title="點擊移除參考圖" />` : ''}
                <button class="text-white/20 hover:text-rose-400 text-[11px] leading-none sc-del-btn">✕</button>
            </div>
            <input type="text" class="sc-region-label-input w-full bg-transparent border-b border-white/10 text-[11px] text-white/80 outline-none placeholder-white/25 pb-0.5 mt-1"
                value="${region.label || ''}" placeholder="描述替換內容（可選）..." />
        `;
        // 點擊任意卡片區域即更新焦點 index（供 Ctrl+V 貼圖使用）
        card.addEventListener('mousedown', () => { SmartCanvas.focusedRegionIdx = idx; });
        card.querySelector('.sc-del-btn').onclick = () => {
            SmartCanvas.regions.splice(idx, 1);
            _scRenderRegionList();
            _scRenderOverlays();
        };
        card.querySelector('.sc-region-label-input').oninput = (e) => {
            SmartCanvas.regions[idx].label = e.target.value;
        };
        card.querySelector('.sc-ref-file-input').addEventListener('change', (e) => {
            var fileArr = e.target.files;
            const file = (fileArr && fileArr.length > 0) ? fileArr[0] : null;
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                SmartCanvas.regions[idx].refImageBase64 = ev.target.result;
                _scRenderRegionList();
            };
            reader.readAsDataURL(file);
        });
        var scRefClear = card.querySelector('.sc-ref-clear');
        if (scRefClear) {
            scRefClear.addEventListener('click', function(e) {
                e.stopPropagation();
                SmartCanvas.regions[idx].refImageBase64 = null;
                _scRenderRegionList();
            });
        }
        list.appendChild(card);
    });

    // 「＋ 新增描述區」按鈕：點擊後換到下一個顏色，用戶主動觸發
    if (SmartCanvas.regions.length > 0) {
        const addBtn = document.createElement('button');
        addBtn.className = 'sc-add-region-btn w-full mt-1 py-1.5 rounded-lg border border-dashed border-white/15 text-[10px] text-white/30 hover:border-[#ff6432]/50 hover:text-[#ff6432]/70 transition-all';
        addBtn.textContent = '＋ 新增描述區（換色）';
        addBtn.onclick = () => {
            // 清除 drawCanvas 上的未提交筆跡，避免干擾新區域
            if (SmartCanvas.drawCtx) SmartCanvas.drawCtx.clearRect(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH);
            _scPickNextColor();
            showUpdateToast('已換色，開始繪製下一個區域');
        };
        list.appendChild(addBtn);
    }

    // 綁定 label input focus → 更新 focusedRegionIdx（供快速標籤使用）
    list.querySelectorAll('.sc-region-label-input').forEach((input, idx) => {
        input.addEventListener('focus', () => { SmartCanvas.focusedRegionIdx = idx; });
    });

    // 快速標籤區：有 region 才顯示
    const tagSection = document.getElementById('sc-tag-section');
    if (tagSection) tagSection.classList.toggle('hidden', SmartCanvas.regions.length === 0);
    scSetTagGroup(SmartCanvas.activeTagGroup || 'soft');
}

// 自動選取與現有區域顏色差異最大的顏色，並同步 color-picker UI
function _scPickNextColor() {
    const palette = ['#ff6432', '#4f7eff', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#84cc16'];
    const used = new Set(SmartCanvas.regions.map(r => (r.colorHex || '').toLowerCase()));
    const next = palette.find(c => !used.has(c.toLowerCase())) || palette[SmartCanvas.regions.length % palette.length];
    SmartCanvas.brushColor = next;
    const picker = document.getElementById('sc-color-picker');
    if (picker) picker.value = next;
}

// Smart Canvas 快速標籤：複用 SWAP_TAG_GROUPS，點擊追加到 focusedRegionIdx 的 label
function scSetTagGroup(groupKey) {
    SmartCanvas.activeTagGroup = groupKey;
    const container = document.getElementById('sc-tags-container');
    if (!container) return;
    const group = SWAP_TAG_GROUPS[groupKey];
    if (!group) return;

    const tagCls = 'text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-black/40 border border-white/10 text-white/50 hover:text-white hover:bg-white/10 cursor-pointer transition-all select-none';
    container.innerHTML = group.tags.map(t =>
        `<span class="${tagCls}" data-tag="${t.tag}">${t.label}</span>`
    ).join('');
    container.querySelectorAll('[data-tag]').forEach(span => {
        span.addEventListener('click', () => {
            const idx = (SmartCanvas.focusedRegionIdx !== undefined && SmartCanvas.focusedRegionIdx !== null) ? SmartCanvas.focusedRegionIdx : (SmartCanvas.regions.length - 1);
            const region = SmartCanvas.regions[idx];
            if (!region || region.inputMode === 'image') return;
            const val = span.getAttribute('data-tag');
            region.label = (region.label ? region.label.trim() + ', ' : '') + val;
            // 同步更新 DOM 輸入框
            const inputs = document.querySelectorAll('#sc-region-list .sc-region-label-input');
            if (inputs[idx]) inputs[idx].value = region.label;
        });
    });

    // 更新 group 按鈕 active 狀態
    document.querySelectorAll('.sc-tag-group-btn[data-group]').forEach(btn => {
        const active = btn.dataset.group === groupKey;
        btn.className = `sc-tag-group-btn text-[9px] px-1.5 py-0.5 rounded border transition-all ${
            active ? 'border-amber-500/40 text-amber-300/70' : 'border-white/10 text-white/30 hover:text-white/60'
        }`;
    });
}

function _scBindEvents() {
    const dc = SmartCanvas.drawCanvas;
    // 解除舊的 listeners（簡單起見：clone & replace）
    const fresh = dc.cloneNode(true);
    dc.parentNode.replaceChild(fresh, dc);
    SmartCanvas.drawCanvas = fresh;
    SmartCanvas.drawCtx = fresh.getContext('2d');

    // --- 魔術棒：hover 邊緣感知 flood fill 高亮 ---
    fresh.addEventListener('mousemove', (e) => {
        if (SmartCanvas.activeTool !== 'wand') {
            if (SmartCanvas.isDrawing) _scDraw(e);
            return;
        }
        if (SmartCanvas.rafPending) return;
        SmartCanvas.rafPending = true;
        requestAnimationFrame(() => {
            SmartCanvas.rafPending = false;
            const { x, y } = _scGetXY(e);
            // 移動 > 3px 才重算 flood fill（節流）
            if (Math.abs(x - SmartCanvas.lastWandX) > 3 || Math.abs(y - SmartCanvas.lastWandY) > 3) {
                SmartCanvas.lastWandX = x; SmartCanvas.lastWandY = y;
                SmartCanvas.hoveredMask = _scFloodFill(x, y);
                _scHighlightByFloodFill(SmartCanvas.hoveredMask);
            }
        });
    });

    fresh.addEventListener('mouseleave', () => {
        SmartCanvas.hoveredMask = null;
        SmartCanvas.lastWandX = -1; SmartCanvas.lastWandY = -1;
        _scRenderOverlays();
    });

    // --- 魔術棒 click → 選取區域 → 彈出 label ---
    fresh.addEventListener('click', () => {
        if (SmartCanvas.activeTool !== 'wand') return;
        // 確認有有效遮罩（非空）
        if (!SmartCanvas.hoveredMask || !SmartCanvas.hoveredMask.some(v => v)) return;
        _scSaveUndo();
        const maskCanvas = _scMaskArrayToCanvas(SmartCanvas.hoveredMask);
        const _we = SmartCanvas.regions.find(r => r.colorHex === SmartCanvas.brushColor);
        if (_we) { _we.maskCanvas.getContext('2d').drawImage(maskCanvas, 0, 0); }
        else { SmartCanvas.regions.push({ id: Date.now(), maskCanvas, label: '', colorHex: SmartCanvas.brushColor }); }
        _scRenderRegionList();
        _scRenderOverlays();
        // 自動 focus 最新區域的 label 輸入框（右側面板）
        requestAnimationFrame(() => {
            const inputs = document.querySelectorAll('#sc-region-list .sc-region-label-input');
            if (inputs.length) inputs[inputs.length - 1].focus();
        });
    });

    // --- 填充桶：click → flood fill ---
    // _scFillBucketDraw 返回 true = Case A（填充了 drawCanvas，需建立新 region）
    //                        false = Case B（已合併進現有 region，不需再建）
    fresh.addEventListener('mousedown', (e) => {
        if (SmartCanvas.activeTool !== 'fill') return;
        _scSaveUndo();
        const { x, y } = _scGetXY(e);
        const needNewRegion = _scFillBucketDraw(x, y);
        if (needNewRegion) {
            const maskCanvas = _scMergeMaskFromDraw();
            if (maskCanvas) {
                const _fe = SmartCanvas.regions.find(r => r.colorHex === SmartCanvas.brushColor);
                if (_fe) { _fe.maskCanvas.getContext('2d').drawImage(maskCanvas, 0, 0); }
                else { SmartCanvas.regions.push({ id: Date.now(), maskCanvas, label: '', colorHex: SmartCanvas.brushColor }); }
                _scRenderRegionList();
            }
            SmartCanvas.drawCtx.clearRect(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH);
            _scRenderOverlays();
        }
    });

    // --- 筆刷 / 橡皮擦 繪製 ---
    fresh.addEventListener('mousedown', (e) => {
        if (SmartCanvas.activeTool === 'wand' || SmartCanvas.activeTool === 'fill') return;
        SmartCanvas.isDrawing = true;
        SmartCanvas._hasDragged = false;  // 重置拖曳旗標
        SmartCanvas._lastDrawX = null;
        SmartCanvas._lastDrawY = null;
        _scSaveUndo();
        _scDraw(e);
    });
    fresh.addEventListener('mouseup', () => {
        if (!SmartCanvas.isDrawing) return;
        SmartCanvas.isDrawing = false;
        SmartCanvas._lastDrawX = null;
        SmartCanvas._lastDrawY = null;
        SmartCanvas._altResizeStartX = null; // 結束 Alt resize
        if (SmartCanvas.activeTool === 'brush') {
            // 只有實際拖曳過才提交為 region（防止單次點擊產生空 region）
            if (SmartCanvas._hasDragged) {
                const maskCanvas = _scMergeMaskFromDraw();
                const _be = SmartCanvas.regions.find(r => r.colorHex === SmartCanvas.brushColor);
                if (_be) { _be.maskCanvas.getContext('2d').drawImage(maskCanvas, 0, 0); }
                else { SmartCanvas.regions.push({ id: Date.now(), maskCanvas, label: '', colorHex: SmartCanvas.brushColor }); }
                _scRenderRegionList();
            }
            SmartCanvas.drawCtx.clearRect(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH);
            _scRenderOverlays();
        } else if (SmartCanvas.activeTool === 'eraser') {
            if (SmartCanvas._hasDragged) {
                // 把 drawCtx 上的白色筆跡當成遮罩，destination-out 到各 region
                SmartCanvas.regions.forEach(r => {
                    const rCtx = r.maskCanvas.getContext('2d');
                    rCtx.globalCompositeOperation = 'destination-out';
                    rCtx.drawImage(SmartCanvas.drawCtx.canvas, 0, 0);
                    rCtx.globalCompositeOperation = 'source-over';
                });
                // 移除已被完全擦除的空 region
                SmartCanvas.regions = SmartCanvas.regions.filter(r => {
                    const d = r.maskCanvas.getContext('2d').getImageData(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH).data;
                    return d.some((v, i) => (i % 4 === 3) && v > 0);
                });
                _scRenderRegionList();
            }
            SmartCanvas.drawCtx.clearRect(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH);
            _scRenderOverlays();
        }
    });
    fresh.addEventListener('mousemove', (e) => {
        // Alt + 拖曳：水平移動調整筆刷大小（PS 同款體驗）
        if (SmartCanvas._altKey && SmartCanvas.isDrawing) {
            if (SmartCanvas._altResizeStartX === null) {
                SmartCanvas._altResizeStartX = e.clientX;
                SmartCanvas._altResizeStartSize = SmartCanvas.brushSize;
            }
            const delta = e.clientX - SmartCanvas._altResizeStartX;
            const newSize = Math.max(5, Math.min(60, SmartCanvas._altResizeStartSize + Math.round(delta * 0.4)));
            SmartCanvas.brushSize = newSize;
            const sizeEl = document.getElementById('sc-brush-size');
            if (sizeEl) sizeEl.value = newSize;
            return;
        }
        if (SmartCanvas.activeTool !== 'wand' && SmartCanvas.isDrawing) {
            SmartCanvas._hasDragged = true;  // 有移動才算拖曳
            _scDraw(e);
        }
    });
}

// 填充桶核心：給定邊界 boundary（Uint8Array），從 (sx,sy) BFS fill
// 返回 filled Uint8Array，或 null（滲漏）
function _scBfsFill(sx, sy, boundary, w, h) {
    if (boundary[sy * w + sx]) return null;
    const filled = new Uint8Array(w * h);
    const stack = [sy * w + sx];
    const visited = new Uint8Array(w * h);
    const MAX_FILL = w * h * 0.7;
    let count = 0;
    while (stack.length) {
        const pos = stack.pop();
        if (visited[pos] || boundary[pos]) continue;
        visited[pos] = 1;
        filled[pos] = 1;
        if (++count > MAX_FILL) return null; // 滲漏
        const px = pos % w, py = Math.floor(pos / w);
        if (px > 0)     stack.push(pos - 1);
        if (px < w - 1) stack.push(pos + 1);
        if (py > 0)     stack.push(pos - w);
        if (py < h - 1) stack.push(pos + w);
    }
    return filled;
}

// 膨脹像素集合，封閉筆觸間隙
function _scDilateMask(sourceData, w, h, r) {
    const boundary = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        if (sourceData[i * 4 + 3] > 10) {
            const bx = i % w, by = Math.floor(i / w);
            const x0 = Math.max(0, bx - r), x1 = Math.min(w - 1, bx + r);
            const y0 = Math.max(0, by - r), y1 = Math.min(h - 1, by + r);
            for (let ny = y0; ny <= y1; ny++)
                for (let nx = x0; nx <= x1; nx++)
                    boundary[ny * w + nx] = 1;
        }
    }
    return boundary;
}

// 填充桶主函數
// 情況A：drawCanvas 有未提交的筆觸 → 填充並建立新 region
// 情況B：drawCanvas 為空（筆刷已建立 region）→ 以現有 region masks 為邊界填充，並擴充最近的 region
function _scFillBucketDraw(startX, startY) {
    const w = SmartCanvas.canvasW, h = SmartCanvas.canvasH;
    const sx = Math.floor(startX), sy = Math.floor(startY);
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;

    const drawImgData = SmartCanvas.drawCtx.getImageData(0, 0, w, h);
    const drawData = drawImgData.data;
    let hasStrokes = false;
    for (let i = 0; i < w * h && !hasStrokes; i++)
        if (drawData[i * 4 + 3] > 10) hasStrokes = true;

    if (hasStrokes) {
        // 情況A：填充 drawCanvas 輪廓內部 → 呼叫方需建立新 region，回傳 true
        if (drawData[(sy * w + sx) * 4 + 3] > 10) return false;
        const boundary = _scDilateMask(drawData, w, h, 4);
        const filled = _scBfsFill(sx, sy, boundary, w, h);
        if (!filled) { showUpdateToast('輪廓未閉合，請確認圈圈有畫完整再填充'); return false; }
        const hex = SmartCanvas.brushColor.replace('#', '');
        const fr = parseInt(hex.slice(0, 2), 16), fg = parseInt(hex.slice(2, 4), 16), fb = parseInt(hex.slice(4, 6), 16);
        for (let i = 0; i < w * h; i++) {
            if (filled[i] && drawData[i * 4 + 3] <= 10) {
                drawData[i*4] = fr; drawData[i*4+1] = fg; drawData[i*4+2] = fb; drawData[i*4+3] = 255;
            }
        }
        SmartCanvas.drawCtx.putImageData(drawImgData, 0, 0);
        return true; // 通知呼叫方建立新 region
    }

    // 情況B：drawCanvas 空，以現有 region masks 為邊界
    if (!SmartCanvas.regions.length) return false;

    // 合併所有 region masks 建立邊界（膨脹 4px 封閉間隙）
    const combined = new Uint8Array(w * h * 4); // RGBA buffer
    for (const region of SmartCanvas.regions) {
        const rImgData = region.maskCanvas.getContext('2d').getImageData(0, 0, w, h);
        for (let i = 0; i < w * h; i++) {
            if (rImgData.data[i * 4 + 3] > 10) {
                combined[i * 4 + 3] = 255; // 標記為已畫
            }
        }
    }
    const DILATE = 4;
    const boundary = _scDilateMask(combined, w, h, DILATE);
    const filled = _scBfsFill(sx, sy, boundary, w, h);
    if (!filled) { showUpdateToast('輪廓未閉合，請確認圈圈有畫完整再填充'); return false; }

    // 補回 dilation 空隙：把 filled 向 boundary 區擴散，填滿 stroke 與 fill 之間的 gap
    // 使用 BFS 在 boundary 區內從 filled 邊界向外擴張
    const gapClosed = new Uint8Array(w * h);
    const gapStack = [];
    for (let i = 0; i < w * h; i++) {
        if (filled[i]) { gapClosed[i] = 1; gapStack.push(i); }
    }
    while (gapStack.length) {
        const pos = gapStack.pop();
        const px = pos % w, py = Math.floor(pos / w);
        const neighbors = [
            px > 0     ? pos - 1 : -1,
            px < w - 1 ? pos + 1 : -1,
            py > 0     ? pos - w : -1,
            py < h - 1 ? pos + w : -1,
        ];
        for (const n of neighbors) {
            if (n >= 0 && !gapClosed[n] && boundary[n]) {
                gapClosed[n] = 1;
                gapStack.push(n);
            }
        }
    }

    // 找最多邊界像素鄰接的 region（最可能是輪廓來源）
    let bestRegion = SmartCanvas.regions[SmartCanvas.regions.length - 1];
    let bestScore = -1;
    for (const region of SmartCanvas.regions) {
        const rd = region.maskCanvas.getContext('2d').getImageData(0, 0, w, h).data;
        let score = 0;
        for (let i = 0; i < w * h; i++) {
            if (!gapClosed[i]) continue;
            const px = i % w, py = Math.floor(i / w);
            if (px > 0 && rd[(i-1)*4+3] > 10) score++;
            if (px < w-1 && rd[(i+1)*4+3] > 10) score++;
            if (py > 0 && rd[(i-w)*4+3] > 10) score++;
            if (py < h-1 && rd[(i+w)*4+3] > 10) score++;
        }
        if (score > bestScore) { bestScore = score; bestRegion = region; }
    }

    // 把填充（含補回的 gap 區域）合併進 bestRegion 的 maskCanvas
    const rCtx = bestRegion.maskCanvas.getContext('2d');
    const rImgData = rCtx.getImageData(0, 0, w, h);
    const rData = rImgData.data;
    for (let i = 0; i < w * h; i++) {
        if (gapClosed[i]) {
            rData[i*4] = 255; rData[i*4+1] = 255; rData[i*4+2] = 255; rData[i*4+3] = 255;
        }
    }
    rCtx.putImageData(rImgData, 0, 0);
    _scRenderOverlays();
    return false; // Case B：已合併進現有 region，不需建立新 region
}

function _scDraw(e) {
    const { x, y } = _scGetXY(e);
    const ctx = SmartCanvas.drawCtx;
    const isEraser = SmartCanvas.activeTool === 'eraser';
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = SmartCanvas.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 橡皮擦用半透明白色在 drawCtx 上預覽，mouseup 時再 destination-out 到 regions
    ctx.strokeStyle = isEraser ? 'rgba(255,255,255,0.6)' : SmartCanvas.brushColor;
    ctx.fillStyle   = isEraser ? 'rgba(255,255,255,0.6)' : SmartCanvas.brushColor;

    if (SmartCanvas._lastDrawX === null) {
        // 第一個點：單點補全
        ctx.beginPath();
        ctx.arc(x, y, SmartCanvas.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(SmartCanvas._lastDrawX, SmartCanvas._lastDrawY);
        ctx.lineTo(x, y);
        ctx.stroke();
    }
    SmartCanvas._lastDrawX = x;
    SmartCanvas._lastDrawY = y;
    ctx.globalCompositeOperation = 'source-over';
}

function _scUpdatePendingIndicator() {
    const ind = document.getElementById('sc-pending-indicator');
    const lbl = document.getElementById('sc-pending-label');
    if (!ind) return;
    if (SmartCanvas.pendingSwap && SmartCanvas.regions.length > 0) {
        lbl.textContent = `Smart Canvas：${SmartCanvas.regions.length} 個區域待替換`;
        ind.classList.remove('hidden');
        ind.classList.add('flex');
    } else {
        ind.classList.add('hidden');
        ind.classList.remove('flex');
    }
}

function _scConfirmSelections() {
    if (SmartCanvas.regions.length === 0) {
        showUpdateToast(t('sc_no_regions') || '請先選取至少一個區域');
        return;
    }
    const emptyIdx = SmartCanvas.regions.findIndex(r =>
        r.inputMode === 'image' ? !r.refImageBase64 : !r.label.trim()
    );
    if (emptyIdx !== -1) {
        const emptyRegion = SmartCanvas.regions[emptyIdx];
        const emptyMsg = emptyRegion.inputMode === 'image'
            ? '請為圖片區域上傳參考圖' : '請為所有區域填寫替換描述';
        showUpdateToast(emptyMsg);
        if (emptyRegion.inputMode !== 'image') {
            requestAnimationFrame(() => {
                const inputs = document.querySelectorAll('#sc-region-list .sc-region-label-input');
                if (inputs[emptyIdx]) { inputs[emptyIdx].focus(); inputs[emptyIdx].classList.add('ring-1', 'ring-red-400'); }
            });
        }
        return;
    }
    SmartCanvas.pendingSwap = true;
    (document.getElementById('smart-canvas-modal') || document.createElement('div')).classList.add('hidden');
    (document.getElementById('smart-canvas-modal') || document.createElement('div')).classList.remove('flex');
    _scUpdatePendingIndicator();
    showUpdateToast('✅ 選取已確認，點擊渲染鍵執行替換');
}

async function executeSmartSwap(overrideBody = null) {
    if (SmartCanvas._executing) return;
    SmartCanvas._executing = true;
    const renderBtn = document.getElementById('btn-render');
    const renderLabel = document.getElementById('btn-render-label');
    const origLabel = renderLabel ? renderLabel.textContent : '';
    if (renderBtn) { renderBtn.disabled = true; renderBtn.classList.add('rendering-pulse'); }
    if (renderLabel) renderLabel.textContent = t('btn_render_processing') || 'Processing...';
    const statusText = document.getElementById('status-text');
    if (statusText) { statusText.textContent = t('status_rendering') || 'AI is processing your scene...'; statusText.classList.replace('text-white/40', 'text-red-400'); }
    (document.getElementById('main-preview-area') || document.createElement('div')).classList.add('is-rendering');
    startRenderTimer();

    try {
        let fetchBody, displayLabel, resolution;

        if (overrideBody) {
            // DEV 快速重測：直接使用上次儲存的 body
            fetchBody = overrideBody._body;
            displayLabel = overrideBody._label || 'Smart Canvas 重測';
            resolution = overrideBody._resolution || '1k';
            showUpdateToast(`[DEV] 重測上次選區...`);
        } else {
            // 正常流程：從 SmartCanvas state 建構
            const composite = _scCreateAnnotatedComposite();
            const compositeBase64 = composite.toDataURL('image/jpeg', 0.9);

            // Prompt：顏色代碼 + 區域描述（後端會嵌入預設模板）
            // 圖片參考區域：image 1 = original, image 2 = composite, image 3+ = 用戶上傳的參考圖
            let refImgIdx = 3;
            const prompt = SmartCanvas.regions.map(r => {
                const hasRef = !!r.refImageBase64;
                const hasText = !!(r.label && r.label.trim());
                const color = r.colorHex || '#ff6432';
                if (!hasRef && !hasText) return null;
                if (hasRef && hasText)  return `${color}: ${r.label.trim()} (see image ${refImgIdx++} as visual reference)`;
                if (hasRef)             return `${color}: apply or place what's shown in image ${refImgIdx++}`;
                return `${color}: ${r.label.trim()}`;
            }).filter(Boolean).join('; ');

            displayLabel = SmartCanvas.regions
                .map(r => r.label || '').filter(Boolean).join(', ').slice(0, 40) || 'Smart Canvas';

            const refImages = SmartCanvas.regions
                .filter(r => r.refImageBase64)
                .map(r => r.refImageBase64);

            const resRadio = document.querySelector('input[name="resolution"]:checked');
            resolution = resRadio ? resRadio.value : '1k';

            let originalParam = { original_image_url: SmartCanvas.renderedUrl };
            if (SmartCanvas.baseImg && SmartCanvas.baseImg.complete && SmartCanvas.baseImg.naturalWidth > 0) {
                try {
                    const oc = document.createElement('canvas');
                    oc.width = SmartCanvas.baseImg.naturalWidth;
                    oc.height = SmartCanvas.baseImg.naturalHeight;
                    oc.getContext('2d').drawImage(SmartCanvas.baseImg, 0, 0);
                    originalParam = { original_image_b64: oc.toDataURL('image/jpeg', 0.9) };
                } catch (_) {}
            }

            fetchBody = { tool: 2, parameters: { ...originalParam, base_image: compositeBase64, prompt, resolution, ...(refImages.length > 0 && { ref_images: refImages }) } };

            // DEV：儲存供重測使用，並顯示區域數量
            if (window._isDev) {
                window._devLastScBody = { _body: fetchBody, _label: displayLabel, _resolution: resolution };
                showUpdateToast(`[DEV] 送出 ${SmartCanvas.regions.length} 區域，參考圖 ${refImages.length} 張`);
            }
        }

        // 60 秒後顯示「仍在處理中」提示，避免用戶以為卡住
        const slowToastTimer = setTimeout(() => {
            showUpdateToast('⏳ AI 仍在處理中，預計還需 1–2 分鐘...');
        }, 60000);

        let resp;
        try {
            resp = await fetch(`${API_BASE}/api/render`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-Email': window.loamlabUserEmail || '',
                    'X-Plugin-Version': '1.2.5'
                },
                body: JSON.stringify(fetchBody),
                signal: AbortSignal.timeout(240000)  // 4 分鐘上限，比 Vercel 300s 提前終止
            });
        } finally {
            clearTimeout(slowToastTimer);
        }
        const result = await resp.json();
        if (result.code === 0 && result.url) {
            if (result.points_remaining !== undefined) {
                const pb = document.getElementById('point-balance');
                if (pb) pb.textContent = result.points_remaining;
            }
            SmartCanvas.pendingSwap = false;
            SmartCanvas.regions = [];
            _scUpdatePendingIndicator();
            appendInpaintResultCard(result.url, displayLabel);
            if (window.sketchup) sketchup.auto_save_render({ url: result.url, scene: SmartCanvas.baseScene || 'render', resolution, prompt: displayLabel });
            showUpdateToast('✅ 替換完成！');
            if (window._isDev) (document.getElementById('dev-retest-btn') || document.createElement('div')).classList.remove('hidden');
        } else {
            showUpdateToast('❌ ' + (result.msg || '替換失敗'));
        }
    } catch (err) {
        const msg = err.name === 'TimeoutError' ? '請求超時，請重試（AI 渲染需 1–2 分鐘）' : '網路錯誤: ' + err.message;
        showUpdateToast('❌ ' + msg);
    } finally {
        finalizeRenderUI();
        SmartCanvas._executing = false;
        if (renderBtn) { renderBtn.disabled = false; renderBtn.classList.remove('rendering-pulse'); }
        if (renderLabel) renderLabel.textContent = origLabel;
        const stEl = document.getElementById('status-text');
        if (stEl) { stEl.textContent = t('status_waiting') || 'Ready'; stEl.classList.replace('text-red-400', 'text-white/40'); }
    }
}

// Smart Canvas 控制器初始化（DOM ready 後掛載）
document.addEventListener('DOMContentLoaded', () => {
    // 關閉按鈕
    var scCloseBtn = document.getElementById('sc-close');
    if (scCloseBtn) scCloseBtn.addEventListener('click', () => {
        var scModal = document.getElementById('smart-canvas-modal');
        if (scModal) {
            scModal.classList.add('hidden');
            scModal.classList.remove('flex');
        }
    });

    // 執行替換按鈕：確認選取 → 關閉 modal → 等待渲染鍵
    (document.getElementById('btn-execute-smart-swap') || document.createElement('div')).addEventListener('click', _scConfirmSelections);

    // Smart Canvas pending 取消鍵
    (document.getElementById('sc-pending-cancel') || document.createElement('div')).addEventListener('click', () => {
        SmartCanvas.pendingSwap = false;
        SmartCanvas.regions = [];
        _scUpdatePendingIndicator();
    });

    // Smart Canvas pending 點擊編輯鍵 → 重開 modal 繼續編輯
    (document.getElementById('sc-pending-edit') || document.createElement('div')).addEventListener('click', () => {
        const modal = document.getElementById('smart-canvas-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        SmartCanvas.pendingSwap = false;
        _scUpdatePendingIndicator();
    });

    // 工具切換
    document.querySelectorAll('.sc-tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            SmartCanvas.activeTool = btn.dataset.tool;
            document.querySelectorAll('.sc-tool-btn').forEach(b => b.classList.remove('sc-active'));
            btn.classList.add('sc-active');
            SmartCanvas.isDrawing = false;
            // 切換工具時清空草稿層並恢復持久 region 遮罩
            SmartCanvas.hoveredColor = null;
            if (SmartCanvas.drawCtx) SmartCanvas.drawCtx.clearRect(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH);
            _scRenderOverlays();
        });
    });

    // 筆刷顏色
    var scColorPicker = document.getElementById('sc-color-picker');
    if (scColorPicker) scColorPicker.addEventListener('input', function(e) {
        SmartCanvas.brushColor = e.target.value;
    });

    // 筆刷大小
    var scBrushSize = document.getElementById('sc-brush-size');
    if (scBrushSize) scBrushSize.addEventListener('input', function(e) {
        SmartCanvas.brushSize = parseInt(e.target.value, 10);
    });

    // 復原
    (document.getElementById('sc-undo') || document.createElement('div')).addEventListener('click', () => {
        if (SmartCanvas.undoStack.length === 0) return;
        const cur = {
            canvas: (SmartCanvas.drawCtx ? SmartCanvas.drawCtx.getImageData(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH) : null),
            regions: SmartCanvas.regions.map(r => ({ ...r }))
        };
        SmartCanvas.redoStack.push(cur);
        const snap = SmartCanvas.undoStack.pop();
        if (SmartCanvas.drawCtx) SmartCanvas.drawCtx.putImageData(snap.canvas, 0, 0);
        SmartCanvas.regions = snap.regions;
        _scRenderRegionList();
        _scRenderOverlays();
    });

    // 重做
    (document.getElementById('sc-redo') || document.createElement('div')).addEventListener('click', () => {
        if (SmartCanvas.redoStack.length === 0) return;
        const cur = {
            canvas: (SmartCanvas.drawCtx ? SmartCanvas.drawCtx.getImageData(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH) : null),
            regions: SmartCanvas.regions.map(r => ({ ...r }))
        };
        SmartCanvas.undoStack.push(cur);
        const snap = SmartCanvas.redoStack.pop();
        if (SmartCanvas.drawCtx) SmartCanvas.drawCtx.putImageData(snap.canvas, 0, 0);
        SmartCanvas.regions = snap.regions;
        _scRenderRegionList();
        _scRenderOverlays();
    });

    // 清空
    var scClearBtn = document.getElementById('sc-clear');
    if (scClearBtn) scClearBtn.addEventListener('click', () => {
        if (SmartCanvas.drawCtx) SmartCanvas.drawCtx.clearRect(0, 0, SmartCanvas.canvasW, SmartCanvas.canvasH);
        SmartCanvas.regions = [];
        SmartCanvas.undoStack = [];
        SmartCanvas.redoStack = [];
        _scRenderRegionList();
        _scRenderOverlays();
    });
});
