require 'sketchup.rb'
require 'json'
require 'base64'
require 'tmpdir'
require 'net/http'
require 'uri'
require 'openssl'
require_relative 'config.rb'
require_relative 'coze_api.rb'
require_relative 'updater.rb'

module LoamLab

  module AIURenderer

    # 截圖時需要關閉的邊線樣式（插件開啟時套用至所有場景，關閉時還原）
    RENDER_KEYS = {
      'DrawBackEdges'   => false,
      'DrawSilhouettes' => false,
      'DrawDepthQue'    => false
    }.freeze

    @@requests        ||= []
    @@pending_results   = []
    @@polling_dialog    = nil

    # 主執行緒輪詢器：從 Thread 接收結果並傳給 JS（每 0.5 秒）
    UI.start_timer(0.5, true) do
      until @@pending_results.empty?
        res = @@pending_results.shift
        begin
          d = @@polling_dialog
          if d
            b64 = Base64.strict_encode64(res.to_json)
            d.execute_script("window.receiveFromRubyBase64('#{b64}')")
            puts "[LoamLab] Poll 送出結果: #{res[:status]} url=#{res[:url]} msg=#{res[:message]}"
          end
        rescue => e
          puts "[LoamLab] Poll 傳送失敗: #{e.message}"
        end
      end
    end

    def self.safe_set_render_keys(ro, keys_hash)
      valid_keys = ro.keys
      keys_hash.each do |k, v|
        begin
          ro[k] = v if valid_keys.include?(k)
        rescue
        end
      end
    end

    def self.apply_render_keys(model)
      ro = model.rendering_options
      RENDER_KEYS.keys.each { |k| model.set_attribute('LoamLabRenderOverride', k, ro[k]) rescue nil }
      self.safe_set_render_keys(ro, RENDER_KEYS)
      model.pages.each { |p| p.update(Sketchup::Page::PAGE_USE_RENDERING_OPTIONS) rescue nil }
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
      model.pages.each { |p| p.update(Sketchup::Page::PAGE_USE_RENDERING_OPTIONS) rescue nil }
      model.set_attribute('LoamLabRenderOverride', 'applied', false)
    end

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
      end

      @dialog.show
    end

    def self.register_callbacks(dialog)
      # 1. 初始化資料請求 (由 JS 呼叫)
      dialog.add_action_callback("getInitialData") do |action_context, params|
        model = Sketchup.active_model
        save_path = model.get_attribute("LoamLabAI", "save_path", "")
        user_email = Sketchup.read_default("LoamLabAI", "user_email", "")
        saved_lang = Sketchup.read_default("LoamLabAI", "ui_lang", "")
        response = {
          status: 'success',
          version: LoamLab::VERSION,
          api_base: LoamLab::API_BASE_URL,
          build_type: LoamLab::BUILD_TYPE,
          lang: saved_lang.empty? ? nil : saved_lang,
          scenes: self.get_scene_names,
          save_path: save_path,
          user_email: user_email
        }
        
        json_str = response.to_json
        dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(json_str)}')")

        # 套用截圖邊線設定（關閉後側邊線、輪廓、深度提示）
        # 若上次未正常還原（如強制關閉），先清除舊值再重新套用
        if model.get_attribute('LoamLabRenderOverride', 'applied') == true
          self.restore_render_keys(model)
        end
        self.apply_render_keys(model)
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

      dialog.add_action_callback("save_ui_lang") do |action_context, params|
        lang = params.is_a?(Hash) ? params["lang"] : params.to_s
        Sketchup.write_default("LoamLabAI", "ui_lang", lang) unless lang.nil? || lang.empty?
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
        scenes_to_render        = params["scenes"] || []
        user_prompt             = (params["prompt"] || "").to_s.dup.force_encoding("UTF-8")
        resolution              = params["resolution"] || "1k"
        tool                    = (params["tool"] || 1).to_i
        base_image_url          = (params["base_image_url"] || "").to_s
        base_image_scene        = (params["base_image_scene"] || "底圖").to_s.dup.force_encoding("UTF-8")
        reference_image_base64  = (params["reference_image_base64"] || "").to_s

        dialog.execute_script("window.receiveFromRuby({status: 'rendering'})")

        # 延遲一點執行，避免阻塞前端 UI 動畫
        UI.start_timer(0.1, false) do
            self.batch_export_scenes(dialog, scenes_to_render, user_prompt, resolution, tool, base_image_url, base_image_scene, reference_image_base64)
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

      # 新增功能：儲存渲染圖到用戶指定位置
      dialog.add_action_callback("save_image") do |action_context, params|
        url = params["url"]
        next unless url

        default_name = "AI_Render_#{Time.now.strftime('%H%M%S')}.jpg"
        file_path = UI.savepanel("保存渲染圖", "", default_name)
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
                  # 場景切換後 SketchUp 會還原場景儲存的 rendering_options，需重新套用
                  self.safe_set_render_keys(model.rendering_options, RENDER_KEYS)
                  # 給予 SketchUp 毫秒級的 UI 刷新時間，避免畫面閃爍過快或主視窗卡死
                  sleep(0.05)
                  base64_img = self.get_preview_base64
                  batch_data << { scene: scene_name, image_data: base64_img }
                end
              end

              model.pages.selected_page = current_page if current_page
              # 切回原場景後也重新套用（避免還原到原始樣式）
              self.safe_set_render_keys(model.rendering_options, RENDER_KEYS)
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

      # 5. AI 渲染結果自動存檔 → 下載圖片到 save_path
      dialog.add_action_callback("auto_save_render") do |action_context, params|
        url    = params["url"]
        scene  = (params["scene"]      || "render").to_s.dup.force_encoding("UTF-8")
        res    = (params["resolution"] || "2k").to_s

        next unless url

        model     = Sketchup.active_model
        save_path = model.get_attribute("LoamLabAI", "save_path", "").to_s.dup.force_encoding("UTF-8")
        next if save_path.empty? || !File.directory?(save_path)

        begin
          require 'open-uri'
          timestamp  = Time.now.strftime("%Y%m%d_%H%M%S")
          safe_scene = scene.gsub(/[:*?"<>|\/\\]/, "_")[0, 30]
          filename   = "#{timestamp}_#{safe_scene}_#{res}_loamlab_camera.jpg"
          full_path  = File.join(save_path, filename)
          File.open(full_path, "wb") { |f| URI.open(url) { |img| f.write(img.read) } }
          puts "[LoamLab] auto_save_render: #{filename}"
        rescue => e
          puts "[LoamLab] auto_save_render failed: #{e.message}"
        end
      end

      # 6. 列出已儲存的渲染歷史（直接掃描 save_path 資料夾，從檔名解析 metadata）
      dialog.add_action_callback("list_saved_renders") do |action_context, params|
        begin
          model     = Sketchup.active_model
          save_path = model.get_attribute("LoamLabAI", "save_path", "").to_s.dup.force_encoding("UTF-8")

          history = []
          if !save_path.empty? && File.directory?(save_path)
            # 只掃描 AI 渲染結果（命名慣例：YYYYMMDD_HHMMSS_RES_SCENE_loamlab_camera.jpg）
            # 原始 SketchUp 截圖命名為 *_原圖.jpg，不納入
            files = Dir.glob(File.join(save_path, "*_loamlab_camera.jpg")).sort_by { |f| -File.mtime(f).to_i }
            history = files.first(30).map do |f|
              fname = File.basename(f)
              # 格式：YYYYMMDD_HHMMSS_SCENE_RES_loamlab_camera.jpg
              m = fname.match(/^(\d{8})_(\d{6})_(.+)_(1k|2k|4k)_loamlab_camera\.jpg$/i)
              if m
                ts    = "#{m[1]}_#{m[2]}"
                scene = m[3].gsub('_', ' ')
                res   = m[4]
              else
                ts = File.mtime(f).strftime("%Y%m%d_%H%M%S")
                res = ''; scene = fname
              end
              file_url = path_to_file_uri(f)
              { 'filename' => fname, 'scene' => scene, 'resolution' => res,
                'timestamp' => ts, 'file_url' => file_url }
            end
          end

          payload = { action: 'historyList', files: history }.to_json
          dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(payload)}')")
        rescue => e
          payload = { action: 'historyList', files: [] }.to_json
          dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(payload)}')")
          puts "[LoamLab] list_saved_renders error: #{e.message}"
        end
      end

      # 7. 自動開啟儲存路徑 (算圖完成後觸發)
      dialog.add_action_callback("open_save_dir") do |action_context, params|
        model = Sketchup.active_model
        save_path = model.get_attribute("LoamLabAI", "save_path", "")
        if save_path && !save_path.empty? && File.directory?(save_path)
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
                  { status: 'render_failed', message: data['msg'] || "HTTP #{response.status_code}" }
              rescue => e
                result = { status: 'render_failed', message: "解析失敗: #{e.message}" }
              end
              UI.start_timer(0, false) { dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(result.to_json)}')") }
            end
            UI.start_timer(0.1, false) { dialog.execute_script("window.receiveFromRuby({status: 'export_done'})") }
          rescue => e
            dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: "Smart Canvas 執行失敗: #{e.message}" })})")
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
            rescue; end
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
          puts "[LoamLab] generate_seg_map error: #{e.message}\n#{e.backtrace.first(3).join("\n")}"
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
    def self.batch_export_scenes(dialog, scenes_to_render, user_prompt, resolution="1k", tool=1, base_image_url="", base_image_scene="底圖", reference_image_base64="")
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
                { status: 'render_failed', message: data['msg'] || "HTTP #{response.status_code}" }
            rescue => e
              result = { status: 'render_failed', message: "解析失敗: #{e.message}" }
            end
            UI.start_timer(0, false) { dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(result.to_json)}')") }
          end
          UI.start_timer(0.1, false) { dialog.execute_script("window.receiveFromRuby({status: 'export_done'})") }
        rescue => e
          dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: "Smart Canvas 請求失敗: #{e.message}" })})")
        end
        return
      end

      # 工具 2：AtlasCloud 家具替換（base_image + 可選 reference_image，皆 base64）
      if tool == 2 && !base_image_url.empty? && base_image_url.start_with?("file:///")
        begin
          local_path = file_uri_to_path(base_image_url)
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
                { status: 'render_failed', message: data['msg'] || "HTTP #{response.status_code}" }
            rescue => e
              result = { status: 'render_failed', message: "解析失敗: #{e.message}" }
            end
            UI.start_timer(0, false) { dialog.execute_script("window.receiveFromRubyBase64('#{Base64.strict_encode64(result.to_json)}')") }
          end
          UI.start_timer(0.1, false) { dialog.execute_script("window.receiveFromRuby({status: 'export_done'})") }
        rescue => e
          dialog.execute_script("window.receiveFromRuby(#{JSON.generate({ status: 'render_failed', message: "底圖讀取失敗: #{e.message}" })})")
        end
        return
      end

      # 工具 3 底圖模式：直接讀本地圖檔送 Coze，跳過 SketchUp 截圖
      if !base_image_url.empty? && base_image_url.start_with?("file:///")
        begin
          local_path = file_uri_to_path(base_image_url)
          img_data   = File.read(local_path, mode: 'rb')
          data_uri   = "data:image/jpeg;base64,#{Base64.strict_encode64(img_data)}"
          user_email = Sketchup.read_default("LoamLabAI", "user_email", "").to_s.force_encoding("UTF-8").scrub("?")
          request_body = JSON.dump({
            tool: tool,
            parameters: { "image" => [data_uri], "user_prompt" => user_prompt, "resolution" => resolution, "aspect_ratio" => "16:9" }
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
                { status: 'render_failed', message: data['msg'] || "HTTP #{response.status_code}" }
            rescue => e
              result = { status: 'render_failed', message: "解析失敗: #{e.message}" }
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
      
      # 記錄並隱藏干擾元素（截圖後自動還原）
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

      temp_dir     = Dir.tmpdir
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
          # 場景切換後 SketchUp 會還原場景儲存的 rendering_options，需重新套用
          self.safe_set_render_keys(model.rendering_options, RENDER_KEYS)

          # 2. 產出暫存檔與備份 (此處 UI 可能會微卡，但因為是單張處理，結束後會交還主控權)
          temp_img_path = File.join(temp_dir, "loamlab_render_#{index}_#{Time.now.to_i}.jpg")
          
          begin
            view = model.active_view
            ratio_val = view.vpheight > 0 ? (view.vpwidth.to_f / view.vpheight) : (16.0 / 9.0)
            supported_ratios = { "16:9"=>1.77, "9:16"=>0.56, "4:3"=>1.33, "3:4"=>0.75, "3:2"=>1.5, "2:3"=>0.66, "1:1"=>1.0, "21:9"=>2.33 }
            closest_ratio = supported_ratios.min_by { |k, v| (v - ratio_val).abs }[0]

            view.write_image(temp_img_path, 1280, 720, true, 0.6)

            # 通道圖生成（Smart Canvas 魔術棒用）
            channel_b64 = ""
            begin
              channel_path = File.join(temp_dir, "loamlab_channel_#{index}_#{Time.now.to_i}.jpg")
              self.export_channel_image(view, 1280, 720, channel_path)
              if File.exist?(channel_path)
                channel_b64 = "data:image/jpeg;base64,#{Base64.strict_encode64(File.read(channel_path, mode: 'rb'))}"
                File.delete(channel_path)
              end
            rescue => e
              puts "[LoamLab] channel image failed (non-fatal): #{e.message}"
            end

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
              tool: tool,
              parameters: {
                "image" => [data_uri], "user_prompt" => user_prompt,
                "resolution" => resolution, "aspect_ratio" => closest_ratio
              }
            })

            # 改用 Net::HTTP + Thread，完全繞過 Sketchup::Http::Request 的事件迴圈問題
            captured_scene       = scene_name
            captured_channel_b64 = channel_b64
            captured_dialog      = dialog
            captured_body        = request_body.dup
            captured_email       = user_email.dup
            captured_version     = ::LoamLab::VERSION.dup
            captured_url         = "#{::LoamLab::API_BASE_URL}/api/render"
            puts "[LoamLab] 啟動 Thread 送出請求: #{scene_name}"

            Thread.new do
              result = nil
              begin
                uri  = URI.parse(captured_url)
                http = Net::HTTP.new(uri.host, uri.port)
                http.use_ssl      = (uri.scheme == 'https')
                http.verify_mode  = OpenSSL::SSL::VERIFY_NONE
                http.read_timeout = 300
                http.open_timeout = 30
                response = http.post(uri.path, captured_body, {
                  'Content-Type'      => 'application/json',
                  'x-user-email'      => captured_email,
                  'x-plugin-version'  => captured_version
                })
                body_str = response.body.to_s.force_encoding("UTF-8").scrub("?")
                puts "[LoamLab] Thread 回應 status=#{response.code} len=#{body_str.length} body=#{body_str[0..300]}"
                data   = JSON.parse(body_str)
                result = (data['code'] == 0 && data['url']) ?
                  { status: 'render_success', scene_name: captured_scene, url: data['url'],
                    points_remaining: data['points_remaining'], transaction_id: data['transaction_id'],
                    channel_base64: captured_channel_b64 } :
                  { status: 'render_failed', message: data['msg'] || "HTTP #{response.code}",
                    points_refunded: data['points_refunded'], error: data['error'] }
              rescue => e
                puts "[LoamLab] Thread 錯誤: #{e.class} #{e.message}"
                result = { status: 'render_failed', message: "請求失敗: #{e.message}" }
              end
              @@pending_results << result if result
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
    
    # 生成色彩通道圖 (Smart Canvas 用) — 切換至「依材質著色」模式截圖後立即還原
    def self.export_channel_image(view, width, height, path)
      model = Sketchup.active_model
      ro    = model.rendering_options

      saved = {
        'FaceColorMode'   => ro['FaceColorMode'],
        'DisplayShadows'  => ro['DisplayShadows'],
        'DrawHorizon'     => ro['DrawHorizon'],
        'DrawGround'      => ro['DrawGround'],
        'DrawSky'         => ro['DrawSky'],
        'EdgeDisplayMode' => ro['EdgeDisplayMode']
      }

      begin
        ro['FaceColorMode']   = 3      # Color by Material
        ro['DisplayShadows']  = false
        ro['DrawHorizon']     = false
        ro['DrawGround']      = false
        ro['DrawSky']         = false
        ro['EdgeDisplayMode'] = 0      # 無邊線
        view.write_image(path, width, height, false)
      ensure
        saved.each { |k, v| ro[k] = v rescue nil }
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
      puts "[LoamLab] override_faces_recursive error: #{e.message}"
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

      file_loaded(__FILE__)
    end
  end
end
