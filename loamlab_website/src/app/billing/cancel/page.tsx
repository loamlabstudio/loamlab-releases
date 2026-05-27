"use client";

import { useState, useEffect } from "react";

const BACKEND = "https://loamlab-camera-backend.vercel.app";

type LangCode = "zh-TW" | "en-US" | "zh-CN" | "es-ES" | "pt-BR" | "ja-JP";

type Translations = {
  cancelSub: string;
  step1H1: string;
  step1Sub: string;
  continueBtn: string;
  step2Label: string;
  pauseHint: string;
  skipOffer: string;
  doneH1: string;
  doneMsg: string;
  backBtn: string;
  cancelH1: string;
  cancelP1: string;
  cancelP2: string;
  emailCta: string;
  emailSubject: string;
  loading: string;
  months: (n: number) => string;
  reasons: { too_expensive: string; not_using: string; switching: string; other: string };
  discount: { title: string; subtitle: string; detail: string; cta: string };
  pause: { title: string; subtitle: string; detail: string; cta: string };
};

const LANG_MAP: Record<string, LangCode> = {
  "zh-tw": "zh-TW", "zh-hant": "zh-TW", "zh": "zh-TW",
  "zh-cn": "zh-CN", "zh-hans": "zh-CN", "zh-sg": "zh-CN",
  "en": "en-US", "en-us": "en-US", "en-gb": "en-US", "en-au": "en-US",
  "es": "es-ES", "es-es": "es-ES", "es-mx": "es-ES",
  "pt": "pt-BR", "pt-br": "pt-BR", "pt-pt": "pt-BR",
  "ja": "ja-JP", "ja-jp": "ja-JP",
};

function detectLang(param?: string | null): LangCode {
  const candidates: string[] = [];
  if (param) candidates.push(param.toLowerCase());
  if (typeof navigator !== "undefined") {
    navigator.languages?.forEach((l) => candidates.push(l.toLowerCase()));
    if (navigator.language) candidates.push(navigator.language.toLowerCase());
  }
  for (const c of candidates) {
    if (LANG_MAP[c]) return LANG_MAP[c];
    const prefix = c.split("-")[0];
    if (LANG_MAP[prefix]) return LANG_MAP[prefix];
  }
  return "en-US";
}

