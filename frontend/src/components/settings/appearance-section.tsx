"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Palette, Sun, SunMoon } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyTheme,
  getStoredTheme,
  setThemeBase,
  THEMES,
  type ThemeId,
} from "@/lib/theme";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** 3 chế độ hiển thị — giá trị id đúng chuẩn next-themes. */
const DISPLAY_MODES = [
  {
    id: "light",
    label: "Sáng",
    desc: "Nền sáng chuẩn, mặc định",
    icon: Sun,
  },
  {
    id: "dark",
    label: "Tối",
    desc: "Dịu mắt khi làm việc đêm",
    icon: Moon,
  },
  {
    id: "system",
    label: "Theo hệ thống",
    desc: "Tự đổi theo cài đặt máy",
    icon: Monitor,
  },
] as const;

/**
 * CHẾ ĐỘ HIỂN THỊ (Sáng / Tối / Theo hệ thống) — trục ĐỘC LẬP với 3 theme
 * accent bên dưới: theme đổi MÀU NHẤN, chế độ đổi NỀN SÁNG–TỐI, phối tự do.
 * next-themes lưu localStorage "hubsell-theme-mode" và gắn class `dark`.
 */
function DisplayModeSection() {
  const { theme, setTheme } = useTheme();
  // theme chỉ đáng tin sau mount (SSR không đọc được localStorage) — trước đó
  // không tô ô đang chọn để khỏi lệch hydration
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Card className="max-w-2xl shadow-sm">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2">
          <SunMoon className="size-5 text-slate-500" />
          Chế độ hiển thị
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-5">
        <div
          role="radiogroup"
          aria-label="Chọn chế độ hiển thị sáng tối"
          className="grid gap-3 sm:grid-cols-3"
        >
          {DISPLAY_MODES.map((m) => {
            const active = mounted && theme === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setTheme(m.id);
                  // Ghi LỰA CHỌN GỐC: chọn "Theo hệ thống" ở đây thì nút mặt
                  // trăng trên header chỉ còn là ghi đè tạm (xem lib/theme.ts).
                  setThemeBase(m.id);
                  toast.success(`Đã đổi chế độ hiển thị: ${m.label}`);
                }}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-primary ring-1 ring-primary"
                    : "hover:border-slate-300 hover:bg-muted/50"
                )}
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                  <Icon className="size-5" />
                </span>
                <span className="mt-2.5 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  {m.label}
                  {active && <Check className="size-3.5 text-primary" />}
                </span>
                <span className={cn(TEXT_SUB, "mt-0.5 block")}>{m.desc}</span>
              </button>
            );
          })}
        </div>
        <p className={cn(TEXT_SUB, "mt-3")}>
          Có thể chuyển nhanh sáng/tối bằng nút mặt trăng trên thanh tiêu đề.
        </p>
      </CardContent>
    </Card>
  );
}

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
    <div className="space-y-4">
      <DisplayModeSection />
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
    </div>
  );
}
