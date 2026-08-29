require 'sketchup.rb'
require 'extensions.rb'

module LoamLab
  module AIURenderer
    # 缂佹墎鍋撻梺宄板椤﹀骞掑☉娆戝闁烩晩鍣ｇ€垫鎹勯姘卞竼
    PLUGIN_ROOT = File.expand_path(File.dirname(__FILE__))
    # 閻忓繐娲ㄩ弳銉╁礈瀹ュ拋妯嗛柟鐑樼洴閺嬪﹪鎯傞懖鈺傜獥闂佸嘲瀚敮褰掑礂?$LOAD_PATH 闁汇劌瀚〒鍫曞礈瀹ュ妗ㄩ柨?
    # 闂侇偅鐟﹁彁濞戞挴鍋撳〒姘椤┭囧几?SketchUp 闁稿景鍕畳闁稿繆鏅濈粊顐﹀触鐏炶姤鍊抽柟鎸庢綑閻秹鏁嶇仦鐣屾婵ɑ鎮傛禒鈺侇嚕瀹勬澘鐓戦柛搴簻閸樻稓鎷嬮埀顒勫矗閺嶃劍浠橀柡鍌涘濞堟垿鏌呭▎鎴犮偒闁?
    unless file_loaded?(__FILE__)
    ext = SketchupExtension.new('LoamLab Camera (闂佹彃绨煎Ч澶愭儎閸涘鐔?', File.join(File.dirname(__FILE__), 'loamlab_plugin', 'main'))
    ext.description = 'LoamLab Camera Architecture Rendering Plugin'
    ext.version     = '1.4.69'
    ext.creator     = 'LoamLab Studio'
      ext.copyright   = '2026 LoamLab Inc.'
      
      # 閻忓繐娲﹂幗顖滀沪閺団埄鎴﹀礃婵犲倸鐓?SketchUp
      Sketchup.register_extension(ext, true)
      
      file_loaded(__FILE__)
    end
  end
end





















