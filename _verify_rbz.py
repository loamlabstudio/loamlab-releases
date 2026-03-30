import zipfile, sys

rbz = r'c:\Users\qingwen\.gemini\antigravity\workspaces\土窟設計su渲染插件\loamlab_plugin.rbz'
print('=== RBZ File List ===')
all_ok = True
with zipfile.ZipFile(rbz, 'r') as z:
    names = z.namelist()
    for n in sorted(names):
        print(' ', n)

    print()
    print('=== updater.rb checks ===')
    if 'loamlab_plugin/updater.rb' in names:
        content = z.read('loamlab_plugin/updater.rb').decode('utf-8', errors='replace')
        checks = [
            ('Thread.new NOT present', 'Thread.new' not in content),
            ('UI.start_timer present', 'UI.start_timer' in content),
            ('main.rb reload present', "'main.rb'" in content),
            ('show_dialog present', 'show_dialog' in content),
            ('.rbz extension used', '.rbz' in content),
            ('File size check (10_000)', '10_000' in content),
        ]
        for label, ok in checks:
            status = '[OK]' if ok else '[FAIL]'
            print('  %s %s' % (status, label))
            if not ok:
                all_ok = False
    else:
        print('  [FAIL] updater.rb not found')
        all_ok = False

    print()
    print('=== config.rb checks ===')
    if 'loamlab_plugin/config.rb' in names:
        cfg = z.read('loamlab_plugin/config.rb').decode('utf-8', errors='replace')
        build_ok = 'BUILD_TYPE = "release"' in cfg
        print('  %s BUILD_TYPE=release' % ('[OK]' if build_ok else '[FAIL]'))
        for line in cfg.splitlines():
            stripped = line.strip()
            if stripped.startswith('VERSION'):
                print('  [OK] %s' % stripped)
        if not build_ok:
            all_ok = False
    else:
        print('  [FAIL] config.rb not found')
        all_ok = False

    print()
    key_files = [
        'loamlab_plugin/main.rb',
        'loamlab_plugin/updater.rb',
        'loamlab_plugin/config.rb',
        'loamlab_plugin/ui/index.html',
        'loamlab_plugin/ui/app.js',
    ]
    print('=== required files check ===')
    for f in key_files:
        ok = f in names
        print('  %s %s' % ('[OK]' if ok else '[MISS]', f))
        if not ok:
            all_ok = False

print()
print('=== RESULT: %s ===' % ('ALL PASS' if all_ok else 'FAILED - see above'))
sys.exit(0 if all_ok else 1)
