# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 闂備胶顭堢换鍫ュ礉瀹€鍕剳妞ゆ帒瀚崑锝夋煛婢跺鍎ラ柡鍡樻濮婃椽寮剁捄銊愩倝鏌?(Global Environment Config)
  # - ENV_MODE: "development" (闂備礁鎼悧婊堝礈濞嗗骏鑰块柟缁㈠枟閳锋垿鎮楅敐搴″妞? | "production" (婵犳鍠楃换鎰緤閻ｅ本顫曢柨鐔哄У閸嬶綁鏌℃径瀣靛劌闁?
  # - BUILD_TYPE: "dev" | "release"
  # ==============================================================================
  ENV_MODE = "production"
  BUILD_TYPE = "dev"
  DIST_CHANNEL = "direct"   # "direct" = 瀹樼恫鐗堬紙鑷嫊瀹夎锛墊 "store" = EW鐗堬紙璺崇€忚鍣級

  if ENV_MODE == "production"
    API_BASE_URL = "https://loamlab-camera.vercel.app"
  else
    API_BASE_URL = "http://localhost:3001"
  end

  VERSION = '1.4.55'
end



































































































