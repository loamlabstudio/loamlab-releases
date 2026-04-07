# frozen_string_literal: true

# 用戶可以直接在 SketchUp Ruby 控制台輸入:
# load 'c:/Users/qingwen/.gemini/antigravity/workspaces/土窟設計su渲染插件/dev_reload.rb'
# 以確保修改後的程式碼能即時生效。

require 'sketchup.rb'

module LoamLab
  module AIURenderer
    # 強制關閉舊視窗
    if @dialog
      begin
        @dialog.close
      rescue => e
        puts "關閉舊視窗失敗: #{e.message}"
      end
      @dialog = nil
    end

    # 1. 徹底拔除舊的常數與記憶體，確保讀到最新版
    # 使用 expand_path 動態解析，相容任何安裝位置
    base_dir = File.dirname(File.expand_path(__FILE__))
    config_file  = File.join(base_dir, 'loamlab_plugin', 'config.rb')
    api_file     = File.join(base_dir, 'loamlab_plugin', 'coze_api.rb')
    updater_file = File.join(base_dir, 'loamlab_plugin', 'updater.rb')
    main_file    = File.join(base_dir, 'loamlab_plugin', 'main.rb')

    begin
        # 強制從全域命名空間中拔除兩個舊的模組 (如果存在的話)
        Object.send(:remove_const, :LoamLab) if Object.const_defined?(:LoamLab)
        Object.send(:remove_const, :LoamLabPlugin) if Object.const_defined?(:LoamLabPlugin)

        # 依序重新載入 (Config -> API -> Updater -> Main)
        load config_file
        load api_file
        load updater_file
        load main_file
        puts "======= LoamLab: API 與 Main.rb 深度重載成功 ======="
    rescue LoadError => e
        puts "LoamLab: 重載檔案失敗 - #{e.message}"
    end

    # 2. 自動呼叫開啟視窗（使用新模組，確保走最新程式碼）
    begin
        LoamLab::AIURenderer.show_dialog
        puts "======= LoamLab: UI 視窗已重置並開啟 ======="
    rescue => e
        puts "LoamLab UI 開啟失敗: #{e.message}"
    end
  end
end
