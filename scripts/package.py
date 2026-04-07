import zipfile
import os
import shutil

# Paths
root = r'c:\Users\qingwen\.gemini\antigravity\workspaces\土窟設計su渲染插件'
plugin_rb = os.path.join(root, 'loamlab_plugin.rb')
plugin_dir = os.path.join(root, 'loamlab_plugin')
out_rbz = os.path.join(root, 'loamlab_plugin.rbz')

# Temporarily set BUILD_TYPE to release in config.rb
config_path = os.path.join(plugin_dir, 'config.rb')
with open(config_path, 'r', encoding='utf-8') as f:
    content = f.read()

original_content = content
release_content = content.replace('BUILD_TYPE = "dev"', 'BUILD_TYPE = "release"')

try:
    with open(config_path, 'w', encoding='utf-8') as f:
        f.write(release_content)
    
    print("Packaging .rbz...")
    with zipfile.ZipFile(out_rbz, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # Add entry file
        zipf.write(plugin_rb, 'loamlab_plugin.rb')
        
        # Add plugin directory contents
        for root_dir, dirs, files in os.walk(plugin_dir):
            for file in files:
                # Exclude node_modules and other irrelevant files
                full_path = os.path.join(root_dir, file)
                if 'node_modules' in full_path:
                    continue
                if '.git' in full_path:
                    continue
                
                rel_path = os.path.relpath(full_path, root)
                zipf.write(full_path, rel_path.replace('\\', '/'))

    print(f"Successfully created {out_rbz}")

finally:
    # Always restore dev mode
    with open(config_path, 'w', encoding='utf-8') as f:
        f.write(original_content)
    print("Restored config.rb to dev mode.")
