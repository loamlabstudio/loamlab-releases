require 'sketchup.rb'
require 'extensions.rb'

module LoamLab
  module AIURenderer
    # 绱€閷勫鎺涙牴鐩寗璺緫
    PLUGIN_ROOT = File.expand_path(File.dirname(__FILE__))
    # 灏囩暥鍓嶅鎺涢枊鐧肩洰閷勬帹鍏?$LOAD_PATH 鐨勬渶鍓嶉潰锛?
    # 閫欐ǎ涓€渚嗗鏋?SketchUp 鍏ф湁鍏╃祫鍚屽悕鎿村睍锛屽皣姘搁仩寮峰埗鍎厛璁€鍙栨渶鏂扮殑閫欑祫銆?
    dev_dir = File.dirname(__FILE__)
    $LOAD_PATH.unshift(dev_dir) unless $LOAD_PATH.include?(dev_dir)
    
    unless file_loaded?(__FILE__)
    ext = SketchupExtension.new('LoamLab Camera (閲庝汉鐩告)', File.join(File.dirname(__FILE__), 'loamlab_plugin', 'main'))
    ext.description = 'LoamLab Camera Architecture Rendering Plugin'
    ext.version     = '1.3.0'
    ext.creator     = 'LoamLab Studio'
      ext.copyright   = '2026 LoamLab Inc.'
      
      # 灏囨摯灞曡ɑ鍐婂埌 SketchUp
      Sketchup.register_extension(ext, true)
      
      file_loaded(__FILE__)
    end
  end
end