const I18N: Record<LangCode, Translations> = {
  "zh-TW": {
    cancelSub: "取消訂閱",
    step1H1: "在離開前，可以告訴我們原因嗎？",
    step1Sub: "這幫助我們改善 LoamLab，也讓我們確認是否有更好的解決方案。",
    continueBtn: "繼續",
    step2Label: "專屬方案",
    pauseHint: "選擇暫停月數後直接生效",
    skipOffer: "不了，我確定要取消",
    doneH1: "已為您處理",
    doneMsg: "您的方案已套用，感謝繼續使用 LoamLab。",
    backBtn: "回到 LoamLab",
    cancelH1: "取消訂閱",
    cancelP1: "請直接聯繫我們，我們將在 24 小時內為您取消並確認。",
    cancelP2: "取消後，當前月份點數仍可繼續使用至期末。",
    emailCta: "發信取消訂閱",
    emailSubject: "訂閱取消申請",
    loading: "處理中...",
    months: (n) => `${n} 個月`,
    reasons: {
      too_expensive: "訂閱費用超出預算",
      not_using: "最近案子少，暫時用不到",
      switching: "改用其他工具",
      other: "其他原因",
    },
    discount: {
      title: "先別走 — 這是給你的",
      subtitle: "立即補充 100 點，繼續完成手邊的案子",
      detail: "100 點 = 5 張 2K 效果圖，今天就能用",
      cta: "接受回饋，繼續使用",
    },
    pause: {
      title: "案子少？先暫停一下",
      subtitle: "點數和方案暫時凍結，想用再自動恢復",
      detail: "暫停期間不扣費，點數保留，隨時可提前恢復",
      cta: "暫停訂閱 1 個月",
    },
  },
  "en-US": {
    cancelSub: "Cancel Subscription",
    step1H1: "Before you leave, could you tell us why?",
    step1Sub: "This helps us improve LoamLab and find a better solution for you.",
    continueBtn: "Continue",
    step2Label: "Exclusive Offer",
    pauseHint: "Choose number of months to pause",
    skipOffer: "No thanks, I still want to cancel",
    doneH1: "Done",
    doneMsg: "Your offer has been applied. Thank you for staying with LoamLab.",
    backBtn: "Back to LoamLab",
    cancelH1: "Cancel Subscription",
    cancelP1: "Please contact us directly and we'll cancel within 24 hours.",
    cancelP2: "Your current month's points remain usable until the end of the period.",
    emailCta: "Email to Cancel",
    emailSubject: "Subscription Cancellation Request",
    loading: "Processing...",
    months: (n) => `${n} month${n > 1 ? "s" : ""}`,
    reasons: {
      too_expensive: "Subscription cost is too high",
      not_using: "Not using it much lately",
      switching: "Switching to another tool",
      other: "Other reasons",
    },
    discount: {
      title: "Wait — here's something for you",
      subtitle: "Get 100 bonus points now and keep your projects going",
      detail: "100 pts = 5 renders at 2K quality, usable today",
      cta: "Accept offer, keep using",
    },
    pause: {
      title: "Slow season? Pause for a while",
      subtitle: "Points and plan frozen until you need them again",
      detail: "No charges during pause, points preserved, resume anytime",
      cta: "Pause for 1 month",
    },
  },
  "zh-CN": {
    cancelSub: "取消订阅",
    step1H1: "在离开前，可以告诉我们原因吗？",
    step1Sub: "这有助于我们改进 LoamLab，也让我们确认是否有更好的解决方案。",
    continueBtn: "继续",
    step2Label: "专属方案",
    pauseHint: "选择暂停月数后直接生效",
    skipOffer: "不了，我确定要取消",
    doneH1: "已为您处理",
    doneMsg: "您的方案已套用，感谢继续使用 LoamLab。",
    backBtn: "回到 LoamLab",
    cancelH1: "取消订阅",
    cancelP1: "请直接联系我们，我们将在 24 小时内为您取消并确认。",
    cancelP2: "取消后，当前月份点数仍可继续使用至期末。",
    emailCta: "发信取消订阅",
    emailSubject: "订阅取消申请",
    loading: "处理中...",
    months: (n) => `${n} 个月`,
    reasons: {
      too_expensive: "订阅费用超出预算",
      not_using: "最近项目少，暂时用不到",
      switching: "改用其他工具",
      other: "其他原因",
    },
    discount: {
      title: "先别走 — 这是给你的",
      subtitle: "立即补充 100 点，继续完成手头的项目",
      detail: "100 点 = 5 张 2K 效果图，今天就能用",
      cta: "接受回馈，继续使用",
    },
    pause: {
      title: "项目少？先暂停一下",
      subtitle: "点数和方案暂时冻结，想用再自动恢复",
      detail: "暂停期间不扣费，点数保留，随时可提前恢复",
      cta: "暂停订阅 1 个月",
    },
  },
  "es-ES": {
    cancelSub: "Cancelar suscripción",
    step1H1: "Antes de irte, ¿puedes decirnos por qué?",
    step1Sub: "Esto nos ayuda a mejorar LoamLab y encontrar una solución mejor para ti.",
    continueBtn: "Continuar",
    step2Label: "Oferta exclusiva",
    pauseHint: "Elige cuántos meses pausar",
    skipOffer: "No gracias, igual quiero cancelar",
    doneH1: "¡Listo!",
    doneMsg: "Tu oferta ha sido aplicada. Gracias por quedarte con LoamLab.",
    backBtn: "Volver a LoamLab",
    cancelH1: "Cancelar suscripción",
    cancelP1: "Contáctanos directamente y cancelaremos en 24 horas.",
    cancelP2: "Tus puntos del mes actual siguen disponibles hasta el final del período.",
    emailCta: "Enviar email para cancelar",
    emailSubject: "Solicitud de cancelación de suscripción",
    loading: "Procesando...",
    months: (n) => `${n} mes${n > 1 ? "es" : ""}`,
    reasons: {
      too_expensive: "El costo es demasiado alto",
      not_using: "Últimamente lo uso poco",
      switching: "Cambio a otra herramienta",
      other: "Otros motivos",
    },
    discount: {
      title: "Espera — esto es para ti",
      subtitle: "Obtén 100 puntos ahora y sigue con tus proyectos",
      detail: "100 pts = 5 renders en calidad 2K, disponibles hoy",
      cta: "Aceptar oferta, seguir usando",
    },
    pause: {
      title: "¿Temporada baja? Pausa un momento",
      subtitle: "Puntos y plan congelados hasta que los necesites",
      detail: "Sin cobros durante la pausa, puntos guardados, reanuda cuando quieras",
      cta: "Pausar 1 mes",
    },
  },
  "pt-BR": {
    cancelSub: "Cancelar assinatura",
    step1H1: "Antes de sair, pode nos dizer o motivo?",
    step1Sub: "Isso nos ajuda a melhorar o LoamLab e encontrar uma solução melhor para você.",
    continueBtn: "Continuar",
    step2Label: "Oferta exclusiva",
    pauseHint: "Escolha quantos meses pausar",
    skipOffer: "Não obrigado, ainda quero cancelar",
    doneH1: "Concluído",
    doneMsg: "Sua oferta foi aplicada. Obrigado por continuar com o LoamLab.",
    backBtn: "Voltar para LoamLab",
    cancelH1: "Cancelar assinatura",
    cancelP1: "Entre em contato conosco e cancelaremos em 24 horas.",
    cancelP2: "Seus pontos do mês atual continuam disponíveis até o final do período.",
    emailCta: "Enviar email para cancelar",
    emailSubject: "Solicitação de cancelamento de assinatura",
    loading: "Processando...",
    months: (n) => `${n} ${n > 1 ? "meses" : "mês"}`,
    reasons: {
      too_expensive: "O custo está muito alto",
      not_using: "Estou usando pouco ultimamente",
      switching: "Mudando para outra ferramenta",
      other: "Outros motivos",
    },
    discount: {
      title: "Aguarde — isso é para você",
      subtitle: "Receba 100 pontos agora e continue seus projetos",
      detail: "100 pts = 5 renders em qualidade 2K, disponíveis hoje",
      cta: "Aceitar oferta, continuar usando",
    },
    pause: {
      title: "Baixa temporada? Pause um pouco",
      subtitle: "Pontos e plano congelados até precisar novamente",
      detail: "Sem cobranças durante a pausa, pontos preservados, retome quando quiser",
      cta: "Pausar por 1 mês",
    },
  },
  "ja-JP": {
    cancelSub: "サブスクリプションをキャンセル",
    step1H1: "退会前に、理由を教えていただけますか？",
    step1Sub: "LoamLabの改善と、より良い解決策を見つけるために使わせていただきます。",
    continueBtn: "続ける",
    step2Label: "特別なオファー",
    pauseHint: "一時停止する月数を選択してください",
    skipOffer: "いいえ、やはりキャンセルします",
    doneH1: "完了しました",
    doneMsg: "オファーが適用されました。LoamLabをご利用いただきありがとうございます。",
    backBtn: "LoamLabに戻る",
    cancelH1: "サブスクリプションをキャンセル",
    cancelP1: "直接お問い合わせください。24時間以内にキャンセルを確認します。",
    cancelP2: "現在の月のポイントは期末まで引き続き使用できます。",
    emailCta: "キャンセルのメールを送る",
    emailSubject: "サブスクリプションキャンセルのご依頼",
    loading: "処理中...",
    months: (n) => `${n}ヶ月`,
    reasons: {
      too_expensive: "料金が予算を超えている",
      not_using: "最近あまり使っていない",
      switching: "別のツールに切り替える",
      other: "その他の理由",
    },
    discount: {
      title: "待って — これはあなたへのプレゼント",
      subtitle: "100ポイントを今すぐ受け取り、プロジェクトを続けましょう",
      detail: "100pts = 2K品質で5枚レンダリング、今日から使用可能",
      cta: "オファーを受け入れて使い続ける",
    },
    pause: {
      title: "案件が少ない？一時停止しましょう",
      subtitle: "ポイントとプランを一時凍結、必要なときに自動再開",
      detail: "一時停止中は課金なし、ポイント保持、いつでも早期再開可能",
      cta: "1ヶ月間一時停止する",
    },
  },
};

