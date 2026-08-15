"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Send, Table2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ROLE_META,
  TAG_META,
  type ChatBody,
  type ChatMessage,
  type OpsAlert,
} from "./types";
import { formatRelative, parsePastedTable } from "./mock-service";

/** Ảnh đính kèm "nhẹ" — chặn file quá 2MB cho đúng tinh thần mock local. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Bảng hiển thị trong tin nhắn — dòng đầu là tiêu đề. */
function MessageTable({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows;
  return (
    <div className="mt-1 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-50">
            {head.map((cell, i) => (
              <th
                key={i}
                className="border-b border-slate-200 px-2.5 py-1.5 text-left font-semibold text-slate-700"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="odd:bg-card even:bg-slate-50/50">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className="border-b border-slate-100 px-2.5 py-1.5 text-slate-700"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const system = message.author === "Hệ thống";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-900">
          {message.author}
        </span>
        {!system && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
            {ROLE_META[message.role].label}
          </span>
        )}
        <span className="text-[11px] text-slate-400">
          {formatRelative(message.at)}
        </span>
      </div>
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-sm",
          system
            ? "bg-slate-50 text-slate-600"
            : "bg-primary/5 text-slate-800"
        )}
      >
        {message.body.kind === "text" && (
          <p className="whitespace-pre-wrap break-words">{message.body.text}</p>
        )}
        {message.body.kind === "table" && <MessageTable rows={message.body.rows} />}
        {message.body.kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={message.body.dataUrl}
            alt={message.body.name}
            className="max-h-56 rounded-md border border-slate-200 object-contain"
          />
        )}
      </div>
    </div>
  );
}

export function ChatDrawer({
  alert,
  messages,
  onSend,
  onClose,
}: {
  alert: OpsAlert;
  messages: ChatMessage[];
  onSend: (body: ChatBody) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<
    { kind: "table"; rows: string[][] } | { kind: "image"; dataUrl: string; name: string } | null
  >(null);
  const [hint, setHint] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Cuộn xuống tin mới nhất mỗi khi danh sách tin đổi
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Đóng bằng phím Esc — thói quen quen thuộc với drawer/dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const raw = e.clipboardData.getData("text/plain");
    const rows = parsePastedTable(raw);
    if (rows) {
      e.preventDefault();
      setPending({ kind: "table", rows });
      setHint(`Đã nhận bảng ${rows.length}×${rows[0].length} — bấm gửi để đăng.`);
    }
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setHint("Chỉ đính kèm được ảnh.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setHint("Ảnh vượt 2MB — chọn ảnh nhẹ hơn.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPending({ kind: "image", dataUrl: String(reader.result), name: file.name });
      setHint(`Đã đính kèm ${file.name}.`);
    };
    reader.readAsDataURL(file);
  }

  function send() {
    if (pending) {
      onSend(pending);
    } else if (text.trim()) {
      onSend({ kind: "text", text: text.trim() });
    } else {
      return;
    }
    setText("");
    setPending(null);
    setHint(null);
  }

  const canSend = pending !== null || text.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50">
      {/* Nền mờ — chạm ra ngoài để đóng */}
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in"
        aria-hidden
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={`Thảo luận: ${alert.title}`}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-slate-200 bg-card shadow-xl animate-in slide-in-from-right duration-200"
      >
        {/* Đầu drawer */}
        <div className="flex items-start gap-3 border-b border-slate-200 p-4">
          <span
            className={cn(
              "mt-0.5 shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold",
              TAG_META[alert.tag].className
            )}
          >
            {TAG_META[alert.tag].label}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Thảo luận riêng theo sự cố này
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4.5" />
          </button>
        </div>

        {/* Danh sách tin nhắn */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <p className="pt-10 text-center text-sm text-slate-400">
              Chưa có trao đổi nào. Bắt đầu thảo luận về sự cố này.
            </p>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          <div ref={endRef} />
        </div>

        {/* Ô soạn tin */}
        <div className="border-t border-slate-200 p-3">
          {pending && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {pending.kind === "table" ? (
                <>
                  <Table2 className="size-4 shrink-0 text-slate-400" />
                  Bảng {pending.rows.length}×{pending.rows[0].length} sẵn sàng gửi
                </>
              ) : (
                <>
                  <ImageIcon className="size-4 shrink-0 text-slate-400" />
                  {pending.name}
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                  setHint(null);
                }}
                className="ml-auto text-slate-400 hover:text-slate-700"
                aria-label="Bỏ đính kèm"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0"
              aria-label="Đính kèm ảnh"
              onClick={() => fileRef.current?.click()}
            >
              <ImageIcon className="size-4" />
            </Button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Nhập tin nhắn, hoặc dán bảng từ Excel…"
              className="max-h-28 min-h-9 flex-1 resize-none rounded-lg border border-slate-200 bg-card px-3 py-1.5 text-sm outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
            />
            <Button
              type="button"
              size="icon-sm"
              className="shrink-0"
              aria-label="Gửi"
              disabled={!canSend}
              onClick={send}
            >
              <Send className="size-4" />
            </Button>
          </div>
          {hint && <p className="mt-1.5 px-1 text-[11px] text-slate-400">{hint}</p>}
        </div>
      </aside>
    </div>
  );
}
