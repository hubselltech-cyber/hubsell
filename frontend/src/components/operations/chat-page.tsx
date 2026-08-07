"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  ChevronDown,
  FlaskConical,
  Package,
  PackageSearch,
  SendHorizontal,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  buildAiSuggestion,
  buildInjectedContext,
  SAMPLE_QUESTIONS,
} from "@/components/operations/copilot-engine";
import {
  CHANNEL_META,
  MOCK_CONVERSATIONS,
  MOCK_PRODUCTS,
  MOCK_STOCK_SOURCE_PREFERENCE,
  type MockConversation,
} from "@/components/operations/mock-data";
import { OperationsFrame } from "@/components/operations/operations-frame";
import { ProductContextCard } from "@/components/operations/product-context-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRỢ LÝ CHAT — MÀN HÌNH MOCKUP (PREVIEW)
 *
 * Inbox CSKH hợp nhất 3 cột: danh sách hội thoại từ 3 sàn — khung chat —
 * Product Context Card (sản phẩm + size chart + tồn kho vật lý của hội thoại
 * đang mở). Gợi ý AI Copilot KHÔNG còn là chuỗi tĩnh: copilot-engine đọc câu
 * khách hỏi + dữ liệu sản phẩm (mô phỏng Context Injection) và sinh câu trả
 * lời có số liệu thật — xem chú thích trong copilot-engine.ts.
 *
 * Có thanh "Giả lập khách nhắn" để demo các câu hỏi mẫu ngay trên UI.
 */
export function OperationsChatPage() {
  // Hội thoại nằm trong state (không đọc thẳng hằng mock) vì thanh giả lập
  // được phép nối thêm tin nhắn của khách để thấy AI đổi gợi ý theo thời gian thực
  const [conversations, setConversations] =
    useState<MockConversation[]>(MOCK_CONVERSATIONS);
  const [activeId, setActiveId] = useState(MOCK_CONVERSATIONS[0].id);
  const [draft, setDraft] = useState("");
  // Mở/đóng khối sản phẩm trên màn hẹp (dưới xl cột phải bị ẩn)
  const [productOpen, setProductOpen] = useState(false);

  const active =
    conversations.find((c) => c.id === activeId) ?? conversations[0];
  const product = active.productSku
    ? MOCK_PRODUCTS[active.productSku]
    : undefined;

  // Gợi ý AI tính lại mỗi khi khách có tin mới — đúng nhịp chạy thật sau này
  const suggestion = useMemo(() => {
    const lastCustomerMsg = [...active.messages]
      .reverse()
      .find((m) => m.from === "CUSTOMER");
    return buildAiSuggestion(
      product,
      lastCustomerMsg?.text ?? "",
      active.aiSuggestion,
      MOCK_STOCK_SOURCE_PREFERENCE
    );
  }, [active, product]);

  function sendMock() {
    if (!draft.trim()) return;
    setDraft("");
    toast.success("Đã gửi tin nhắn (preview — chưa nối API sàn).");
  }

  /** Giả lập khách nhắn thêm một câu — engine sẽ sinh gợi ý mới ngay. */
  function simulateCustomer(text: string) {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === active.id
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

  return (
    <OperationsFrame>
      {/* Chiều cao cố định kiểu app chat: các cột tự cuộn bên trong, không kéo
          dài cả trang. min-h đề phòng màn hình thấp. */}
      <Card className="overflow-hidden py-0">
        <div className="grid min-h-[560px] lg:h-[calc(100vh-19rem)] lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_330px]">
          {/* ----- CỘT TRÁI: DANH SÁCH HỘI THOẠI ----- */}
          <div className="flex flex-col border-b lg:border-b-0 lg:border-r">
            <div className="border-b p-3">
              <Input placeholder="Tìm khách hàng, mã đơn…" aria-label="Tìm hội thoại" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.map((c) => {
                const isActive = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0",
                      isActive ? "bg-muted" : "hover:bg-muted/50"
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
                        <span className={cn(TEXT_SUB, "ml-auto shrink-0")}>
                          {c.time}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-slate-600">
                        {c.lastMessage}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={CHANNEL_META[c.channel].badgeClass}
                        >
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
                );
              })}
            </div>
          </div>

          {/* ----- CỘT GIỮA: KHUNG CHAT + AI COPILOT ----- */}
          <div className="flex min-w-0 flex-col">
            {/* Header hội thoại */}
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-slate-600">
                {active.customer.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {active.customer}
                </p>
                <p className={TEXT_SUB}>
                  {CHANNEL_META[active.channel].label} · {active.shop}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {active.orderCode && (
                  <Badge variant="outline" className="gap-1">
                    <Package className="size-3" />
                    Đơn {active.orderCode}
                  </Badge>
                )}
                {/* Nút xem SP cho màn hẹp — trên xl đã có hẳn cột phải */}
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
                      className={cn(
                        "size-3.5 transition-transform",
                        productOpen && "rotate-180"
                      )}
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
                  channel={active.channel}
                  stockSource={MOCK_STOCK_SOURCE_PREFERENCE}
                />
              </div>
            )}

            {/* Luồng tin nhắn */}
            <div className="flex-1 space-y-3 overflow-y-auto bg-muted/30 p-4">
              {active.messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "flex",
                    m.from === "SHOP" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-xs",
                      m.from === "SHOP"
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm border bg-card text-slate-900"
                    )}
                  >
                    <p>{m.text}</p>
                    <p
                      className={cn(
                        "mt-1 text-right text-[11px]",
                        m.from === "SHOP"
                          ? "text-primary-foreground/70"
                          : "text-slate-400"
                      )}
                    >
                      {m.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Thanh giả lập khách nhắn — demo engine đổi gợi ý theo câu hỏi */}
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

            {/* Widget AI Copilot — gợi ý sinh từ engine đọc dữ liệu SP */}
            <div className="border-t bg-violet-50/60 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Bot className="mt-0.5 size-4.5 shrink-0 text-violet-600" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                      AI Copilot gợi ý
                    </p>
                    {/* Badge nguồn: nhân viên biết câu này AI dựa số liệu kho
                        thật hay chỉ là câu hội thoại thường */}
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
                  {/* Ngữ cảnh đã tiêm vào prompt — minh bạch cho nhân viên/dev */}
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
                onKeyDown={(e) => e.key === "Enter" && sendMock()}
                placeholder="Nhập tin nhắn trả lời khách…"
                aria-label="Soạn tin nhắn"
              />
              <Button size="icon" aria-label="Gửi tin nhắn" onClick={sendMock}>
                <SendHorizontal className="size-4" />
              </Button>
            </div>
          </div>

          {/* ----- CỘT PHẢI: PRODUCT CONTEXT CARD (chỉ xl trở lên) ----- */}
          <div className="hidden flex-col overflow-y-auto border-l xl:flex">
            {product ? (
              <ProductContextCard
                product={product}
                channel={active.channel}
                stockSource={MOCK_STOCK_SOURCE_PREFERENCE}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <PackageSearch className="size-8 text-slate-300" />
                <p className="text-sm text-muted-foreground">
                  Hội thoại này chưa gắn sản phẩm nào.
                </p>
              </div>
            )}
          </div>
        </div>
      </Card>
    </OperationsFrame>
  );
}
