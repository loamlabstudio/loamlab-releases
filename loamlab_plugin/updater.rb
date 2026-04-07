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
      # 完全棄用 Thread.new（在 SketchUp 主執行緒中不穩定）
      # 改為 UI.start_timer 鏈式：下載 → 解壓 → 重啟，每步之間交還主執行緒
      def download_and_install(dialog, url)
        send_to_js(dialog, status: 'update_downloading')
        puts "[Updater] 開始下載：#{url}"

        require 'tmpdir'
        zip_path = File.join(Dir.tmpdir, "loamlab_update_#{Time.now.to_i}.rbz")

        # --- Step A：Net::HTTP 跨平台下載（含 redirect 追蹤） ---
        UI.start_timer(0.1, false) do
          begin
            http_download(url, zip_path)

            unless File.exist?(zip_path) && File.size(zip_path) > 10_000
              File.delete(zip_path) rescue nil
              send_to_js(dialog, status: 'update_error',
                         msg: '下載失敗：請檢查網路，或前往 GitHub 手動下載最新版本')
              next
            end
            puts "[Updater] 下載完成（#{File.size(zip_path)} bytes）：#{zip_path}"

            # --- Step B：解壓覆蓋（跨平台） ---
            # loamlab_plugin/ 的上一層 = SketchUp Plugins 目錄
            plugins_dir = File.dirname(File.dirname(__FILE__))

            # --- Step B：解壓覆蓋（跨平台）---
            # loamlab_plugin/ 的上一層 = SketchUp Plugins 目錄
            plugins_dir = File.dirname(File.dirname(__FILE__))

            if Sketchup.platform == :platform_osx
              unzip_ok = system("unzip -o '#{zip_path}' -d '#{plugins_dir}'")
              File.delete(zip_path) rescue nil
            else
              # PS 5.1 的 Expand-Archive 只認 .zip 副檔名；multi-arg system() 繞過 cmd.exe 引號
              zip_as_zip = zip_path.sub(/\.[^.]+$/, '.zip')
              File.rename(zip_path, zip_as_zip) rescue (zip_as_zip = zip_path)
              zip_win  = zip_as_zip.gsub('/', '\\')
              dest_win = plugins_dir.gsub('/', '\\')
              unzip_ok = system(
                'powershell', '-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command',
                "Expand-Archive -LiteralPath '#{zip_win}' -DestinationPath '#{dest_win}' -Force"
              )
              File.delete(zip_as_zip) rescue nil
            end

            unless unzip_ok
              send_to_js(dialog, status: 'update_error',
                         msg: '安裝失敗，請手動下載後重新安裝 .rbz 檔案')
              next
            end
            puts "[Updater] 解壓完成 → #{plugins_dir}"

            # --- Step C：熱重載 Ruby 模組並重開 dialog（不需重啟 SketchUp）---
            UI.start_timer(0.3, false) do
              plugin_dir = File.dirname(__FILE__)
              %w[config.rb coze_api.rb updater.rb main.rb].each do |f|
                fp = File.join(plugin_dir, f)
                load fp if File.exist?(fp)
              end
              begin; dialog.close; rescue; end
              LoamLab::AIURenderer.show_dialog
            end

          rescue => e
            File.delete(zip_path) rescue nil
            puts "[Updater] 安裝失敗：#{e.message}"
            send_to_js(dialog, status: 'update_error', msg: "安裝失敗：#{e.message}")
          end
        end
      end

      private

      # 跟隨 HTTP redirect 下載二進位檔案到 dest_path（GitHub Release 會 302 跳轉到 CDN）
      def http_download(url, dest_path, limit = 8)
        raise "下載重新導向次數過多" if limit == 0
        uri = URI.parse(url)
        Net::HTTP.start(uri.host, uri.port,
                        use_ssl: uri.scheme == 'https',
                        read_timeout: 120, open_timeout: 30) do |http|
          resp = http.get(uri.request_uri)
          case resp.code.to_i
          when 200
            File.open(dest_path, 'wb') { |f| f.write(resp.body) }
          when 301, 302, 303, 307, 308
            http_download(resp['location'], dest_path, limit - 1)
          else
            raise "HTTP #{resp.code}"
          end
        end
      end

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
