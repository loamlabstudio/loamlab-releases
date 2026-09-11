require 'sketchup.rb'
require 'extensions.rb'

module LoamLab
  module AIURenderer
    # 取得插件根目錄 (Get plugin root directory)
    PLUGIN_ROOT = File.expand_path(File.dirname(__FILE__))
    
    unless file_loaded?(__FILE__)
      ext = SketchupExtension.new('LoamLab Camera (野人相機)', File.join(File.dirname(__FILE__), 'loamlab_plugin', 'main'))
      ext.description = 'LoamLab Camera Architecture Rendering Plugin'
      ext.version     = '1.4.78'
      ext.creator     = 'LoamLab Studio'
      ext.copyright   = '2026 LoamLab Inc.'
      
      # 註冊擴充程式到 SketchUp (Register extension to SketchUp)
      Sketchup.register_extension(ext, true)
      
      file_loaded(__FILE__)
    end
  end
end





















