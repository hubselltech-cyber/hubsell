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
 * Thuần trình bày, không tự đóng/mở: khối Thiết lập kho (setup-guide.tsx) quyết
 * định khi nào hiện, seller luôn có đường xem lại.
 */
export function HubStoryStrip() {
  /** Một trạng thái "kho ↔ 3 shop" — trước và sau khi Shop A bán 1 đơn. */
  const snapshot = (qty: number, after: boolean) => (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg border p-2.5",
        after ? "border-emerald-200 bg-emerald-50/50" : "bg-background"
      )}
    >
      <div className="shrink-0 rounded-md border bg-background px-3 py-2 text-center">
        <div className={cn(TEXT_SUB, "flex items-center justify-center gap-1")}>
          <Warehouse className="size-3.5" />
          Kho Hubsell
        </div>
        <div className="text-2xl font-semibold tabular-nums leading-tight">{qty}</div>
        <div className={TEXT_SUB}>có thể bán</div>
      </div>
      <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 flex-1 gap-1">
        {(["Shop A", "Shop B", "Shop C"] as const).map((name) => (
          <div
            key={name}
            className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs"
          >
            <Store className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">AO-DEN-M</span>
            <span className="font-semibold tabular-nums">{qty}</span>
            {after && (
              <span className="rounded bg-emerald-100 px-1 text-[11px] font-medium text-emerald-800">
                −1
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Sơ đồ: trước → Shop A bán 1 đơn → sau (kho và mọi shop cùng trừ 1) */}
      <div className="grid items-center gap-2 md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]">
        {snapshot(100, false)}
        <div className="flex flex-col items-center justify-center gap-1 text-center">
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
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
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900">
        <b>Cùng một sản phẩm bán trên nhiều shop: đặt cùng mã SKU trên sàn</b> để Hubsell
        tự khớp về một SKU kho. Khác mã thì phải nối tay và dễ nhầm.
      </p>
    </div>
  );
}
