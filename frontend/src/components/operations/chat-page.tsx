"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  channelMeta,
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
import { Switch } from "@/components/ui/switch";
import {
  ApiError,
  fetchOpsConversations,
  fetchOpsMessages,
  fetchOpsProductContext,
  sendOpsMessage,
  type OpsChannelError,
  type OpsChannelStat,
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

/** Khoá localStorage nhớ trạng thái nút Auto trả lời giữa các phiên. */
const AUTO_REPLY_KEY = "hubsell_ops_chat_autoreply";

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
  // Lỗi tải tin nhắn của hội thoại đang mở — hiện error state NHẸ trong khung
  // chat kèm nút thử lại, không kéo sập cả trang
  const [messagesError, setMessagesError] = useState<string | null>(null);
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
  const [channelStats, setChannelStats] = useState<OpsChannelStat[]>([]);

  // ── AUTO TRẢ LỜI TIN MỚI ──
  // Bật là hệ thống tự gửi câu xác nhận đã nhận tin cho hội thoại có tin mới
  // của khách (mỗi tin mới auto 1 lần — theo dõi bằng khoá conv.id:lastAt).
  // Chạy khi trang đang mở (client-side); auto-reply nền 24/7 cần worker +
  // webhook sàn — ghi lộ trình, làm sau.
  const [autoReply, setAutoReply] = useState(false);
  const autoReplyRef = useRef(autoReply);
  const autoRepliedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    autoReplyRef.current = autoReply;
  }, [autoReply]);
  useEffect(() => {
    setAutoReply(localStorage.getItem(AUTO_REPLY_KEY) === "1");
  }, []);
  function toggleAutoReply(on: boolean) {
    setAutoReply(on);
    localStorage.setItem(AUTO_REPLY_KEY, on ? "1" : "0");
    toast.success(on ? "Đã BẬT auto trả lời tin nhắn mới." : "Đã tắt auto trả lời.");
  }

  /** Tự gửi câu xác nhận cho các hội thoại vừa có tin mới của khách (real). */
  const maybeAutoReply = useCallback(async (convs: OpsConversationDTO[]) => {
    if (!autoReplyRef.current) return;
    for (const c of convs) {
      if (!c || c.unread <= 0) continue;
      const key = `${c.id}:${c.lastAt ?? ""}`;
      if (autoRepliedRef.current.has(key)) continue;
      autoRepliedRef.current.add(key); // đánh dấu TRƯỚC — lỗi cũng không dội bom khách
      try {
        await sendOpsMessage({
          channelId: c.channelId,
          conversationId: c.externalId,
          buyerId: c.buyerId,
          text: GENERIC_CHAT_FALLBACK,
        });
        toast.success(`🤖 Auto đã trả lời ${c.customer}.`);
      } catch {
        // gian lỗi quyền/token — bỏ qua, tin kế tiếp (key mới) sẽ thử lại
      }
    }
  }, []);

  // ── Nạp + LÀM MỚI inbox (dùng cho cả lượt đầu lẫn polling 30s) ──
  const refreshConversations = useCallback(
    async (opts?: { initial?: boolean }) => {
      try {
        const r = await fetchOpsConversations();
        setChannelErrors(r.errors);
        setChannelStats(r.channelStats ?? []);
        if (r.conversations.length > 0) {
          setRealConvs(r.conversations);
          // Giữ nguyên hội thoại đang mở nếu còn; khách nhắn khi đang demo →
          // tự chuyển sang dữ liệu thật, không cần F5
          setActiveRealId((prev) =>
            prev && r.conversations.some((c) => c.id === prev)
              ? prev
              : r.conversations[0].id
          );
          setMode("real");
          void maybeAutoReply(r.conversations);
        } else if (opts?.initial) {
          setMode("demo");
        }
      } catch (err) {
        if (opts?.initial) {
          // 401 đã bị OperationsFrame đẩy về /login; lỗi khác (NO_CHANNEL,
          // mạng, backend tắt) → demo để trang vẫn dùng được.
          if (err instanceof ApiError && err.status !== 401) {
            setChannelErrors([
              { channelId: "", shopName: "Hệ thống", message: err.message },
            ]);
          }
          setMode("demo");
        }
        // Poll nền lỗi thoáng qua → giữ nguyên dữ liệu đang có, lượt sau thử lại
      }
    },
    [maybeAutoReply]
  );

  useEffect(() => {
    void refreshConversations({ initial: true });
  }, [refreshConversations]);

  // Polling inbox mỗi 30s — chạy cả ở chế độ demo để có khách nhắn là bắt được
  useEffect(() => {
    if (mode === "loading") return;
    const iv = setInterval(() => void refreshConversations(), 30_000);
    return () => clearInterval(iv);
  }, [mode, refreshConversations]);

  const activeReal = realConvs.find((c) => c.id === activeRealId) ?? null;
  const activeDemo = demoConvs.find((c) => c.id === activeDemoId) ?? demoConvs[0];

  // ── Nạp tin nhắn + ngữ cảnh SP của hội thoại thật đang mở ──
  const loadRealMessages = useCallback(
    async (conv: OpsConversationDTO, opts?: { silent?: boolean }) => {
      // silent = poll nền 15s: không nháy spinner, lỗi thoáng qua thì giữ
      // nguyên tin nhắn đang có thay vì đập error state vào mặt người dùng
      const silent = opts?.silent === true;
      if (!silent) {
        setLoadingMessages(true);
        setMessagesError(null);
      }
      let msgs: OpsMessageDTO[] = [];
      try {
        const r = await fetchOpsMessages({
          channelId: conv.channelId,
          conversationId: conv.externalId,
          buyerId: conv.buyerId,
        });
        msgs = r.messages ?? [];
        setRealMessages((prev) => ({ ...prev, [conv.id]: msgs }));
      } catch (err) {
        // Token hết hạn / sàn chặn quyền — hiện trong khung chat, các hội
        // thoại khác vẫn dùng bình thường
        if (!silent) {
          setMessagesError(
            err instanceof Error ? err.message : "Không tải được tin nhắn"
          );
          setLoadingMessages(false);
        }
        return;
      }
      if (!silent) setLoadingMessages(false);

      // Ngữ cảnh SP tách RIÊNG khỏi luồng tin nhắn: khách gửi kèm sản phẩm mà
      // tra ngữ cảnh lỗi thì chat vẫn phải hiện đủ — chỉ ghi log, không toast.
      try {
        const withItem = [...msgs].reverse().find((m) => m?.itemId);
        if (withItem?.itemId) {
          const ctx = await fetchOpsProductContext({
            channelId: conv.channelId,
            itemId: withItem.itemId,
          });
          if (ctx.found && ctx.product) {
            setRealProduct(productInfoFromContext(ctx.product));
          }
        }
      } catch {
        // best-effort — nhân viên vẫn tra tay được bằng ô tìm kiếm
      }
    },
    []
  );

  useEffect(() => {
    if (mode !== "real" || !activeReal) return;
    setMessagesError(null); // lỗi là của hội thoại cũ — đừng đeo sang hội thoại mới
    if (!realMessages[activeReal.id]) void loadRealMessages(activeReal);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ nạp khi đổi hội thoại
  }, [mode, activeRealId]);

  // Polling khung chat đang mở mỗi 15s — tin khách vừa nhắn tự hiện, không F5.
  // (Real-time đúng nghĩa qua webhook sàn nằm trong lộ trình worker nền.)
  useEffect(() => {
    if (mode !== "real" || !activeReal) return;
    const iv = setInterval(
      () => void loadRealMessages(activeReal, { silent: true }),
      15_000
    );
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- theo hội thoại đang mở
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
    // Bọc TOÀN BỘ đường sinh gợi ý: một payload dị (text undefined, chart
    // hỏng…) làm engine ném lỗi thì copilot rơi về câu chung, chat KHÔNG sập.
    try {
      const lastCustomerText = isReal
        ? [...(activeReal ? realMessages[activeReal.id] ?? [] : [])]
            .reverse()
            .find((m) => m && !m.fromShop)?.text ?? ""
        : [...activeDemo.messages].reverse().find((m) => m.from === "CUSTOMER")?.text ??
          "";
      const fallback = isReal ? GENERIC_CHAT_FALLBACK : activeDemo.aiSuggestion;
      return buildAiSuggestion(
        product,
        typeof lastCustomerText === "string" ? lastCustomerText : "",
        fallback,
        MOCK_STOCK_SOURCE_PREFERENCE
      );
    } catch {
      return { text: GENERIC_CHAT_FALLBACK, intent: "GENERAL" as const };
    }
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
      toast.success(`Đã gửi tới ${activeReal.customer} qua ${channelMeta(activeReal.channelName).label}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gửi tin thất bại");
    } finally {
      setSending(false);
    }
  }

  /** Giả lập khách nhắn (CHỈ demo) — engine sinh gợi ý mới ngay; đang bật
   *  Auto trả lời thì shop tự nhắn lại sau ~1 giây, demo đúng luồng thật. */
  function simulateCustomer(text: string) {
    const convId = activeDemo.id;
    setDemoConvs((prev) =>
      prev.map((c) =>
        c.id === convId
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

    if (!autoReplyRef.current) return;
    const demoProduct = activeDemo.productSku
      ? MOCK_PRODUCTS[activeDemo.productSku]
      : undefined;
    const reply = buildAiSuggestion(
      demoProduct,
      text,
      activeDemo.aiSuggestion,
      MOCK_STOCK_SOURCE_PREFERENCE
    ).text;
    setTimeout(() => {
      setDemoConvs((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                lastMessage: reply,
                messages: [
                  ...c.messages,
                  {
                    id: `auto-${c.messages.length + 1}`,
                    from: "SHOP" as const,
                    text: reply,
                    time: "Vừa xong",
                  },
                ],
              }
            : c
        )
      );
      toast.success("🤖 Auto đã trả lời khách (demo).");
    }, 900);
  }

  // ── View model danh sách hội thoại (chung 2 chế độ) ──
  const convItems = isReal
    ? realConvs.map((c) => ({
        key: c.id,
        customer: c.customer || "Khách",
        channel: c.channelName as OpsChannel,
        lastMessage: typeof c.lastMessage === "string" ? c.lastMessage : "",
        time: fmtTime(c.lastAt),
        unread: Number(c.unread) || 0,
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
    ? (activeReal ? realMessages[activeReal.id] ?? [] : [])
        .filter((m) => m != null)
        .map((m, i) => ({
          key: m.id ?? `msg-${i}`,
          fromShop: Boolean(m.fromShop),
          text: typeof m.text === "string" ? m.text : "[tin nhắn không đọc được]",
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
      {/* ===== NHÃN NGUỒN DỮ LIỆU + CÔNG TẮC AUTO + TRẠNG THÁI TỪNG GIAN ===== */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
          {/* Công tắc auto trả lời — dùng được ở cả hai chế độ.
              KHÔNG bọc <label>: label dội thêm một click vào control con làm
              switch bật-rồi-tắt trong một lần bấm; chữ bên cạnh tự xử lý click. */}
          <div className="flex items-center gap-2">
            <Switch
              checked={autoReply}
              onCheckedChange={toggleAutoReply}
              aria-label="Bật/tắt auto trả lời tin nhắn mới"
            />
            <button
              type="button"
              className="text-sm font-medium text-slate-900"
              onClick={() => toggleAutoReply(!autoReply)}
            >
              🤖 Auto trả lời tin mới
            </button>
          </div>
          {autoReply && (
            <span className={TEXT_SUB}>
              Tự gửi câu xác nhận cho tin nhắn mới của khách (khi đang mở trang).
            </span>
          )}
        </div>
        {/* Trạng thái từng gian: phân biệt rõ "lỗi" với "OK nhưng 0 hội thoại" */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {channelStats.map((s) => (
            <span key={s.channelId} className={cn(TEXT_SUB, "text-emerald-600")}>
              ✓ {s.shopName} ({channelMeta(s.channelName).label}): kết nối OK —{" "}
              {s.count} hội thoại
            </span>
          ))}
          {channelErrors.map((e) => (
            <span key={`${e.channelId}-${e.message}`} className={cn(TEXT_SUB, "text-amber-700")}>
              ⚠️ {e.shopName}: {e.message}
            </span>
          ))}
          {!isReal && channelStats.length > 0 && (
            <span className={TEXT_SUB}>
              Inbox tự làm mới mỗi 30 giây — có khách nhắn là chuyển sang dữ liệu
              thật, không cần tải lại trang.
            </span>
          )}
        </div>
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
                    {(c.customer || "?").charAt(0)}
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
                      <Badge variant="outline" className={channelMeta(c.channel).badgeClass}>
                        {channelMeta(c.channel).label}
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
                {(headerCustomer || "?").charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{headerCustomer}</p>
                <p className={TEXT_SUB}>
                  {channelMeta(activeChannel).label} · {headerShop}
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
              {/* Error state NHẸ trong khung — trang và các hội thoại khác vẫn sống */}
              {!loadingMessages && messagesError && (
                <div className="mx-auto max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
                  <p className="text-sm text-amber-800">
                    Không tải được tin nhắn: {messagesError}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 border-amber-300 text-amber-800 hover:bg-amber-100"
                    onClick={() => activeReal && loadRealMessages(activeReal)}
                  >
                    Thử lại
                  </Button>
                </div>
              )}
              {!loadingMessages && !messagesError && messageItems.length === 0 && (
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
