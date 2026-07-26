/**
 * ĐA GIAO DIỆN (Multi-theme) — nguồn chân lý cho danh sách theme và cách áp.
 *
 * Theme hoạt động thuần CSS: đổi attribute `data-theme` trên <html> là bộ biến
 * --primary/--ring/--sidebar-active-* trong globals.css đổi theo. Lựa chọn lưu
 * ở localStorage (THEME_STORAGE_KEY) để F5 còn nhớ.
 *
 * Áp theme lúc TẢI TRANG do script inline trong layout.tsx đảm nhiệm (chạy
 * trước khi React render để không nháy màu mặc định — FOUC); file này phục vụ
 * phần còn lại: trang Cấu hình đọc/ghi lựa chọn khi người dùng bấm chọn.
 */

export const THEME_STORAGE_KEY = "hubsell-theme";

export type ThemeId = "monochrome" | "indigo" | "emerald";

export const DEFAULT_THEME: ThemeId = "monochrome";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  desc: string;
  /** Lớp màu cho khối mini-preview ở trang Cấu hình (accent + nền active). */
  swatch: { accent: string; tint: string };
}

export const THEMES: ThemeMeta[] = [
  {
    id: "monochrome",
    label: "Tối giản (Monochrome)",
    desc: "Đen – trắng – xám mặc định. Trung tính, tập trung vào số liệu.",
    swatch: { accent: "bg-slate-900", tint: "bg-slate-100" },
  },
  {
    id: "indigo",
    label: "Hiện đại (Indigo)",
    desc: "Accent indigo phong cách công nghệ — nút chính và menu nổi rõ.",
    swatch: { accent: "bg-indigo-600", tint: "bg-indigo-50" },
  },
  {
    id: "emerald",
    label: "Tài chính (Emerald)",
    desc: "Accent xanh ngọc gợi tăng trưởng — hợp không khí bảng số tiền.",
    swatch: { accent: "bg-emerald-600", tint: "bg-emerald-50" },
  },
];

function isThemeId(v: unknown): v is ThemeId {
  return v === "monochrome" || v === "indigo" || v === "emerald";
}

/** Theme đang lưu (mặc định monochrome khi chưa chọn / giá trị rác). */
export function getStoredTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME; // localStorage bị chặn (chế độ riêng tư…) → mặc định
  }
}

/** Áp theme ngay lập tức + lưu lựa chọn để lần tải sau còn nhớ. */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Không lưu được thì theme vẫn áp cho phiên hiện tại — không cần báo lỗi.
  }
}
