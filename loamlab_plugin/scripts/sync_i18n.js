const fs = require('fs');
const path = require('path');

const pluginDir = path.join(__dirname, '..', 'ui');
const localesDir = path.join(pluginDir, 'locales');
const i18nJsPath = path.join(pluginDir, 'i18n.js');

// 確保 locales 資料夾存在
if (!fs.existsSync(localesDir)) {
    fs.mkdirSync(localesDir, { recursive: true });
}

const SUPPORTED_LANGS = ['zh-TW', 'en-US', 'zh-CN', 'es-ES', 'pt-BR', 'ja-JP'];
const BASE_LANG = 'zh-TW';

let UI_LANG = {};

// 1. 如果 i18n.js 存在且 locales 是空的，首次從 i18n.js 提取並生成 JSON
if (fs.existsSync(i18nJsPath)) {
    const i18nContent = fs.readFileSync(i18nJsPath, 'utf8');
    // 簡單提取 UI_LANG 物件
    try {
        const match = i18nContent.match(/const\s+UI_LANG\s*=\s*(\{[\s\S]*?\});/);
        if (match && match[1]) {
            // 使用 Function 來解析 JS 物件 (避免嚴格 JSON 格式錯誤)
            UI_LANG = new Function('return ' + match[1])();
            
            // 初次分離儲存為 JSON
            SUPPORTED_LANGS.forEach(lang => {
                const jsonPath = path.join(localesDir, `${lang}.json`);
                if (!fs.existsSync(jsonPath)) {
                    const data = UI_LANG[lang] || {};
                    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 4), 'utf8');
                    console.log(`[初始化] 已提取並建立 ${lang}.json`);
                }
            });
        }
    } catch (e) {
        console.error('解析現有 i18n.js 失敗，將從 locales 讀取。', e.message);
    }
}

// 2. 載入最新的 JSON 檔案
const langData = {};
SUPPORTED_LANGS.forEach(lang => {
    const jsonPath = path.join(localesDir, `${lang}.json`);
    if (fs.existsSync(jsonPath)) {
        try {
            langData[lang] = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        } catch (e) {
            console.error(`讀取 ${lang}.json 失敗`, e.message);
            langData[lang] = {};
        }
    } else {
        langData[lang] = {};
    }
});

// 3. 以 zh-TW 為基準，同步其他語言
const baseData = langData[BASE_LANG];
let addedCount = 0;

SUPPORTED_LANGS.forEach(lang => {
    if (lang === BASE_LANG) return;
    
    let isModified = false;
    const targetData = langData[lang];
    
    Object.keys(baseData).forEach(key => {
        if (targetData[key] === undefined || targetData[key] === null) {
            if (lang === 'zh-CN') {
                targetData[key] = baseData[key];
            } else {
                targetData[key] = `[TBD] ${baseData[key]}`;
            }
            isModified = true;
            addedCount++;
        }
    });

    if (isModified || !fs.existsSync(path.join(localesDir, `${lang}.json`))) {
        fs.writeFileSync(path.join(localesDir, `${lang}.json`), JSON.stringify(targetData, null, 4), 'utf8');
    }
});

if (addedCount > 0) {
    console.log(`[同步] 已自動補齊 ${addedCount} 個遺漏的翻譯鍵值。`);
} else {
    console.log(`[同步] 所有語系的翻譯鍵值皆已對齊。`);
}

// 4. 重組並匯出 i18n.js
// 建構 UI_LANG 的字串部分
const uiLangStr = JSON.stringify(langData, null, 4);

const finalI18nJs = `// ⚠️ 警告：此檔案為自動生成，請勿直接修改。
// 請修改 locales/ 下的 JSON 檔案，然後執行 node scripts/sync_i18n.js 重新編譯。

const UI_LANG = ${uiLangStr};

let currentLang = 'en-US';

window.setLanguage = function (lang) {
    if (!UI_LANG[lang]) return;
    currentLang = lang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (UI_LANG[lang][key]) {
            if (key === 'sync_screen') {
                el.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-[#dc2626] animate-pulse"></span> ' + UI_LANG[lang][key];
            } else if (el.tagName.toLowerCase() === 'textarea' || el.tagName.toLowerCase() === 'input') {
                el.placeholder = UI_LANG[lang][key];
            } else {
                el.innerHTML = UI_LANG[lang][key];
            }
        }
    });

    const scenesSpan = document.getElementById('scene-count-label');
    if (scenesSpan) {
        const count = scenesSpan.getAttribute('data-count') || 0;
        scenesSpan.textContent = UI_LANG[lang]['total'] + ' ' + count + ' ' + UI_LANG[lang]['unit'];
    }

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const val = (UI_LANG[lang] || UI_LANG['en-US'])[key];
        if (val) el.title = val;
    });

    if (typeof updatePlanCostLabels === 'function') updatePlanCostLabels(lang);
    if (typeof setActiveTool === 'function' && typeof currentActiveTool !== 'undefined') setActiveTool(currentActiveTool, true);
};

// 若環境需要，可導出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UI_LANG };
}
`;

fs.writeFileSync(i18nJsPath, finalI18nJs, 'utf8');
console.log('[完成] 已重新編譯並覆蓋 ' + i18nJsPath);

// 5. 自動同步到後端 (loamlab_backend/public/i18n.js) 以供跳轉網站使用
const backendPublicDir = path.join(__dirname, '..', '..', 'loamlab_backend', 'public');
if (fs.existsSync(backendPublicDir)) {
    const backendI18nPath = path.join(backendPublicDir, 'i18n.js');
    fs.writeFileSync(backendI18nPath, finalI18nJs, 'utf8');
    console.log('[完成] 已同步發佈到後端: ' + backendI18nPath);
}
