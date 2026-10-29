"use client";

// ============================================================
// Ô chọn THƯƠNG HIỆU có tìm kiếm — thay <select> gốc (30/10/2026, khách báo:
// Safari/macOS xổ danh sách hàng nghìn thương hiệu không gõ tìm được, không thấy
// thanh cuộn). Gõ → hỏi lại gian đích (`/brands?q=`), danh sách cuộn có thanh
// cuộn LUÔN HIỆN (macOS ẩn thanh cuộn overlay), chọn bằng chuột hoặc ↑↓ Enter.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { fetchCopyListingBrands } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { brandLabel } from "./labels";

export interface BrandValue {
  id: string;
  name: string;
}

export function BrandCombobox({
  jobId,
  targetId,
  categoryId,
  value,
  disabled,
  invalid,
  onChange,
}: {
  jobId: string;
  targetId: string;
  categoryId: string | null;
  value: BrandValue | null;
  disabled?: boolean;
  invalid?: boolean;
  onChange: (brand: BrandValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<BrandValue[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Hỏi gian đích theo từ khóa (đợi gõ xong 250 ms); mở mà chưa gõ → danh sách đầu.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      fetchCopyListingBrands(jobId, targetId, query.trim(), categoryId)
        .then((r) => {
          if (!alive) return;
          setItems(r.items);
          setHighlight(0);
        })
        .catch(() => alive && setItems([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, query, jobId, targetId, categoryId]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(b: BrandValue | null) {
    onChange(b);
    close();
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[highlight];
      if (it) choose(it);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const shown = open ? query : value ? brandLabel(value.name) : "";

  return (
    <div ref={boxRef} className="relative min-w-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        className={cn("pl-9 pr-16", invalid && "border-amber-300 bg-amber-50/40")}
        placeholder="Gõ tên thương hiệu để tìm…"
        value={shown}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label="Thương hiệu"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {value && !open && !disabled && (
          <button
            type="button"
            aria-label="Bỏ thương hiệu"
            onClick={() => onChange(null)}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </div>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="scrollbar-always absolute z-50 mt-1 max-h-64 w-full overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 shadow-lg"
        >
          {loading && items.length === 0 ? (
            <div className={cn(TEXT_SUB, "px-3 py-4 text-center")}>Đang tìm…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-sm">Không thấy thương hiệu nào</p>
              <p className={cn(TEXT_SUB, "mt-0.5")}>
                {query.trim() ? "Thử gõ ngắn hơn, hoặc chọn Không có thương hiệu." : "Sàn chưa trả danh sách cho danh mục này."}
              </p>
            </div>
          ) : (
            items.map((b, index) => {
              const active = value?.id === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  data-index={index}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(b)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                    index === highlight ? "bg-muted" : "hover:bg-muted/60"
                  )}
                >
                  <Check className={cn("size-4 shrink-0", active ? "text-primary opacity-100" : "opacity-0")} />
                  <span className="min-w-0 truncate">{brandLabel(b.name)}</span>
                </button>
              );
            })
          )}
          {!loading && items.length >= 200 && (
            <div className={cn(TEXT_SUB, "px-3 py-1.5 text-center")}>Chỉ hiện 200 đầu — gõ thêm chữ để thu hẹp.</div>
          )}
        </div>
      )}
    </div>
  );
}
