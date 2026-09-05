"use client";

import { ArrowLeftRight, ArrowRight, ShoppingBag, Store, Warehouse } from "lucide-react";

import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * DẢI KỂ CHUYỆN — NGUYÊN LÝ KHO TRUNG TÂM (anh Trung 05/09: "trình bày phải kể
 * được câu chuyện thì seller mới dễ làm việc"; 06/09: bắt buộc giữ, đưa cả vào
 * tài liệu hướng dẫn). Câu chuyện chung cho MỌI seller nên dùng Shop A / B / C
 * và số tròn, không dùng tên shop thật:
 *
 *   [Kho 100 ↔ A 100 · B 100 · C 100]  →  Shop A bán 1 đơn  →  [Kho 99 ↔ A 99 · B 99 · C 99]
 *
 * Câu chốt bên dưới là điều quan trọng nhất: CÙNG MỘT SẢN PHẨM trên nhiều shop
 * thì đặt CÙNG MÃ SKU — Hubsell tự khớp, khác mã là phải nối tay.
 *
 * 06/09 (anh Trung chê phẳng): BỎ VIỀN LỒNG — mỗi ảnh chụp là MỘT mảng nền,
 * không đóng hộp ô Kho lẫn từng dòng shop nữa; chỉ mảng "sau" nhuộm xanh để
 * thấy cái gì đổi. Thuần trình bày, không tự đóng/mở: khối Thiết lập kho
 * (setup-guide.tsx) quyết định khi nào hiện, seller luôn có đường xem lại.
 */
export function HubStoryStrip() {
  /** Một trạng thái "kho ↔ 3 shop" — trước và sau khi Shop A bán 1 đơn. */
  const snapshot = (qty: number, after: boolean) => (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl px-4 py-3",
        after ? "bg-emerald-50 ring-1 ring-emerald-200/70" : "bg-muted/60"
      )}
    >
      <div className="shrink-0 text-center">
        <div className={cn(TEXT_SUB, "flex items-center justify-center gap-1")}>
          <Warehouse className="size-3.5" />
          Kho Hubsell
        </div>
        <div
          className={cn(
            "text-4xl font-semibold tabular-nums leading-none tracking-tight",
            after && "text-emerald-800"
          )}
        >
          {qty}
        </div>
        <div className={cn(TEXT_SUB, "mt-1")}>có thể bán</div>
      </div>
      <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground/70" />
      <div className="min-w-0 flex-1 divide-y divide-foreground/10">
        {(["Shop A", "Shop B", "Shop C"] as const).map((name) => (
          <div key={name} className="flex items-center gap-2 py-1 text-sm">
            <Store className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">AO-DEN-M</span>
            <span className="w-8 text-right font-semibold tabular-nums">{qty}</span>
            <span
              className={cn(
                "w-7 text-right text-[11px] font-medium tabular-nums",
                after ? "text-emerald-700" : "text-transparent"
              )}
            >
              −1
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Sơ đồ: trước → Shop A bán 1 đơn → sau (kho và mọi shop cùng trừ 1) */}
      <div className="grid items-center gap-3 md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]">
        {snapshot(100, false)}
        <div className="flex flex-col items-center justify-center gap-1 text-center">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
            <ShoppingBag className="size-3.5" />
            Shop A bán 1 đơn
          </span>
          <ArrowRight className="size-5 text-muted-foreground" />
          <span className={cn(TEXT_SUB, "leading-snug")}>
            kho và Shop B, C
            <br />
            tự trừ 1 theo
          </span>
        </div>
        {snapshot(99, true)}
      </div>

      {/* Một dòng duy nhất — điều quan trọng nhất (sơ đồ đã kể phần còn lại) */}
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200/70">
        <b>Cùng một sản phẩm bán trên nhiều shop: đặt cùng mã SKU trên sàn</b> để Hubsell
        tự khớp về một SKU kho. Khác mã thì phải nối tay và dễ nhầm.
      </p>
    </div>
  );
}
