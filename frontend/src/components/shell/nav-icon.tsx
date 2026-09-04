"use client";

import type { LucideIcon } from "lucide-react";

// Icon sidebar bằng Material Symbols Rounded (variable font, trục FILL) —
// active thì FILL 0→1: icon outline "đổ đầy" thành filled đúng kiểu YouTube
// Studio, chi tiết bên trong vẫn khoét trắng vì glyph filled được vẽ riêng.
//
// 04/09/2026 — đo CSS thật của YouTube Studio: icon sidebar của họ 24px ở CẢ
// HAI trạng thái, glyph vẽ bằng path đặc nét ~2px, góc bo 2px trên lưới 24.
// Material Symbols ở opsz 24 / wght 400 cho đúng nét 2px đó; bản 20px/wght 350
// trước đây mảnh hơn chữ 500 đứng cạnh nên lệch nhịp. Cỡ icon KHÔNG đổi khi
// active — chỉ đổ đầy (FILL) và chữ nhích một bậc weight.
// transition font-variation-settings cho chuyển trạng thái mượt.
// (Tách ra file riêng từ app-shell.tsx để command palette dùng chung một bộ
// icon với sidebar — hai nơi không bao giờ lệch nhau.)
const ICON_PX = 24;
const WGHT_OUTLINE = 400;
const WGHT_FILLED = 400;

export function NavIcon({
  name,
  filled,
}: {
  name: string | LucideIcon;
  filled?: boolean;
}) {
  // Icon lucide (component) — cùng cỡ 24px với Material Symbols; active thì
  // nét dày hơn một bậc thay cho hiệu ứng FILL của glyph.
  if (typeof name !== "string") {
    const Icon = name;
    return (
      <Icon
        aria-hidden
        className="w-6 shrink-0"
        size={ICON_PX}
        strokeWidth={filled ? 2.25 : 2}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="material-symbols-rounded w-6 shrink-0 text-center text-[24px] leading-none transition-[font-variation-settings] duration-200 select-none"
      style={{
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${filled ? WGHT_FILLED : WGHT_OUTLINE}, 'GRAD' 0, 'opsz' 24`,
      }}
    >
      {name}
    </span>
  );
}
