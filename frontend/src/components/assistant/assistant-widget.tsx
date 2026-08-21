"use client";

/**
 * ══ TRỢ LÝ HUBSELL — bong bóng chat nổi KHẮP MỌI TRANG (kiểu Intercom) ══
 *
 * Chủ shop hỏi số liệu vận hành bằng tiếng Việt tự nhiên ("hôm nay lãi bao
 * nhiêu", "sku nào sắp hết hàng"…) — backend /api/assistant/ask là TẦNG LUẬT
 * của thác nước luật-trước-LLM-sau (chốt 16/08): khớp intent bằng từ khóa
 * không dấu, trả SỐ THẬT + deep-link, 0 đồng token; câu mơ hồ trả CHIP hỏi
 * lại; câu chưa hiểu được ghi log để bồi luật dần.
 *
 * AppShell được render TRONG TỪNG PAGE (không phải layout gốc) nên chuyển
 * trang là widget bị remount — hội thoại + trạng thái mở/đóng phải gửi ở
 * sessionStorage để trợ lý sống xuyên điều hướng lẫn F5 (hết tab là thôi),
 * đúng cảm giác trợ lý CSKH của các website. GĐ1 chỉ CHỦ SHOP (câu trả lời
 * chạm số tài chính), như chuông thông báo.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Send, X } from "lucide-react";

import {
  askAssistant,
  fetchAssistantSuggestions,
  type AssistantReply,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * ══ NHẬN DIỆN RIÊNG CỦA TRỢ LÝ (chốt 21/08) ══
 * Trợ lý KHÔNG ăn theo theme accent (--primary đổi theo lựa chọn người dùng)
 * mà mang bộ màu logo Hubsell: mint #4ade80 → emerald #10b981/#059669 — dải
 * emerald 400–600 không bị .dark remap nên giữ nguyên sắc thương hiệu ở cả
 * 2 theme. Riêng band header phải LUÔN TỐI (slate-950 bị .dark đảo thành
 * trắng) nên nền navy dùng hex cố định có chủ đích.
 */

/** Chip gợi ý / hỏi lại — viền + chữ emerald, các nấc 50/200/700 đã có remap dark. */
const CHIP_CLASS =
  "rounded-full border border-emerald-200 bg-card px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50";

/**
 * Avatar SVG theo logo: orb navy tối + vành gradient + sparkle AI 4 cánh tô
 * đúng dải mint→emerald của chữ H mũi tên. Vẽ inline vì logo-hubsell.png nền
 * trắng đặc (24bpp, không alpha) không đặt lên nền tối được.
 */
function AssistantAvatar({ className }: { className?: string }) {
  const uid = React.useId();
  const spark = `hb-spark-${uid}`;
  const orb = `hb-orb-${uid}`;
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={spark} x1="12%" y1="88%" x2="88%" y2="12%">
          <stop offset="0%" stopColor="#4ade80" />
          <stop offset="55%" stopColor="#2ee08d" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <radialGradient id={orb} cx="30%" cy="22%" r="95%">
          <stop offset="0%" stopColor="#17293f" />
          <stop offset="100%" stopColor="#050b16" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill={`url(#${orb})`} />
      <circle
        cx="24"
        cy="24"
        r="21.4"
        fill="none"
        stroke={`url(#${spark})`}
        strokeOpacity="0.55"
        strokeWidth="1.4"
      />
      {/* Sparkle chính — cạnh cong lõm kiểu tia AI */}
      <path
        d="M23 12.5c1.55 6.9 4.9 10.25 11.8 11.8-6.9 1.55-10.25 4.9-11.8 11.8-1.55-6.9-4.9-10.25-11.8-11.8 6.9-1.55 10.25-4.9 11.8-11.8Z"
        fill={`url(#${spark})`}
      />
      {/* Sparkle phụ nhỏ góc trên phải — điểm nhấn chuyển động đi lên như mũi tên logo */}
      <path
        d="M35.2 9.8c.68 2.75 1.97 4.04 4.72 4.72-2.75.68-4.04 1.97-4.72 4.72-.68-2.75-1.97-4.04-4.72-4.72 2.75-.68 4.04-1.97 4.72-4.72Z"
        fill="#6ee7a7"
      />
    </svg>
  );
}

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  reply?: AssistantReply;
  error?: boolean;
}

/** Dự phòng khi API gợi ý chưa kịp về — khớp bộ intent backend. */
const FALLBACK_SUGGESTIONS = [
  "Hôm nay lãi bao nhiêu?",
  "Có bao nhiêu đơn chờ xử lý?",
  "SKU nào sắp hết hàng?",
];

/**
 * Biểu đồ cột thuần div — đủ cho khung chat 24rem, không kéo thư viện chart.
 * Cột tô primary (tự đổi theo theme accent + dark), tooltip title số đầy đủ.
 * Nhiều hơn ~10 cột (báo cáo tháng) thì nhãn trục chỉ in thưa cho khỏi dồn chữ.
 */
