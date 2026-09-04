"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Store, Warehouse, X } from "lucide-react";

import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "hubsell_hub_story_dismissed_v1";

/**
 * DẢI KỂ CHUYỆN của hub Hàng hóa (anh Trung 05/09: "trình bày phải kể được câu
 * chuyện thì seller mới dễ làm việc"). Ba ý, ý số 2 là trọng tâm: CÙNG MỘT SẢN
 * PHẨM trên nhiều shop thì đặt CÙNG MÃ SKU — Hubsell tự khớp, khác mã là phải
 * nối tay. Đóng được, nhớ trong localStorage của trình duyệt.
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

  const shop = (site: string, name: string, sku: string) => (
    <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs">
      <Store className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">
        <span className="text-muted-foreground">{site} · </span>
        {name}
      </span>
      <span className="ml-auto font-mono text-[11px] text-muted-foreground">{sku}</span>
      <span className="font-semibold tabular-nums">479</span>
    </div>
  );

  return (
    <div className="relative grid gap-4 rounded-lg border bg-muted/30 p-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Đóng phần giới thiệu"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>

      {/* Sơ đồ: kho ở giữa, các gian là gương */}
      <div className="flex items-center gap-3">
        <div className="shrink-0 rounded-lg border bg-background px-3 py-2.5 text-center">
          <div className={cn(TEXT_SUB, "flex items-center justify-center gap-1")}>
            <Warehouse className="size-3.5" />
            Kho Hubsell
          </div>
          <div className="text-2xl font-semibold tabular-nums leading-tight">479</div>
          <div className={TEXT_SUB}>có thể bán</div>
        </div>
        <ArrowLeftRight className="size-5 shrink-0 text-muted-foreground" />
        <div className="grid min-w-0 flex-1 gap-1.5">
          {shop("Shopee", "DarkMan", "TC008-DEN")}
          {shop("Shopee", "ANO", "TC008-DEN")}
          {shop("Lazada", "Hi.Bé", "TC008-DEN")}
        </div>
      </div>

      {/* Ba ý — ý 2 là trọng tâm */}
      <ol className="space-y-1.5 pr-6 text-sm">
        <li className="flex gap-2">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            1
          </span>
          <span>
            Một <b>SKU kho</b> là một sản phẩm thật. Nó có thể bán trên nhiều gian, nhiều
            sàn — nhưng chỉ có <b>một</b> số tồn.
          </span>
        </li>
        <li className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-900">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-medium text-amber-900">
            2
          </span>
          <span>
            <b>Cùng một sản phẩm trên nhiều shop thì đặt CÙNG MÃ SKU trên sàn.</b> Trùng
            mã là Hubsell tự khớp về đúng SKU kho; khác mã thì phải nối tay ở tab Chờ
            liên kết, và dễ nối nhầm.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            3
          </span>
          <span>
            Gian nào bán 1 chiếc, kho và mọi gian còn lại cùng trừ 1. Nhập kho 100, mọi
            gian cùng lên. Số trên mọi gian luôn bằng <b>Có thể bán</b> của kho.
          </span>
        </li>
      </ol>
    </div>
  );
}
