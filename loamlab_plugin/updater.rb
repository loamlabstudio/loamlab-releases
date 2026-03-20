module LoamLabPlugin
  module Updater
    require 'net/http'
    require 'uri'
    require 'json'
    require_relative 'config.rb'

    class << self
      def check_for_updates(dialog, current_version)
        puts "[Updater] 正在檢查更新... 目前版本：#{current_version}"
        
        # 開啟獨立背景執行緒以避免卡死主程式
        Thread.new do
          begin
            uri = URI("#{::LoamLab::API_BASE_URL}/api/version")
            http = Net::HTTP.new(uri.hostname, uri.port)
            http.use_ssl = (uri.scheme == 'https')
            http.open_timeout = 5
            http.read_timeout = 5
            
            request = Net::HTTP::Get.new(uri)
            response = http.request(request)
            
            if response.is_a?(Net::HTTPSuccess)
              data = JSON.parse(response.body)
              latest_version = data["latest_version"]
              release_notes = data["release_notes"]
              download_url = data["download_url"]
              
              if version_greater_than?(latest_version, current_version)
                 # 將結果丟回主執行緒觸發 UI，因為 UI.messagebox 必須在主執行緒執行
                 UI.start_timer(0.1, false) do
                   prompt_user_to_update(dialog, latest_version, release_notes, download_url)
                 end
              else
                 UI.start_timer(0.1, false) do
                   UI.messagebox("LoamLab 已是最新版本 (#{current_version})！", MB_OK)
                 end
              end
            else
              puts "[Updater] 伺服器回傳非 200 狀態碼: #{response.code}"
            end
          rescue => e
            puts "[Updater] 檢查更新連線失敗: #{e.message}"
            UI.start_timer(0.1, false) do
              UI.messagebox("無法連接更新伺服器，請檢查網路連線或稍後再試。")
            end
          ensure
            UI.start_timer(0.1, false) do
              dialog.execute_script("const svg = document.querySelector('#btn-check-update svg'); if(svg) svg.classList.remove('animate-spin');")
            end
          end
        end
      end

      private

      def prompt_user_to_update(dialog, new_version, notes, url)
        msg = "發現新版本 LoamLab v#{new_version}！\n\n更新內容：\n#{notes}\n\n是否立即下載並覆蓋更新？\n(最新技術：更新後將為您【自動熱重載】，無須重啟 SketchUp！)"
        result = UI.messagebox(msg, MB_YESNO)
        
        if result == IDYES
           download_and_install(dialog, url)
        end
      end

      def download_and_install(dialog, url)
        # 防止再次點擊與更新狀態 UI
        dialog.execute_script("window.receiveFromRuby({status: 'rendering'})")
        puts "[Updater] 開始下載更新模組: #{url}"
        
        Thread.new do
          begin
            temp_dir = ENV['TEMP'] || ENV['TMP'] || 'C:/Temp'
            rbz_path = File.join(temp_dir, "loamlab_update_#{Time.now.to_i}.rbz")
            
            uri = URI(url)
            # 因為 Github Releases 等常常會重定向，所以需要處理 redirect
            require 'open-uri'
            
            # 使用 open-uri 會有預設的重定向處理，但為了顯示真實且避免假網址崩潰，我們可以加個安全殼
            # 這裡為了展示概念，若 url 是 dummy url 我們就不真下載
            if url.include?("example.com") || url.include?("your-repo")
               puts "[Updater] 偵測到測試用的 Dummy URL，跳過實體下載，直接進入熱重載模擬環節"
               File.write(rbz_path, "dummy rbz content")
            else
               File.open(rbz_path, 'wb') do |f|
                 f.write URI.open(url).read
               end
            end
            
            # 必須把操作 SketchUp 的 API 丟回主執行緒
            UI.start_timer(0.1, false) do
              begin
                 # 核心安裝防線：載入 rbz
                 Sketchup.install_from_archive(rbz_path)
                 
                 # 觸發熱重載
                 dir = File.dirname(__FILE__)
                 ["main.rb", "coze_api.rb", "i18n.rb", "updater.rb"].each do |file|
                   file_path = File.join(dir, file)
                   load file_path if File.exist?(file_path)
                 end
                 
                 dialog.execute_script("window.location.reload();")
                 UI.messagebox("LoamLab 核心模組已成功覆蓋並熱更新完成！")
              rescue => inner_e
                 UI.messagebox("安裝更新檔時發生錯誤: #{inner_e.message}")
              ensure
                 # 清理暫存檔
                 File.delete(rbz_path) if File.exist?(rbz_path)
                 dialog.execute_script("window.receiveFromRuby({status: 'export_done'})")
              end
            end
            
          rescue => e
            puts "[Updater] 下載失敗: #{e.message}"
            UI.start_timer(0.1, false) do
              UI.messagebox("下載更新檔失敗，因為遠端連結無效：\n#{e.message}")
              dialog.execute_script("window.receiveFromRuby({status: 'export_done'})")
            end
          end
        end
      end

      def version_greater_than?(v_new, v_old)
        # 提取 e.g. "1.1.1 (ImgBB Sync)" 的 "1.1.1" 部份進行比較
        clean_new = v_new.split(' ')[0]
        clean_old = v_old.split(' ')[0]
        Gem::Version.new(clean_new) > Gem::Version.new(clean_old)
      rescue => e
        puts "版本比對錯誤: #{e.message}"
        false
      end
    end
  end
end
