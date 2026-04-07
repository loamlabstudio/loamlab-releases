// LoamLab Tutorial System
// Reads from TUTORIAL_CONFIG (window.TUTORIAL_CONFIG, loaded from tutorial_config.json)
// Uses CustomEvent decoupling — no direct dependency on app.js internals.
//
// localStorage keys:
//   loamlab_tut_v{version}_{toolId}  → "done" | "skip"
//   loamlab_tut_whats_new_{version}  → "seen"
//   loamlab_tut_opted_out            → "1"  (user chose to skip all tutorials)
//   loamlab_tut_choice_shown         → "1"  (choice screen already presented)

(function () {
    'use strict';

    // Read config lazily so async fetch injection works.
    function _cfg() {
        return (typeof window !== 'undefined' && window.TUTORIAL_CONFIG) || null;
    }

    // ── State ────────────────────────────────────────────────────────────────
    let _activeToolId = null;
    let _activeStepIndex = 0;
    let _activeSteps = [];
    let _pendingToolId = null;  // tool waiting to show after choice screen

    // ── i18n helper (delegates to app.js t() if available) ───────────────────
    function _t(key) {
        if (typeof t === 'function') return t(key);
        var lang = (typeof currentLang !== 'undefined' ? currentLang : null) || 'en-US';
        var langSet = (typeof UI_LANG !== 'undefined' && UI_LANG[lang]) || {};
        return langSet[key] || key;
    }

    function _currentVersion() {
        return (typeof window !== 'undefined' && window.LOAMLAB_VERSION)
            || (typeof VERSION !== 'undefined' ? VERSION : null)
            || '99.99.99';  // fallback: show all steps in dev
    }

    function _storageKey(toolId) {
        return 'loamlab_tut_v' + _currentVersion() + '_' + toolId;
    }

    function _whatsNewKey(version) {
        return 'loamlab_tut_whats_new_' + version;
    }

    // ── Public API ────────────────────────────────────────────────────────────
    window.TutorialSystem = {

        /**
         * Called when user switches tool (via loamlab:tool-switch CustomEvent).
         * First time ever: shows choice screen (guide me vs skip-all).
         * Subsequent times: shows tutorial if not already seen, unless opted out.
         */
        checkFirstUse: function (toolId) {
            if (!_cfg()) return;
            try {
                if (localStorage.getItem('loamlab_tut_opted_out')) return;
                // 只有用戶主動打勾（'done'）才跳過，'skip' 代表只是關閉，下次仍顯示
                if (localStorage.getItem(_storageKey(toolId)) === 'done') return;
                if (!localStorage.getItem('loamlab_tut_choice_shown')) {
                    _pendingToolId = toolId;
                    this.showChoiceScreen();
                    return;
                }
            } catch (_) { return; }
            var tool = _findTool(toolId);
            if (!tool || !tool.live) return;
            this.showModal(toolId, 0);
        },

        /**
         * One-time choice screen: "guide me" vs "skip all tutorials".
         */
        showChoiceScreen: function () {
            var modal = document.getElementById('tutorial-modal');
            if (!modal) return;
            var box = modal.querySelector('.tut-modal-box');
            if (!box) return;

            box.innerHTML =
                '<div class="flex flex-col gap-5 py-1">' +
                    '<div class="flex flex-col gap-1.5">' +
                        '<p class="text-[14px] font-bold text-white/90">' +
                            (_t('tut_choice_title') || '需要新手引導嗎？') +
                        '</p>' +
                        '<p class="text-[11px] text-white/45 leading-relaxed">' +
                            (_t('tut_choice_desc') || '首次使用各工具時，我們提供 2-3 步操作說明。隨時可從工具旁的 ? 重新開啟。') +
                        '</p>' +
                    '</div>' +
                    '<div class="flex flex-col gap-2">' +
                        '<button onclick="TutorialSystem.acceptTutorial()" ' +
                            'class="w-full py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-[12px] font-semibold text-amber-300 hover:bg-amber-500/30 transition-colors">' +
                            (_t('tut_choice_yes') || '帶我了解功能 →') +
                        '</button>' +
                        '<button onclick="TutorialSystem.skipAll()" ' +
                            'class="w-full py-2 rounded-xl text-[11px] text-white/35 hover:text-white/60 transition-colors">' +
                            (_t('tut_choice_no') || '我已熟悉，直接開始') +
                        '</button>' +
                    '</div>' +
                '</div>';

            modal.classList.remove('hidden');
            requestAnimationFrame(function () {
                if (box) box.classList.remove('scale-95', 'opacity-0');
            });
        },

        /**
         * User chose to accept tutorials.
         */
        acceptTutorial: function () {
            try { localStorage.setItem('loamlab_tut_choice_shown', '1'); } catch (_) {}
            var modal = document.getElementById('tutorial-modal');
            if (modal) modal.classList.add('hidden');
            _restoreModalStructure();
            if (_pendingToolId) {
                var toolId = _pendingToolId;
                _pendingToolId = null;
                var tool = _findTool(toolId);
                if (tool && tool.live) this.showModal(toolId, 0);
            }
        },

        /**
         * User chose to skip all tutorials — never show again.
         */
        skipAll: function () {
            try {
                localStorage.setItem('loamlab_tut_opted_out', '1');
                localStorage.setItem('loamlab_tut_choice_shown', '1');
            } catch (_) {}
            var modal = document.getElementById('tutorial-modal');
            if (modal) modal.classList.add('hidden');
            _restoreModalStructure();
            _pendingToolId = null;
        },

        /**
         * Called after login completes. Shows What's New once per version.
         */
        checkWhatsNew: function (version) {
            if (!_cfg()) return;
            var key = _whatsNewKey(version || _currentVersion());
            try {
                if (localStorage.getItem(key)) return;
            } catch (_) { return; }
            var tools = _cfg().tools || [];
            var firstLive = tools.find(function (t) { return t.live; });
            if (!firstLive) return;
            if (!localStorage.getItem(_storageKey(firstLive.id))) {
                this.showModal(firstLive.id, 0, true);
            }
        },

        /**
         * Manually triggered by Help button — always shows.
         */
        openHelp: function (toolId) {
            if (!_cfg()) return;
            var tool = _findTool(toolId);
            if (!tool) return;
            this.showModal(toolId, 0, false, true);
        },

        /**
         * Core: render and show the step tutorial modal.
         */
        showModal: function (toolId, stepIndex, isWhatsNew, isManual) {
            var tool = _findTool(toolId);
            if (!tool) return;
            var lang = (typeof currentLang !== 'undefined' ? currentLang : null)
                || (typeof localStorage !== 'undefined' && localStorage.getItem('loamlab_lang'))
                || 'en-US';
            var steps = _liveSteps(tool, _currentVersion());
            if (!steps.length) return;

            _activeToolId = toolId;
            _activeStepIndex = stepIndex || 0;
            _activeSteps = steps;

            // 不寫 localStorage — 只有用戶打勾時 dismiss(true) 才寫 'done'

            _render(tool, lang, _activeStepIndex, isWhatsNew);

            var modal = document.getElementById('tutorial-modal');
            if (modal) {
                modal.classList.remove('hidden');
                requestAnimationFrame(function () {
                    var box = modal.querySelector('.tut-modal-box');
                    if (box) box.classList.remove('scale-95', 'opacity-0');
                });
            }
        },

        nextStep: function () {
            if (_activeStepIndex < _activeSteps.length - 1) {
                _activeStepIndex++;
                var tool = _findTool(_activeToolId);
                var lang = (typeof currentLang !== 'undefined' ? currentLang : null)
                    || (typeof localStorage !== 'undefined' && localStorage.getItem('loamlab_lang'))
                    || 'en-US';
                _render(tool, lang, _activeStepIndex);
            } else {
                this.dismiss(false, false);
            }
        },

        prevStep: function () {
            if (_activeStepIndex > 0) {
                _activeStepIndex--;
                var tool = _findTool(_activeToolId);
                var lang = (typeof currentLang !== 'undefined' ? currentLang : null)
                    || (typeof localStorage !== 'undefined' && localStorage.getItem('loamlab_lang'))
                    || 'en-US';
                _render(tool, lang, _activeStepIndex);
            }
        },

        /**
         * @param {boolean} permanent  Mark this tool as done in localStorage.
         * @param {boolean} markWhatsNew  Also mark what's new as seen.
         */
        dismiss: function (permanent, markWhatsNew) {
            var modal = document.getElementById('tutorial-modal');
            if (modal) {
                var box = modal.querySelector('.tut-modal-box');
                if (box) {
                    box.classList.add('scale-95', 'opacity-0');
                    setTimeout(function () { modal.classList.add('hidden'); }, 200);
                } else {
                    modal.classList.add('hidden');
                }
            }
            if (permanent && _activeToolId) {
                try { localStorage.setItem(_storageKey(_activeToolId), 'done'); } catch (_) {}
            } else if (_activeToolId) {
                try { localStorage.setItem(_storageKey(_activeToolId), 'skip'); } catch (_) {}
            }
            if (markWhatsNew) {
                try { localStorage.setItem(_whatsNewKey(_currentVersion()), 'seen'); } catch (_) {}
            }
        }
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _restoreModalStructure() {
        var modal = document.getElementById('tutorial-modal');
        if (!modal) return;
        var box = modal.querySelector('.tut-modal-box');
        if (!box) return;
        box.innerHTML =
            '<div class="flex items-center justify-between">' +
                '<div class="flex items-center gap-2">' +
                    '<span class="tut-tool-icon text-lg"></span>' +
                    '<span class="tut-tool-title text-[13px] font-bold text-white/70 uppercase tracking-widest"></span>' +
                '</div>' +
                '<button onclick="TutorialSystem.dismiss(false,false)" class="text-white/30 hover:text-white/60 transition-colors text-lg leading-none">\u2715</button>' +
            '</div>' +
            '<div class="w-full rounded-xl bg-[#09090b] border border-white/8 flex items-center justify-center overflow-hidden" style="height:110px;">' +
                '<span class="tut-visual-icon text-5xl opacity-60"></span>' +
                '<img class="tut-visual-img hidden w-full h-full object-cover" src="" alt="">' +
            '</div>' +
            '<div class="flex flex-col gap-2">' +
                '<p class="tut-step-title text-[15px] font-semibold text-white/90"></p>' +
                '<p class="tut-step-desc text-[13px] text-white/55 leading-relaxed"></p>' +
            '</div>' +
            '<div class="tut-dots flex justify-center gap-1.5"></div>' +
            '<div class="flex items-center justify-between gap-2">' +
                '<button onclick="TutorialSystem.prevStep()" class="tut-btn-prev text-[12px] px-3 py-1.5 rounded-lg text-white/30 hover:text-white/60 transition-colors">\u2190 ' + (_t('tut_prev') || '\u4e0a\u4e00\u6b65') + '</button>' +
                '<span class="tut-step-counter text-[11px] text-white/25 font-mono"></span>' +
                '<button onclick="TutorialSystem.nextStep()" class="tut-btn-next text-[12px] px-4 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-colors font-semibold"></button>' +
            '</div>' +
            '<label class="flex items-center gap-2 cursor-pointer select-none">' +
                '<input type="checkbox" id="tut-no-show-cb" class="accent-amber-400" onchange="if(this.checked) TutorialSystem.dismiss(true,true)">' +
                '<span class="text-[11px] text-white/30">' + (_t('tut_no_show') || '\u4e0d\u518d\u986f\u793a\u6b64\u5de5\u5177\u7684\u5f15\u5c0e') + '</span>' +
            '</label>';
    }

    function _findTool(toolId) {
        var cfg = _cfg();
        if (!cfg || !cfg.tools) return null;
        return cfg.tools.find(function (t) { return t.id === toolId; }) || null;
    }

    function _liveSteps(tool, version) {
        return (tool.steps || []).filter(function (s) {
            if (s.deprecated) return false;
            return _versionLte(s.since || '0.0.0', version);
        });
    }

    function _versionLte(a, b) {
        var pa = a.split('.').map(Number);
        var pb = b.split('.').map(Number);
        for (var i = 0; i < 3; i++) {
            if ((pa[i] || 0) < (pb[i] || 0)) return true;
            if ((pa[i] || 0) > (pb[i] || 0)) return false;
        }
        return true;
    }

    function _getLang(obj, lang) {
        if (!obj) return '';
        return obj[lang] || obj['en-US'] || '';
    }

    function _render(tool, lang, stepIndex, isWhatsNew) {
        var step = _activeSteps[stepIndex];
        if (!step) return;
        var total = _activeSteps.length;
        var modal = document.getElementById('tutorial-modal');
        if (!modal) return;

        var counterEl = modal.querySelector('.tut-step-counter');
        if (counterEl) {
            var tpl = _t('tut_step_of') || 'Step {n} of {total}';
            counterEl.textContent = tpl.replace('{n}', stepIndex + 1).replace('{total}', total);
        }

        var titleEl = modal.querySelector('.tut-tool-title');
        if (titleEl) titleEl.textContent = _getLang(tool.title, lang);

        var iconEl = modal.querySelector('.tut-tool-icon');
        if (iconEl) iconEl.textContent = tool.icon || '\u2736';

        var stepTitleEl = modal.querySelector('.tut-step-title');
        if (stepTitleEl) stepTitleEl.textContent = _getLang(step.title, lang);

        var stepDescEl = modal.querySelector('.tut-step-desc');
        if (stepDescEl) stepDescEl.textContent = _getLang(step.desc, lang);

        var visualEl = modal.querySelector('.tut-visual-icon');
        var visualImgEl = modal.querySelector('.tut-visual-img');
        if (step.visual && step.visual.img) {
            if (visualEl) visualEl.classList.add('hidden');
            if (visualImgEl) { visualImgEl.src = step.visual.img; visualImgEl.classList.remove('hidden'); }
        } else {
            if (visualEl) { visualEl.classList.remove('hidden'); visualEl.textContent = (step.visual && step.visual.icon) || '\u{1F4CB}'; }
            if (visualImgEl) { visualImgEl.classList.add('hidden'); visualImgEl.src = ''; }
        }

        var dotsEl = modal.querySelector('.tut-dots');
        if (dotsEl) {
            dotsEl.innerHTML = '';
            for (var i = 0; i < total; i++) {
                var dot = document.createElement('span');
                dot.className = 'inline-block w-1.5 h-1.5 rounded-full transition-colors ' +
                    (i === stepIndex ? 'bg-amber-400' : 'bg-white/20');
                dotsEl.appendChild(dot);
            }
        }

        var prevBtn = modal.querySelector('.tut-btn-prev');
        if (prevBtn) prevBtn.classList.toggle('invisible', stepIndex === 0);

        var nextBtn = modal.querySelector('.tut-btn-next');
        if (nextBtn) {
            nextBtn.textContent = stepIndex === total - 1
                ? (_t('tut_done') || '\u5b8c\u6210 \u2713')
                : (_t('tut_next') || '\u4e0b\u4e00\u6b65 \u2192');
        }
    }


    // ── Event listener: loamlab:tool-switch ──────────────────────────────────
    document.addEventListener('loamlab:tool-switch', function (e) {
        if (e && e.detail && e.detail.toolId) {
            window.TutorialSystem.checkFirstUse(e.detail.toolId);
        }
    });

})();
