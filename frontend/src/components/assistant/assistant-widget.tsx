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
import { ArrowRight, Send, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  askAssistant,
  fetchAssistantSuggestions,
  type AssistantReply,
} from "@/lib/api";
import { cn } from "@/lib/utils";

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
            className="w-full rounded-t bg-primary/75"
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          justOpenedRef.current = true;
          setOpen(true);
        }}
        aria-label="Mở Trợ lý Hubsell"
        className="fixed bottom-4 right-4 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-slate-900/20 transition-transform duration-200 hover:scale-105 active:scale-95 motion-reduce:transition-none sm:bottom-6 sm:right-6"
      >
        <Sparkles className="size-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex h-[min(37.5rem,calc(100dvh-5rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-card shadow-xl shadow-slate-900/10 animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none sm:bottom-6 sm:right-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Trợ lý Hubsell</p>
          <p className="truncate text-xs text-slate-500">
            Hỏi số liệu vận hành — trả lời tức thì
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Đóng trợ lý"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </Button>
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
                  className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-accent"
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
              className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
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
                      className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-accent"
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
                      className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-accent"
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
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
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
            <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
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
          className="h-10 min-w-0 flex-1 rounded-lg border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />
        <Button
          type="submit"
          size="icon-sm"
          aria-label="Gửi câu hỏi"
          disabled={!input.trim() || loading}
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
