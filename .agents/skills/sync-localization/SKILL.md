---
name: sync-localization
description: Use this skill when the user wants to update, sync, or compile the multi-language UI translation files for the SketchUp plugin.
---

# Sync Localization (i18n) Skill

## When to use this skill
- When the user mentions "更新語系", "翻譯", "sync i18n", "同步多國語言", or asks you to add new translation keys to the UI.
- When new UI features are added that require updating hover tooltips (`data-i18n-title`) or text (`data-i18n`).

## How it works
The language system is managed through separate JSON files in `loamlab_plugin/ui/locales/`. 
The `zh-TW.json` file is the **Source of Truth**. When a new translation is needed, it should be added to `zh-TW.json` first.
A Node.js script synchronizes these keys to all other supported languages (`en-US`, `zh-CN`, `es-ES`, `pt-BR`, `ja-JP`) and compiles them into a single `i18n.js` file required by the plugin.

## Execution Steps
1. **Update `zh-TW.json`**: If the user wants to add or modify a translation, first edit `loamlab_plugin/ui/locales/zh-TW.json`.
2. **Run Sync Script**: Execute the synchronization script using the `run_command` tool:
   ```bash
   node ./loamlab_plugin/scripts/sync_i18n.js
   ```
   *Make sure you run this in the root workspace directory.*
3. **Verify Output**: The script will automatically add any missing keys to the other language JSON files (prefixing non-zh-CN languages with `[TBD] `) and it will rebuild `loamlab_plugin/ui/i18n.js`.
   - **Optimization Note:** It also automatically copies `i18n.js` to `loamlab_backend/public/i18n.js`. Any "redirected website" or backend page (like `qr-handoff.html`) can dynamically translate its UI by simply importing `<script src="/i18n.js"></script>` and calling `window.setLanguage(navigator.language.substring(0,2) === 'zh' ? 'zh-TW' : 'en-US');`.
4. **Translate (Optional)**: If the user provides translations for the `[TBD]` placeholders, update the respective localized JSON files and run the script again.

## Remember
- **DO NOT** edit `loamlab_plugin/ui/i18n.js` directly. It is an auto-generated file and will be overwritten.
- **ALWAYS** edit the JSON files inside `loamlab_plugin/ui/locales/`.
