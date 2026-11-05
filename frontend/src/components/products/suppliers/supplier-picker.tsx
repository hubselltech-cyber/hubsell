"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { fetchSupplierOptions } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * Ô CHỌN NHÀ CUNG CẤP trên phiếu nhập (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 5).
 * Một ô gõ: gõ là lọc danh bạ; chọn nhà đã có, hoặc cứ để tên vừa gõ — tên chưa có sẽ được lưu vào
 * danh bạ khi ghi phiếu (không bắt khách sang trang khác tạo trước). Trùng tên (không phân hoa
 * thường) thì tự nhận nhà đã có. Danh sách tự cuộn, không dùng <select> gốc (có thể vài trăm nhà).
 */
export interface SupplierChoice {
  /** null = tên mới, chưa có trong danh bạ. */
  id: string | null;
  name: string;
}

export function SupplierPicker({
  value,
  onChange,
  id,
  className,
  disabled,
}: {
  value: SupplierChoice | null;
  onChange: (v: SupplierChoice | null) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const q = useApiQuery({ queryKey: qk.supplierOptions(), queryFn: fetchSupplierOptions });
  const options = q.data?.items ?? [];
  const text = value?.name ?? "";
  const needle = text.trim().toLowerCase();
  const filtered = (needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options).slice(0, 50);
  const isNew = Boolean(value && !value.id && needle);

  function type(v: string) {
    if (!v) {
      onChange(null);
      return;
    }
    const hit = options.find((o) => o.name.toLowerCase() === v.trim().toLowerCase());
    onChange({ id: hit?.id ?? null, name: v });
    setOpen(true);
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        value={text}
        disabled={disabled}
        autoComplete="off"
        placeholder="Chọn hoặc gõ tên nhà cung cấp"
        className={cn(text && "pr-8")}
        onChange={(e) => type(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {text && !disabled && (
        <button
          type="button"
          aria-label="Bỏ nhà cung cấp"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(null)}
        >
          <X className="size-4" />
        </button>
      )}
      {open && filtered.length > 0 && !(filtered.length === 1 && filtered[0].id === value?.id) && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover py-1 shadow-md">
          {filtered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className={cn("block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-muted", o.id === value?.id && "bg-muted font-medium")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ id: o.id, name: o.name });
                  setOpen(false);
                }}
              >
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {isNew && (!open || filtered.length === 0) && <p className={cn(TEXT_SUB, "absolute left-0 top-full mt-1 whitespace-nowrap")}>Nhà cung cấp mới — sẽ lưu vào danh bạ khi ghi phiếu.</p>}
    </div>
  );
}

/** Đổi lựa chọn trên ô thành tham số API: nhà đã có → id; tên mới → name; trống → không gửi gì. */
export function supplierChoiceToParams(c: SupplierChoice | null): { supplierId?: string; supplierName?: string } {
  if (!c) return {};
  if (c.id) return { supplierId: c.id };
  const name = c.name.trim();
  return name ? { supplierName: name } : {};
}
