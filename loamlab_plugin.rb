require 'sketchup.rb'
require 'extensions.rb'

module LoamLab
  module AIURenderer
    # 缁扁偓闁峰嫬顦婚幒娑欑壌閻╊噣瀵楃捄顖氱帆
    PLUGIN_ROOT = File.expand_path(File.dirname(__FILE__))
    # 鐏忓洨鏆ラ崜宥咁樆閹烘盯鏋婇惂鑲╂窗闁峰嫭甯归崗?$LOAD_PATH 閻ㄥ嫭娓堕崜宥夋桨閿?
    # 闁瑦菐娑撯偓娓氬棗顩ч弸?SketchUp 閸徰勬箒閸忊晝绁崥灞芥倳閹挎潙鐫嶉敍灞界殻濮樻悂浠╁宄板煑閸庮亜鍘涚拋鈧崣鏍ㄦ付閺傛壆娈戦柅娆戠カ閵?
    unless file_loaded?(__FILE__)
    ext = SketchupExtension.new('LoamLab Camera (闁插簼姹夐惄鍛婎熂)', File.join(File.dirname(__FILE__), 'loamlab_plugin', 'main'))
    ext.description = 'LoamLab Camera Architecture Rendering Plugin'
    ext.version     = '1.4.12'
    ext.creator     = 'LoamLab Studio'
      ext.copyright   = '2026 LoamLab Inc.'
      
      # 鐏忓洦鎽仦鏇∩戦崘濠傚煂 SketchUp
      Sketchup.register_extension(ext, true)
      
      file_loaded(__FILE__)
    end
  end
end












