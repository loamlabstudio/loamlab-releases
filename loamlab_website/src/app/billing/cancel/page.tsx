"use client";

import { useState, useEffect } from "react";

const BACKEND = "https://loamlab-camera-backend.vercel.app";

const REASONS = [
  { id: "too_expensive", label: "訂閱費用超出預算", offer: "discount" as const },
  { id: "not_using", label: "最近案子少，暫時用不到", offer: "pause" as const },
  { id: "switching", label: "改用其他工具", offer: "discount" as const },
  { id: "other", label: "其他原因", offer: "pause" as const },
];

const OFFER_COPY = {
  discount: {
    title: "先別走 — 這是給你的",
    subtitle: "立即補充 100 點，繼續完成手邊的案子",
    detail: "100 點 = 5 張 2K 效果圖，今天就能用",
    cta: "接受回饋，繼續使用",
    ctaColor: "bg-[var(--color-loam-primary)]",
  },
  pause: {
    title: "案子少？先暫停一下",
    subtitle: "點數和方案暫時凍結，想用再自動恢復",
    detail: "暫停期間不扣費，點數保留，隨時可提前恢復",
    cta: "暫停訂閱 1 個月",
    ctaColor: "bg-white/10 border border-white/20",
  },
};

export default function CancelPage() {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedReason, setSelectedReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; msg: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEmail(params.get("email") || "");
  }, []);

  const reasonData = REASONS.find((r) => r.id === selectedReason);
  const offerType = reasonData?.offer || "discount";
  const offer = OFFER_COPY[offerType];

  async function acceptOffer(pauseMonths = 1) {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/user?action=save_offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, offer_type: offerType, pause_months: pauseMonths }),
      });
      const data = await res.json();
      setResult({ success: data.code === 0, msg: data.msg || (data.code === 0 ? "完成" : "發生錯誤，請稍後再試") });
      setStep(3);
    } catch {
      setResult({ success: false, msg: "網路錯誤，請稍後再試" });
      setStep(3);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-loam-dark)] flex items-center justify-center px-4 py-20">
      {/* 背景光暈 */}
      <div className="fixed top-1/2 left-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 opacity-5 bg-[radial-gradient(circle,_var(--color-loam-primary)_0%,_transparent_70%)] blur-[80px] pointer-events-none" />

      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-12 justify-center">
          <svg width="24" height="24" viewBox="0 0 100 100" fill="none">
            <path d="M10 85L50 15L90 85" stroke="white" strokeWidth="8" />
            <path d="M42 85H58L50 72L42 85Z" fill="var(--color-loam-primary)" />
          </svg>
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-white/60">LoamLab Camera</span>
        </div>

        {/* Step 1 - 取消原因 */}
        {step === 1 && (
          <div className="glass-panel rounded-3xl p-8 md:p-10 border border-white/10">
            <div className="text-[10px] tracking-[0.3em] uppercase text-[var(--color-loam-primary)] font-bold mb-4">
              取消訂閱
            </div>
            <h1 className="text-2xl md:text-3xl font-light mb-3 tracking-tight">
              在離開前，可以告訴我們原因嗎？
            </h1>
            <p className="text-zinc-400 font-light text-sm mb-8">
              這幫助我們改善 LoamLab，也讓我們確認是否有更好的解決方案。
            </p>

            <div className="space-y-3 mb-8">
              {REASONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedReason(r.id)}
                  className={`w-full text-left px-5 py-4 rounded-2xl border transition-all text-sm font-light ${
                    selectedReason === r.id
                      ? "border-[var(--color-loam-primary)] bg-[var(--color-loam-primary)]/10 text-white"
                      : "border-white/10 text-zinc-400 hover:border-white/30 hover:text-white"
                  }`}
                >
                  <span className={`inline-block w-4 h-4 rounded-full border mr-3 align-middle transition-all ${
                    selectedReason === r.id ? "border-[var(--color-loam-primary)] bg-[var(--color-loam-primary)]" : "border-white/30"
                  }`} />
                  {r.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setStep(2)}
              disabled={!selectedReason}
              className="w-full py-4 rounded-full bg-white/5 border border-white/20 text-[10px] font-bold tracking-widest uppercase hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              繼續
            </button>
          </div>
        )}

        {/* Step 2 - 挽留方案 */}
        {step === 2 && (
          <div className="glass-panel rounded-3xl p-8 md:p-10 border border-white/10">
            <div className="text-[10px] tracking-[0.3em] uppercase text-[var(--color-loam-primary)] font-bold mb-4">
              專屬方案
            </div>
            <h1 className="text-2xl md:text-3xl font-light mb-3 tracking-tight">
              {offer.title}
            </h1>
            <p className="text-zinc-300 text-sm mb-2">{offer.subtitle}</p>
            <p className="text-zinc-500 text-xs mb-8">{offer.detail}</p>

            {offerType === "pause" && (
              <div className="flex gap-3 mb-6">
                {[1, 2, 3].map((m) => (
                  <button
                    key={m}
                    onClick={() => acceptOffer(m)}
                    disabled={loading}
                    className="flex-1 py-3 rounded-xl border border-white/20 text-xs font-bold tracking-wider hover:bg-white/10 transition-all disabled:opacity-50"
                  >
                    {m} 個月
                  </button>
                ))}
              </div>
            )}

            {offerType === "discount" && (
              <button
                onClick={() => acceptOffer(1)}
                disabled={loading}
                className={`w-full py-4 rounded-full text-white text-[10px] font-bold tracking-widest uppercase transition-all mb-4 disabled:opacity-50 ${offer.ctaColor}`}
              >
                {loading ? "處理中..." : offer.cta}
              </button>
            )}

            {offerType === "pause" && (
              <p className="text-zinc-500 text-xs text-center mb-4">選擇暫停月數後直接生效</p>
            )}

            <button
              onClick={() => {
                setResult({ success: false, msg: "" });
                setStep(3);
              }}
              className="w-full py-3 rounded-full text-[10px] font-bold tracking-widest uppercase text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              不了，我確定要取消
            </button>
          </div>
        )}

        {/* Step 3 - 結果 */}
        {step === 3 && (
          <div className="glass-panel rounded-3xl p-8 md:p-10 border border-white/10 text-center">
            {result?.success ? (
              <>
                <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center mx-auto mb-6">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h1 className="text-2xl font-light mb-3 tracking-tight">已為您處理</h1>
                <p className="text-zinc-400 text-sm font-light mb-8">{result.msg}</p>
                <a
                  href="https://loamlab.studio"
                  className="inline-block px-10 py-4 rounded-full bg-[var(--color-loam-primary)] text-white text-[10px] font-bold tracking-widest uppercase hover:scale-105 transition-transform"
                >
                  回到 LoamLab
                </a>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-6">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <h1 className="text-2xl font-light mb-3 tracking-tight">取消訂閱</h1>
                <p className="text-zinc-400 text-sm font-light mb-2">
                  請直接聯繫我們，我們將在 24 小時內為您取消並確認。
                </p>
                <p className="text-zinc-600 text-xs mb-8">取消後，當前月份點數仍可繼續使用至期末。</p>
                <a
                  href={`mailto:support@loamlab.studio?subject=訂閱取消申請&body=Email: ${email}`}
                  className="inline-block px-10 py-4 rounded-full border border-white/20 text-[10px] font-bold tracking-widest uppercase hover:bg-white/10 transition-all"
                >
                  發信取消訂閱
                </a>
              </>
            )}
          </div>
        )}

        {/* 步驟指示器 */}
        <div className="flex justify-center gap-2 mt-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1 rounded-full transition-all duration-300 ${
                step === s ? "w-8 bg-[var(--color-loam-primary)]" : "w-2 bg-white/20"
              }`}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
