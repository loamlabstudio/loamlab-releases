# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 閻犳澘顣ㄩ懜鍥у弿閸╃喕艒鐎?(Global Environment Config)
  # - 闂佸娅﹂梽銈夊盁閺呭倽鐝涙穱婵囧瘮 "development" (闁絿绐旈懛顏呮拱濮?localhost:3000)
  # - 閸熷棗瀵查幍鎾冲瘶闁插鍤?.rbz)閸撳稄绱濋崟娆忕箑鐏忓洦顒濈拋濠冩毄閺€鍦仱 "production" (闁絿绐旈懛?Vercel 闂嗚尙顏径褑鍙?
  # ==============================================================================
  ENV_MODE = "production" # "development" | "production"

  if ENV_MODE == "production"
    # ! 闂嗚尙顏径褑鍙囬惃鍕劀瀵繒鎭崸鈧?(鐠滃褰岄幋鎰亶闁劎璁插宀€娈?Vercel 缂嶆彃鐓欓敍灞筋洤 https://loamlab.vercel.app)
    API_BASE_URL = "https://loamlab-camera-backend.vercel.app"
  else
    # ! 閺堫剚顭奸梺瀣濞擃剝鈹傞悹鏉款暔
    API_BASE_URL = "http://localhost:3001"
  end

  # 鐣跺墠铏熺⒓ (閫ｅ嫊 updater 鐗堟湰姣斿皪姗熷埗)
  VERSION = '1.2.0-beta'
end



