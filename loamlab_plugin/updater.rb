module LoamLabPlugin
  module Updater
    require 'net/http'
    require 'uri'
    require 'json'
    require_relative 'config.rb'

    class << self

      # ─── Step 1：檢查有無新版本 ───────────────────────────────────
      # 使用 Sketchup::Http::Request（主執行緒非同步），避免 Thread.new + UI.start_timer 的不穩定問題
      def check_for_updates(dialog, current_version)
        puts "[Updater] 檢查更新，目前版本：#{current_version}"

        url = "#{::LoamLab::API_BASE_URL}/api/version"
        req = Sketchup::Http::Request.new(url, Sketchup::Http::GET)

        req.start do |_request, response|
          begin
            unless response.status_code == 200
              send_to_js(dialog, status: 'update_error', msg: "伺服器回傳 #{response.status_code}")
              next
            end

            data           = JSON.parse(response.body.to_s.force_encoding('UTF-8').scrub('?'))
            latest_version = data["latest_version"].to_s
            notes          = data["release_notes"].to_s
            dl_url         = data["download_url"].to_s

            if version_newer?(latest_version, current_version)
              send_to_js(dialog, status: 'update_available',
                                 version: latest_version, notes: notes, url: dl_url)
            else
              send_to_js(dialog, status: 'update_latest', version: current_version)
            end

          rescue => e
            puts "[Updater] 解析回應失敗：#{e.message}"
            send_to_js(dialog, status: 'update_error', msg: '更新伺服器回應異常，請稍後再試')
          end
        end

      rescue => e
        puts "[Updater] 無法建立請求：#{e.message}"
        send_to_js(dialog, status: 'update_error', msg: '無法連接更新伺服器，請確認網路後再試')
      end

      # ─── Step 2：下載並覆蓋安裝（由 JS 確認後呼叫）────────────────
      def download_and_install(dialog, url)
        send_to_js(dialog, status: 'update_downloading')
        puts "[Updater] 開始下載：#{url}"

        Thread.new do
          begin
            tmp = (ENV['TEMP'] || ENV['TMP'] || 'C:/Temp').gsub('\\', '/')
            zip_path = "#{tmp}/loamlab_update_#{Time.now.to_i}.zip"

            # 用 PowerShell 下載（原生處理 HTTPS 302 redirect + SSL，避免 Ruby open-uri 相容性問題）
            zip_win_dl = zip_path.gsub('/', '\\')
            dl_ok = system("powershell -ExecutionPolicy Bypass -Command " \
                           "\"Invoke-WebRequest -Uri '#{url}' -OutFile '#{zip_win_dl}'\"")
            raise '下載失敗，請稍後再試或手動下載' unless dl_ok && File.exist?(zip_path)
            puts "[Updater] 下載完成：#{zip_path}"

            # 插件根目錄（loamlab_plugin/ 的上一層 = SketchUp Plugins/）
            plugins_dir = File.dirname(File.dirname(__FILE__))
            zip_win     = zip_path.gsub('/', '\\')
            dest_win    = plugins_dir.gsub('/', '\\')

            # 用 PowerShell 解壓縮，-Force 強制覆蓋既有檔案
            cmd = "powershell -ExecutionPolicy Bypass -Command " \
                  "\"Expand-Archive -Path '#{zip_win}' -DestinationPath '#{dest_win}' -Force\""
            ok  = system(cmd)
            File.delete(zip_path) rescue nil

            if ok
              puts "[Updater] 解壓完成，重新載入插件"
              UI.start_timer(0.2, false) do
                # 熱重載非 main 的 Ruby 支援模組（config/coze_api/updater）
                plugin_dir = File.dirname(__FILE__)
                %w[config.rb coze_api.rb updater.rb].each do |f|
                  fp = File.join(plugin_dir, f)
                  load fp if File.exist?(fp)
                end
                # 重載 WebDialog（JS/HTML 從磁碟讀取新版本）
                dialog.execute_script("window.location.reload()")
              end
            else
              UI.start_timer(0, false) { send_to_js(dialog, status: 'update_error', msg: '解壓縮失敗，請重試或手動下載安裝') }
            end

          rescue => e
            puts "[Updater] 下載/安裝失敗：#{e.message}"
            err_msg = e.message
            UI.start_timer(0, false) { send_to_js(dialog, status: 'update_error', msg: "安裝失敗：#{err_msg}") }
          end
        end
      end

      private

      # 比較版本號：支援 "1.3.0" > "1.2.0-beta" 這類混合格式
      def version_newer?(v_new, v_old)
        # 去掉 "-beta"/"-rc" 等後綴，只保留 x.y.z 純版號再比較
        clean = ->(v) { v.to_s.gsub(/-[a-zA-Z].+$/, '').strip }
        Gem::Version.new(clean.call(v_new)) > Gem::Version.new(clean.call(v_old))
      rescue => e
        puts "[Updater] 版本比對錯誤：#{e.message}"
        false
      end

      def send_to_js(dialog, payload)
        dialog.execute_script("window.receiveFromRuby(#{JSON.generate(payload)})")
      end

    end
  end
end
