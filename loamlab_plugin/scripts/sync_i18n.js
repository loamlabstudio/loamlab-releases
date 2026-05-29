const fs = require('fs');
const path = require('path');

const pluginDir = path.join(__dirname, '..', 'ui');
const localesDir = path.join(pluginDir, 'locales');
const i18nJsPath = path.join(pluginDir, 'i18n.js');

if (!fs.existsSync(localesDir)) {
    fs.mkdirSync(localesDir, { recursive: true });
}

const SUPPORTED_LANGS = ['zh-TW', 'en-US', 'zh-CN', 'es-ES', 'pt-BR', 'ja-JP'];
const BASE_LANG = 'zh-TW';

const LANG_NAMES = {
    'en-US': 'English',
    'es-ES': 'Spanish',
    'pt-BR': 'Brazilian Portuguese',
    'ja-JP': 'Japanese',
};

function loadGeminiKey() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
    const envPath = path.join(__dirname, '..', '..', 'loamlab_backend', '.env.local');
    if (fs.existsSync(envPath)) {
        const m = fs.readFileSync(envPath, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m);
        if (m) return m[1].trim();
    }
    return null;
}

async function translateBatch(apiKey, missingMap, targetLang) {
    const prompt = `Translate the following UI strings from Traditional Chinese to ${LANG_NAMES[targetLang]}.
Return ONLY a raw JSON object (no markdown, no explanation) with the same keys and translated values.
Rules:
- Preserve HTML tags, emoji, {variable} placeholders, brand names (LoamLab, SketchUp), and keyboard shortcuts exactly
- Keep translations concise and natural for a design/architecture software UI

Input:
${JSON.stringify(missingMap, null, 2)}`;

    const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1 },
            }),
        }
    );
    if (!resp.ok) throw new Error(`Gemini API ${resp.status}`);
    const data = await resp.json();
    const text = data.candidates[0].content.parts[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Gemini response');
    return JSON.parse(jsonMatch[0]);
}

async function main() {
    let UI_LANG = {};

    // 1. 若 locales 尚未初始化，從 i18n.js 提取
    if (fs.existsSync(i18nJsPath)) {
        const i18nContent = fs.readFileSync(i18nJsPath, 'utf8');
        try {
            const match = i18nContent.match(/const\s+UI_LANG\s*=\s*(\{[\s\S]*?\});/);
            if (match && match[1]) {
                UI_LANG = new Function('return ' + match[1])();
                SUPPORTED_LANGS.forEach(lang => {
                    const jsonPath = path.join(localesDir, `${lang}.json`);
                    if (!fs.existsSync(jsonPath)) {
                        fs.writeFileSync(jsonPath, JSON.stringify(UI_LANG[lang] || {}, null, 4), 'utf8');
                        console.log(`[初始化] 已提取並建立 ${lang}.json`);
                    }
                });
            }
        } catch (e) {
            console.error('解析現有 i18n.js 失敗，將從 locales 讀取。', e.message);
        }
    }

    // 2. 載入最新 JSON 檔案
    const langData = {};
    SUPPORTED_LANGS.forEach(lang => {
        const jsonPath = path.join(localesDir, `${lang}.json`);
        if (fs.existsSync(jsonPath)) {
            try {
                const raw = fs.readFileSync(jsonPath, 'utf8');
                const clean = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
                langData[lang] = JSON.parse(clean);
            } catch (e) {
                console.error(`讀取 ${lang}.json 失敗`, e.message);
                langData[lang] = {};
            }
        } else {
            langData[lang] = {};
        }
    });

    // 3. 找出各語言缺失的 key
    const baseData = langData[BASE_LANG];
    const missingPerLang = {}; // { 'en-US': { key: zhValue, ... }, ... }

    SUPPORTED_LANGS.forEach(lang => {
        if (lang === BASE_LANG) return;
        const target = langData[lang];
        Object.keys(baseData).forEach(key => {
            if (target[key] === undefined || target[key] === null) {
                if (!missingPerLang[lang]) missingPerLang[lang] = {};
                missingPerLang[lang][key] = baseData[key];
            }
        });
    });

    const totalMissing = Object.values(missingPerLang).reduce((s, m) => s + Object.keys(m).length, 0);

    if (totalMissing === 0) {
        console.log('[同步] 所有語系的翻譯鍵值皆已對齊。');
    } else {
        // 4. 嘗試 Gemini 自動翻譯
        const apiKey = loadGeminiKey();
        if (apiKey) {
            console.log(`[翻譯] 偵測到 ${totalMissing} 個缺失鍵值，呼叫 Gemini 自動翻譯...`);
        }

        for (const lang of Object.keys(missingPerLang)) {
            const missing = missingPerLang[lang];
            const keys = Object.keys(missing);

            if (lang === 'zh-CN') {
                // zh-CN 直接抄 zh-TW
                keys.forEach(k => { langData[lang][k] = baseData[k]; });
                console.log(`[同步] zh-CN 補齊 ${keys.length} 個鍵值（直接複製）`);
            } else if (apiKey) {
                try {
                    const translated = await translateBatch(apiKey, missing, lang);
                    let filled = 0;
                    keys.forEach(k => {
                        langData[lang][k] = translated[k] !== undefined ? translated[k] : `[TBD] ${baseData[k]}`;
                        filled++;
                    });
                    console.log(`[翻譯] ${lang} 補齊 ${filled} 個鍵值 ✓`);
                } catch (e) {
                    console.warn(`[警告] ${lang} 翻譯失敗（${e.message}），降級為 [TBD]`);
                    keys.forEach(k => { langData[lang][k] = `[TBD] ${baseData[k]}`; });
                }
            } else {
                // 無 API key，使用原本 [TBD] 行為
                keys.forEach(k => { langData[lang][k] = `[TBD] ${baseData[k]}`; });
            }

            // 寫回 JSON
            fs.writeFileSync(
                path.join(localesDir, `${lang}.json`),
                JSON.stringify(langData[lang], null, 4),
                'utf8'
            );
        }

        if (!apiKey) {
            console.log(`[同步] 已補齊 ${totalMissing} 個遺漏鍵值（無 GEMINI_API_KEY，標記為 [TBD]）`);
        }
    }

    // 5. 重組並匯出 i18n.js
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

    // 6. 自動同步到後端
    const backendPublicDir = path.join(__dirname, '..', '..', 'loamlab_backend', 'public');
    if (fs.existsSync(backendPublicDir)) {
        const backendI18nPath = path.join(backendPublicDir, 'i18n.js');
        fs.writeFileSync(backendI18nPath, finalI18nJs, 'utf8');
        console.log('[完成] 已同步發佈到後端: ' + backendI18nPath);
    }
}

main().catch(e => {
    console.error('[錯誤]', e.message);
    process.exit(1);
});
