"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  ChevronDown,
  FlaskConical,
  Loader2,
  Package,
  PackageSearch,
  Search,
  SendHorizontal,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  buildAiSuggestion,
  buildInjectedContext,
  GENERIC_CHAT_FALLBACK,
  productInfoFromContext,
  SAMPLE_QUESTIONS,
} from "@/components/operations/copilot-engine";
import {
  CHANNEL_META,
  MOCK_CONVERSATIONS,
  MOCK_PRODUCTS,
  MOCK_STOCK_SOURCE_PREFERENCE,
  type MockConversation,
  type MockProductInfo,
  type OpsChannel,
} from "@/components/operations/mock-data";
import { OperationsFrame } from "@/components/operations/operations-frame";
import { ProductContextCard } from "@/components/operations/product-context-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  fetchOpsConversations,
  fetchOpsMessages,
  fetchOpsProductContext,
  sendOpsMessage,
  type OpsChannelError,
  type OpsConversationDTO,
  type OpsMessageDTO,
} from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRỢ LÝ CHAT — INBOX CSKH HỢP NHẤT (Shopee + Lazada)
 *
 * CHẠY 2 CHẾ ĐỘ:
 *   · real — có gian hàng uỷ quyền và sàn trả về hội thoại: danh sách/tin nhắn/
 *     gửi tin đi thẳng API sàn qua backend /api/operations/*. Ngữ cảnh sản phẩm
 *     cho AI lấy từ Kho vật lý (sizeChart/material) + tồn sàn live.
 *   · demo — chưa có dữ liệu thật (chưa uỷ quyền, sàn lỗi, hoặc chưa ai nhắn):
 *     rơi về bộ mock cũ để màn hình vẫn trình diễn được đầy đủ luồng.
 *
 * AI Copilot dùng CHUNG engine cho cả hai chế độ (copilot-engine.ts) — thay
 * nguồn dữ liệu, không thay luật.
 */

type ChatMode = "loading" | "real" | "demo";

/** Mốc thời gian hiển thị gọn: hôm nay → HH:mm, khác ngày → dd/MM. */
function fmtTime(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  return sameDay
    ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : `${d.getDate()}/${d.getMonth() + 1}`;
}

