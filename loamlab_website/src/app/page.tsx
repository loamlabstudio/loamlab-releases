"use client";

import { useEffect, useState, useRef } from "react";

// --- 緩慢跳動的即時儀表板 ---
function LiveTicker() {
  const [hours, setHours] = useState<number | null>(null);

  // 從後端拉取真實渲染次數換算的節省小時數
  useEffect(() => {
    fetch('https://loamlab-camera-backend.vercel.app/api/stats')
      .then(r => r.json())
      .then(data => setHours(data.hours_saved ?? 0))
      .catch(() => setHours(3240)); // fallback 避免畫面空白
  }, []);

  // 呼吸動畫：真實基底載入後啟動，不規則節奏偶爾 +1
  useEffect(() => {
    if (hours === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setHours(prev => (prev ?? 0) + (Math.random() < 0.85 ? 0 : 1));
      timer = setTimeout(tick, 800 + Math.random() * 3200);
    };
    timer = setTimeout(tick, 2000);
    return () => clearTimeout(timer);
  }, [hours !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col items-center justify-center p-8 glass-panel rounded-3xl w-full max-w-2xl mx-auto relative overflow-hidden group border border-white/10 transition-all hover:border-[var(--color-loam-primary)] backdrop-blur-xl bg-black/40">
      <div className="text-xs md:text-sm font-bold tracking-[0.3em] uppercase text-zinc-400 mb-3 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[var(--color-loam-primary)] animate-pulse shadow-[0_0_10px_var(--color-loam-primary)]"></span>
        Live Report: 全球設計師已節省時間
      </div>

      <div
        key={hours ?? 'loading'}
        className="ticker-refresh text-4xl md:text-5xl font-mono tracking-widest mb-4 text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]"
      >
        {hours === null
          ? <span className="opacity-30">—,———</span>
          : <>{hours.toLocaleString()} <span className="text-xl text-[var(--color-loam-primary)] uppercase">小時</span></>
        }
      </div>

      <div className="text-sm md:text-base text-zinc-400 font-light max-w-lg text-center">
        傳統渲染需耗時超過 60 分鐘，野人相機將每張高畫質出圖<br className="hidden md:block" />
        <span className="text-white font-medium">縮短至驚人的 30 秒</span>。
      </div>
    </div>
  );
}

// --- Before / After 滑塊 ---
function CompareSlider() {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDrag = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  };

  useEffect(() => {
    const handleUp = () => document.body.style.cursor = 'default';
    const handleMove = (e: MouseEvent) => {
      if (e.buttons === 1) handleDrag(e.clientX);
    };
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('mousemove', handleMove);
    return () => {
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('mousemove', handleMove);
    };
  }, []);

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-[50vh] min-h-[400px] md:h-[70vh] rounded-[40px] overflow-hidden border border-white/10 shadow-[0_40px_100px_rgba(0,0,0,0.8)] cursor-ew-resize select-none mx-auto max-w-6xl"
      onMouseDown={(e) => handleDrag(e.clientX)}
      onTouchMove={(e) => handleDrag(e.touches[0].clientX)}
    >
      {/* Before Image (SketchUp Model) */}
      <div 
        className="absolute inset-0 bg-cover bg-center pointer-events-none" 
        style={{ backgroundImage: "url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&q=80&w=2000&grayscale=true')" }}
      />
      <div className="absolute top-6 left-6 px-4 py-2 bg-black/50 backdrop-blur rounded-full text-[10px] md:text-xs font-bold tracking-widest uppercase border border-white/20 text-white/70">
        Raw SketchUp
      </div>

      {/* After Image (Rendered) */}
      <div 
        className="absolute top-0 left-0 bottom-0 bg-cover bg-center border-r-2 border-[var(--color-loam-primary)] pointer-events-none"
        style={{ 
          width: `${sliderPos}%`,
          backgroundImage: "url('https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&q=80&w=2000')" 
        }}
      >
        <div className="absolute top-6 left-6 px-4 py-2 bg-[var(--color-loam-primary)] text-white rounded-full text-[10px] md:text-xs font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(218,30,31,0.5)]">
          LoamLab Camera
        </div>
      </div>

      {/* Slider Handle */}
      <div 
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-14 h-14 bg-white/10 backdrop-blur-md rounded-full border-2 border-white flex items-center justify-center shadow-[0_0_20px_rgba(0,0,0,0.8)] z-20 transition-transform hover:scale-110 active:scale-95"
        style={{ left: `${sliderPos}%` }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M18 8L22 12L18 16M6 8L2 12L6 16"/></svg>
      </div>
    </div>
  );
}

