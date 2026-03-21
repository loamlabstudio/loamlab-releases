module LoamLabPlugin
  module Updater
    require 'net/http'
    require 'uri'
    require 'json'
    require_relative 'config.rb'

    class << self

      # ─── Step 1：檢查有無新版本 ───────────────────────────────────
      def check_for_updates(dialog, current_version)
        puts "[Updater] 檢查更新，目前版本：#{current_version}"

        Thread.new do
          begin
            uri  = URI("#{::LoamLab::API_BASE_URL}/api/version")
            http = Net::HTTP.new(uri.hostname, uri.port)
            http.use_ssl      = (uri.scheme == 'https')
            http.open_timeout = 8
            http.read_timeout = 8

            response = http.request(Net::HTTP::Get.new(uri))

            unless response.is_a?(Net::HTTPSuccess)
              send_to_js(dialog, status: 'update_error', msg: "伺服器回傳 #{response.code}")
              next
            end

            data           = JSON.parse(response.body)
            latest_version = data["latest_version"].to_s
            notes          = data["release_notes"].to_s
            url            = data["download_url"].to_s

            if version_newer?(latest_version, current_version)
              send_to_js(dialog, status: 'update_available',
                                 version: latest_version, notes: notes, url: url)
            else
              send_to_js(dialog, status: 'update_latest', version: current_version)
            end

          rescue => e
            puts "[Updater] 連線失敗：#{e.message}"
            send_to_js(dialog, status: 'update_error', msg: '無法連接更新伺服器，請確認網路後再試')
          end
        end
      end

      # ─── Step 2：下載並覆蓋安裝（由 JS 確認後呼叫）────────────────
      def download_and_install(dialog, url)
        send_to_js(dialog, status: 'update_downloading')
        puts "[Updater] 開始下載：#{url}"

        Thread.new do
          begin
            tmp = (ENV['TEMP'] || ENV['TMP'] || 'C:/Temp').gsub('\\', '/')
            zip_path = "#{tmp}/loamlab_update_#{Time.now.to_i}.zip"

            # 下載（open-uri 自動處理 redirect）
            require 'open-uri'
            File.open(zip_path, 'wb') { |f| f.write URI.open(url, 'rb').read }
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
              send_to_js(dialog, status: 'update_error', msg: '解壓縮失敗，請重試或手動下載安裝')
            end

          rescue => e
            puts "[Updater] 下載/安裝失敗：#{e.message}"
            send_to_js(dialog, status: 'update_error', msg: "安裝失敗：#{e.message}")
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
        UI.start_timer(0.05, false) do
          dialog.execute_script("window.receiveFromRuby(#{JSON.generate(payload)})")
        end
      end

    end
  end
end
