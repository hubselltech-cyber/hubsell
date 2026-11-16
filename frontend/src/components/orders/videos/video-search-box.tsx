"use client";

import * as React from "react";
import { ScanLine, X } from "lucide-react";

import { Input } from "@/components/ui/input";

/**
 * Ô TÌM VIDEO — việc số một của trang: dán / gõ mã vận đơn hoặc mã đơn, hoặc bắn máy quét
 * vào (máy quét là bàn phím + Enter).
 *
 * - Gõ: lọc danh sách theo tiền tố sau khi ngừng gõ (trang cha tự trễ nhịp).
 * - Enter (máy quét, hoặc người gõ xong bấm Enter): lọc NGAY và báo `onSubmit` để trang
 *   mở thẳng hồ sơ nếu mã ra đúng một đơn.
 *
 * Mã nằm lại trong ô để người dùng thấy đang lọc theo gì; mã kế tiếp bắn vào sẽ THAY mã
 * cũ (ô tự bôi đen sau Enter) chứ không dính liền vào nhau. Bề rộng cố định, không kéo
 * giãn theo trang (bố cục anh Trung chốt ở Đối soát đơn hoàn 13/11/2026).
 */
export function VideoSearchBox({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Người dùng bấm Enter với một mã không rỗng. */
  onSubmit: (code: string) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="relative w-full sm:w-80">
      <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        className="pl-9 pr-9"
        aria-label="Tìm video theo mã vận đơn hoặc mã đơn"
        placeholder="Quét hoặc dán mã vận đơn, mã đơn…"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const code = value.trim();
          if (!code) return;
          onSubmit(code);
          inputRef.current?.select();
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Xóa mã đang tìm"
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