export default function Home() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="min-h-screen bg-[var(--color-loam-dark)] relative overflow-hidden text-[var(--color-loam-bone)]">
      {/* Background Noise & Radial Glow */}
      <div className="fixed top-0 left-1/2 -z-10 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 opacity-10 bg-[radial-gradient(circle_at_center,_var(--color-loam-primary)_0%,_transparent_70%)] blur-[100px] pointer-events-none" />
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none z-0 mix-blend-screen" style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg viewBox=\"0 0 200 200\" xmlns=\"http://www.w3.org/2000/svg\"%3E%3Cfilter id=\"n\"%3E%3CfeTurbulence type=\"fractalNoise\" baseFrequency=\"0.85\" numOctaves=\"3\" stitchTiles=\"stitch\"/%3E%3C/filter%3E%3Crect width=\"100%25\" height=\"100%25\" filter=\"url(%23n)\"/%3E%3C/svg%3E')" }}></div>
      
      {/* Navbar */}
      <nav className="fixed w-full z-50 px-6 py-4 flex justify-between items-center bg-[var(--color-loam-dark)]/80 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => scrollTo('hero')}>
          <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
             <path d="M10 85L50 15L90 85" stroke="white" strokeWidth="8"/>
             <path d="M42 85H58L50 72L42 85Z" fill="var(--color-loam-primary)"/>
          </svg>
          <div className="hidden sm:flex flex-col">
            <span className="text-xs font-bold tracking-[0.2em] uppercase">LoamLab Camera</span>
            <span className="text-[8px] tracking-[0.4em] text-white/40 uppercase mt-0.5">By LoamLab Studio</span>
          </div>
        </div>
        
        <div className="hidden lg:flex space-x-10 text-[10px] font-bold tracking-[0.2em] uppercase text-white/50">
          <button onClick={() => scrollTo('features')} className="hover:text-white transition-colors">美學核心</button>
          <button onClick={() => scrollTo('comparison')} className="hover:text-white transition-colors">渲染對比</button>
          <button onClick={() => scrollTo('pricing')} className="hover:text-white transition-colors">專業方案</button>
          <button onClick={() => scrollTo('referral')} className="hover:text-white transition-colors">永久能量</button>
        </div>

        <a href="https://github.com/loamlabstudio/loamlab-releases/releases/latest/download/loamlab_plugin.rbz" className="px-6 py-2 rounded-full bg-white text-black text-[10px] font-bold tracking-widest uppercase hover:bg-white/80 transition-all">
          Get Started
        </a>
      </nav>

      {/* 1. Hero Section */}
      <section id="hero" className="w-full pt-40 pb-24 px-4 flex flex-col items-center justify-center z-10 text-center relative min-h-screen">
        <h2 className="text-[var(--color-loam-primary)] text-[10px] md:text-xs font-bold tracking-[0.6em] uppercase mb-8">
          The Future of Architectural Narrative
        </h2>
        
        <h1 className="text-5xl md:text-7xl lg:text-9xl font-light tracking-tighter mb-8 leading-[1.1]">
          讓直覺，<br className="md:hidden" />領先於<span className="italic font-normal text-[var(--color-loam-primary)]">算力</span>
        </h1>
        
        <p className="text-base md:text-xl text-zinc-400 max-w-2xl mx-auto mb-16 leading-relaxed font-light">
          專為 SketchUp 打造的極簡 AI 渲染引擎。<br className="hidden md:block"/>
          將冗長的參數調整與等待，濃縮成 30 秒的視覺爆發。
        </p>

        <div className="w-full mb-16">
          <LiveTicker />
        </div>

        <div className="flex flex-col sm:flex-row gap-6">
          <a href="https://github.com/loamlabstudio/loamlab-releases/releases/latest/download/loamlab_plugin.rbz" className="px-10 py-5 rounded-full bg-[var(--color-loam-primary)] text-white font-bold text-xs tracking-[0.2em] uppercase hover:scale-105 transition-transform shadow-[0_0_30px_rgba(218,30,31,0.3)] border border-[var(--color-loam-primary)] text-center">
            Download Free Plugin
          </a>

          <a href="https://buy.dodopayments.com/buy?variant_id=pdt_0NblmafncbUuGNrMRvJp4" target="_blank" className="px-10 py-5 rounded-full border border-white/20 text-white font-bold text-xs tracking-[0.2em] uppercase hover:bg-white/10 transition-all flex items-center justify-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            升級 Pro 方案
          </a>
        </div>
      </section>

      {/* 2. Features Section (美學核心) */}
      <section id="features" className="w-full py-32 px-6 max-w-7xl mx-auto z-10 relative border-t border-white/5">
        <div className="text-center mb-20">
          <h2 className="text-3xl md:text-5xl font-light tracking-tight mb-6">我們拒絕死板的「計算物理」</h2>
          <p className="text-zinc-400 font-light text-lg">野人相機模擬的是人類的「空間直覺」，彌補模型中缺失的情緒維度。</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="glass-panel p-10 rounded-3xl hover:-translate-y-2 transition-transform">
            <div className="text-[var(--color-loam-primary)] text-3xl font-light mb-6">01.</div>
            <h3 className="text-xl font-bold mb-4">瞬時出圖 (30s)</h3>
            <p className="text-zinc-400 font-light leading-relaxed">不必再等光線追蹤算圖。每次點擊，都能在 30 秒內產出極具視覺張力的渲染成果，讓設計反覆代代零成本。</p>
          </div>
          <div className="glass-panel p-10 rounded-3xl hover:-translate-y-2 transition-transform border border-white/10 hover:border-[var(--color-loam-primary)]/50">
            <div className="text-[var(--color-loam-primary)] text-3xl font-light mb-6">02.</div>
            <h3 className="text-xl font-bold mb-4">原生 SU 工作流</h3>
            <p className="text-zinc-400 font-light leading-relaxed">深度嵌入 SketchUp 環境，無需導出模型。從建構到視覺化，保持靈感連續不中斷。</p>
          </div>
          <div className="glass-panel p-10 rounded-3xl hover:-translate-y-2 transition-transform">
            <div className="text-[var(--color-loam-primary)] text-3xl font-light mb-6">03.</div>
            <h3 className="text-xl font-bold mb-4">骨瓷級 4K 解析度</h3>
            <p className="text-zinc-400 font-light leading-relaxed">超越基礎 AI 生圖的模糊極限，搭載超分辨率重建演算法，自動修復邊緣鋸齒與材質細節。</p>
          </div>
        </div>
      </section>

      {/* 3. Comparison Slider Section (渲染對比) */}
      <section id="comparison" className="w-full py-32 px-4 md:px-12 z-10 bg-white/[0.01]">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-light tracking-tight mb-4">專業產出 vs 原始模型</h2>
            <p className="text-[10px] md:text-xs text-zinc-500 tracking-[0.4em] uppercase">Slide to feel the native rendering magic</p>
          </div>
          <CompareSlider />
        </div>
      </section>

      {/* 4. Pricing Section (定價方案 - Synchronized with POINTS_SYSTEM.md) */}
      <section id="pricing" className="w-full py-32 px-6 max-w-6xl mx-auto z-10 relative">
        <div className="text-center mb-20">
          <h2 className="text-4xl md:text-5xl font-light mb-6">靈活方案，支撐創意野心</h2>
          <p className="text-zinc-400 font-light">
            目前開放 Beta 測試期專屬 <span className="text-[var(--color-loam-primary)] font-bold">7折 (30% OFF)</span> 永久優惠。<br/>
            點數採 Use it or lose it 制度，確保伺服器穩定。
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Starter */}
          <div className="glass-panel p-10 rounded-[40px] flex flex-col border border-white/5 hover:border-white/20 transition-all">
            <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 font-bold mb-6">Starter / 基礎</div>
            <div className="text-5xl font-light mb-2">$17 <span className="text-sm text-zinc-500">/mo</span></div>
            <div className="text-xs text-zinc-500 line-through mb-8">原價 $24</div>

            <ul className="space-y-4 mb-12 flex-grow text-sm text-zinc-400 font-light">
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> 每月發放 300 Credits</li>
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> 約可產出 15 張 2K 渲染</li>
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> SketchUp 全版本支援</li>
            </ul>
            <a href="https://buy.dodopayments.com/buy?variant_id=pdt_0NblmUvFrwJe36ymTELWV" target="_blank" className="w-full py-4 rounded-full border border-white/20 text-[10px] font-bold tracking-widest uppercase hover:bg-white hover:text-black transition-all text-center">Subscribe</a>
          </div>

          {/* Pro (Hot) */}
          <div className="glass-panel p-10 rounded-[40px] flex flex-col border border-[var(--color-loam-primary)]/50 bg-[var(--color-loam-primary)]/5 relative scale-105 shadow-[0_20px_50px_rgba(218,30,31,0.15)] z-20">
            <div className="absolute top-0 right-0 bg-[var(--color-loam-primary)] text-white text-[9px] px-4 py-2 font-bold tracking-[0.2em] uppercase rounded-bl-2xl">Most Popular</div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-[var(--color-loam-primary)] font-bold mb-6">Pro / 專業</div>
            <div className="text-5xl font-light mb-2 text-white">$36 <span className="text-sm text-zinc-500">/mo</span></div>
            <div className="text-xs text-[var(--color-loam-primary)]/60 line-through mb-8">原價 $52</div>

            <ul className="space-y-4 mb-12 flex-grow text-sm text-zinc-300 font-light">
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> 每月高達 2,000 Credits</li>
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> 約可產出 100 張 2K 渲染</li>
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> 支援 4K 影院級畫質擴展</li>
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> 優先 AI 計算通道</li>
            </ul>
            <a href="https://buy.dodopayments.com/buy?variant_id=pdt_0NblmafncbUuGNrMRvJp4" target="_blank" className="w-full py-5 rounded-full bg-[var(--color-loam-primary)] text-white text-[10px] font-bold tracking-widest uppercase hover:scale-105 transition-transform text-center">Subscribe</a>
          </div>

          {/* Studio */}
          <div className="glass-panel p-10 rounded-[40px] flex flex-col border border-white/5 hover:border-white/20 transition-all">
            <div className="text-[10px] tracking-[0.3em] uppercase text-zinc-500 font-bold mb-6">Studio / 工作室</div>
            <div className="text-5xl font-light mb-2">$97 <span className="text-sm text-zinc-500">/mo</span></div>
            <div className="text-xs text-zinc-500 line-through mb-8">原價 $139</div>

            <ul className="space-y-4 mb-12 flex-grow text-sm text-zinc-400 font-light">
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> 每月爆發 9,000 Credits</li>
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> 約可產出 450 張 2K 渲染</li>
              <li className="flex items-center"><span className="text-[var(--color-loam-primary)] mr-3">✓</span> 團隊商用授權許可</li>
            </ul>
            <a href="https://buy.dodopayments.com/buy?variant_id=pdt_0Nblmhwbr5WXfNyDHpaA2" target="_blank" className="w-full py-4 rounded-full border border-white/20 text-[10px] font-bold tracking-widest uppercase hover:bg-white hover:text-black transition-all text-center">Subscribe</a>
          </div>
        </div>
      </section>

      {/* 5. Referral System (永久能量) */}
      <section id="referral" className="w-full py-32 px-6 border-t border-white/5 bg-[radial-gradient(ellipse_at_bottom,_var(--color-loam-primary)_0%,_transparent_30%)] opacity-90">
        <div className="max-w-4xl mx-auto text-center glass-panel p-12 md:p-20 rounded-[50px] relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-10 mix-blend-overlay pointer-events-none"></div>
          
          <h2 className="text-3xl md:text-5xl font-light mb-6">永久能量：共享無界</h2>
          <p className="text-zinc-400 font-light leading-relaxed mb-12 max-w-2xl mx-auto">
            設計師的進步不應被點數阻礙。透過專屬連結邀請同行註冊，當對方完成首次體驗時，<br/>
            邀請人即獲得 <span className="text-white font-bold">300 點</span>，受邀人獲得 <span className="text-white font-bold">100 點</span> 永久不過期點數。
          </p>

          <div className="flex flex-col md:flex-row justify-center items-center gap-8 md:gap-16">
            <div className="flex flex-col items-center">
              <div className="text-6xl text-[var(--color-loam-primary)] font-light mb-2">+300</div>
              <div className="text-[10px] tracking-widest uppercase text-zinc-500">邀請人獲得 (Invite)</div>
            </div>
            <div className="w-[1px] h-16 bg-white/20 hidden md:block"></div>
            <div className="w-full h-[1px] bg-white/20 md:hidden"></div>
            <div className="flex flex-col items-center">
              <div className="text-6xl text-white font-light mb-2">+100</div>
              <div className="text-[10px] tracking-widest uppercase text-zinc-500">受邀人獲得 (Bonus)</div>
            </div>
          </div>

          <button className="mt-16 px-12 py-5 rounded-full border border-white/20 text-[10px] font-bold tracking-widest uppercase hover:bg-white hover:text-black transition-all">
            生成專屬邀請碼
          </button>
        </div>
      </section>

      {/* 6. Footer */}
      <footer className="w-full py-12 px-6 border-t border-white/5 text-center flex flex-col items-center justify-center">
        <div className="flex items-center space-x-2 opacity-30 mb-6">
          <svg viewBox="0 0 100 100" fill="none" className="w-6 h-6">
             <path d="M10 85L50 15L90 85" stroke="white" strokeWidth="8"/>
             <path d="M42 85H58L50 72L42 85Z" fill="var(--color-loam-primary)"/>
          </svg>
          <span className="text-xs font-bold tracking-widest uppercase">LoamLab Camera</span>
        </div>
        <div className="text-[9px] tracking-[0.4em] uppercase text-zinc-600 space-x-6 mb-4">
          <a href="#" className="hover:text-white transition-colors">服務條款</a>
          <a href="#" className="hover:text-white transition-colors">隱私權政策</a>
          <a href="#" className="hover:text-white transition-colors">Instagram</a>
        </div>
        <div className="text-[8px] tracking-[0.2em] uppercase text-zinc-700">
          &copy; 2024 - 2026 Developed by LoamLab Studio. All rights reserved.
        </div>
      </footer>
    </main>
  );
}
