"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * NÚT SAO CHÉP MỘT CHẠM cạnh mã định danh (mã SKU, tên sản phẩm, mã đơn…).
 * Bấm → tick xanh 1,5 giây. Trình duyệt chặn Clipboard API thì dùng cách cũ
 * (ô ẩn + execCommand); vẫn không được thì báo khách bôi đen + Ctrl+C.
 * `what` là tên đối tượng để tooltip / aria-label nói đúng đang chép gì.
 */
export function CopyIconButton({
  value,
  what,
  className,
  iconClassName = "size-3",
}: {
  value: string;
  what: string;
  className?: string;
  iconClassName?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand copy failed");
      } catch {
        toast.error("Trình duyệt không cho sao chép. Hãy bôi đen rồi Ctrl+C.");
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Sao chép ${what} ${value}`}
      title={copied ? "Đã sao chép" : `Sao chép ${what}`}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-muted hover:text-foreground",
        copied ? "text-emerald-600" : "text-muted-foreground/60",
        className
      )}
    >
      {copied ? <Check className={iconClassName} /> : <Copy className={iconClassName} />}
    </button>
  );
}
