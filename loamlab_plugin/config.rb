# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 閸忋劌鐪悹鏉款暔闁板秶鐤?(Global Environment Config)
  # - ENV_MODE: "development" (閺堫剙婀撮梺瀣) | "production" (濮濓絽绱￠悹鏉款暔)
  # - BUILD_TYPE: "dev" | "release"
  # ==============================================================================
  ENV_MODE = "production"
  BUILD_TYPE = "dev" # 闂佸娅﹀Ο鈥崇础

  if ENV_MODE == "production"
    API_BASE_URL = "https://loamlabbackend.vercel.app"
  else
    API_BASE_URL = "http://localhost:3001"
  end

  # 閹绘帊娆㈤悧鍫熸拱閾?(閻劍鏌?updater 濡俱垺鐓￠懜?API 鐠滃鐪板Ο娆撶墵)
  VERSION = '1.3.0'
end




