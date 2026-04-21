const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const targetFile = path.join(__dirname, '..', 'ui', 'locales', 'zh-TW.json');
const syncScript = path.join(__dirname, 'sync_i18n.js');

console.log('👀 正在監聽翻譯母本變化...');
console.log('檔案路徑: ' + targetFile);

let debounceTimer;

fs.watch(targetFile, (eventType, filename) => {
    if (filename) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            console.log('\n[檢測到變更] 正在全自動同步所有語系...');
            exec(`node "${syncScript}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error('[錯誤]', error.message);
                    return;
                }
                if (stderr) {
                    console.error('[警告]', stderr);
                }
                console.log(stdout.trim());
                console.log('✅ 自動編譯發佈完成，繼續監聽中...');
            });
        }, 300); // 300ms 防抖
    }
});
