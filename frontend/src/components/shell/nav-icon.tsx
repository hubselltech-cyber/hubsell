"use client";

import type { LucideIcon } from "lucide-react";

// Icon sidebar bằng Material Symbols Rounded (variable font, trục FILL) —
// active thì FILL 0→1: icon outline "đổ đầy" thành filled đúng kiểu YouTube
// Studio, chi tiết bên trong vẫn khoét trắng vì glyph filled được vẽ riêng.
// Outline để wght 350 — mỏng hơn mặc định 400 nhưng không mảnh dây (300):
// đối chiếu ảnh sidebar YouTube Studio thật thì nét của họ nằm đúng khoảng này.
// Khi đổ đầy trả về wght 400 để khối đen đủ đậm.
// transition font-variation-settings cho chuyển trạng thái mượt.
// (Tách ra file riêng từ app-shell.tsx để command palette dùng chung một bộ
// icon với sidebar — hai nơi không bao giờ lệch nhau.)
export function NavIcon({
  name,
  filled,
}: {
  name: string | LucideIcon;
  filled?: boolean;
}) {
  // Icon lucide (component) — kích cỡ 20px khớp Material Symbols; active thì
  // nét dày hơn một bậc thay cho hiệu ứng FILL của glyph.
  if (typeof name !== "string") {
    const Icon = name;
    return (
      <Icon
        aria-hidden
        className="w-5 shrink-0"
        size={20}
        strokeWidth={filled ? 2.25 : 1.75}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="material-symbols-rounded w-5 shrink-0 text-center text-[20px] leading-none transition-[font-variation-settings] duration-200 select-none"
      style={{
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${filled ? 400 : 350}, 'GRAD' 0, 'opsz' 24`,
      }}
    >
      {name}
    </span>
  );
}
