# frozen_string_literal: true

module LoamLab
  # ==============================================================================
  # 闂傚倷鑳堕…鍫㈡崲閸儱绀夌€光偓閸曨剙鍓冲銈嗗笒鐎氼參宕戦敐澶嬬厸濠㈣泛顑愰崕銉╂煛閸℃ɑ顥堟慨濠冩そ瀵墎鎹勯妸鎰╁€濋弻?(Global Environment Config)
  # - ENV_MODE: "development" (闂傚倷绀侀幖顐︽偋濠婂牆绀堟繛鍡楅獜閼板潡鏌熺紒銏犳灍闁抽攱鍨块幃妤呮晲鎼粹€愁潽濡? | "production" (濠电姵顔栭崰妤冩崲閹邦喖绶ら柣锝呮湰椤洟鏌ㄩ悢鍝勑ｉ柛瀣剁秮閺屸剝寰勭€ｉ潧鍔岄梺?
  # - BUILD_TYPE: "dev" | "release"
  # ==============================================================================
  ENV_MODE = "production"
  BUILD_TYPE = "dev"
  DIST_CHANNEL = "direct"   # "direct" = 鐎规鎭悧鍫礄閼奉亜瀚婄€瑰顥㈤敍澧?"store" = EW閻楀牞绱欑捄宕団偓蹇氼瀴閸ｎ煉绱?

  if ENV_MODE == "production"
    API_BASE_URL = "https://loamlab-camera.vercel.app"
  else
    API_BASE_URL = "http://localhost:3001"
  end

  VERSION = '1.4.71'
end






















































































