export function OperationsChatPage() {
  const [mode, setMode] = useState<ChatMode>("loading");
  const [channelErrors, setChannelErrors] = useState<OpsChannelError[]>([]);

  // ── Chế độ REAL ──
  const [realConvs, setRealConvs] = useState<OpsConversationDTO[]>([]);
  const [activeRealId, setActiveRealId] = useState<string | null>(null);
  const [realMessages, setRealMessages] = useState<Record<string, OpsMessageDTO[]>>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [realProduct, setRealProduct] = useState<MockProductInfo | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [productLoading, setProductLoading] = useState(false);

  // ── Chế độ DEMO (bộ mock cũ) ──
  const [demoConvs, setDemoConvs] = useState<MockConversation[]>(MOCK_CONVERSATIONS);
  const [activeDemoId, setActiveDemoId] = useState(MOCK_CONVERSATIONS[0].id);

  // ── Dùng chung ──
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [productOpen, setProductOpen] = useState(false);

  // ── Nạp inbox thật khi vào trang ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchOpsConversations();
        if (cancelled) return;
        setChannelErrors(r.errors);
        if (r.conversations.length > 0) {
          setRealConvs(r.conversations);
          setActiveRealId(r.conversations[0].id);
          setMode("real");
        } else {
          setMode("demo");
        }
      } catch (err) {
        if (cancelled) return;
        // 401 đã bị OperationsFrame đẩy về /login; lỗi khác (NO_CHANNEL, mạng,
        // backend tắt) → demo để trang vẫn dùng được.
        if (err instanceof ApiError && err.status !== 401) {
          setChannelErrors([{ channelId: "", shopName: "Hệ thống", message: err.message }]);
        }
        setMode("demo");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeReal = realConvs.find((c) => c.id === activeRealId) ?? null;
  const activeDemo = demoConvs.find((c) => c.id === activeDemoId) ?? demoConvs[0];

  // ── Nạp tin nhắn + ngữ cảnh SP của hội thoại thật đang mở ──
  const loadRealMessages = useCallback(
    async (conv: OpsConversationDTO) => {
      setLoadingMessages(true);
      try {
        const r = await fetchOpsMessages({
          channelId: conv.channelId,
          conversationId: conv.externalId,
          buyerId: conv.buyerId,
        });
        setRealMessages((prev) => ({ ...prev, [conv.id]: r.messages }));

        // Khách chat từ trang sản phẩm → tin nhắn có item_id: tự tra ngữ cảnh
        const withItem = [...r.messages].reverse().find((m) => m.itemId);
        if (withItem?.itemId) {
          const ctx = await fetchOpsProductContext({
            channelId: conv.channelId,
            itemId: withItem.itemId,
          });
          if (ctx.found && ctx.product) {
            setRealProduct(productInfoFromContext(ctx.product));
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Không tải được tin nhắn");
      } finally {
        setLoadingMessages(false);
      }
    },
    []
  );

  useEffect(() => {
    if (mode !== "real" || !activeReal) return;
    if (!realMessages[activeReal.id]) void loadRealMessages(activeReal);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ nạp khi đổi hội thoại
  }, [mode, activeRealId]);

  // ── Tra ngữ cảnh sản phẩm theo từ khoá (SKU / tên) ──
  async function searchProduct() {
    if (!productQuery.trim()) return;
    setProductLoading(true);
    try {
      const ctx = await fetchOpsProductContext({ query: productQuery.trim() });
      if (ctx.found && ctx.product) {
        setRealProduct(productInfoFromContext(ctx.product));
        toast.success(`Đã nạp ngữ cảnh: ${ctx.product.name}`);
      } else {
        toast.error("Không tìm thấy sản phẩm khớp từ khoá");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không tra được sản phẩm");
    } finally {
      setProductLoading(false);
    }
  }

  // ── Hợp nhất dữ liệu cho phần render ──
  const isReal = mode === "real";
  const product: MockProductInfo | undefined = isReal
    ? realProduct ?? undefined
    : activeDemo.productSku
      ? MOCK_PRODUCTS[activeDemo.productSku]
      : undefined;
  const activeChannel: OpsChannel = isReal
    ? (activeReal?.channelName ?? "SHOPEE")
    : activeDemo.channel;

  const suggestion = useMemo(() => {
    const lastCustomerText = isReal
      ? [...(activeReal ? realMessages[activeReal.id] ?? [] : [])]
          .reverse()
          .find((m) => !m.fromShop)?.text ?? ""
      : [...activeDemo.messages].reverse().find((m) => m.from === "CUSTOMER")?.text ?? "";
    const fallback = isReal ? GENERIC_CHAT_FALLBACK : activeDemo.aiSuggestion;
    return buildAiSuggestion(product, lastCustomerText, fallback, MOCK_STOCK_SOURCE_PREFERENCE);
  }, [isReal, activeReal, realMessages, activeDemo, product]);

  // ── Gửi tin nhắn ──
  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    if (!isReal) {
      setDraft("");
      toast.success("Đã gửi tin nhắn (demo — chưa nối gian hàng thật).");
      return;
    }
    if (!activeReal) return;
    setSending(true);
    try {
      await sendOpsMessage({
        channelId: activeReal.channelId,
        conversationId: activeReal.externalId,
        buyerId: activeReal.buyerId,
        text,
      });
      // Nối lạc quan vào khung chat — sàn đã nhận thì hiển thị ngay
      setRealMessages((prev) => ({
        ...prev,
        [activeReal.id]: [
          ...(prev[activeReal.id] ?? []),
          { id: `local-${Date.now()}`, fromShop: true, text, at: Date.now(), itemId: null },
        ],
      }));
      setDraft("");
      toast.success(`Đã gửi tới ${activeReal.customer} qua ${CHANNEL_META[activeReal.channelName].label}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gửi tin thất bại");
    } finally {
      setSending(false);
    }
  }

  /** Giả lập khách nhắn (CHỈ demo) — engine sinh gợi ý mới ngay. */
  function simulateCustomer(text: string) {
    setDemoConvs((prev) =>
      prev.map((c) =>
        c.id === activeDemo.id
          ? {
              ...c,
              lastMessage: text,
              messages: [
                ...c.messages,
                {
                  id: `sim-${c.messages.length + 1}`,
                  from: "CUSTOMER" as const,
                  text,
                  time: "Vừa xong",
                },
              ],
            }
          : c
      )
    );
  }

  // ── View model danh sách hội thoại (chung 2 chế độ) ──
  const convItems = isReal
    ? realConvs.map((c) => ({
        key: c.id,
        customer: c.customer,
        channel: c.channelName as OpsChannel,
        lastMessage: c.lastMessage,
        time: fmtTime(c.lastAt),
        unread: c.unread,
        active: c.id === activeRealId,
        select: () => setActiveRealId(c.id),
      }))
    : demoConvs.map((c) => ({
        key: c.id,
        customer: c.customer,
        channel: c.channel,
        lastMessage: c.lastMessage,
        time: c.time,
        unread: c.unread,
        active: c.id === activeDemoId,
        select: () => setActiveDemoId(c.id),
      }));

  // ── View model tin nhắn của hội thoại đang mở ──
  const messageItems = isReal
    ? (activeReal ? realMessages[activeReal.id] ?? [] : []).map((m) => ({
        key: m.id,
        fromShop: m.fromShop,
        text: m.text,
        time: fmtTime(m.at),
      }))
    : activeDemo.messages.map((m) => ({
        key: m.id,
        fromShop: m.from === "SHOP",
        text: m.text,
        time: m.time,
      }));

  const headerCustomer = isReal ? activeReal?.customer ?? "" : activeDemo.customer;
  const headerShop = isReal ? activeReal?.shopName ?? "" : activeDemo.shop;

  if (mode === "loading") {
    return (
      <OperationsFrame>
        <Card className="flex min-h-[420px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Đang tải hội thoại từ các gian hàng…
          </div>
        </Card>
      </OperationsFrame>
    );
  }

  return (
    <OperationsFrame>
      {/* ===== NHÃN NGUỒN DỮ LIỆU + LỖI TỪNG GIAN ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={
            isReal
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-violet-200 bg-violet-50 text-violet-700"
          }
        >
          {isReal ? "Dữ liệu thật từ sàn" : "Demo — chưa có hội thoại thật"}
        </Badge>
        {channelErrors.map((e) => (
          <span key={`${e.channelId}-${e.message}`} className={cn(TEXT_SUB, "text-amber-700")}>
            ⚠️ {e.shopName}: {e.message}
          </span>
        ))}
      </div>

      {/* Chiều cao cố định kiểu app chat: các cột tự cuộn bên trong. */}
      <Card className="overflow-hidden py-0">
        <div className="grid min-h-[560px] lg:h-[calc(100vh-21rem)] lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_330px]">
          {/* ----- CỘT TRÁI: DANH SÁCH HỘI THOẠI ----- */}
          <div className="flex flex-col border-b lg:border-b-0 lg:border-r">
            <div className="border-b p-3">
              <Input placeholder="Tìm khách hàng, mã đơn…" aria-label="Tìm hội thoại" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {convItems.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.select}
                  className={cn(
                    "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0",
                    c.active ? "bg-muted" : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-slate-600">
                    {c.customer.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {c.customer}
                      </span>
                      <span className={cn(TEXT_SUB, "ml-auto shrink-0")}>{c.time}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm text-slate-600">{c.lastMessage}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge variant="outline" className={CHANNEL_META[c.channel].badgeClass}>
                        {CHANNEL_META[c.channel].label}
                      </Badge>
                      {c.unread > 0 && (
                        <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-semibold text-white tabular-nums">
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ----- CỘT GIỮA: KHUNG CHAT + AI COPILOT ----- */}
          <div className="flex min-w-0 flex-col">
            {/* Header hội thoại */}
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-slate-600">
                {headerCustomer.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{headerCustomer}</p>
                <p className={TEXT_SUB}>
                  {CHANNEL_META[activeChannel].label} · {headerShop}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {!isReal && activeDemo.orderCode && (
                  <Badge variant="outline" className="gap-1">
                    <Package className="size-3" />
                    Đơn {activeDemo.orderCode}
                  </Badge>
                )}
                {product && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="xl:hidden"
                    onClick={() => setProductOpen((v) => !v)}
                  >
                    <PackageSearch className="size-4" />
                    SP &amp; tồn kho
                    <ChevronDown
                      className={cn("size-3.5 transition-transform", productOpen && "rotate-180")}
                    />
                  </Button>
                )}
              </div>
            </div>

            {/* Khối sản phẩm gập cho màn hẹp */}
            {product && productOpen && (
              <div className="border-b xl:hidden">
                <ProductContextCard
                  product={product}
                  channel={activeChannel}
                  stockSource={MOCK_STOCK_SOURCE_PREFERENCE}
                />
              </div>
            )}

            {/* Luồng tin nhắn */}
            <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4">
              {loadingMessages && (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loadingMessages && messageItems.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Chưa có tin nhắn nào trong hội thoại này.
                </p>
              )}
              {messageItems.map((m) => (
                <div key={m.key} className={cn("flex", m.fromShop ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-xs",
                      m.fromShop
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm border bg-card text-slate-900"
                    )}
                  >
                    <p>{m.text}</p>
                    <p
                      className={cn(
                        "mt-1 text-right text-[11px]",
                        m.fromShop ? "text-primary-foreground/70" : "text-slate-400"
                      )}
                    >
                      {m.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Thanh giả lập khách nhắn — CHỈ demo */}
            {!isReal && (
              <div className="flex flex-wrap items-center gap-1.5 border-t bg-muted/40 px-4 py-2">
                <span className={cn(TEXT_SUB, "flex items-center gap-1")}>
                  <FlaskConical className="size-3.5" />
                  Giả lập khách nhắn:
                </span>
                {SAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => simulateCustomer(q)}
                    className="rounded-full border bg-card px-2.5 py-1 text-xs text-slate-700 transition-colors hover:border-violet-300 hover:text-violet-700"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Widget AI Copilot */}
            <div className="border-t bg-violet-50/60 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Bot className="mt-0.5 size-4.5 shrink-0 text-violet-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                      AI Copilot gợi ý
                    </p>
                    {suggestion.intent !== "GENERAL" && (
                      <Badge
                        variant="outline"
                        className="border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        {suggestion.intent === "SIZE_ADVICE"
                          ? `Từ bảng size + tồn ${MOCK_STOCK_SOURCE_PREFERENCE === "CHANNEL" ? "sàn" : "kho"}`
                          : MOCK_STOCK_SOURCE_PREFERENCE === "CHANNEL"
                            ? "Từ tồn trên sàn"
                            : "Từ tồn kho vật lý"}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-900">{suggestion.text}</p>
                  {product && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-violet-600 hover:underline">
                        Xem ngữ cảnh sản phẩm AI đã nạp
                      </summary>
                      <pre className="mt-1.5 whitespace-pre-wrap rounded-lg border border-violet-200 bg-card p-2.5 font-mono text-[11px] leading-relaxed text-slate-600">
                        {buildInjectedContext(product, MOCK_STOCK_SOURCE_PREFERENCE)}
                      </pre>
                    </details>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-violet-300 text-violet-700 hover:bg-violet-100 hover:text-violet-800"
                  onClick={() => setDraft(suggestion.text)}
                >
                  <Sparkles className="size-4" />
                  Dùng gợi ý
                </Button>
              </div>
            </div>

            {/* Ô soạn tin */}
            <div className="flex items-center gap-2 border-t p-3">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Nhập tin nhắn trả lời khách…"
                aria-label="Soạn tin nhắn"
                disabled={sending}
              />
              <Button size="icon" aria-label="Gửi tin nhắn" onClick={handleSend} disabled={sending}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
              </Button>
            </div>
          </div>

          {/* ----- CỘT PHẢI: PRODUCT CONTEXT CARD (chỉ xl trở lên) ----- */}
          <div className="hidden flex-col overflow-y-auto border-l xl:flex">
            {/* Ô tra sản phẩm — chế độ thật cho nhân viên nạp ngữ cảnh theo SKU/tên */}
            {isReal && (
              <div className="flex items-center gap-2 border-b p-3">
                <Input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchProduct()}
                  placeholder="Tra SKU / tên sản phẩm…"
                  aria-label="Tra sản phẩm"
                />
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Tra sản phẩm"
                  onClick={searchProduct}
                  disabled={productLoading}
                >
                  {productLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                </Button>
              </div>
            )}
            {product ? (
              <ProductContextCard
                product={product}
                channel={activeChannel}
                stockSource={MOCK_STOCK_SOURCE_PREFERENCE}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <PackageSearch className="size-8 text-slate-300" />
                <p className="text-sm text-muted-foreground">
                  {isReal
                    ? "Tra SKU/tên sản phẩm ở ô trên để nạp ngữ cảnh cho AI, hoặc chờ khách gửi kèm sản phẩm."
                    : "Hội thoại này chưa gắn sản phẩm nào."}
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </OperationsFrame>
  );
}
