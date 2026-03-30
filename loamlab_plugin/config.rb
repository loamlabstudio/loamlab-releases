# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 闁荤姵婢橀。銊╂嚋閸パ冨伎闁糕晝鍠曡墥閻?(Global Environment Config)
  # - 闂備礁顑囧▍锕傛⒔閵堝鐩侀柡鍛€介悵娑欑┍濠靛洤鐦?"development" (闂侇偓绲跨粣鏃堟嚊椤忓懏鎷辨慨?localhost:3000)
  # - 闁哥喎妫楃€垫煡骞嶉幘鍐茬樁闂佹彃顑呴崵?.rbz)闁告挸绋勭槐婵嬪礋濞嗗繒绠戦悘蹇撴处椤掓繄鎷嬫繝鍐╂瘎闁衡偓閸︻厼浠?"production" (闂侇偓绲跨粣鏃堟嚊?Vercel 闂傚棜灏欓顒佸緞瑜戦崣?
  # ==============================================================================
  ENV_MODE = "production"   # 姘搁仩鎵撶湡瀵?Vercel锛堥枊鐧艰垏鐧煎竷鐗堟湰涓€鑷达級
  BUILD_TYPE = "dev"            # "dev" | "release" 鈥?build_rbz.ps1 鎵撳寘鏅傝嚜鍕曞垏鐐?release

  if ENV_MODE == "production"
    # ! 闂傚棜灏欓顒佸緞瑜戦崣鍥儍閸曨剦鍔€鐎殿喖绻掗幁顐﹀锤閳?(閻犳粌顑嗚ぐ宀勫箣閹邦厼浜堕梺顔哄妿鐠佹彃顕ュ畝鈧▓?Vercel 缂傚秵褰冮悡娆撴晬鐏炵瓔娲?https://loamlab.vercel.app)
    API_BASE_URL = "https://loamlab-camera-backend.vercel.app"
  else
    # ! 闁哄牜鍓氶…濂告⒑鐎ｎ剚顏ｆ繛鎿冨墲閳瑰倿鎮归弶娆炬殧
    API_BASE_URL = "http://localhost:3001"
  end

  # 閻ｈ泛澧犻搹鐔衡挀 (闁絽瀚?updater 閻楀牊婀板В鏂跨毆濮楃喎鍩?
  VERSION = '1.2.6'
end



















