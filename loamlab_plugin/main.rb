require 'sketchup.rb'
require 'json'
require 'base64'
require_relative 'config.rb'
require_relative 'coze_api.rb'
require_relative 'updater.rb'

module LoamLab

  module AIURenderer
    
    def self.show_dialog
      # 防止重複打開視窗
      if @dialog && @dialog.visible?
        @dialog.bring_to_front
        return
      end

      # HTML Dialog 基本設定
      is_dev = (LoamLab::BUILD_TYPE == "dev")
      options = {
        :dialog_title => is_dev ? "LoamLab AI Renderer [DEV]" : "LoamLab AI Renderer",
        :preferences_key => is_dev ? "com.loamlab.airenderer.dev" : "com.loamlab.airenderer",
        :scrollable => true,
        :resizable => true,
        :width => 1200,
        :height => 800,
        :left => 100,
        :top => 100,
        :min_width => 800,
        :min_height => 600,
        :style => UI::HtmlDialog::STYLE_DIALOG
      }

      @dialog = UI::HtmlDialog.new(options)
      
      # 載入 UI 的 index.html，附加上時間戳記以強制作廢 SketchUp 內建瀏覽器快取
      current_dir = File.dirname(__FILE__)
      html_path = File.join(current_dir, 'ui', 'index.html')
      # 因 set_file 不支援 querystring，改用 set_url 來載入含有 cache-busting 的本地檔案路徑
      url = "file:///#{html_path}?t=#{Time.now.to_i}"
      @dialog.set_url(url)
      
      # 註冊所有的 JS to Ruby Callback
      self.register_callbacks(@dialog)

      @dialog.show
    end

    def self.register_callbacks(dialog)
      # 1. 初始化資料請求 (由 JS 呼叫)
      dialog.add_action_callback("getInitialData") do |action_context, params|
        model = Sketchup.active_model
        save_path = model.get_attribute("LoamLabAI", "save_path", "")
        user_email = Sketchup.read_default("LoamLabAI", "user_email", "")
        response = {
          status: 'success',
          version: LoamLab::VERSION,
          api_base: LoamLab::API_BASE_URL,
          build_type: LoamLab::BUILD_TYPE,
          lang: 'en-US',
          scenes: self.get_scene_names,
          save_path: save_path,
          user_email: user_email
        }
        
        json_str = response.to_json
        dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(json_str)}')")
      end

      # 1.2 瀏覽器開啟與授權儲存
      dialog.add_action_callback("open_browser") do |action_context, url|
        UI.openURL(url)
      end

      dialog.add_action_callback("save_email") do |action_context, email|
        Sketchup.write_default("LoamLabAI", "user_email", email)
      end
      
      dialog.add_action_callback("logout_user") do |action_context|
        Sketchup.write_default("LoamLabAI", "user_email", "")
      end

      # 1.5. 讓使用者指定專案存檔目錄
      dialog.add_action_callback("choose_save_dir") do |action_context, params|
        model = Sketchup.active_model
        current_path = model.get_attribute("LoamLabAI", "save_path", "")
        
        # 安全機制：當路徑不存在或為空時，不帶 directory 參數，以免 SU 崩潰
        chosen_dir = nil
        if current_path && !current_path.empty? && File.directory?(current_path)
          chosen_dir = UI.select_directory(title: "選擇專案 AI 輸出資料夾", directory: current_path)
        else
          chosen_dir = UI.select_directory(title: "選擇專案 AI 輸出資料夾")
        end
        
        if chosen_dir && !chosen_dir.empty?
          model.set_attribute("LoamLabAI", "save_path", chosen_dir)
          # 回傳給 JS 更新 UI
          json_str = chosen_dir.to_json
          dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64({action: 'updateSaveDir', path: chosen_dir}.to_json)}')")
        end
      end

      # 2. 開始渲染指令 (由 JS 呼叫)
      dialog.add_action_callback("render_scene") do |action_context, params|
        puts "LoamLab: 收到渲染指令 - #{params.inspect}"
        scenes_to_render = params["scenes"] || []
        user_prompt = (params["prompt"] || "").to_s.dup.force_encoding("UTF-8")
        resolution = params["resolution"] || "1k"
        
        dialog.execute_script("window.receiveFromRuby({status: 'rendering'})")
        
        # 延遲一點執行，避免阻塞前端 UI 動畫
        UI.start_timer(0.1, false) do
            self.batch_export_scenes(dialog, scenes_to_render, user_prompt, resolution)
        end
      end

      # 3. [Dev] 熱重載: 開發時一鍵刷新 UI 與讀取最新程式碼
      dialog.add_action_callback("dev_reload") do |action_context, params|
        begin
          # 載入獨立的熱重載腳本，負責拔除記憶體與重新載入全套庫
          reload_script = File.join(File.dirname(__FILE__), '..', 'dev_reload.rb')
          load reload_script if File.exist?(reload_script)
          
          # 手動補上對 coze_api 的強制載入
          api_file = File.join(File.dirname(__FILE__), 'coze_api.rb')
          load api_file if File.exist?(api_file)
          
          # 最後重載自己 (main.rb)
          load __FILE__
        rescue => e
          UI.messagebox("LoamLab 載入錯誤: #{e.message}")
        end
        dialog.execute_script("window.location.reload();")
      end

      # 4. [Prod] 自動更新: 向伺服器檢查版號，若有新版則透過 JS 通知
      dialog.add_action_callback("auto_update") do |action_context, params|
        current_version = LoamLab::VERSION
        LoamLabPlugin::Updater.check_for_updates(dialog, current_version)
      end

      # 4b. [Prod] 執行安裝更新: 接收 JS 確認後實際下載並覆蓋插件
      dialog.add_action_callback("execute_update") do |action_context, params|
        url = params.is_a?(Hash) ? params["url"] : nil
        if url && !url.empty?
          LoamLabPlugin::Updater.download_and_install(dialog, url)
        else
          dialog.execute_script("window.receiveFromRuby(#{JSON.generate({status: 'update_error', msg: '無效的下載連結'})})")
        end
      end

      # 3.5 [第一性原理除錯]: 空載 API 直連測試
      dialog.add_action_callback("debug_coze") do |action_context, params|
        require 'net/http'
        require 'uri'
        require 'json'

        pat = ENV['COZE_PAT'].to_s  # 僅供本機除錯，透過環境變數注入，勿 hardcode
        # 直接使用絕對正確的 Workflow ID，不再依賴外界傳入的舊變數
        wid = "7613251981235208197"
        
        # 由於 Coze 對於耗時工作流強制要求使用 stream_run 端點，否則會報 4200
        uri = URI("https://api.coze.com/v1/workflow/stream_run")
        req = Net::HTTP::Post.new(uri)
        req['Authorization'] = "Bearer #{pat}"
        req['Content-Type'] = 'application/json'
        
        # 使用官方文件最標準、最乾淨的 JSON 結構 (已移除 bot_id，改為直連 Workflow)
        payload = {
          workflow_id: wid,
          parameters: {
            # 圖片傳入為 Array<String>，以滿足 Coze 的最佳實踐設計
            "image": ["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?ixlib=rb-4.0.3&w=800"],
            "prompt": "debug text"
          }
        }
        
        req.body = JSON.dump(payload)

        begin
          res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|
            http.request(req)
          end
          UI.messagebox("【第一性原理 API 直連測試】\n\nHTTP #{res.code}\n#{res.body}")
        rescue => e
          UI.messagebox("連線失敗：#{e.message}")
        end
      end

      # 新增功能：指定本地資料夾，自動分層儲存滿意的算圖結果
      dialog.add_action_callback("save_image") do |action_context, params|
        url = params["url"]
        prompt = (params["prompt"] || "default").to_s.dup.force_encoding("UTF-8")
        lang = params["lang"] || "zh-TW"
        
        next unless url
        
        # 讓使用者選擇最高階儲存目錄
        chosen_dir = UI.select_directory(title: "選擇要保存 LoamLab 渲染圖的資料夾")
        if chosen_dir
          begin
             # 建立基於語言與日期的專業資料夾結構
             date_str = Time.now.strftime("%Y-%m-%d")
             target_dir = File.join(chosen_dir, "LoamLab_Renders_#{lang}", date_str)
             Dir.mkdir(target_dir) unless File.exist?(target_dir)
             
             # 安全化檔案名稱，避免非法字元
             safe_prompt = prompt[0..20].gsub(/[^a-zA-Z0-9_\u4e00-\u9fa5]/, '_')
             file_name = "AI_Render_#{Time.now.strftime("%H%M%S")}_#{safe_prompt}.jpg"
             full_path = File.join(target_dir, file_name)
             
             require 'open-uri'
             File.open(full_path, "wb") do |file|
               URI.open(url) do |image|
                 file.write(image.read)
               end
             end
             
             UI.messagebox("圖片已成功保存至:\n#{full_path}")
          rescue => e
             UI.messagebox("儲存圖片失敗:\n#{e.message}")
          end
        end
      end

      # 4. 同步預覽畫面指令 (處理批量故事板預覽)
      dialog.add_action_callback("sync_preview") do |action_context, params|
        begin
          puts "LoamLab: 正在擷取即時預覽故事板..."
          scenes = params["scenes"] || []
          
          batch_data = []
          if scenes.empty?
            # 當使用者沒有勾選任何場景時，自動擷取他當下的視角
            base64_img = self.get_preview_base64
            batch_data << { scene: "當前即時視角", image_data: base64_img }
          else
            model = Sketchup.active_model
            if model
              current_page = model.pages.selected_page
              page_options = model.options['PageOptions']
              old_transition = page_options['ShowTransition']
              page_options['ShowTransition'] = false if old_transition
              
              # 先隱藏干擾項目 (安全寫法，避免 SketchUp 拋出例外)
              safe_keys = ['DrawHidden', 'DrawHiddenObjects', 'DisplaySketchAxes', 'DisplayInstanceAxes']
              original_states = {}
              safe_keys.each do |k|
                begin
                  if model.rendering_options.keys.include?(k)
                    original_states[k] = model.rendering_options[k]
                    model.rendering_options[k] = false
                  end
                rescue
                end
              end
              
              scenes.each do |scene_name|
                if page = model.pages[scene_name]
                  model.pages.selected_page = page
                  # 給予 SketchUp 毫秒級的 UI 刷新時間，避免畫面閃爍過快或主視窗卡死
                  sleep(0.05) 
                  base64_img = self.get_preview_base64
                  batch_data << { scene: scene_name, image_data: base64_img }
                end
              end
              
              model.pages.selected_page = current_page if current_page
              page_options['ShowTransition'] = old_transition if old_transition
              
              # 恢復原始顯示設定
              original_states.each do |k, v|
                begin
                  model.rendering_options[k] = v
                rescue
                end
              end
            end
          end
          
          response = { status: 'preview_updated', batch_data: batch_data }
          dialog.execute_script("window.receiveFromRuby(#{response.to_json})")
        rescue => e
          UI.messagebox("Sync Preview Error: #{e.message}")
        end
      end

      # 5. 自動開啟儲存路徑 (算圖完成後觸發)
      dialog.add_action_callback("open_save_dir") do |action_context, params|
        model = Sketchup.active_model
        save_path = model.get_attribute("LoamLabAI", "save_path", "")
        if save_path && !save_path.empty? && File.directory?(save_path)
          UI.openURL("file:///#{save_path}")
        end
      end
    end

    # 獲取當前模型所有的場景名稱
    def self.get_scene_names
      model = Sketchup.active_model
      return [] unless model
      model.pages.map { |page| page.name }
    end

    # 將當前往視角擷取為 Base64 圖片 (品質較低，縮圖預覽用)
    def self.get_preview_base64
      model = Sketchup.active_model
      return "" unless model
      
      temp_dir = ENV['TEMP'] || ENV['TMP'] || 'C:/Temp'
      # 確保目錄存在
      Dir.mkdir(temp_dir) unless File.exist?(temp_dir)
      temp_img_path = File.join(temp_dir, "loamlab_preview_#{Time.now.to_i}.jpg")
      
      begin
        # 採用最通用的參數寫法確保相容性
        model.active_view.write_image(temp_img_path, 1280, 720, true, 0.8)
        require 'base64'
        img_data = File.read(temp_img_path, mode: 'rb')
        base64_img = Base64.strict_encode64(img_data).force_encoding('UTF-8')
        File.delete(temp_img_path) if File.exist?(temp_img_path)
        return "data:image/jpeg;base64,#{base64_img}"
      rescue => e
        UI.messagebox("LoamLab 預覽截圖出錯:\n#{e.message}\n請檢查是否有寫入權限。")
        return ""
      end
    end

    # 批量導出指定的場景為實體檔案並上傳 Coze
    def self.batch_export_scenes(dialog, scenes_to_render, user_prompt, resolution="1k")
      model = Sketchup.active_model
      return unless model

      current_page = model.pages.selected_page
      
      # 記錄並隱藏干擾元素
      safe_keys = ['DrawHidden', 'DrawHiddenObjects', 'DisplaySketchAxes', 'DisplayInstanceAxes']
      original_states = {}
      safe_keys.each do |k|
        begin
          if model.rendering_options.keys.include?(k)
            original_states[k] = model.rendering_options[k]
            model.rendering_options[k] = false
          end
        rescue
        end
      end

      temp_dir = ENV['TEMP'] || ENV['TMP'] || 'C:/Temp'
      project_name = (model.title.empty? ? "未命名專案" : model.title).to_s.dup.force_encoding("UTF-8")
      save_path = model.get_attribute("LoamLabAI", "save_path", "").to_s.dup.force_encoding("UTF-8")
      timestamp = Time.now.strftime("%Y%m%d_%H%M%S")

      # --- [非阻塞佇列實作] ---
      # 將場景清單轉化為一個可切片處理的佇列
      queue = scenes_to_render.dup
      total_count = queue.length
      
      # 定義內部的逐一處理邏輯
      process_chain = proc do |index|
        if queue.empty?
          # 佇列結束，恢復狀態
          UI.start_timer(0.5, false) do
            dialog.execute_script("window.receiveFromRuby({status: 'export_done'})")
            original_states.each { |k, v| model.rendering_options[k] = v rescue nil }
            model.pages.selected_page = current_page if current_page
            puts "[LoamLab] 批量導出排程已全部送出。"
          end
          next
        end

        scene_raw = queue.shift
        scene_name = scene_raw.to_s.dup.force_encoding("UTF-8")
        page = model.pages[scene_raw]
        
        if page
          # 1. 切換場景
          model.pages.selected_page = page
          
          # 2. 產出暫存檔與備份 (此處 UI 可能會微卡，但因為是單張處理，結束後會交還主控權)
          temp_img_path = File.join(temp_dir, "loamlab_render_#{index}_#{Time.now.to_i}.jpg")
          
          begin
            view = model.active_view
            ratio_val = view.vpheight > 0 ? (view.vpwidth.to_f / view.vpheight) : (16.0 / 9.0)
            supported_ratios = { "16:9"=>1.77, "9:16"=>0.56, "4:3"=>1.33, "3:4"=>0.75, "3:2"=>1.5, "2:3"=>0.66, "1:1"=>1.0, "21:9"=>2.33 }
            closest_ratio = supported_ratios.min_by { |k, v| (v - ratio_val).abs }[0]

            view.write_image(temp_img_path, 1280, 720, true, 0.6)
            
            # 自動備份
            if !save_path.empty? && File.directory?(save_path)
              safe_project_name = project_name.gsub(/[:*?"<>|\/\\]/, "_")
              safe_scene_name = scene_name.gsub(/[:*?"<>|\/\\]/, "_")
              before_name = "#{timestamp}_#{safe_project_name}_#{safe_scene_name}_原圖.jpg"
              require 'fileutils'
              FileUtils.cp(temp_img_path, File.join(save_path, before_name)) rescue nil
            end

            # 3. 執行 Base64 與發送 (最耗主執行緒時間的環節)
            img_data = File.read(temp_img_path, mode: 'rb')
            data_uri = "data:image/jpeg;base64,#{Base64.strict_encode64(img_data)}"
            
            user_email = Sketchup.read_default("LoamLabAI", "user_email", "").to_s.force_encoding("UTF-8").scrub("?")
            request_body = JSON.dump({
              parameters: {
                "image" => [data_uri], "user_prompt" => user_prompt, 
                "resolution" => resolution, "aspect_ratio" => closest_ratio
              }
            })

            req = Sketchup::Http::Request.new("#{::LoamLab::API_BASE_URL}/api/render", Sketchup::Http::POST)
            req.headers = { 'Content-Type' => 'application/json', 'x-user-email' => user_email, 'x-plugin-version' => ::LoamLab::VERSION }
            req.body = request_body

            captured_scene = scene_name
            req.start do |_, response|
              begin
                data = JSON.parse(response.body.to_s.force_encoding("UTF-8").scrub("?"))
                result = (data['code'] == 0 && data['url']) ?
                  { status: 'render_success', scene_name: captured_scene, url: data['url'], points_remaining: data['points_remaining'], transaction_id: data['transaction_id'] } :
                  { status: 'render_failed', message: data['msg'] || "HTTP #{response.status_code}", points_refunded: data['points_refunded'], error: data['error'] }
              rescue => e
                result = { status: 'render_failed', message: "解析失敗: #{e.message}" }
              end
              UI.start_timer(0, false) { dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(result.to_json)}')") }
            end

            puts "[LoamLab] 第 #{index+1}/#{total_count} 個場景請求中: #{scene_name}"

          rescue => e
            puts "[LoamLab] 導出 #{scene_name} 發生錯誤: #{e.message}"
          ensure
            File.delete(temp_img_path) if File.exist?(temp_img_path)
          end
        end

        # ★ 重要關鍵：透過 0.1 秒的計時器呼叫下一個，讓 SketchUp 有時間處理 UI 訊息與防止 Not Responding
        UI.start_timer(0.1, false) { process_chain.call(index + 1) }
      end

      # 啟動鏈式呼叫
      process_chain.call(0)
    end
    
    # 新增選單項目
    unless file_loaded?(__FILE__)
      main_menu = UI.menu('Plugins').add_submenu('LoamLab Camera (野人相機)')
      main_menu.add_item('啟動相機 (Start)') do
        self.show_dialog
      end
      # 新增「重新載入 (開發用)」— 安全版：不移除模組常數，避免 SketchUp 當機
      main_menu.add_item('開發重新載入 (Dev Reload)') do
        begin
          dir = File.dirname(File.expand_path(__FILE__))
          # 關閉舊視窗
          if @dialog
            begin; @dialog.close; rescue; end
            @dialog = nil
          end
          # 依序重載 (不移除常數，直接覆蓋方法定義)
          load File.join(dir, 'config.rb')
          load File.join(dir, 'coze_api.rb')
          load File.join(dir, 'updater.rb')
          load File.join(dir, 'main.rb')
          LoamLab::AIURenderer.show_dialog
          puts "======= LoamLab: Dev Reload OK ======="
        rescue => e
          UI.messagebox("Dev Reload 失敗: #{e.message}")
        end
      end
      
      # 註冊快捷工具列 (Toolbar)
      toolbar = UI::Toolbar.new "LoamLab"
      cmd = UI::Command.new("AI Render") {
        self.show_dialog
      }
      cmd.tooltip = "啟動 LoamLab AI 渲染器"
      cmd.status_bar_text = "打開 AI 渲染器大屏介面"
      # 未來可在此加入 .svg 或 .png 的 icon
      
      toolbar = toolbar.add_item cmd
      toolbar.show

      file_loaded(__FILE__)
    end
  end
end
