"use client";

// Ô chọn QUỐC GIA có tìm kiếm — mặc định Việt Nam 🇻🇳 (+84).
// Tự dựng bằng button + panel thả xuống (không thêm dependency): danh sách
// ~80 nước lọc theo tên/mã/dial code, đóng khi click ra ngoài hoặc Esc.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { COUNTRIES, findCountry } from "@/lib/countries";

export function CountrySelect({
  value,
  onChange,
}: {
  /** ISO alpha-2, vd "VN". */
  value: string;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = findCountry(value);

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
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dial.includes(q)
    );
  }, [query]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
      >
        <span className="flex items-center gap-2">
          <span className="text-base leading-none">{selected.flag}</span>
          {selected.name}
          <span className="text-muted-foreground">({selected.dial})</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <div className="flex items-center gap-2 border-b px-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm quốc gia…"
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
                    c.code === value && "bg-accent/60"
                  )}
                  onClick={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                >
                  <span className="text-base leading-none">{c.flag}</span>
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.dial}</span>
                  {c.code === value && <Check className="size-4 text-primary" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
