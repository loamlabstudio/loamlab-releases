# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 闂佺绻堥崝宀勬儑椤掑嫭鍋ｉ柡澶嬵儥閺嗘棃姊洪弶璺ㄐら柣?(Global Environment Config)
  # - ENV_MODE: "development" (闂佸搫鐗滈崜娆忥耿閹绢喗鈷戦悗锝庡墯椤? | "production" (濠殿喗绻愮徊鐣屾閿熺姵鍋ｉ柡澶嬵儥閺?
  # - BUILD_TYPE: "dev" | "release"
  # ==============================================================================
  ENV_MODE = "production"
  BUILD_TYPE = "dev"

  if ENV_MODE == "production"
    API_BASE_URL = "https://loamlab-camera.vercel.app"
  else
    API_BASE_URL = "http://localhost:3001"
  end

  # Update version for 1.3.3 -> 1.4.0
  VERSION = '1.4.5'
end















