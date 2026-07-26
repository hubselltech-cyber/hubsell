"use client";

import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyTheme,
  getStoredTheme,
  THEMES,
  type ThemeId,
} from "@/lib/theme";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * GIAO DIỆN HỆ THỐNG (Appearance) — khối chọn theme trong Cấu hình chung.
 *
 * Grid 3 ô = 3 theme (Monochrome mặc định / Indigo / Emerald), mỗi ô kèm khối
 * mini-preview mô phỏng sidebar + nút chính để hình dung tone màu trước khi
 * bấm. Click là áp NGAY (đổi data-theme trên <html>) và lưu localStorage —
 * không cần nút Lưu riêng, đổi ý bấm ô khác là xong.
 */
export function AppearanceSection() {
  // Khởi tạo bằng mặc định rồi đồng bộ theme thật trong effect — đọc
  // localStorage ngay lúc render đầu sẽ lệch với HTML server trả về (hydration).
  const [theme, setTheme] = useState<ThemeId>("monochrome");
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  function handleSelect(next: ThemeId) {
    if (next === theme) return;
    applyTheme(next);
    setTheme(next);
    toast.success(
      `Đã đổi giao diện: ${THEMES.find((t) => t.id === next)?.label}`
    );
  }

  return (
    <Card className="max-w-2xl shadow-sm">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-5 text-slate-500" />
          Giao diện hệ thống
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-5">
        <div
          role="radiogroup"
          aria-label="Chọn giao diện hệ thống"
          className="grid gap-3 sm:grid-cols-3"
        >
          {THEMES.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => handleSelect(t.id)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-primary ring-1 ring-primary"
                    : "hover:border-slate-300 hover:bg-muted/50"
                )}
              >
                {/* Mini-preview: dải accent (nút chính) + nền active (menu) */}
                <span className="flex h-12 items-center gap-1.5 rounded-md border border-slate-100 bg-slate-50 p-2">
                  <span
                    className={cn("h-full w-1.5 rounded-full", t.swatch.accent)}
                  />
                  <span className="flex h-full flex-1 flex-col justify-center gap-1">
                    <span
                      className={cn("h-2.5 w-3/4 rounded", t.swatch.tint)}
                    />
                    <span className="h-2.5 w-1/2 rounded bg-white" />
                  </span>
                  <span
                    className={cn(
                      "h-4 w-7 shrink-0 rounded-md",
                      t.swatch.accent
                    )}
                  />
                </span>

                <span className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  {t.label}
                  {active && <Check className="size-3.5 text-primary" />}
                </span>
                <span className={cn(TEXT_SUB, "mt-0.5 block")}>{t.desc}</span>
              </button>
            );
          })}
        </div>
        <p className={cn(TEXT_SUB, "mt-3")}>
          Áp dụng ngay khi chọn và lưu trên trình duyệt này. Màu lãi/lỗ
          (xanh/đỏ) giữ nguyên ở mọi giao diện.
        </p>
      </CardContent>
    </Card>
  );
}
