require 'sketchup.rb'
require 'extensions.rb'

module LoamLab
  module AIURenderer
    # 紀錄外掛根目錄路徑
    PLUGIN_ROOT = File.expand_path(File.dirname(__FILE__))
    # 將當前外掛開發目錄推入 $LOAD_PATH 的最前面，
    # 這樣一來如果 SketchUp 內有兩組同名擴展，將永遠強制優先讀取最新的這組。
    dev_dir = File.dirname(__FILE__)
    $LOAD_PATH.unshift(dev_dir) unless $LOAD_PATH.include?(dev_dir)
    
    unless file_loaded?(__FILE__)
    ext = SketchupExtension.new('LoamLab Camera (野人相機)', 'loamlab_plugin/main')
    ext.description = 'LoamLab Camera Architecture Rendering Plugin'
    ext.version     = '1.1.2'
    ext.creator     = 'LoamLab Studio'
      ext.copyright   = '2026 LoamLab Inc.'
      
      # 將擴展註冊到 SketchUp
      Sketchup.register_extension(ext, true)
      
      file_loaded(__FILE__)
    end
  end
end
