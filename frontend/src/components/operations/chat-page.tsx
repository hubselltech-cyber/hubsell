"use client";

import { useState } from "react";
import { Bot, Package, SendHorizontal, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { CHANNEL_META, MOCK_CONVERSATIONS } from "@/components/operations/mock-data";
import { OperationsFrame } from "@/components/operations/operations-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRỢ LÝ CHAT — MÀN HÌNH MOCKUP (PREVIEW)
 *
 * Inbox CSKH hợp nhất 2 cột: trái là danh sách hội thoại đổ về từ 3 sàn,
 * phải là khung chat kèm widget AI Copilot gợi ý câu trả lời cho tin nhắn
 * mới nhất của khách. Dữ liệu mock cứng — khi nối API tin nhắn của sàn chỉ
 * thay nguồn hội thoại, khung UI giữ nguyên.
 */
export function OperationsChatPage() {
  const [activeId, setActiveId] = useState(MOCK_CONVERSATIONS[0].id);
  const [draft, setDraft] = useState("");

  const active =
    MOCK_CONVERSATIONS.find((c) => c.id === activeId) ?? MOCK_CONVERSATIONS[0];

  function sendMock() {
    if (!draft.trim()) return;
    setDraft("");
    toast.success("Đã gửi tin nhắn (preview — chưa nối API sàn).");
  }

  return (
    <OperationsFrame>
      {/* Chiều cao cố định kiểu app chat: 2 cột tự cuộn bên trong, không kéo
          dài cả trang. min-h đề phòng màn hình thấp. */}
      <Card className="overflow-hidden py-0">
        <div className="grid min-h-[560px] lg:h-[calc(100vh-19rem)] lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* ----- CỘT TRÁI: DANH SÁCH HỘI THOẠI ----- */}
          <div className="flex flex-col border-b lg:border-b-0 lg:border-r">
            <div className="border-b p-3">
              <Input placeholder="Tìm khách hàng, mã đơn…" aria-label="Tìm hội thoại" />
            </div>
            <div className="flex-1 overflow-y-auto">
              {MOCK_CONVERSATIONS.map((c) => {
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

          {/* ----- CỘT PHẢI: KHUNG CHAT + AI COPILOT ----- */}
          <div className="flex flex-col">
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
              {active.orderCode && (
                <Badge variant="outline" className="ml-auto gap-1">
                  <Package className="size-3" />
                  Đơn {active.orderCode}
                </Badge>
              )}
            </div>

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

            {/* Widget AI Copilot — gợi ý trả lời cho tin nhắn mới nhất */}
            <div className="border-t bg-violet-50/60 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Bot className="mt-0.5 size-4.5 shrink-0 text-violet-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                    AI Copilot gợi ý
                  </p>
                  <p className="mt-1 text-sm text-slate-900">
                    {active.aiSuggestion}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-violet-300 text-violet-700 hover:bg-violet-100 hover:text-violet-800"
                  onClick={() => setDraft(active.aiSuggestion)}
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
        </div>
      </Card>
    </OperationsFrame>
  );
}
