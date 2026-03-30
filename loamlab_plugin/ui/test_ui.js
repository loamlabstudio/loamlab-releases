const { firefox } = require('playwright');
const path = require('path');

(async () => {
    // 啟動瀏覽器 (使用 firefox 避免 Chrome 本地 file:// 跨域限制)
    const browser = await firefox.launch({ headless: true });
    const page = await browser.newPage();

    // 取得絕對路徑
    const htmlPath = path.resolve(__dirname, 'index.html');
    const fileUrl = `file:///${htmlPath.replace(/\\/g, '/')}`;

    console.log(`[UI Test] Loading: ${fileUrl}`);

    try {
        await page.goto(fileUrl, { waitUntil: 'networkidle' });
        
        // 1. 測試框架載入 (等待 body 出現)
        await page.waitForSelector('body', { timeout: 5000 });
        console.log('✅ 介面基台成功載入！');

        // 2. 測試標題與渲染引擎 DOM 是否存在
        const titleExists = await page.locator('header').count() > 0;
        if (titleExists) {
            console.log('✅ UI 標題列成功渲染。');
        } else {
            console.error('❌ UI 標題列未找到。');
        }

        // 3. 測試語系與 JS 腳本是否正確綁定
        // 檢查是否有主要的渲染按鈕
        const renderBtnExists = await page.locator('#btn-render').count() > 0;
        if (renderBtnExists) {
            console.log('✅ 渲染按鈕 #btn-render 存在。');
        }

        // 4. 點擊測試機制 (嘗試開啟設定或歷史紀錄)
        const historyBtn = page.locator('#btn-history');
        if (await historyBtn.count() > 0) {
            await historyBtn.click();
            console.log('✅ 成功點擊 #btn-history 按鈕。');
        }

        // 5. 擷取畫面供後續人工驗證
        const screenshotPath = path.join(__dirname, 'test_screenshot.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`✅ 已擷取測試畫面至: ${screenshotPath}`);

    } catch (e) {
        console.error('❌ UI 測試執行失敗:', e.message);
    } finally {
        await browser.close();
        console.log('[UI Test] 完成。');
    }
})();
