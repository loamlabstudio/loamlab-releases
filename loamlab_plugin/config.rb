# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 全局環境配置 (Global Environment Config)
  # - ENV_MODE: "development" (本地開發) | "production" (正式環境)
  # - BUILD_TYPE: "dev" | "release"
  # ==============================================================================
  ENV_MODE = "production"
  BUILD_TYPE = "dev" # 開發模式

  if ENV_MODE == "production"
    API_BASE_URL = "https://loamlab-camera-backend.vercel.app"
  else
    API_BASE_URL = "http://localhost:3001"
  end

  # 插件版本號 (用於 updater 檢查與 API 請求標頭)
  VERSION = '1.2.9-beta'
end
