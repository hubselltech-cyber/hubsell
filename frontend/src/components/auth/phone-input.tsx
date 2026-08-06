"use client";

// Ô SỐ ĐIỆN THOẠI QUỐC TẾ (In-line Phone Input) — chuẩn UI/UX quốc tế:
// 2 phân vùng ghép liền trong 1 khung bo góc chung (Grouped Input):
//   • Trái: nút chọn quốc gia gọn `🇻🇳 +84` → click mở dropdown search
//     `[cờ] [Tên tiếng Anh] (+mã vùng)`.
//   • Phải: ô nhập số thuần tuý (chỉ nhận chữ số), không dính mã vùng.
// Tự dựng bằng button + panel thả xuống (không thêm dependency) — cùng cơ chế
// đóng khi click ra ngoài / Esc như CountrySelect cũ.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { COUNTRIES, findCountry } from "@/lib/countries";

export function PhoneInput({
  country,
  phone,
  onCountryChange,
  onPhoneChange,
  onPhoneBlur,
}: {
  /** ISO alpha-2, vd "VN". */
  country: string;
  /** Số điện thoại thuần (chỉ chữ số), KHÔNG kèm mã vùng. */
  phone: string;
  onCountryChange: (code: string) => void;
  onPhoneChange: (phone: string) => void;
  onPhoneBlur?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = findCountry(country);

  // Đóng khi click ra ngoài / bấm Esc — hành vi chuẩn của mọi dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.nameEn.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dial.includes(q)
    );
  }, [query]);

  return (
    <div ref={rootRef} className="relative">
      {/* Khung chung: 2 ô ghép liền, bo góc + ring focus trên CẢ NHÓM */}
      <div className="flex h-9 w-full items-stretch rounded-md border border-input bg-transparent shadow-xs transition-colors focus-within:ring-1 focus-within:ring-ring">
        <button
          type="button"
          aria-label={`Mã vùng: ${selected.nameEn} (${selected.dial})`}
          className="flex shrink-0 items-center gap-1.5 rounded-l-md border-r border-input px-3 text-sm hover:bg-accent/50 focus-visible:outline-none"
          onClick={() => {
            setOpen((o) => !o);
            setQuery("");
          }}
        >
          <span className="text-base leading-none">{selected.flag}</span>
          <span className="tabular-nums">{selected.dial}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="912 345 678"
          value={phone}
          onChange={(e) => {
            // Chỉ giữ chữ số — người dùng dán "091 234-5678" vẫn ra "0912345678".
            onPhoneChange(e.target.value.replace(/\D/g, "").slice(0, 15));
          }}
          onBlur={onPhoneBlur}
          className="w-full min-w-0 rounded-r-md bg-transparent px-3 text-sm placeholder:text-muted-foreground focus:outline-none"
        />
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="flex items-center gap-2 border-b px-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm quốc gia hoặc mã vùng…"
              className="h-8 border-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-center text-sm text-muted-foreground">
                Không tìm thấy quốc gia nào
              </li>
            )}
            {filtered.map((c) => (
              <li key={c.code}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                    c.code === country && "bg-accent/60"
                  )}
                  onClick={() => {
                    onCountryChange(c.code);
                    setOpen(false);
                  }}
                >
                  <span className="text-base leading-none">{c.flag}</span>
                  <span className="flex-1">{c.nameEn}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    ({c.dial})
                  </span>
                  {c.code === country && <Check className="size-4 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
