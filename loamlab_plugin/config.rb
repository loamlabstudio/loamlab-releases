# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 鍏ㄥ眬鐠板閰嶇疆 (Global Environment Config)
  # - ENV_MODE: "development" (鏈湴闁嬬櫦) | "production" (姝ｅ紡鐠板)
  # - BUILD_TYPE: "dev" | "release"
  # ==============================================================================
  ENV_MODE = "production"
  BUILD_TYPE = "dev" # 闁嬬櫦妯″紡

  if ENV_MODE == "production"
    API_BASE_URL = "https://loamlabbackend.vercel.app"
  else
    API_BASE_URL = "http://localhost:3001"
  end

  # 鎻掍欢鐗堟湰铏?(鐢ㄦ柤 updater 妾㈡煡鑸?API 璜嬫眰妯欓牠)
  VERSION = '1.3.0'
end



