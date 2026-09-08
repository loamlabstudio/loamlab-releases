# 存檔鏈自我驗證 — 在 SketchUp 的 Ruby 主控台執行
#
#   load 'c:/Users/qingwen/.gemini/antigravity/workspaces/土窟設計su渲染插件/scripts/verify_save_chain.rb'
#
# 測的是「實際載入到 SketchUp 裡的程式碼」，不是模擬。
# 全程不寫任何檔案、不呼叫網路，測完會把佔用的路徑登記還原乾淨。

module LoamLabVerify
  # 用方法而非常數：這支腳本會被重複 load，常數重新賦值會噴
  # "already initialized constant" 警告。
  def self.m
    LoamLab::AIURenderer
  end

  def self.run
    m_ = m
    puts ""
    puts "=" * 62
    puts " LoamLab 存檔鏈驗證"
    puts "=" * 62

    fails = []

    # ── 0. 確認熱重載真的載到新版 ─────────────────────────────────
    puts "\n[0] 新版程式碼是否已載入"
    %i[build_save_path resolve_collision_free_path download_and_save_render
       safe_read_default encode_pref_blob migrate_pref_blobs].each do |meth|
      ok = m_.respond_to?(meth)
      puts "    #{ok ? 'OK ' : 'X  '} #{meth}"
      fails << "缺少 #{meth}，熱重載沒吃到新版" unless ok
    end
    if fails.any?
      puts "\n>>> 請先重新執行 dev_reload.rb 再測一次"
      return finish(fails)
    end

    # 備份佔位表，測完還原（避免污染實際存檔行為）
    reserved = m_.class_variable_get(:@@reserved_paths)
    backup   = reserved.dup

    begin
      dir  = "C:/__loamlab_verify__"      # 不存在的目錄，確保不碰到真實檔案
      ts   = "20260908_140000"            # 批量共用同一時間戳（重現批量條件）
      proj = "驗證專案"

      # 三個場景前 30 字完全相同，只有第 31 字之後不同 —— 舊寫法會全部撞成同一個檔名
      scenes = [
        "一樓客廳主視角 早晨自然光側逆光 廣角鏡頭無變形 精修交付定稿版本 A",
        "一樓客廳主視角 早晨自然光側逆光 廣角鏡頭無變形 精修交付定稿版本 B",
        "一樓客廳主視角 早晨自然光側逆光 廣角鏡頭無變形 精修交付定稿版本 C",
        "餐廳視角",
      ]

      # ── 1. 檔名本身是否還會撞 ───────────────────────────────────
      puts "\n[1] 批量檔名唯一性（場景名 #{scenes[0].length} 字，前 30 字相同）"
      paths = scenes.map { |s| m_.build_save_path(dir, ts, proj, s) }
      paths.each { |p| puts "    #{File.basename(p)}" }
      puts "    送出 #{scenes.size} 張 → 相異檔名 #{paths.uniq.size} 個"
      if paths.uniq.size == scenes.size
        puts "    OK  每張各自落地"
      else
        puts "    X   仍有 #{scenes.size - paths.uniq.size} 張會被覆蓋"
        fails << "build_save_path 仍產生重複檔名"
      end

      # ── 2. 最後防線：不同圖不覆蓋、同一張圖不重存 ──────────────
      puts "\n[2] 碰撞防線"
      same = File.join(dir, "collide_render.jpg")
      a = m_.resolve_collision_free_path(same, "https://cdn/a.jpg")
      b = m_.resolve_collision_free_path(same, "https://cdn/b.jpg")
      c = m_.resolve_collision_free_path(same, "https://cdn/a.jpg")   # 與 a 同一張圖
      puts "    圖A          → #{a ? File.basename(a) : 'nil'}"
      puts "    圖B（不同）  → #{b ? File.basename(b) : 'nil'}"
      puts "    圖A（重複）  → #{c ? File.basename(c) : 'nil（正確略過）'}"
      if a && b && a != b
        puts "    OK  不同圖分開存"
      else
        puts "    X   不同圖被指到同一路徑"
        fails << "resolve_collision_free_path 未擋下不同圖的碰撞"
      end
      if c.nil?
        puts "    OK  同一張圖不重複存"
      else
        puts "    X   同一張圖會被存兩次"
        fails << "resolve_collision_free_path 未擋下重複存檔"
      end

      # ── 3. 超長路徑仍安全 ───────────────────────────────────────
      puts "\n[3] 超長場景名"
      long = "超長場景名稱" * 40
      lp = m_.build_save_path(dir, ts, proj, long)
      cap = m_.const_get(:MAX_SAVE_PATH)
      puts "    場景名 #{long.length} 字 → 路徑 #{lp.length} 字（上限 #{cap}）"
      if lp.length <= cap
        puts "    OK  已縮到上限內"
      else
        puts "    X   路徑仍超長，寫檔會失敗"
        fails << "build_save_path 未處理超長路徑"
      end

      # ── 4. 偏好值儲存安全性 ─────────────────────────────────────
      # SketchUp 存偏好值時把字串包進雙引號，但**不跳脫值裡面的雙引號**；
      # 讀取時對它做 eval，於是存過 JSON 的值會拋 SyntaxError。
      # 該例外由 SketchUp 內部自己 rescue（只把訊息印到主控台、回傳預設值），
      # Ruby 端攔不到也蓋不掉——真正的損失是那個值永遠讀回空字串。
      # 解法是改用 Base64 存放（不含引號），並由 migrate_pref_blobs 覆蓋掉已存壞的值。
      puts "\n[4] 偏好值儲存安全性"
      if m_.respond_to?(:safe_read_default) && m_.respond_to?(:encode_pref_blob)
        risky = "{\"layout\":\"參數分享------\n{zhLine}\",\"tags\":[\"#室內設計\"]}"
        enc   = m_.encode_pref_blob(risky)
        dec   = m_.decode_pref_blob(enc)
        clean = !(enc =~ /[{}\n\\"]/)
        puts "    編碼後含危險字元? #{clean ? '否（eval 不會誤解）' : '是'}"
        puts "    來回還原一致?     #{dec == risky}"
        puts "    舊格式相容?       #{m_.decode_pref_blob(risky) == risky}"
        if clean && dec == risky && m_.decode_pref_blob(risky) == risky
          puts "    OK  大字串以 Base64 存放，不會再炸"
        else
          puts "    X   編碼或相容處理有誤"
          fails << "encode/decode_pref_blob 行為不正確"
        end
        # 真正讀一次目前存著的值，確認不會拋例外
        begin
          m_.safe_read_default("dev_post_template_v2", "")
          m_.safe_read_default("global_save_path", "")
          puts "    OK  實際讀取現有偏好值未拋例外"
        rescue => e
          puts "    X   仍會拋例外: #{e.class}"
          fails << "safe_read_default 沒擋住例外"
        end
      else
        puts "    X   缺少 safe_read_default / encode_pref_blob，熱重載沒吃到新版"
        fails << "偏好值安全存取未載入"
      end

    ensure
      reserved.clear
      backup.each { |k, v| reserved[k] = v }
      puts "\n    （佔位登記已還原，未寫入任何檔案）"
    end

    finish(fails)
  end

  def self.finish(fails)
    puts "\n" + "=" * 62
    if fails.empty?
      puts " 全部通過。批量渲染的檔名碰撞已解除。"
      puts ""
      puts " 接著建議做一次真實批量：勾 3 個以上場景送出，"
      puts " 完成後確認存檔資料夾的 _render.jpg 張數 == 你送出的張數。"
    else
      puts " 有 #{fails.size} 項未通過："
      fails.each { |f| puts "   - #{f}" }
    end
    puts "=" * 62
    puts ""
    fails.empty?
  end
end

LoamLabVerify.run