function MiniBarChart({ points }: { points: { label: string; value: number }[] }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const labelStep = points.length > 10 ? Math.ceil(points.length / 6) : 1;
  return (
    <div className="flex items-end gap-1">
      {points.map((p, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
          <div
            title={`${p.label}: ${p.value.toLocaleString("vi-VN")}₫`}
            className="w-full rounded-t bg-emerald-500/80"
            style={{ height: `${Math.max(3, Math.round((p.value / max) * 64))}px` }}
          />
          <span className="h-3 truncate text-[9px] tabular-nums text-slate-400">
            {i % labelStep === 0 || i === points.length - 1 ? p.label : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

let msgSeq = 0;

/** Hội thoại + trạng thái mở, sống xuyên remount (điều hướng) và F5. */
const STORAGE_KEY = "hubsell_assistant_chat_v1";

function loadStored(): { open: boolean; msgs: Msg[] } {
  if (typeof window === "undefined") return { open: false, msgs: [] };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { open: false, msgs: [] };
    const parsed = JSON.parse(raw) as { open?: boolean; msgs?: Msg[] };
    const msgs = Array.isArray(parsed.msgs) ? parsed.msgs : [];
    msgSeq = msgs.reduce((m, x) => Math.max(m, x.id), msgSeq);
    return { open: parsed.open === true, msgs };
  } catch {
    return { open: false, msgs: [] };
  }
}

export function AssistantWidget() {
  const router = useRouter();
  const [open, setOpen] = React.useState(() => loadStored().open);
  const [msgs, setMsgs] = React.useState<Msg[]>(() => loadStored().msgs);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  // State khởi tạo từ sessionStorage (chỉ có ở client) nên HTML server ≠ client
  // khi F5 lúc panel đang mở → hydration error. Chữa tận gốc: khung hình đầu
  // render RỖNG ở cả hai phía cho khớp, sang effect mới hiện — state đã nạp
  // sẵn từ storage nên panel mở hiện thẳng dạng mở, không chớp nút đóng.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Gửi hội thoại vào sessionStorage mỗi lần đổi — remount nạp lại nguyên trạng.
  React.useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ open, msgs }));
    } catch {
      // storage đầy/bị chặn — trợ lý vẫn chạy, chỉ mất tính nhớ xuyên trang
    }
  }, [open, msgs]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { data: sug } = useQuery({
    queryKey: ["assistant-suggestions"],
    queryFn: fetchAssistantSuggestions,
    staleTime: Infinity,
    enabled: open,
  });
  const suggestions = sug?.suggestions ?? FALLBACK_SUGGESTIONS;

  // Tin mới / đang trả lời → cuộn xuống đáy khung chat.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, loading, open]);

  // BẤM MỞ panel → đưa con trỏ vào ô hỏi cho gõ liền tay. Chỉ khi người dùng
  // vừa bấm — remount lúc chuyển trang (panel đang mở sẵn) mà autofocus sẽ
  // cướp focus của trang đích.
  const justOpenedRef = React.useRef(false);
  React.useEffect(() => {
    if (open && justOpenedRef.current) {
      justOpenedRef.current = false;
      inputRef.current?.focus();
    }
  }, [open]);

  function push(msg: Omit<Msg, "id">) {
    setMsgs((prev) => [...prev, { ...msg, id: ++msgSeq }]);
  }

  async function ask(payload: { question?: string; intent?: string }, shown: string) {
    if (loading) return;
    push({ role: "user", text: shown });
    setLoading(true);
    try {
      const reply = await askAssistant(payload);
      push({ role: "assistant", text: reply.text, reply });
    } catch (err) {
      push({
        role: "assistant",
        text:
          err instanceof Error && err.message
            ? err.message
            : "Có lỗi khi hỏi trợ lý — anh/chị thử lại giúp em nhé.",
        error: true,
      });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  // Deep-link từ CHUÔNG THÔNG BÁO (báo cáo tuần): /?assistant=<câu hỏi> → tự
  // mở panel và hỏi luôn câu đó. Đọc search TƯƠI trong effect + xóa param ngay
  // bằng replaceState nên StrictMode/remount không hỏi lặp; ask tham chiếu qua
  // ref để effect [] không thiếu dependency.
  const askRef = React.useRef(ask);
  React.useEffect(() => {
    askRef.current = ask;
  });
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("assistant");
    if (!q) return;
    params.delete("assistant");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    setOpen(true);
    void askRef.current({ question: q }, q);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    void ask({ question: q }, q);
  }

  function openLink(href: string) {
    router.push(href);
  }

  if (!mounted) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          justOpenedRef.current = true;
          setOpen(true);
        }}
        aria-label="Mở Trợ lý Hubsell"
        className="group fixed bottom-4 right-4 z-40 size-12 rounded-full transition-transform duration-200 hover:scale-105 active:scale-95 motion-reduce:transition-none sm:bottom-6 sm:right-6"
      >
        {/* Quầng sáng gradient thở chậm sau orb — hiệu ứng "AI đang trực" */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 opacity-50 blur-md transition-opacity duration-300 animate-[pulse_3.5s_ease-in-out_infinite] group-hover:opacity-90 motion-reduce:animate-none"
        />
        <AssistantAvatar className="relative size-12 rounded-full shadow-lg shadow-emerald-950/40" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex h-[min(37.5rem,calc(100dvh-5rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-card shadow-xl shadow-slate-900/10 animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none sm:bottom-6 sm:right-6">
      {/* ── Header — band navy LUÔN TỐI (nhận diện trợ lý), hex cố định vì
          slate-950 bị .dark đảo trắng ── */}
      <div className="relative flex items-center gap-3 overflow-hidden border-b border-white/10 bg-[#0a1424] px-4 py-3">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-8 -top-12 size-32 rounded-full bg-emerald-500/25 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-14 right-6 size-28 rounded-full bg-green-400/15 blur-2xl"
        />
        <AssistantAvatar className="relative size-9 shrink-0 rounded-full ring-1 ring-white/10" />
        <div className="relative min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
            Trợ lý Hubsell
            <span className="rounded-full bg-gradient-to-r from-green-400 to-emerald-500 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-[#04301f]">
              AI
            </span>
          </p>
          <p className="flex items-center gap-1.5 truncate text-xs text-[#8fa3bf]">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none"
            />
            Hỏi số liệu vận hành — trả lời tức thì
          </p>
        </div>
        <button
          type="button"
          aria-label="Đóng trợ lý"
          onClick={() => setOpen(false)}
          className="relative rounded-md p-1.5 text-[#8fa3bf] transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* ── Khung hội thoại ── */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {/* Màn chào — chỉ khi chưa hỏi gì */}
        {msgs.length === 0 && (
          <div className="mr-auto max-w-[95%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5 text-sm text-foreground">
            <p>
              Chào anh/chị 👋 Em là Trợ lý Hubsell. Hỏi em về lãi lỗ, đơn hàng,
              tồn kho, quảng cáo… bằng tiếng Việt tự nhiên (không dấu cũng
              hiểu). Thử ngay:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask({ question: s }, s)}
                  className={CHIP_CLASS}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m) =>
          m.role === "user" ? (
            <div
              key={m.id}
              className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-gradient-to-br from-emerald-500 to-emerald-600 px-3 py-2 text-sm text-white shadow-sm shadow-emerald-600/20"
            >
              {m.text}
            </div>
          ) : (
            <div
              key={m.id}
              className={cn(
                "mr-auto max-w-[95%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5 text-sm text-foreground",
                m.error && "border border-rose-200 bg-rose-50 text-red-500"
              )}
            >
              <p className="whitespace-pre-line">{m.text}</p>

              {/* Bảng số liệu — tabular-nums, tone lãi/lỗ theo chuẩn màu */}
              {m.reply?.rows && m.reply.rows.length > 0 && (
                <div className="mt-2 overflow-hidden rounded-lg border bg-card">
                  {m.reply.rows.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 border-b px-2.5 py-1.5 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                        {r.label}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs font-medium tabular-nums text-slate-900",
                          r.tone === "pos" && "text-emerald-500",
                          r.tone === "neg" && "text-red-500"
                        )}
                      >
                        {r.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Biểu đồ cột mini — doanh thu theo ngày của báo cáo tuần/tháng */}
              {m.reply?.chart && m.reply.chart.points.length > 1 && (
                <div className="mt-2 rounded-lg border bg-card p-2.5">
                  <p className="mb-1.5 text-[11px] font-medium text-slate-500">
                    {m.reply.chart.caption}
                  </p>
                  <MiniBarChart points={m.reply.chart.points} />
                </div>
              )}

              {/* Chip hỏi lại (câu mơ hồ) */}
              {m.reply?.chips && m.reply.chips.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.reply.chips.map((c) => (
                    <button
                      key={c.intent}
                      type="button"
                      onClick={() =>
                        void ask({ intent: c.intent, question: c.label }, c.label)
                      }
                      className={CHIP_CLASS}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Câu mẫu gợi ý (miss / analysis / help) */}
              {m.reply?.suggestions && m.reply.suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.reply.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void ask({ question: s }, s)}
                      className={CHIP_CLASS}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Deep-link tới đúng trang nghiệp vụ */}
              {m.reply?.link && (
                <button
                  type="button"
                  onClick={() => openLink(m.reply!.link!.href)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                >
                  {m.reply.link.label}
                  <ArrowRight className="size-3" />
                </button>
              )}
            </div>
          )
        )}

        {/* Đang tính — ba chấm nhấp nháy */}
        {loading && (
          <div className="mr-auto flex items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5">
            <span className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-emerald-500 [animation-delay:300ms]" />
          </div>
        )}
      </div>

      {/* ── Ô hỏi ── */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t p-3">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Hỏi về lãi, đơn, tồn kho…"
          maxLength={300}
          className="h-10 min-w-0 flex-1 rounded-lg border bg-transparent px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/25"
        />
        <button
          type="submit"
          aria-label="Gửi câu hỏi"
          disabled={!input.trim() || loading}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm transition-all hover:from-emerald-400 hover:shadow-md hover:shadow-emerald-500/30 active:scale-95 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
