# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 闁稿繈鍔岄惇顒勬偣閺夋鏆旈梺鏉跨Ф閻?(Global Environment Config)
  # - ENV_MODE: "development" (闁哄牜鍓欏﹢鎾⒑鐎ｎ剚顏? | "production" (婵繐绲界槐锟犳偣閺夋鏆?
  # - BUILD_TYPE: "dev" | "release"
  # ==============================================================================
  ENV_MODE = "production"
  BUILD_TYPE = "dev" # 闂備礁顑囧▍锕€螣閳ュ磭纭€

  if ENV_MODE == "production"
    API_BASE_URL = "https://loamlab-camera.vercel.app"
  else
    API_BASE_URL = "http://localhost:3001"
  end

  # 闁圭粯甯婂▎銏ゆ偋閸喐鎷遍柧?(闁活潿鍔嶉弻?updater 婵′勘鍨洪悡锟犳嚋?API 閻犳粌顑嗛惇鏉课熷▎鎾跺⒌)
  VERSION = '1.3.0'
end





