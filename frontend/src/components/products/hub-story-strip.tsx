"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, ArrowRight, ShoppingBag, Store, Warehouse, X } from "lucide-react";

import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "hubsell_hub_story_dismissed_v2";

/**
 * DẢI KỂ CHUYỆN của hub Hàng hóa (anh Trung 05/09: "trình bày phải kể được câu
 * chuyện thì seller mới dễ làm việc"). Câu chuyện chung cho MỌI seller nên dùng
 * Shop A / B / C và số tròn, không dùng tên shop thật:
 *
 *   [Kho 100 ↔ A 100 · B 100 · C 100]  →  Shop A bán 1 đơn  →  [Kho 99 ↔ A 99 · B 99 · C 99]
 *
 * Ba ý bên dưới, ý số 2 là trọng tâm: CÙNG MỘT SẢN PHẨM trên nhiều shop thì đặt
 * CÙNG MÃ SKU — Hubsell tự khớp, khác mã là phải nối tay. Đóng được (localStorage).
 */
export function HubStoryStrip() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // không lưu được thì lần sau hiện lại — vô hại
    }
  }

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
    <div className="relative space-y-3 rounded-lg border bg-muted/30 p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Đóng phần giới thiệu"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>

      {/* Sơ đồ: trước → Shop A bán 1 đơn → sau (kho và mọi shop cùng trừ 1) */}
      <div className="grid items-center gap-2 pr-6 md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]">
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

      {/* Ba ý — ý 2 là trọng tâm */}
      <ol className="grid gap-2 pr-6 text-sm md:grid-cols-3">
        <li className="flex gap-2">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            1
          </span>
          <span>
            Một <b>SKU kho</b> là một sản phẩm thật. Bán trên bao nhiêu shop cũng chỉ có{" "}
            <b>một</b> số tồn.
          </span>
        </li>
        <li className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-medium text-amber-900">
            2
          </span>
          <span>
            <b>Cùng một sản phẩm trên nhiều shop thì đặt CÙNG MÃ SKU trên sàn.</b> Trùng
            mã là Hubsell tự khớp về đúng SKU kho; khác mã thì phải nối tay và dễ nhầm.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            3
          </span>
          <span>
            Nhập kho thêm 100, mọi shop cùng lên. Số trên mọi shop luôn bằng{" "}
            <b>Có thể bán</b> của kho.
          </span>
        </li>
      </ol>
    </div>
  );
}
