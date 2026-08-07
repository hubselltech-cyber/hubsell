"use client";

import { Loader2, Paperclip, SendHorizontal, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * KHUNG SOẠN TIN NHẮN (Bottom Chat Input Bar)
 *
 * Cố định ở ĐÁY cột chat (phần tử cuối của flex column — vùng tin nhắn phía
 * trên mang flex-1 min-h-0 nên dù hội thoại dài đến đâu thanh này cũng không
 * bao giờ bị đẩy khỏi màn hình; đây chính là bug "khung trống" từng gặp với
 * dữ liệu thật).
 *
 *  · Enter        → gửi
 *  · Shift+Enter  → xuống dòng (textarea tự giãn tối đa ~5 dòng)
 *  · [✨ Dùng gợi ý AI] đổ câu của Copilot vào ô nhập để sửa trước khi gửi
 *  · Nút đính kèm là UI giữ chỗ — API upload ảnh của sàn nối sau
 */
export function ChatInput({
  value,
  onChange,
  onSend,
  onUseSuggestion,
  sending,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onUseSuggestion: () => void;
  sending: boolean;
}) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  // Giãn theo số dòng đang gõ (1→5) — đủ mượt mà không cần đo scrollHeight
  const rows = Math.min(5, Math.max(1, value.split("\n").length));

  return (
    <div className="border-t bg-card p-3">
      <div className="flex items-end gap-2">
        <Button
          variant="outline"
          size="icon"
          disabled
          className="shrink-0"
          title="Đính kèm hình ảnh/file — sắp có"
          aria-label="Đính kèm hình ảnh/file (sắp có)"
        >
          <Paperclip className="size-4" />
        </Button>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={rows}
          disabled={sending}
          placeholder="Nhập tin nhắn trả lời khách…  (Enter gửi · Shift+Enter xuống dòng)"
          aria-label="Soạn tin nhắn"
          className="max-h-36 min-w-0 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
        />
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 border-violet-300 text-violet-700 hover:bg-violet-100 hover:text-violet-800"
          onClick={onUseSuggestion}
          title="Đổ câu gợi ý của AI Copilot vào ô nhập"
        >
          <Sparkles className="size-4" />
          Dùng gợi ý AI
        </Button>
        <Button
          size="sm"
          className="shrink-0"
          onClick={onSend}
          disabled={sending || !value.trim()}
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SendHorizontal className="size-4" />
          )}
          Gửi tin nhắn
        </Button>
      </div>
    </div>
  );
}
