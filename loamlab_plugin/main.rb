require 'sketchup.rb'
require 'json'
require 'base64'
require 'tmpdir'
require 'net/http'
require 'uri'
require 'openssl'
require_relative 'config.rb'
require_relative 'coze_api.rb'

module LoamLab

  # Dev-only logging helper — silent in release builds
  def self.log(msg)
    puts msg if LoamLab::BUILD_TYPE == 'dev'
  end

  # 全局 cloud URL 索引路徑（存於系統 AppData，不污染用戶資料夾）
  def self.cloud_index_path
    base = if Sketchup.platform == :platform_win
      ENV['APPDATA'] || File.expand_path('~')
    else
      File.expand_path('~/Library/Application Support')
    end
    dir = File.join(base, 'LoamLab')
    Dir.mkdir(dir) unless File.directory?(dir)
    File.join(dir, 'cloud_index.json')
  end

  def self.read_cloud_index
    path = cloud_index_path
    File.exist?(path) ? (JSON.parse(File.read(path)) rescue {}) : {}
  end

  def self.write_cloud_index(index)
    File.write(cloud_index_path, JSON.generate(index)) rescue nil
  end

  module AIURenderer

    # 截圖前強制套用的 SketchUp 顯示設定（全用戶統一，截圖後立即還原）
    # EdgeDisplayMode 是邊線主開關（整數：1=開, 0=關）；DrawEdges 這個 key 不存在
    RENDER_KEYS = {
      # Edge Style — EdgeDisplayMode 是唯一有效的邊線主開關
      'EdgeDisplayMode'     => 0,       # 全部邊線關閉（0=關, 1=開）
      'DrawBackEdges'       => false,   # 後側邊線
      'DrawSilhouettes'     => true,    # Profiles 輪廓線保留（助 AI 辨識幾何輪廓）
      'SilhouetteWidth'     => 1,       # Profile 粗細（像素）
      'DrawDepthQue'        => false,   # Depth Cue
      # AO（AmbientOcclusion；新圖形引擎支援，classic engine 靜默跳過）
      'AmbientOcclusion'    => true,
      # Modeling
      'DisplayInstanceAxes' => false,
      'DisplaySketchAxes'   => false,
    }.freeze

    # shadow_info 陰影設定（截圖用固定值，admin 可透過 _render_force_style 覆蓋）
    # shadow_info 強制值：只統一 Light/Dark 色調，DisplayShadows 由 admin _render_force_style 控制
    # （預設不強制開/關陰影，以免覆蓋用戶模型設定；admin 可透過 force_style 追加 DisplayShadows）
    SHADOW_KEYS_DEFAULT = { 'Light' => 17, 'Dark' => 81 }.freeze

    @@requests        ||= []
    @@pending_results   = []
    @@polling_dialog    = nil
    @@deferred_sends    = []   # Method B：Scene 1+ 的延遲 HTTP 佇列
    @@scene0_style_url  = nil  # Method B：Scene 0 成功後的結果 URL
    @@ao_unsupported    = false # 偵測：用戶是否在 classic engine（AO 不支持）

    # [v1.4.2 Hotfix] 如果正在重載代碼（更新或熱重載），且舊視窗還在，強制清除它
    # 這樣可以確保 1.3.3 -> 1.4.2 的用戶能看到新版介面（因其 updater.rb 呼叫 show_dialog 不帶參數）
    if @dialog
      begin; @dialog.close; rescue => e; LoamLab.log "[LoamLab] dialog close: #{e.message}"; end
      @dialog = nil
      @@polling_dialog = nil
    end

    # 主執行緒輪詢器：從 Thread 接收結果並傳給 JS（每 0.5 秒）
    # 每次只送一個結果，避免連續 execute_script 在 WebView 快速連發導致第一個被丟棄
    # 熱重載安全：取消舊計時器，避免多重 timer 同時跑導致結果格式混亂
    UI.stop_timer($loamlab_poll_timer) if defined?($loamlab_poll_timer) && $loamlab_poll_timer
    $loamlab_poll_timer = UI.start_timer(0.5, true) do
      d = @@polling_dialog
      unless @@pending_results.empty? || d.nil?
        res = @@pending_results.shift
        begin
          b64 = Base64.strict_encode64(res.to_json)
          d.execute_script("window.receiveFromRubyBase64('#{b64}')")
        rescue => e
          @@pending_results.unshift(res)  # execute_script 失敗 → 放回等下次重試
          LoamLab.log "[LoamLab] Poll 傳送失敗: #{e.message}"
        end
      end
    end

    def self.safe_set_render_keys(ro, keys_hash)
      valid_keys = ro.keys
      keys_hash.each do |k, v|
        begin
          ro[k] = v if valid_keys.include?(k)
        rescue => e
          LoamLab.log "[LoamLab] render key #{k}: #{e.message}"
        end
      end
    end

    def self.apply_render_keys(model)
      ro = model.rendering_options
      RENDER_KEYS.keys.each do |k|
        begin; model.set_attribute('LoamLabRenderOverride', k, ro[k]); rescue => e; LoamLab.log "[LoamLab] render attr #{k}: #{e.message}"; end
      end
      self.safe_set_render_keys(ro, RENDER_KEYS)
      # 偵測 AO 是否受支持（AmbientOcclusion 僅在新圖形引擎的 rendering_options.keys 中存在）
      @@ao_unsupported = RENDER_KEYS['AmbientOcclusion'] == true && !ro.keys.include?('AmbientOcclusion')
      # shadow_info 另存（si: 前綴避免鍵名碰撞）並套用預設值
      si = model.shadow_info
      SHADOW_KEYS_DEFAULT.keys.each do |k|
        begin; model.set_attribute('LoamLabRenderOverride', "si:#{k}", si[k]); rescue => e; end
      end
      SHADOW_KEYS_DEFAULT.each { |k, v| begin; si[k] = v; rescue => e; end }
      # 不在此處做全頁 p.update — SU2023 批量 page update 可能在 C++ 層崩潰；
      # 截圖前的每場景 safe_set_render_keys 已確保截圖樣式正確，還原時由 restore_render_keys 統一 p.update。
      model.set_attribute('LoamLabRenderOverride', 'applied', true)
    end

    def self.restore_render_keys(model)
      ro = model.rendering_options
      restore_hash = {}
      RENDER_KEYS.keys.each do |k|
        val = model.get_attribute('LoamLabRenderOverride', k)
        restore_hash[k] = val unless val.nil?
      end
      self.safe_set_render_keys(ro, restore_hash)
      # 還原 shadow_info
      si = model.shadow_info
      SHADOW_KEYS_DEFAULT.keys.each do |k|
        val = model.get_attribute('LoamLabRenderOverride', "si:#{k}")
        begin; si[k] = val unless val.nil?; rescue => e; end
      end
      model.pages.each do |p|
        begin; p.update(Sketchup::Page::PAGE_USE_RENDERING_OPTIONS | Sketchup::Page::PAGE_USE_SHADOW_INFO); rescue => e; LoamLab.log "[LoamLab] page update: #{e.message}"; end
      end
      model.set_attribute('LoamLabRenderOverride', 'applied', false)
    end

    # admin 透過 _render_force_style 覆蓋截圖樣式值（原始值已由 apply_render_keys 儲存，此處只覆蓋不重存）
    def self.apply_force_style_override(model, force_style)
      return if force_style.nil? || force_style.empty?
      ro = model.rendering_options
      # rendering_options 的有效 key（EdgeDisplayMode 是主開關，DrawEdges 不存在）
      ro_keys = ['EdgeDisplayMode', 'DrawBackEdges', 'DrawSilhouettes', 'SilhouetteWidth',
                 'DrawDepthQue', 'AmbientOcclusion', 'DisplayInstanceAxes', 'DisplaySketchAxes']
      ro_keys.each do |k|
        begin; ro[k] = force_style[k] if force_style.key?(k) && ro.keys.include?(k); rescue => e; end
      end
      # shadow_info 的 key（DisplayShadows, Light, Dark）
      si = model.shadow_info
      ['DisplayShadows', 'Light', 'Dark'].each do |k|
        next unless force_style.key?(k)
        begin
          si[k] = k == 'DisplayShadows' ? !!force_style[k] : force_style[k].to_i
        rescue => e; end
      end
    end

    # 取得系統的 Downloads 資料夾路徑
    def self.get_downloads_folder
      if Sketchup.platform == :platform_win
        folder = File.join(ENV['USERPROFILE'], 'Downloads')
      else
        folder = File.expand_path('~/Downloads')
      end
      folder.force_encoding("UTF-8").gsub("\\", "/")
    end

    # 取得當前有效的儲存路徑：per-model → global default → Downloads
    def self.get_effective_save_path(model)
      path = model.get_attribute("LoamLabAI", "save_path", "")
      if path.empty? || !File.directory?(path)
        path = Sketchup.read_default("LoamLabAI", "global_save_path", "")
      end
      if path.empty? || !File.directory?(path)
        path = self.get_downloads_folder
      end
      path
    end

    def self.show_dialog(force = false)
      # 如果強制重開，先關閉存在的視窗
      if force && @dialog
        begin; @dialog.close; rescue => e; LoamLab.log "[LoamLab] dialog close: #{e.message}"; end
        @dialog = nil
      end

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
        :min_width => 1050,
        :min_height => 700,
        :style => UI::HtmlDialog::STYLE_DIALOG
      }

      @dialog = UI::HtmlDialog.new(options)
      
      # 載入 UI 的 index.html，附加上時間戳記以強制作廢 SketchUp 內建瀏覽器快取
      current_dir = File.dirname(__FILE__)
      html_path = File.join(current_dir, 'ui', 'index.html')
      # 因 set_file 不支援 querystring，改用 set_url 來載入含有 cache-busting 的本地檔案路徑
      url = "#{path_to_file_uri(html_path)}?t=#{Time.now.to_i}"
      @dialog.set_url(url)
      
      # 註冊所有的 JS to Ruby Callback
      self.register_callbacks(@dialog)

      @dialog.set_on_closed do
        m = Sketchup.active_model
        self.restore_render_keys(m) if m
        @dialog = nil
        @@polling_dialog = nil
      end

      @@polling_dialog = @dialog
      @dialog.show
    end

    def self.register_callbacks(dialog)
      # 1. 初始化資料請求 (由 JS 呼叫)
      dialog.add_action_callback("getInitialData") do |action_context, params|
        model = Sketchup.active_model
        save_path = self.get_effective_save_path(model)
        user_email = Sketchup.read_default("LoamLabAI", "user_email", "")
        saved_lang = Sketchup.read_default("LoamLabAI", "ui_lang", "")
        
        device_id = Sketchup.read_default("LoamLabAI", "device_id", "")
        if device_id.to_s.strip.empty?
          device_id = "10000000-1000-4000-8000-100000000000".gsub(/0/){rand(16).to_s(16)}
          Sketchup.write_default("LoamLabAI", "device_id", device_id)
        end

        # 偵測 AO 是否受支持（classic engine 沒有 AmbientOcclusion key）
        ao_unsupported = RENDER_KEYS['AmbientOcclusion'] == true &&
                         !model.rendering_options.keys.include?('AmbientOcclusion')

        response = {
          status: 'success',
          version: LoamLab::VERSION,
          api_base: LoamLab::API_BASE_URL,
          build_type: LoamLab::BUILD_TYPE,
          dist_channel: LoamLab::DIST_CHANNEL,
          lang: saved_lang.empty? ? nil : saved_lang,
          scenes: self.get_scene_names,
          save_path: save_path,
          user_email: user_email,
          device_id: device_id,
          ao_unsupported: ao_unsupported
        }
        
        json_str = response.to_json
        dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(json_str)}')")

        # 若上次渲染後未正常還原（如插件強制關閉），在此還原
        if model.get_attribute('LoamLabRenderOverride', 'applied') == true
          self.restore_render_keys(model)
        end
        # 注意：apply_render_keys 已移至 batch_export_scenes 渲染開始時才呼叫
        # 此處不再套用強制樣式，避免插件開啟時就改變 SketchUp 視圖
      end

      # 1.2 更新相關（僅限 direct channel；EW 版不注冊，審核員看不到 update 能力）
      if LoamLab::DIST_CHANNEL != 'store'
        dialog.add_action_callback("check_for_updates") do |action_context, params|
          require_relative 'updater.rb'
          LoamLab::Updater.check_for_updates(dialog, LoamLab::VERSION)
        end

        dialog.add_action_callback("install_update") do |action_context, params|
          require_relative 'updater.rb'
          LoamLab::Updater.download_and_install(dialog, (params || {})["url"].to_s)
        end
      end

      # 1.3 瀏覽器開啟與授權儲存
      dialog.add_action_callback("open_browser") do |action_context, url|
        UI.openURL(url)
      end

      dialog.add_action_callback("save_email") do |action_context, email|
        Sketchup.write_default("LoamLabAI", "user_email", email)
      end
      
      dialog.add_action_callback("logout_user") do |action_context|
        Sketchup.write_default("LoamLabAI", "user_email", "")
      end

      dialog.add_action_callback("save_ui_lang") do |action_context, params|
        lang = params.is_a?(Hash) ? params["lang"] : params.to_s
        Sketchup.write_default("LoamLabAI", "ui_lang", lang) unless lang.nil? || lang.empty?
      end

      # 1.5. 讓使用者指定專案存檔目錄
      dialog.add_action_callback("choose_save_dir") do |action_context, params|
        model = Sketchup.active_model
        current_path = self.get_effective_save_path(model)
        
        # 安全機制：當路徑不存在或為空時，不帶 directory 參數，以免 SU 崩潰
        chosen_dir = UI.select_directory(title: "選擇專案 AI 輸出資料夾", directory: current_path)
        
        if chosen_dir && !chosen_dir.empty?
          model.set_attribute("LoamLabAI", "save_path", chosen_dir)
          Sketchup.write_default("LoamLabAI", "global_save_path", chosen_dir)
          # 回傳給 JS 更新 UI
          json_str = chosen_dir.to_json
          dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64({action: 'updateSaveDir', path: chosen_dir}.to_json)}')")
        end
      end

      # 2. 開始渲染指令 (由 JS 呼叫)
      dialog.add_action_callback("render_scene") do |action_context, params|
        LoamLab.log "LoamLab: 收到渲染指令 - #{params.inspect}"
        scenes_to_render        = params["scenes"] || []
        user_prompt             = (params["prompt"] || "").to_s.dup.force_encoding("UTF-8")
        resolution              = params["resolution"] || "1k"
        tool                    = (params["tool"] || 1).to_i
        base_image_url          = (params["base_image_url"] || "").to_s
        base_image_scene        = (params["base_image_scene"] || "底圖").to_s.dup.force_encoding("UTF-8")
        reference_image_base64  = (params["reference_image_base64"] || "").to_s
        user_style_ref_url      = (params["style_ref_url"] || "").to_s.strip
        advanced_settings       = params["advanced_settings"] || {}
        render_force_style      = begin; JSON.parse((params["render_force_style"] || "{}").to_s); rescue; {}; end

        dialog.execute_script("window.receiveFromRuby({status: 'rendering'})")

        # 延遲一點執行，避免阻塞前端 UI 動畫
        UI.start_timer(0.1, false) do
            self.batch_export_scenes(dialog, scenes_to_render, user_prompt, resolution, tool, base_image_url, base_image_scene, reference_image_base64, advanced_settings, user_style_ref_url, render_force_style)
        end
      end

      # JS 在最後一張渲染結果收到後呼叫，還原 SketchUp 的 RENDER_KEYS 樣式設定
      dialog.add_action_callback("restore_render_style") do |action_context, params|
        m = Sketchup.active_model
        self.restore_render_keys(m) if m
      end

      # 分享本機圖片：讀取本機圖片為 base64，傳給前端上傳至圖床
      # 本機圖片分享：Ruby 直接上傳圖床，只把 cloud URL 回傳 JS（避免大型 base64 卡死 bridge）
      dialog.add_action_callback("upload_local_image_for_share") do |action_context, params|
        UI.start_timer(0.1, false) do
          begin
            require 'net/http'
            require 'uri'
            p = params.is_a?(Hash) ? params : {}
            raw_url = (p["file_url"] || "").to_s
            local_path = raw_url.start_with?("file:") ? file_uri_to_path(raw_url) : raw_url
            raise "找不到圖片: #{local_path}" unless File.exist?(local_path)

            img_data = File.read(local_path, mode: 'rb')
            b64_clean = Base64.strict_encode64(img_data)

            # 上傳到 freeimage.host（免費，不需 API key）
            cloud_url = nil
            begin
              uri = URI('https://freeimage.host/api/1/upload')
              http = Net::HTTP.new(uri.host, uri.port)
              http.use_ssl = true
              http.read_timeout = 30
              req = Net::HTTP::Post.new(uri)
              req.set_form_data('key' => '6d207e02198a847aa98d0a2a901485a5', 'action' => 'upload', 'source' => b64_clean, 'format' => 'json')
              res = http.request(req)
              result = JSON.parse(res.body)
              cloud_url = result.dig('image', 'url') if result['status_code'] == 200
            rescue => _upload_err
            end

            if cloud_url
              dialog.execute_script("window._onLocalImageUploaded(#{cloud_url.to_json})")
            else
              dialog.execute_script("window._onLocalImageUploaded(null, '上傳失敗，請稍後再試')")
            end
          rescue => e
            dialog.execute_script("window._onLocalImageUploaded(null, #{e.message.to_json})")
          end
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

      # 新增功能：儲存渲染圖到用戶指定位置
      dialog.add_action_callback("save_image") do |action_context, params|
        url = params["url"]
        next unless url

        default_name = "AI_Render_#{Time.now.strftime('%H%M%S')}.jpg"
        save_path = self.get_effective_save_path(Sketchup.active_model)
        file_path = UI.savepanel("保存渲染圖", save_path, default_name)
        if file_path
          begin
            require 'open-uri'
            File.open(file_path, "wb") { |f| URI.open(url) { |img| f.write(img.read) } }
            UI.messagebox("圖片已成功保存至:\n#{file_path}")
          rescue => e
            UI.messagebox("儲存圖片失敗:\n#{e.message}")
          end
        end
      end

      # 4. 同步預覽畫面指令 (處理批量故事板預覽)
      dialog.add_action_callback("sync_preview") do |action_context, params|
        begin
          LoamLab.log "LoamLab: 正在擷取即時預覽故事板..."
          scenes = params["scenes"] || []
          batch_data = []

          if scenes.empty?
            base64_img = self.get_preview_base64
            batch_data << { scene: "當前即時視角", image_data: base64_img }
            dialog.execute_script("window.receiveFromRuby(#{{ status: 'preview_updated', batch_data: batch_data }.to_json})")
          else
            model = Sketchup.active_model
            next unless model

            current_page  = model.pages.selected_page
            page_options  = model.options['PageOptions']
            old_transition = page_options['ShowTransition']
            page_options['ShowTransition'] = false if old_transition

            safe_keys = ['DrawHidden', 'DrawHiddenObjects', 'DisplaySketchAxes', 'DisplayInstanceAxes']
            original_states = {}
            safe_keys.each do |k|
              begin
                if model.rendering_options.keys.include?(k)
                  original_states[k] = model.rendering_options[k]
                  model.rendering_options[k] = false
                end
              rescue => e
                LoamLab.log "[LoamLab] render option #{k}: #{e.message}"
              end
            end

            remaining = scenes.dup
            capture_next = nil
            capture_next = lambda do
              if remaining.empty?
                model.pages.selected_page = current_page if current_page
                self.safe_set_render_keys(model.rendering_options, RENDER_KEYS)
                page_options['ShowTransition'] = old_transition if old_transition
                original_states.each { |k, v| begin; model.rendering_options[k] = v; rescue; end }
                dialog.execute_script("window.receiveFromRuby(#{{ status: 'preview_updated', batch_data: batch_data }.to_json})")
              else
                scene_name = remaining.shift
                if page = model.pages[scene_name]
                  model.pages.selected_page = page
                  self.safe_set_render_keys(model.rendering_options, RENDER_KEYS)
                  # 非阻塞：給 SketchUp 50ms 刷新後再截圖，避免主執行緒凍結
                  UI.start_timer(0.05, false) do
                    base64_img = self.get_preview_base64
                    batch_data << { scene: scene_name, image_data: base64_img }
                    capture_next.call
                  end
                else
                  capture_next.call
                end
              end
            end
            capture_next.call
          end
        rescue => e
          UI.messagebox("Sync Preview Error: #{e.message}")
        end
      end

      # 5. AI 渲染結果自動存檔 → 下載圖片到 save_path
      dialog.add_action_callback("auto_save_render") do |action_context, params|
        url    = params["url"]
        scene  = (params["scene"]      || "render").to_s.dup.force_encoding("UTF-8")
        res    = (params["resolution"] || "2k").to_s

        next unless url

        model        = Sketchup.active_model
        project_name = (model.title.empty? ? "未命名專案" : model.title).to_s.dup.force_encoding("UTF-8")
        save_path    = self.get_effective_save_path(model)
        next if !File.directory?(save_path)

        begin
          require 'open-uri'
          timestamp         = Time.now.strftime("%Y%m%d_%H%M%S")
          safe_project_name = project_name.gsub(/[:*?"<>|\\\/]/, "_")
          safe_scene        = scene.gsub(/[:*?"<>|\\\/]/, "_")[0, 30]
          # 檔名範例：20231027_120000_專案名稱_場景名稱_render.jpg
          filename          = "#{timestamp}_#{safe_project_name}_#{safe_scene}_render.jpg"
          full_path         = File.join(save_path, filename)
          File.open(full_path, "wb") { |f| URI.open(url) { |img| f.write(img.read) } }
          # 將 cloud URL 寫入全局索引（AppData/LoamLab/cloud_index.json），不污染用戶資料夾
          index = LoamLab.read_cloud_index
          index[full_path] = url
          LoamLab.write_cloud_index(index)
          LoamLab.log "[LoamLab] auto_save_render: #{filename}"
        rescue => e
          LoamLab.log "[LoamLab] auto_save_render failed: #{e.message}"
        end
      end

      # 6. 列出已儲存的渲染歷史
      dialog.add_action_callback("list_saved_renders") do |action_context, params|
        begin
          model     = Sketchup.active_model
          save_path = self.get_effective_save_path(model)

          history = []
          if !save_path.empty? && File.directory?(save_path)
            # 掃描渲染圖（新版 ASCII + 舊版繁/簡體向後相容）
            files = Dir.glob(File.join(save_path, "*_render.jpg"))
            files += Dir.glob(File.join(save_path, "*_original.jpg"))
            files += Dir.glob(File.join(save_path, "*_渲染圖.jpg"))
            files += Dir.glob(File.join(save_path, "*_渲染图.jpg"))
            files += Dir.glob(File.join(save_path, "*_原圖.jpg"))
            files += Dir.glob(File.join(save_path, "*_原图.jpg"))
            # 向後相容舊版的命名 (loamlab_camera.jpg)
            files += Dir.glob(File.join(save_path, "*_loamlab_camera.jpg"))
            files = files.uniq.sort_by { |f| -File.mtime(f).to_i }
            # 載入全局 cloud URL 索引（key = 絕對路徑）
            index = LoamLab.read_cloud_index
            history = files.first(60).map do |f|
              fname = File.basename(f)
              # 格式：YYYYMMDD_HHMMSS_SCENE_RES_loamlab_camera.jpg (舊版)
              m = fname.match(/^(\d{8})_(\d{6})_(.+)_(1k|2k|4k)_loamlab_camera\.jpg$/i)
              if m
                ts    = "#{m[1]}_#{m[2]}"
                scene = m[3].gsub('_', ' ')
                res   = m[4]
              else
                # 新版格式：YYYYMMDD_HHMMSS_專案_場景_(render|original|渲染圖|原圖).jpg
                m2 = fname.match(/^(\d{8}_\d{6})_(.+)_(render|original|渲染圖|渲染图|原圖|原图)\.jpg$/i)
                if m2
                  ts    = m2[1]
                  parts = m2[2].split('_')
                  scene = parts.last || m2[2]
                  res   = ''
                else
                  ts = File.mtime(f).strftime("%Y%m%d_%H%M%S")
                  res = ''; scene = fname
                end
              end
              file_url  = path_to_file_uri(f)
              # 優先從全局索引讀取（key = 絕對路徑），向後相容舊版 sidecar
              cloud_url = index[f]
              unless cloud_url
                cache_cloudurl = File.join(save_path, '.loamlab_cache', fname.sub(/\.jpg$/i, '.cloudurl'))
                old_cloudurl   = f.sub(/\.jpg$/i, '.cloudurl')
                cloudurl_path  = File.exist?(cache_cloudurl) ? cache_cloudurl : old_cloudurl
                cloud_url = File.exist?(cloudurl_path) ? File.read(cloudurl_path).strip : nil
              end
              entry = { 'filename' => fname, 'scene' => scene, 'resolution' => res,
                        'timestamp' => ts, 'file_url' => file_url }
              entry['cloud_url'] = cloud_url if cloud_url && !cloud_url.empty?
              entry
            end
          end

          payload = { action: 'historyList', files: history }.to_json
          dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(payload)}')")
        rescue => e
          payload = { action: 'historyList', files: [] }.to_json
          dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(payload)}')")
          LoamLab.log "[LoamLab] list_saved_renders error: #{e.message}"
        end
      end

      # 7. 專屬：匯出 IG 貼文素材至獨立資料夾
      dialog.add_action_callback("export_ig_assets") do |action_context, params|
        begin
          require 'fileutils'
          model = Sketchup.active_model
          save_path = self.get_effective_save_path(model)
          
          # 建立桌面隔離資料夾
          desktop_path = ENV['HOME'] || ENV['USERPROFILE']
          desktop_path = File.join(desktop_path, 'Desktop')
          export_dir = File.join(desktop_path, '[LoamLab]_IG貼文素材')
          
          FileUtils.mkdir_p(export_dir)
          
          files = params['files'] || []
          text = params['text'] || ""
          
          # 將選擇的圖片單獨拷貝進去
          files.each do |fname|
            source = File.join(save_path, fname)
            target = File.join(export_dir, fname)
            FileUtils.cp(source, target) if File.exist?(source)
          end
          
          # 寫入文案 text 檔
          File.write(File.join(export_dir, '貼文文案.txt'), text)
          
          # 打開這個乾淨的資料夾
          if Sketchup.platform == :platform_win
            UI.openURL("file:///#{export_dir}")
          else
            UI.openURL("file://#{export_dir}")
          end
        rescue => e
          LoamLab.log "[LoamLab] export_ig_assets error: #{e.message}"
        end
      end

      # 7. 自動開啟儲存路徑 (算圖完成後觸發)
      dialog.add_action_callback("open_save_dir") do |action_context, params|
        model = Sketchup.active_model
        save_path = self.get_effective_save_path(model)
        if File.directory?(save_path)
          UI.openURL(path_to_file_uri(save_path))
        end
      end

      # 8. 生成色塊通道圖 (Segmentation Map) — Tool 2 選物件用
      # Smart Canvas 執行：遠端底圖 URL + 合并 prompt → /api/render Tool 2 → Coze Banana2
      dialog.add_action_callback("smart_canvas_execute") do |action_context, params|
        base_image_url = (params["base_image_url"] || "").to_s
        prompt         = (params["prompt"] || "").to_s.dup.force_encoding("UTF-8")
        resolution     = (params["resolution"] || "2k").to_s
        scene_label    = (params["scene_label"] || "Smart Canvas").to_s

        if base_image_url.empty?
          dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: 'Smart Canvas: 缺少底圖 URL' })})")
          next
        end

        dialog.execute_script("window.receiveFromRuby({status: 'rendering'})")

        UI.start_timer(0.1, false) do
          begin
            user_email = Sketchup.read_default("LoamLabAI", "user_email", "").to_s.force_encoding("UTF-8").scrub("?")
            request_body = JSON.dump({
              tool: 2,
              parameters: {
                "base_image_url" => base_image_url,
                "user_prompt"    => prompt,
                "resolution"     => resolution,
                "aspect_ratio"   => "16:9"
              }
            })
            req = Sketchup::Http::Request.new("#{::LoamLab::API_BASE_URL}/api/render", Sketchup::Http::POST)
            req.headers = { 'Content-Type' => 'application/json', 'x-user-email' => user_email, 'x-plugin-version' => ::LoamLab::VERSION }
            req.body = request_body
            captured_label = scene_label
            req.start do |_, response|
              begin
                data = JSON.parse(response.body.to_s.force_encoding("UTF-8").scrub("?"))
                result = (data['code'] == 0 && data['url']) ?
                  { status: 'render_success', scene_name: captured_label, url: data['url'],
                    points_remaining: data['points_remaining'], transaction_id: data['transaction_id'] } :
                  { status: 'render_failed', message: self.sanitize_error(data['msg'] || "HTTP #{response.status_code}") }
              rescue => e
                result = { status: 'render_failed', message: self.sanitize_error("解析失敗: #{e.message}") }
              end
              UI.start_timer(0, false) { dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(result.to_json)}')") }
            end
            UI.start_timer(0.1, false) { dialog.execute_script("window.receiveFromRuby({status: 'export_done'})") }
          rescue => e
            dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: self.sanitize_error("Smart Canvas 執行失敗: #{e.message}") })})")
          end
        end
      end

      dialog.add_action_callback("loamlab_generate_seg_map") do |action_context|
        begin
          model = Sketchup.active_model
          view  = model.active_view

          # 收集所有 top-level Groups / ComponentInstances
          top_entities = model.active_entities.select { |e|
            e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
          }

          if top_entities.empty?
            dialog.execute_script("window._onSegMapReady(#{JSON.dump({error: 'No objects found in scene'})})")
            next
          end

          # 為每個 entity 分配唯一顏色（黃金角 137.5° 均勻分佈）
          color_entries = []
          materials_created = []
          top_entities.each_with_index do |ent, i|
            hue = (i * 137.5) % 360
            r, g, b = self.hsl_to_rgb(hue, 0.78, 0.52)
            hex = format("#%02X%02X%02X", r, g, b)
            raw_name = ent.respond_to?(:name) ? ent.name : ""
            display_name = raw_name.empty? ? "Object #{i + 1}" : raw_name
            color_entries << { color: hex, name: display_name }

            mat = model.materials.add("__seg_#{i}_#{ent.object_id}")
            mat.color = Sketchup::Color.new(r, g, b)
            materials_created << mat
          end

          # 儲存原始材質 & 遞迴覆蓋
          saved_materials = {}
          top_entities.each_with_index do |ent, i|
            self.override_faces_recursive(ent, materials_created[i], saved_materials)
          end

          # 截圖
          temp_dir  = Dir.tmpdir
          temp_path = File.join(temp_dir, "loamlab_segmap_#{Time.now.to_i}.jpg")
          view.write_image(temp_path, 1280, 720, true, 0.9)

          # 還原原始材質
          saved_materials.each do |_, s|
            begin
              s[:face].material      = s[:mat]
              s[:face].back_material = s[:back]
            rescue => e; LoamLab.log "[LoamLab] face material restore: #{e.message}"; end
          end
          # 刪除臨時材質
          materials_created.each { |m| model.materials.remove(m) rescue nil }

          # 轉 base64
          seg_b64 = Base64.strict_encode64(File.read(temp_path, mode: 'rb'))
          File.delete(temp_path) rescue nil

          result = { segmap_base64: "data:image/jpeg;base64,#{seg_b64}", color_entries: color_entries }
          dialog.execute_script("window._onSegMapReady(#{JSON.dump(result)})")
        rescue => e
          dialog.execute_script("window._onSegMapReady(#{JSON.dump({error: e.message})})")
          LoamLab.log "[LoamLab] generate_seg_map error: #{e.message}\n#{e.backtrace.first(3).join("\n")}"
        end
      end
    end

    # 獲取當前模型所有的場景名稱
    def self.get_scene_names
      model = Sketchup.active_model
      return [] unless model
      model.pages.map { |page| page.name }
    end

    # ─── 跨平台路徑工具 ──────────────────────────────────────────────
    # 本地路徑 → file:/// URL（Windows: C:/... → file:///C:/..., Mac: /Users/... → file:///Users/...）
    def self.path_to_file_uri(path)
      normalized = path.gsub('\\', '/')
      normalized = "/#{normalized}" unless normalized.start_with?('/')
      "file://#{normalized}"
    end

    # file:/// URL → 本地路徑（反向轉換，跨平台正確）
    def self.file_uri_to_path(uri)
      path = uri.sub('file://', '')        # → "/Users/..." or "/C:/Users/..."
      path = path[1..-1] if path.match?(%r{\A/[A-Za-z]:/})  # Windows: 移除多餘開頭 /
      path
    end

    # 將當前往視角擷取為 Base64 圖片 (品質較低，縮圖預覽用)
    def self.get_preview_base64
      model = Sketchup.active_model
      return "" unless model
      
      temp_dir      = Dir.tmpdir
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
    def self.batch_export_scenes(dialog, scenes_to_render, user_prompt, resolution="1k", tool=1, base_image_url="", base_image_scene="底圖", reference_image_base64="", advanced_settings={}, user_style_ref_url="", render_force_style={})
      model = Sketchup.active_model
      return unless model
      @@polling_dialog = dialog

      # 工具 2 (Smart Canvas)：遠端 URL 直接透傳 render.js，不讀本地檔案
      if tool == 2 && !base_image_url.empty? && base_image_url.start_with?("http")
        begin
          user_email = Sketchup.read_default("LoamLabAI", "user_email", "").to_s.force_encoding("UTF-8").scrub("?")
          params_hash = {
            "base_image_url" => base_image_url,
            "user_prompt"    => user_prompt,
            "resolution"     => resolution,
            "smart_canvas"   => true
          }
          request_body = JSON.dump({ tool: 2, parameters: params_hash })
          req = Sketchup::Http::Request.new("#{::LoamLab::API_BASE_URL}/api/render", Sketchup::Http::POST)
          req.headers = { 'Content-Type' => 'application/json', 'x-user-email' => user_email, 'x-plugin-version' => ::LoamLab::VERSION }
          req.body = request_body
          captured_scene = base_image_scene
          req.start do |_, response|
            begin
              data   = JSON.parse(response.body.to_s.force_encoding("UTF-8").scrub("?"))
              result = (data['code'] == 0 && data['url']) ?
                { status: 'render_success', scene_name: captured_scene, url: data['url'], points_remaining: data['points_remaining'], transaction_id: data['transaction_id'] } :
                { status: 'render_failed', message: self.sanitize_error(data['msg'] || "HTTP #{response.status_code}") }
            rescue => e
              result = { status: 'render_failed', message: self.sanitize_error("解析失敗: #{e.message}") }
            end
            UI.start_timer(0, false) { dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(result.to_json)}')") }
          end
          UI.start_timer(0.1, false) { dialog.execute_script("window.receiveFromRuby({status: 'export_done'})") }
        rescue => e
          dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: self.sanitize_error("Smart Canvas 請求失敗: #{e.message}") })})")
        end
        return
      end

      # 工具 2：AtlasCloud 家具替換（base_image + 可選 reference_image，皆 base64）
      if tool == 2 && !base_image_url.empty? && base_image_url.start_with?("file:///")
        begin
          local_path = file_uri_to_path(base_image_url)
          unless File.exist?(local_path)
            dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: '底圖檔案已移除，請重新選擇底圖' })})")
            return
          end
          img_data   = File.read(local_path, mode: 'rb')
          base_data_uri = "data:image/jpeg;base64,#{Base64.strict_encode64(img_data)}"
          user_email = Sketchup.read_default("LoamLabAI", "user_email", "").to_s.force_encoding("UTF-8").scrub("?")
          params_hash = {
            "base_image"   => base_data_uri,
            "user_prompt"  => user_prompt,
            "resolution"   => resolution
          }
          params_hash["reference_image"] = reference_image_base64 unless reference_image_base64.empty?
          request_body = JSON.dump({ tool: 2, parameters: params_hash })
          req = Sketchup::Http::Request.new("#{::LoamLab::API_BASE_URL}/api/render", Sketchup::Http::POST)
          req.headers = { 'Content-Type' => 'application/json', 'x-user-email' => user_email, 'x-plugin-version' => ::LoamLab::VERSION }
          req.body = request_body
          captured_scene = base_image_scene
          req.start do |_, response|
            begin
              data   = JSON.parse(response.body.to_s.force_encoding("UTF-8").scrub("?"))
              result = (data['code'] == 0 && data['url']) ?
                { status: 'render_success', scene_name: captured_scene, url: data['url'], points_remaining: data['points_remaining'], transaction_id: data['transaction_id'] } :
                { status: 'render_failed', message: self.sanitize_error(data['msg'] || "HTTP #{response.status_code}") }
            rescue => e
              result = { status: 'render_failed', message: self.sanitize_error("解析失敗: #{e.message}") }
            end
            UI.start_timer(0, false) { dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(result.to_json)}')") }
          end
          UI.start_timer(0.1, false) { dialog.execute_script("window.receiveFromRuby({status: 'export_done'})") }
        rescue => e
          dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: "底圖讀取失敗: #{e.message}" })})")
        end
        return
      end

      # 非 T2 工具（T3 等）底圖模式：雲端 URL 直接透傳，跳過 SketchUp 截圖
      if tool != 2 && !base_image_url.empty? && base_image_url.start_with?("http")
        begin
          user_email = Sketchup.read_default("LoamLabAI", "user_email", "").to_s.force_encoding("UTF-8").scrub("?")
          request_body = JSON.dump({
            tool: tool,
            parameters: { "image" => [base_image_url], "user_prompt" => user_prompt, "resolution" => resolution, "aspect_ratio" => "16:9" },
            "advanced_settings" => advanced_settings
          })
          req = Sketchup::Http::Request.new("#{::LoamLab::API_BASE_URL}/api/render", Sketchup::Http::POST)
          req.headers = { 'Content-Type' => 'application/json', 'x-user-email' => user_email, 'x-plugin-version' => ::LoamLab::VERSION }
          req.body = request_body
          captured_scene = base_image_scene
          req.start do |_, response|
            begin
              data   = JSON.parse(response.body.to_s.force_encoding("UTF-8").scrub("?"))
              result = (data['code'] == 0 && data['url']) ?
                { status: 'render_success', scene_name: captured_scene, url: data['url'], points_remaining: data['points_remaining'], transaction_id: data['transaction_id'] } :
                { status: 'render_failed', message: self.sanitize_error(data['msg'] || "HTTP #{response.status_code}") }
            rescue => e
              result = { status: 'render_failed', message: self.sanitize_error("解析失敗: #{e.message}") }
            end
            UI.start_timer(0, false) { dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(result.to_json)}')") }
          end
          UI.start_timer(0.1, false) { dialog.execute_script("window.receiveFromRuby({status: 'export_done'})") }
        rescue => e
          dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: self.sanitize_error("底圖讀取失敗: #{e.message}") })})")
        end
        return
      end

      # 工具 3 底圖模式：直接讀本地圖檔送 Coze，跳過 SketchUp 截圖
      if !base_image_url.empty? && base_image_url.start_with?("file:///")
        begin
          local_path = file_uri_to_path(base_image_url)
          unless File.exist?(local_path)
            dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: '底圖檔案已移除，請重新選擇底圖' })})")
            return
          end
          img_data   = File.read(local_path, mode: 'rb')
          data_uri   = "data:image/jpeg;base64,#{Base64.strict_encode64(img_data)}"
          user_email = Sketchup.read_default("LoamLabAI", "user_email", "").to_s.force_encoding("UTF-8").scrub("?")
          request_body = JSON.dump({
            tool: tool,
            parameters: { "image" => [data_uri], "user_prompt" => user_prompt, "resolution" => resolution, "aspect_ratio" => "16:9" },
            "advanced_settings" => advanced_settings
          })
          req = Sketchup::Http::Request.new("#{::LoamLab::API_BASE_URL}/api/render", Sketchup::Http::POST)
          req.headers = { 'Content-Type' => 'application/json', 'x-user-email' => user_email, 'x-plugin-version' => ::LoamLab::VERSION }
          req.body = request_body
          captured_scene = base_image_scene
          req.start do |_, response|
            begin
              data   = JSON.parse(response.body.to_s.force_encoding("UTF-8").scrub("?"))
              result = (data['code'] == 0 && data['url']) ?
                { status: 'render_success', scene_name: captured_scene, url: data['url'], points_remaining: data['points_remaining'], transaction_id: data['transaction_id'] } :
                { status: 'render_failed', message: self.sanitize_error(data['msg'] || "HTTP #{response.status_code}") }
            rescue => e
              result = { status: 'render_failed', message: self.sanitize_error("解析失敗: #{e.message}") }
            end
            UI.start_timer(0, false) { dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(result.to_json)}')") }
          end
          UI.start_timer(0.1, false) { dialog.execute_script("window.receiveFromRuby({status: 'export_done'})") }
        rescue => e
          dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: "底圖讀取失敗: #{e.message}" })})")
        end
        return
      end

      current_page = model.pages.selected_page

      # 批量出圖：先暫停任何正在播放的動畫，避免截到動畫過渡幀
      begin
        Sketchup.send_action("pauseAnimation:")
      rescue => e
        LoamLab.log "[LoamLab] pauseAnimation: #{e.message}"
      end

      # 禁用場景切換過渡動畫，避免截圖時切換尚未完成
      begin
        opts = model.options['PageOptions']
        original_transition_time = opts['TransitionTime'] rescue 0.5
        opts['TransitionTime'] = 0.0
      rescue => _e
        original_transition_time = 0.5
      end

      # ── 一次性套用強制樣式（渲染開始時才套用，不在 dialog 開啟時套用）──
      # 若上次渲染後未還原（如插件強制關閉），先還原再重新套用
      if model.get_attribute('LoamLabRenderOverride', 'applied') == true
        self.restore_render_keys(model)
      end
      self.apply_render_keys(model)
      if @@ao_unsupported
        @@pending_results << { status: 'system_hint', hint_id: 'new_engine_for_ao' }
      end
      # 套用 admin 覆蓋值（在 RENDER_KEYS 基礎上再覆蓋）
      self.apply_force_style_override(model, render_force_style) unless render_force_style.empty?
      # 不做批量 p.update：SU2023 批量 page update 可能在 C++ 層崩潰（致少部分用戶閃退）
      # 每場景的 safe_set_render_keys 已在 selected_page= 後重新套用，批量 update 為冗餘操作

      temp_dir     = Dir.tmpdir
      project_name = (model.title.empty? ? "未命名專案" : model.title).to_s.dup.force_encoding("UTF-8")
      save_path = self.get_effective_save_path(model)
      timestamp = Time.now.strftime("%Y%m%d_%H%M%S")

      # --- [非阻塞佇列實作] ---
      # 將場景清單轉化為一個可切片處理的佇列
      queue = scenes_to_render.dup
      total_count = queue.length
      
      # 定義內部的逐一處理邏輯
      process_chain = proc do |index|
        if queue.empty?
          # 佇列結束：只恢復場景位置與 TransitionTime，不還原 RENDER_KEYS
          # RENDER_KEYS 的還原由 JS 在最後一張結果收到後透過 restore_render_style callback 觸發
          UI.start_timer(0.5, false) do
            model.pages.selected_page = current_page if current_page
            begin; model.options['PageOptions']['TransitionTime'] = original_transition_time; rescue => _e; end
            dialog.execute_script("window.receiveFromRuby({status: 'export_done'})")
            LoamLab.log "[LoamLab] 批量導出排程已全部送出。"
          end
          next
        end

        scene_raw = queue.shift
        scene_name = scene_raw.to_s.dup.force_encoding("UTF-8")
        page = model.pages[scene_raw]
        
        if page
          # 1. 切換場景
          model.pages.selected_page = page

          # 2. 每場景重新套用強制樣式（selected_page= 已同步相機；p.update 不保證所有 key 被 selected_page= 還原，AmbientOcclusion 等需明確重設）
          begin
            self.safe_set_render_keys(model.rendering_options, RENDER_KEYS)
            si = model.shadow_info
            SHADOW_KEYS_DEFAULT.each { |k, v| begin; si[k] = v; rescue => _e; end }
            self.apply_force_style_override(model, render_force_style) unless render_force_style.empty?
          rescue => e
            LoamLab.log "[LoamLab] style re-apply: #{e.message}"
          end

          # 加入 0.1s 延遲等待畫面更新，防止 SketchUp 渲染引擎崩潰 (防閃退核心)
          UI.start_timer(0.1, false) do
            temp_img_path = File.join(temp_dir, "loamlab_render_#{index}_#{Time.now.to_i}.jpg")
            channel_path = File.join(temp_dir, "loamlab_channel_#{index}_#{Time.now.to_i}.jpg")
            
            begin
              view = model.active_view
              ratio_val = view.vpheight > 0 ? (view.vpwidth.to_f / view.vpheight) : (16.0 / 9.0)
              supported_ratios = { "16:9"=>1.77, "9:16"=>0.56, "4:3"=>1.33, "3:4"=>0.75, "3:2"=>1.5, "2:3"=>0.66, "1:1"=>1.0, "21:9"=>2.33 }
              closest_ratio = supported_ratios.min_by { |k, v| (v - ratio_val).abs }[0]

              view.write_image(temp_img_path, 1280, 720, true, 0.6)

              # 定義發送請求的 Proc，避免代碼重複
              send_request = proc do |channel_b64|
                begin
                  # 自動備份
                  if File.directory?(save_path)
                    safe_project_name = project_name.gsub(/[:*?"<>|\/\\]/, "_")
                    safe_scene_name = scene_name.gsub(/[:*?"<>|\/\\]/, "_")
                    before_name = "#{timestamp}_#{safe_project_name}_#{safe_scene_name}_original.jpg"
                    require 'fileutils'
                    FileUtils.cp(temp_img_path, File.join(save_path, before_name)) rescue nil
                  end

                  # 5. Base64 編碼 + 組裝請求
                  img_data = File.read(temp_img_path, mode: 'rb')
                  data_uri = "data:image/jpeg;base64,#{Base64.strict_encode64(img_data)}"

                  user_email = Sketchup.read_default("LoamLabAI", "user_email", "").to_s.force_encoding("UTF-8").scrub("?")
                  scene_params = {
                    "image" => [data_uri], "user_prompt" => user_prompt,
                    "resolution" => resolution, "aspect_ratio" => closest_ratio
                  }
                  scene_params["style_ref_url"] = user_style_ref_url unless user_style_ref_url.to_s.strip.empty?
                  request_body = JSON.dump({
                    tool: tool,
                    parameters: scene_params,
                    "advanced_settings" => advanced_settings
                  })

                  captured_scene       = scene_name
                  captured_channel_b64 = channel_b64

                  # 截圖縮略圖立即回傳 JS
                  begin
                    preview_payload = { action: 'scene_screenshot', scene: captured_scene, image_data: data_uri }.to_json
                    dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(preview_payload)}')")
                  rescue => e
                    LoamLab.log "[LoamLab] 縮略圖發送失敗（非致命）: #{e.message}"
                  end
                  captured_body    = request_body.dup
                  captured_email   = user_email.dup
                  captured_version = ::LoamLab::VERSION.dup
                  captured_url     = "#{::LoamLab::API_BASE_URL}/api/render"
                  LoamLab.log "[LoamLab] 截圖完成: #{scene_name}"

                  if index == 0 || total_count == 1
                    _s0_scene   = captured_scene.dup
                    _s0_channel = captured_channel_b64.dup
                    _s0_sref    = user_style_ref_url.dup
                    _s0_req = Sketchup::Http::Request.new(captured_url, Sketchup::Http::POST)
                    _s0_req.headers = { 'Content-Type' => 'application/json', 'x-user-email' => captured_email, 'x-plugin-version' => captured_version }
                    _s0_req.body = captured_body
                    @@requests << _s0_req
                    _s0_req.start do |req, response|
                      @@requests.delete(req)
                      result = nil
                      begin
                        body_str = response.body.to_s.force_encoding("UTF-8").scrub("?")
                        data   = JSON.parse(body_str)
                        result = (data['code'] == 0 && data['url']) ?
                          { status: 'render_success', scene_name: _s0_scene, url: data['url'],
                            points_remaining: data['points_remaining'], transaction_id: data['transaction_id'],
                            channel_base64: _s0_channel } :
                          { status: 'render_failed', message: self.sanitize_error(data['msg'] || "HTTP #{response.status_code}"),
                            points_refunded: data['points_refunded'], error: data['error'] }
                      rescue => e
                        LoamLab.log "[LoamLab] 渲染失敗: #{_s0_scene}"
                        result = { status: 'render_failed', message: self.sanitize_error(e.message) }
                      end
                      @@pending_results << result if result
                      style_url = (result && result[:status] == 'render_success') ? result[:url] : nil
                      self.fire_deferred_renders(style_url, _s0_sref)
                    end
                  else
                    @@deferred_sends << {
                      body:    captured_body,
                      email:   captured_email,
                      version: captured_version,
                      url:     captured_url,
                      scene:   captured_scene,
                      channel: captured_channel_b64
                    }
                  end

                  LoamLab.log "[LoamLab] 第 #{index+1}/#{total_count} 個場景請求中: #{scene_name}"

                rescue => e
                  LoamLab.log "[LoamLab] 導出 #{scene_name} 發生錯誤: #{e.message}"
                ensure
                  File.delete(temp_img_path) if File.exist?(temp_img_path)
                  File.delete(channel_path) if File.exist?(channel_path)
                  # 6. 給 SketchUp UI 短暫呼吸後繼續下一場景
                  UI.start_timer(0.3, false) { process_chain.call(index + 1) }
                end
              end # end of send_request proc

              # 處理通道圖生成
              if tool == 2
                # 先套用通道圖樣式
                saved_ro = {
                  'FaceColorMode'   => model.rendering_options['FaceColorMode'],
                  'DrawHorizon'     => model.rendering_options['DrawHorizon'],
                  'DrawGround'      => model.rendering_options['DrawGround'],
                  'DrawSky'         => model.rendering_options['DrawSky'],
                  'EdgeDisplayMode' => model.rendering_options['EdgeDisplayMode']
                }
                saved_display_shadows = begin; model.shadow_info['DisplayShadows']; rescue; nil; end

                model.rendering_options['FaceColorMode']   = 3
                model.rendering_options['DrawHorizon']     = false
                model.rendering_options['DrawGround']      = false
                model.rendering_options['DrawSky']         = false
                model.rendering_options['EdgeDisplayMode'] = 0
                begin; model.shadow_info['DisplayShadows'] = false; rescue => _e; end

                # 再延遲 0.1s 等待通道圖樣式套用
                UI.start_timer(0.1, false) do
                  channel_b64 = ""
                  begin
                    view.write_image(channel_path, 1280, 720, false)
                    if File.exist?(channel_path)
                      channel_b64 = "data:image/jpeg;base64,#{Base64.strict_encode64(File.read(channel_path, mode: 'rb'))}"
                    end
                  rescue => e
                    LoamLab.log "[LoamLab] channel write failed: #{e.message}"
                  ensure
                    # 還原樣式（即使截圖失敗也必須還原）
                    saved_ro.each { |k, v| begin; model.rendering_options[k] = v; rescue => e; end }
                    begin; model.shadow_info['DisplayShadows'] = saved_display_shadows unless saved_display_shadows.nil?; rescue => _e; end
                  end
                  # ensure 後保證執行：channel 失敗時以空字串繼續，不卡死鏈條
                  send_request.call(channel_b64)
                end
              else
                send_request.call("")
              end

            rescue => e
              LoamLab.log "[LoamLab] 導出 #{scene_name} 最外層錯誤: #{e.message}"
              File.delete(temp_img_path) if File.exist?(temp_img_path)
              File.delete(channel_path) if File.exist?(channel_path)
              UI.start_timer(0.3, false) { process_chain.call(index + 1) }
            end
          end
        else
          # 場景名不存在（已刪除或改名），跳過繼續
          UI.start_timer(0.1, false) { process_chain.call(index + 1) }
        end
      end

      # Method B：每次批量渲染前重置 deferred 狀態
      @@deferred_sends.clear
      @@scene0_style_url = nil

      # 啟動鏈式呼叫
      process_chain.call(0)
    end

    # Method B：Scene 0 完成後循序送出所有 deferred scenes
    # style_ref_url 為 Scene 0 的渲染結果 URL（nil 表示 Scene 0 失敗，不帶風格參考）
    def self.fire_deferred_renders(style_ref_url, user_style_ref_url = '')
      sends = @@deferred_sends.dup
      @@deferred_sends.clear
      @@scene0_style_url = style_ref_url
      return if sends.empty?

      # 優先使用用戶選擇的風格參考圖，無則沿用 Scene 0 結果 URL
      effective_url = (!user_style_ref_url.to_s.strip.empty?) ? user_style_ref_url : style_ref_url

      self.process_next_deferred(sends, effective_url)
    end

    def self.process_next_deferred(sends, effective_url)
      return if sends.empty?

      item = sends.shift
      body_hash = JSON.parse(item[:body])
      if effective_url
        body_hash['parameters'] ||= {}
        body_hash['parameters']['style_ref_url'] = effective_url
      end
      final_body = JSON.dump(body_hash)
      captured   = item

      _df_scene   = captured[:scene].dup
      _df_channel = captured[:channel].dup
      _df_req = Sketchup::Http::Request.new(captured[:url], Sketchup::Http::POST)
      _df_req.headers = { 'Content-Type' => 'application/json', 'x-user-email' => captured[:email], 'x-plugin-version' => captured[:version] }
      _df_req.body = final_body
      
      @@requests << _df_req
      
      _df_req.start do |req, response|
        @@requests.delete(req)
        result = nil
        begin
          body_str = response.body.to_s.force_encoding("UTF-8").scrub("?")
          data = JSON.parse(body_str)
          result = (data['code'] == 0 && data['url']) ?
            { status: 'render_success', scene_name: _df_scene, url: data['url'],
              points_remaining: data['points_remaining'], transaction_id: data['transaction_id'],
              channel_base64: _df_channel } :
            { status: 'render_failed', message: self.sanitize_error(data['msg'] || "HTTP #{response.status_code}"),
              points_refunded: data['points_refunded'], error: data['error'] }
        rescue => e
          LoamLab.log "[LoamLab] 渲染失敗"
          result = { status: 'render_failed', message: self.sanitize_error(e.message) }
        end
        @@pending_results << result if result
        
        self.process_next_deferred(sends, effective_url)
      end
    end
    
    # 生成色彩通道圖 (Smart Canvas 用) — 切換至「依材質著色」模式截圖後立即還原
    def self.export_channel_image(view, width, height, path)
      model = Sketchup.active_model
      ro    = model.rendering_options
      si    = model.shadow_info

      # rendering_options 的儲存
      saved_ro = {
        'FaceColorMode'   => ro['FaceColorMode'],
        'DrawHorizon'     => ro['DrawHorizon'],
        'DrawGround'      => ro['DrawGround'],
        'DrawSky'         => ro['DrawSky'],
        'EdgeDisplayMode' => ro['EdgeDisplayMode']
      }
      # DisplayShadows 屬於 shadow_info，不在 rendering_options 中
      saved_display_shadows = begin; si['DisplayShadows']; rescue; nil; end

      begin
        ro['FaceColorMode']   = 3      # Color by Material
        ro['DrawHorizon']     = false
        ro['DrawGround']      = false
        ro['DrawSky']         = false
        ro['EdgeDisplayMode'] = 0      # 無邊線
        begin; si['DisplayShadows'] = false; rescue => _e; end
        view.write_image(path, width, height, false)
      ensure
        saved_ro.each do |k, v|
          begin; ro[k] = v; rescue => e; LoamLab.log "[LoamLab] render option restore #{k}: #{e.message}"; end
        end
        begin; si['DisplayShadows'] = saved_display_shadows unless saved_display_shadows.nil?; rescue => _e; end
      end
    end

    # 遞迴覆蓋 entity 下所有 Face 的材質（生成 segmap 用）
    def self.override_faces_recursive(entity, mat, saved)
      sub_entities = entity.is_a?(Sketchup::Group) ? entity.entities : entity.definition.entities
      sub_entities.each do |e|
        if e.is_a?(Sketchup::Face)
          saved[e.object_id] = { face: e, mat: e.material, back: e.back_material }
          e.material      = mat
          e.back_material = mat
        elsif e.is_a?(Sketchup::Group) || e.is_a?(Sketchup::ComponentInstance)
          override_faces_recursive(e, mat, saved)
        end
      end
    rescue => e
      LoamLab.log "[LoamLab] override_faces_recursive error: #{e.message}"
    end

    # HSL (0-360, 0-1, 0-1) → [R, G, B] (0-255)
    def self.hsl_to_rgb(h, s, l)
      h = h / 360.0
      if s == 0
        v = (l * 255).round
        return [v, v, v]
      end
      q = l < 0.5 ? l * (1 + s) : l + s - l * s
      p = 2 * l - q
      r = hue_to_rgb(p, q, h + 1.0/3)
      g = hue_to_rgb(p, q, h)
      b = hue_to_rgb(p, q, h - 1.0/3)
      [(r * 255).round, (g * 255).round, (b * 255).round]
    end

    def self.hue_to_rgb(p, q, t)
      t += 1 if t < 0; t -= 1 if t > 1
      return p + (q - p) * 6 * t if t < 1.0/6
      return q if t < 1.0/2
      return p + (q - p) * (2.0/3 - t) * 6 if t < 2.0/3
      p
    end

    # 新增選單項目
    unless file_loaded?(__FILE__)
      main_menu = UI.menu('Plugins').add_submenu('LoamLab Camera (野人相機)')
      main_menu.add_item('啟動相機 (Start)') do
        LoamLab::AIURenderer.show_dialog
      end
      # 新增「重新載入 (開發用)」— 安全版：不移除模組常數，避免 SketchUp 當機
      if LoamLab::BUILD_TYPE == "dev"
      main_menu.add_item('開發重新載入 (Dev Reload)') do
        begin
          dir = File.dirname(File.expand_path(__FILE__))
          # 關閉舊視窗
          if @dialog
            begin; @dialog.close; rescue => e; LoamLab.log "[LoamLab] dialog close: #{e.message}"; end
            @dialog = nil
          end
          # 依序重載 (不移除常數，直接覆蓋方法定義)
          load File.join(dir, 'config.rb')
          load File.join(dir, 'coze_api.rb')
          load File.join(dir, 'updater.rb')
          load File.join(dir, 'main.rb')
          LoamLab::AIURenderer.show_dialog
          LoamLab.log "======= LoamLab: Dev Reload OK ======="
        rescue => e
          UI.messagebox("Dev Reload 失敗: #{e.message}")
        end
      end
      end # if BUILD_TYPE == "dev"

      # 註冊快捷工具列 (Toolbar)
      toolbar = UI::Toolbar.new "LoamLab"
      cmd = UI::Command.new("AI Render") {
        LoamLab::AIURenderer.show_dialog
      }
      cmd.tooltip = "啟動 LoamLab AI 渲染器"
      cmd.status_bar_text = "打開 AI 渲染器大屏介面"
      # 未來可在此加入 .svg 或 .png 的 icon
      
      toolbar = toolbar.add_item cmd
      toolbar.show

      # 脫敏與友善報錯處理
      def self.sanitize_error(msg)
        return msg unless msg.is_a?(String)
        # Vercel 伺服器崩潰（未修復前的舊版後端）
        if msg.include?('FUNCTION_INVOCATION_FAILED') || msg.include?('A server error has occurred')
          return '渲染請求失敗，請稍後再試。如持續發生請聯繫客服。'
        end
        # 針對常見的 Ruby 逾時報錯轉換為友好提示
        if msg.include?('execution expired') || msg.include?('Net::OpenTimeout') || msg.include?('Net::ReadTimeout')
          return '連線到伺服器逾時，請檢查您的網路狀態或稍後再試。'
        end
        # 隱藏技術關鍵字
        msg.gsub(/api\.atlascloud\.ai/i, 'ai-render-gateway')
           .gsub(/atlascloud\.ai/i, 'ai-render-gateway')
           .gsub(/AtlasCloud/i, 'AI 渲染引擎')
           .gsub(/ATLASCLOUD_API_KEY/i, '渲染引擎金鑰')
           .gsub(/google\/[^\s]*/i, 'AI-Engine')
           .gsub(/nano-banana/i, 'AI-Engine')
           .gsub(/https?:\/\/api\.[a-z0-9\-\.]+\/[^\s]*/i, '[API_ENDPOINT]')
           .gsub(/google/i, 'AI')
      end

      file_loaded(__FILE__)
    end
  end
end
