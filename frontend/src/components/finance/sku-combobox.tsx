"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, PackageSearch, Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { Product } from "@/lib/api";
import { matchesKeyword } from "@/lib/text";
import { TEXT_BODY, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

interface SkuComboboxProps {
  products: Product[];
  value: string; // mã SKU đang chọn ("" = chưa gắn SKU nào)
  onChange: (sku: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Dòng gợi ý khi KHO RỖNG (chưa có SKU nào) — ngữ cảnh gọi tự chỉ đường. */
  emptyHint?: string;
  /**
   * true = danh sách kết quả nằm TRONG luồng nội dung (đẩy phần dưới xuống)
   * thay vì nổi đè lên. Dùng trong dialog/modal: danh sách nổi sẽ tràn ra
   * ngoài khung thoại, đè lên nút bấm — nhìn như vỡ giao diện.
   */
  inlineList?: boolean;
}

/// Ô chọn SKU có TÌM KIẾM (autocomplete) — thay cho dropdown thường.
/// Gõ được cả mã SKU lẫn tên sản phẩm, không phân biệt hoa/thường và dấu tiếng Việt.
export function SkuCombobox({
  products,
  value,
  onChange,
  disabled,
  placeholder = "Gõ mã SKU hoặc tên sản phẩm để tìm…",
  emptyHint = "Tạo sản phẩm trong kho trước rồi quay lại chọn.",
  inlineList = false,
}: SkuComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  // Danh sách mở LÊN TRÊN khi dưới ô nhập không đủ chỗ (vd thanh liên kết
  // hàng loạt ghim sát đáy màn hình — mở xuống là chui ra ngoài viewport).
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = products.find((p) => p.skuCode === value) ?? null;

  // Lọc theo từ khoá (khớp mã SKU HOẶC tên sản phẩm)
  const filtered = useMemo(
    () => products.filter((p) => matchesKeyword(query, p.skuCode, p.productName)),
    [products, query]
  );

  // Bấm ra ngoài thì đóng danh sách
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Reset vị trí highlight mỗi khi kết quả lọc đổi
  useEffect(() => setHighlight(0), [query, open]);

  // Đo chỗ trống mỗi lần mở: dưới không đủ cho danh sách (max-h-64 ≈ 256px)
  // mà trên rộng hơn thì lật lên. Danh sách inline nằm trong luồng nội dung
  // nên không cần đo — không bao giờ tràn viewport.
  useEffect(() => {
    if (inlineList || !open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setDropUp(below < 280 && rect.top > below);
  }, [open, inlineList]);

  // Cuộn để mục đang chọn bằng bàn phím luôn nằm trong tầm nhìn
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function choose(sku: string) {
    onChange(sku);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault(); // không để Enter submit form
      const item = filtered[highlight];
      if (item) choose(item.skuCode);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  // Khi đang mở thì ô nhập hiển thị từ khoá; khi đóng thì hiển thị SKU đã chọn
  const inputValue = open
    ? query
    : selected
      ? `${selected.skuCode} — ${selected.productName}`
      : "";

  return (
    <div ref={containerRef} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        className="pl-9 pr-16"
        placeholder={placeholder}
        value={inputValue}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />

      {/* Nút xoá lựa chọn + mũi tên mở danh sách */}
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {value && !open && (
          <button
            type="button"
            aria-label="Bỏ gắn SKU"
            onClick={() => {
              onChange("");
              setQuery("");
            }}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </div>

      {/* Danh sách kết quả */}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          // Giới hạn chiều cao + cuộn dọc để không làm vỡ layout modal
          className={cn(
            "max-h-64 w-full overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1",
            inlineList
              ? "mt-2 max-h-56 shadow-sm" // trong dialog: nằm trong luồng, đẩy nút xuống
              : cn("absolute z-50 shadow-lg", dropUp ? "bottom-full mb-1" : "top-full mt-1")
          )}
        >
          {/* Lựa chọn bỏ gắn SKU */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()} // giữ focus, tránh blur trước click
            onClick={() => choose("")}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            {!value && <Check className="size-4 shrink-0" />}
            <span className={cn(!value && "font-medium text-foreground")}>
              — Không gắn SKU nào —
            </span>
          </button>

          {filtered.length === 0 ? (
            // Kho rỗng và không-khớp-từ-khoá là hai chuyện khác nhau — kho rỗng
            // mà khuyên "đổi từ khoá" thì người dùng tưởng chức năng hỏng.
            <div className="px-3 py-6 text-center">
              <PackageSearch className="mx-auto mb-2 size-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                {products.length === 0
                  ? "Kho vật lý chưa có SKU nào"
                  : "Không tìm thấy sản phẩm nào"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {products.length === 0
                  ? emptyHint
                  : "Thử đổi từ khoá tìm kiếm khác."}
              </p>
            </div>
          ) : (
            filtered.map((p, index) => {
              const active = p.skuCode === value;
              return (
                <button
                  key={p.id}
                  type="button"
                  data-index={index}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(p.skuCode)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors",
                    index === highlight ? "bg-muted" : "hover:bg-muted/60"
                  )}
                >
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      active ? "opacity-100 text-primary" : "opacity-0"
                    )}
                  />
                  <span className="min-w-0">
                    <span className={cn(TEXT_SUB, "block font-mono")}>
                      {p.skuCode}
                    </span>
                    <span className={cn(TEXT_BODY, "block truncate font-medium")}>
                      {p.productName}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
