# 畫幅診斷 — 在 SketchUp 的 Ruby 主控台執行
#
#   load 'c:/Users/qingwen/.gemini/antigravity/workspaces/土窟設計su渲染插件/scripts/verify_aspect.rb'
#
# 把存檔資料夾裡成對的 _original.jpg（送去 AI 的原圖）與 _render.jpg（AI 回傳的圖）
# 逐一量出實際像素與比例，直接指出是「送出去的就歪了」還是「AI 回來才歪」。
# 只讀檔，不改任何東西。

module LoamLabAspect
  TARGET = 3.0 / 2.0          # T1 期望比例（main.rb 的 closest_ratio = "3:2"）
  TOL    = 0.02               # 2% 容差，吸收 JPEG 尺寸對齊造成的微小偏差

  def self.run
    m = LoamLab::AIURenderer
    model = Sketchup.active_model
    dir = m.get_effective_save_path(model)
    puts ""
    puts "=" * 68
    puts " 畫幅診斷"
    puts "=" * 68
    puts " 存檔資料夾: #{dir}"

    unless dir && File.directory?(dir)
      puts " X 資料夾不存在，無法診斷"
      return
    end

    # 以「時間戳_專案_場景」前綴配對
    pairs = {}
    Dir.glob(File.join(dir, "*.jpg")).each do |f|
      base = File.basename(f)
      if base =~ /\A(.+)_original\.jpg\z/i
        (pairs[$1] ||= {})[:orig] = f
      elsif base =~ /\A(.+)_render\.jpg\z/i
        (pairs[$1] ||= {})[:render] = f
      end
    end

    both = pairs.select { |_k, v| v[:orig] && v[:render] }
    puts " 找到成對檔案: #{both.size} 組（共掃到 #{pairs.size} 組前綴）"
    if both.empty?
      puts ""
      puts " 沒有成對的檔案可比對。可能原因："
      puts "   - 這批渲染沒有存原圖（只有 T1 批量會存 _original.jpg）"
      puts "   - 存檔資料夾設在別處"
      puts "   - 檔名前綴不一致（_original 用完整場景名、_render 舊版會截斷到 30 字）"
      return
    end

    puts ""
    bad_orig = 0
    bad_pair = 0
    both.sort.last(12).each do |prefix, v|
      ow, oh = dims(v[:orig])
      rw, rh = dims(v[:render])
      next unless ow && rw
      oratio = ow.to_f / oh
      rratio = rw.to_f / rh
      orig_ok = (oratio - TARGET).abs / TARGET <= TOL
      pair_ok = (oratio - rratio).abs / oratio <= TOL
      bad_orig += 1 unless orig_ok
      bad_pair += 1 unless pair_ok

      puts " #{prefix[0, 46]}"
      puts "   原圖 #{ow}x#{oh}  比例 #{fmt(oratio)}   #{orig_ok ? '' : '<- 不是 3:2'}"
      puts "   出圖 #{rw}x#{rh}  比例 #{fmt(rratio)}   #{pair_ok ? '' : '<- 與原圖不符'}"
      puts ""
    end

    puts "=" * 68
    if bad_pair == 0 && bad_orig == 0
      puts " 全部一致：原圖是 3:2，出圖與原圖相同。"
    elsif bad_orig > 0 && bad_pair > 0
      puts " 判定：**送出去的原圖就已經不是 3:2**（#{bad_orig} 組）。"
      puts "       代表 main.rb 的 crop_center_to_ratio 沒有生效——"
      puts "       它整段包在 rescue 裡，失敗時會靜默保留原生視窗比例，只留一行 log。"
      puts "       後端對 T1 強制輸出 3:2，於是前後兩張比例對不上。"
    elsif bad_pair > 0
      puts " 判定：原圖是 3:2，但**出圖不是**（#{bad_pair} 組）。"
      puts "       問題在後端或 AI 模型端，不在截圖流程。"
    else
      puts " 判定：原圖不是 3:2，但出圖與原圖一致（#{bad_orig} 組）。"
      puts "       模型是跟著輸入圖的比例走，沒有套用要求的 3:2。"
    end
    puts "=" * 68
    puts ""
  end

  def self.dims(path)
    ir = Sketchup::ImageRep.new
    ir.load_file(path)
    [ir.width, ir.height]
  rescue StandardError, ScriptError
    [nil, nil]
  end

  def self.fmt(r)
    known = { "3:2" => 1.5, "16:9" => 16.0 / 9, "4:3" => 4.0 / 3, "1:1" => 1.0, "2:3" => 2.0 / 3, "9:16" => 9.0 / 16 }
    hit = known.find { |_n, v| (r - v).abs / v <= 0.02 }
    hit ? "#{hit[0]} (#{r.round(3)})" : r.round(3).to_s
  end
end

LoamLabAspect.run
