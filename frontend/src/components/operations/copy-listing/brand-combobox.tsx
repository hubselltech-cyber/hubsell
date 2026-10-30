"use client";

// ============================================================
// Ô chọn THƯƠNG HIỆU có tìm kiếm — thay <select> gốc (30/10/2026, khách báo:
// Safari/macOS xổ danh sách hàng nghìn thương hiệu không gõ tìm được, không thấy
// thanh cuộn). Gõ → hỏi lại gian đích (`/brands?q=`), danh sách cuộn có thanh
// cuộn LUÔN HIỆN (macOS ẩn thanh cuộn overlay), chọn bằng chuột hoặc ↑↓ Enter.
// 30/10 chiều (khách Bunchar lần 3): gõ "BUNCHAR" ra 0 hãng → Enter từng chọn
// No Brand rồi xóa chữ khách gõ. Nay: không khớp thì Enter KHÔNG chọn gì, chữ
// giữ nguyên, hộp nói rõ Shopee chỉ nhận thương hiệu đã đăng ký cho đúng danh mục.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { fetchCopyListingBrands } from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { WARN_INPUT } from "./primitives";
import { brandLabel } from "./shared";

export interface BrandValue {
  id: string;
  name: string;
  /** Backend ghi chú (vd hãng đang dùng trên gian, không có trong danh sách danh mục). */
  note?: string;
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

  /** Đóng hộp; GIỮ chữ đã gõ (mở lại thấy ngay) trừ khi vừa chọn xong. */
  function close(clearQuery = false) {
    setOpen(false);
    if (clearQuery) setQuery("");
  }

  /** Có hãng thật khớp từ khóa (ngoài No Brand)? */
  const q = query.trim();
  const realMatches = items.filter((b) => !/^no ?brand$/i.test(b.name));
  const noMatch = Boolean(q) && !loading && realMatches.length === 0;

  function choose(b: BrandValue | null) {
    onChange(b);
    close(true);
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
      // Gõ tên mà không khớp hãng nào → Enter không được lặng lẽ chọn No Brand rồi xóa chữ.
      if (noMatch) return;
      const it = items[highlight];
      if (it) choose(it);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const shown = open ? query : value ? brandLabel(value.name) : query;

  return (
    <div ref={boxRef} className="relative min-w-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        className={cn("pl-9 pr-16", invalid && WARN_INPUT)}
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
                  <span className="min-w-0 flex-1 truncate">
                    {brandLabel(b.name)}
                    {b.note && <span className={cn(TEXT_SUB, "ml-1.5")}>· {b.note}</span>}
                  </span>
                </button>
              );
            })
          )}
          {!loading && items.length >= 200 && (
            <div className={cn(TEXT_SUB, "px-3 py-1.5 text-center")}>Chỉ hiện 200 đầu — gõ thêm chữ để thu hẹp.</div>
          )}
          {noMatch && items.length > 0 && (
            <div className={cn(TEXT_SUB, "whitespace-normal border-t px-3 py-2")}>
              Sàn không có thương hiệu &ldquo;{q}&rdquo; trong danh mục này. Shopee chỉ nhận thương hiệu đã đăng ký với sàn cho đúng danh
              mục — chọn <span className="text-foreground">Không có thương hiệu</span>, hoặc đăng ký thương hiệu trên Seller Centre rồi quay lại.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
