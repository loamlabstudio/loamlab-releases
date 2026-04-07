# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 闁稿繈鍔岄惇顒勬偣閺夋鏆旈梺鏉跨Ф閻?(Global Environment Config)
  # - ENV_MODE: "development" (闁哄牜鍓欏﹢鎾⒑鐎ｎ剚顏? | "production" (婵繐绲界槐锟犳偣閺夋鏆?
  # - BUILD_TYPE: "dev" | "release"
  # ==============================================================================
  ENV_MODE = "production"
  BUILD_TYPE = "release"

  if ENV_MODE == "production"
    API_BASE_URL = "https://loamlab-camera.vercel.app"
  else
    API_BASE_URL = "http://localhost:3001"
  end

  # Update version for 1.3.3 -> 1.4.0
  VERSION = '1.4.0'
end