export default function CancelPage() {
  const [email, setEmail] = useState("");
  const [lang, setLang] = useState<LangCode>("en-US");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedReason, setSelectedReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; msg: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEmail(params.get("email") || "");
    setLang(detectLang(params.get("lang")));
  }, []);

  const t = I18N[lang];
  const REASONS = [
    { id: "too_expensive", label: t.reasons.too_expensive, offer: "discount" as const },
    { id: "not_using", label: t.reasons.not_using, offer: "pause" as const },
    { id: "switching", label: t.reasons.switching, offer: "discount" as const },
    { id: "other", label: t.reasons.other, offer: "pause" as const },
  ];

  const reasonData = REASONS.find((r) => r.id === selectedReason);
  const offerType = reasonData?.offer || "discount";
  const offer = offerType === "discount" ? t.discount : t.pause;

  async function acceptOffer(pauseMonths = 1) {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/user?action=save_offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, offer_type: offerType, pause_months: pauseMonths }),
      });
      const data = await res.json();
      setResult({ success: data.code === 0, msg: data.code === 0 ? t.doneMsg : (data.msg || "") });
      setStep(3);
    } catch {
      setResult({ success: false, msg: "" });
      setStep(3);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--color-loam-dark)] flex items-center justify-center px-4 py-20">
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

        {/* Step 1 */}
        {step === 1 && (
          <div className="glass-panel rounded-3xl p-8 md:p-10 border border-white/10">
            <div className="text-[10px] tracking-[0.3em] uppercase text-[var(--color-loam-primary)] font-bold mb-4">
              {t.cancelSub}
            </div>
            <h1 className="text-2xl md:text-3xl font-light mb-3 tracking-tight">
              {t.step1H1}
            </h1>
            <p className="text-zinc-400 font-light text-sm mb-8">{t.step1Sub}</p>

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
                    selectedReason === r.id
                      ? "border-[var(--color-loam-primary)] bg-[var(--color-loam-primary)]"
                      : "border-white/30"
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
              {t.continueBtn}
            </button>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="glass-panel rounded-3xl p-8 md:p-10 border border-white/10">
            <div className="text-[10px] tracking-[0.3em] uppercase text-[var(--color-loam-primary)] font-bold mb-4">
              {t.step2Label}
            </div>
            <h1 className="text-2xl md:text-3xl font-light mb-3 tracking-tight">{offer.title}</h1>
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
                    {t.months(m)}
                  </button>
                ))}
              </div>
            )}

            {offerType === "discount" && (
              <button
                onClick={() => acceptOffer(1)}
                disabled={loading}
                className="w-full py-4 rounded-full text-white text-[10px] font-bold tracking-widest uppercase transition-all mb-4 disabled:opacity-50 bg-[var(--color-loam-primary)]"
              >
                {loading ? t.loading : offer.cta}
              </button>
            )}

            {offerType === "pause" && (
              <p className="text-zinc-500 text-xs text-center mb-4">{t.pauseHint}</p>
            )}

            <button
              onClick={() => { setResult({ success: false, msg: "" }); setStep(3); }}
              className="w-full py-3 rounded-full text-[10px] font-bold tracking-widest uppercase text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              {t.skipOffer}
            </button>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="glass-panel rounded-3xl p-8 md:p-10 border border-white/10 text-center">
            {result?.success ? (
              <>
                <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center mx-auto mb-6">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h1 className="text-2xl font-light mb-3 tracking-tight">{t.doneH1}</h1>
                <p className="text-zinc-400 text-sm font-light mb-8">{result.msg}</p>
                <a
                  href="https://loamlab.studio"
                  className="inline-block px-10 py-4 rounded-full bg-[var(--color-loam-primary)] text-white text-[10px] font-bold tracking-widest uppercase hover:scale-105 transition-transform"
                >
                  {t.backBtn}
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
                <h1 className="text-2xl font-light mb-3 tracking-tight">{t.cancelH1}</h1>
                <p className="text-zinc-400 text-sm font-light mb-2">{t.cancelP1}</p>
                <p className="text-zinc-600 text-xs mb-8">{t.cancelP2}</p>
                <a
                  href={`mailto:support@loamlab.studio?subject=${encodeURIComponent(t.emailSubject)}&body=Email: ${email}`}
                  className="inline-block px-10 py-4 rounded-full border border-white/20 text-[10px] font-bold tracking-widest uppercase hover:bg-white/10 transition-all"
                >
                  {t.emailCta}
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
