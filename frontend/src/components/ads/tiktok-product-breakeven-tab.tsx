"use client";

// ============================================================
// TAB "HÒA VỐN SẢN PHẨM" — ROI hòa vốn của TỪNG sản phẩm trên gian TikTok
//
// Anh Trung 18/09/2026: một tab tính ROI hòa vốn, HOÀN TOÀN dựa vào Lãi/Lỗ thực hiện, chỉ lấy đơn giao thành công / hoàn
// thành công ĐÃ ĐỐI SOÁT — đơn chưa đối soát không tính. Backend dùng đúng phép tính hòa vốn của chiến dịch
// (integrations/tiktok-ads/breakeven.ts), chỉ đọc DB, không gọi TikTok → gian CHƯA nối quảng cáo vẫn xem được.
// Đây là nền cho phần gợi ý tạo quảng cáo về sau (cần xin thêm quyền Campaign của TikTok — làm sau).
//
// Bảng theo khẩu vị chuẩn của anh: hộp cuộn như Lãi/Lỗ + 20/50/100 dòng, sắp xếp ở tiêu đề cột, cột tiền trước cột %,
// chip lọc, mã sản phẩm + nút copy, kết luận từng dòng là CỘT riêng (trỏ chuột / bấm hiện lý do).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, ExternalLink, ImageOff, Search } from "lucide-react";
import { toast } from "sonner";

import { TIKTOK_SELLER_CENTER_ADS_URL, formatRoi } from "@/components/ads/tiktok-ads-format";
import { TIKTOK_ADVICE_TONE as ADVICE_TONE, TiktokAdviceBody, TiktokRunAdviceBody } from "@/components/ads/tiktok-advice-body";
import { TiktokBreakevenValue } from "@/components/ads/tiktok-breakeven";
import { PNL_STICKY_HEAD, PNL_TABLE_SCROLLER } from "@/components/finance/realized-pnl/cells";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  fetchTiktokProductAds,
  fetchTiktokProductBreakeven,
  type TiktokProductAdsData,
  type TiktokProductBreakevenRow,
  type TiktokProductBreakevenVerdict,
} from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

const PAGE_SIZES = [20, 50, 100];
const TH = "whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 font-medium";

type RowVerdict = TiktokProductBreakevenVerdict;
type AdsOf = TiktokProductAdsData["products"][string] | undefined;

/** Chẩn đoán ĐÃ kết luận được lãi / lỗ (các loại còn lại để nhận định của dòng sản phẩm nói — vd "Thiếu giá vốn" rõ hơn "Chưa kết luận được"). */
const DECIDED_ADVICE = new Set([
  "losing",
  "target_below",
  "budget_capped",
  "target_binding",
  "target_watching",
  "target_hold",
  "healthy",
  "learning",
  "no_delivery",
  "no_orders",
  "max_delivery_learning",
  "max_delivery_review",
]);
function decidedAdvice(ads: AdsOf) {
  const a = ads?.advice;
  return a && DECIDED_ADVICE.has(a.kind) ? a : null;
}

const VERDICT: Record<RowVerdict, { label: string; className: string }> = {
  ok: { label: "Đã có mốc hòa vốn", className: "bg-emerald-50 text-emerald-700" },
  target_below: { label: "Mục tiêu dưới hòa vốn", className: "bg-rose-50 text-red-500" },
  loss: { label: "Lỗ trước quảng cáo", className: "bg-rose-50 text-red-500" },
  low_sample: { label: "Ít đơn — tham khảo", className: "bg-amber-50 text-amber-700" },
  no_cost: { label: "Thiếu giá vốn", className: "bg-amber-50 text-amber-700" },
  no_settled: { label: "Chưa có đơn đối soát", className: "bg-slate-100 text-slate-500" },
};

// Ô THỐNG KÊ THEO VIỆC (08/11/2026 — anh Trung: 3 ô cũ chỉ dùng được "Hòa vốn toàn gian", muốn ô "Nên chạy / Chưa nên / Theo dõi"; khảo sát
// Google Merchant Center "Needs attention" 3 thẻ vấn đề tác động lớn nhất kèm số sản phẩm, bấm thẻ = lọc — docs/ADS-TIKTOK-GMV-MAX.md mục 9).
// Ô THAY chip lọc (không là nơi thứ ba nói cùng một điều — luật 19/09): bốn ô theo việc, đỏ đứng trước, phủ CẢ HAI nửa:
//   · đang chạy  → chẩn đoán chiến dịch (campaign-advice): Cần sửa ngay (lỗ / mục tiêu dưới hòa vốn) · Có thể tăng (ngân sách chặn, mục tiêu
//                  ghìm, không phân phối) · Theo dõi (khởi động, vừa đổi mục tiêu, giữ mục tiêu, Phân phối tối đa chưa đủ ngày / đến lúc đánh giá);
//   · chưa chạy  → bộ chấm product-run-advice: Nên chạy · Theo dõi (Chạy thử, ít đơn). "Chưa nên" không có việc để làm → chỉ là nhãn dòng.
// Chất lượng dữ liệu (thiếu giá vốn, chưa đủ đơn đối soát) không phải việc quảng cáo → dòng chữ nhỏ dưới ô, vẫn bấm lọc được.
type QuickKey = "all" | "attention" | "should_run" | "can_scale" | "watch" | "no_cost" | "waiting";
const SCALE_ADVICE = new Set(["budget_capped", "target_binding", "no_delivery"]);
const WATCH_ADVICE = new Set(["learning", "target_watching", "target_hold", "max_delivery_learning", "max_delivery_review"]);
const inQuick = (k: QuickKey, v: RowVerdict, p: TiktokProductBreakevenRow, ads: AdsOf) => {
  if (k === "all") return true;
  const a = decidedAdvice(ads);
  switch (k) {
    case "attention":
      return v === "target_below" || v === "loss" || a?.tone === "warn";
    case "can_scale":
      return !!a && SCALE_ADVICE.has(a.kind) && a.tone !== "warn";
    case "watch":
      return a ? WATCH_ADVICE.has(a.kind) && a.tone !== "warn" : p.runAdvice?.tier === "test" || v === "low_sample";
    case "should_run":
      return !a && p.runAdvice?.tier === "run";
    case "no_cost":
      return v === "no_cost";
    case "waiting":
      return v === "no_settled";
  }
};
const hasBreakeven = (v: RowVerdict) => v === "ok" || v === "target_below";
/** Lãi/lỗ ước tính 30 ngày của phần quảng cáo = doanh thu GMV Max × biên lãi trước quảng cáo − chi phí (cùng công thức tiktokEstProfit backend). */
const estAdsProfit = (p: TiktokProductBreakevenRow, ads: AdsOf): number | null =>
  ads && ads.cost > 0 && p.breakeven.margin != null ? ads.gmv * p.breakeven.margin - ads.cost : null;

const ACTION_CARDS: { key: Exclude<QuickKey, "all" | "no_cost" | "waiting">; label: string; hint: string; tone: "warn" | "ok" | "info" | "muted" }[] = [
  { key: "attention", label: "Cần sửa ngay", hint: "Đang chạy mà lỗ hoặc mục tiêu đặt dưới hòa vốn.", tone: "warn" },
  { key: "should_run", label: "Nên chạy quảng cáo", hint: "Chưa chạy, hòa vốn tin được, tồn và đà bán đủ.", tone: "ok" },
  { key: "can_scale", label: "Có thể tăng", hint: "Đang lãi nhưng ngân sách chặn hoặc mục tiêu đang ghìm.", tone: "info" },
  { key: "watch", label: "Theo dõi", hint: "Chạy thử, đang khởi động, vừa đổi mục tiêu, ít đơn.", tone: "muted" },
];
const CARD_TONE: Record<(typeof ACTION_CARDS)[number]["tone"], { num: string; active: string }> = {
  warn: { num: "text-red-500", active: "border-red-300 ring-2 ring-red-100 dark:ring-red-900/40" },
  ok: { num: "text-emerald-600", active: "border-emerald-300 ring-2 ring-emerald-100 dark:ring-emerald-900/40" },
  info: { num: "text-sky-600", active: "border-sky-300 ring-2 ring-sky-100 dark:ring-sky-900/40" },
  muted: { num: "text-slate-700", active: "border-slate-400 ring-2 ring-slate-200 dark:ring-slate-700" },
};

type SortKey = "revenue" | "margin" | "roi" | "adCost";
const SORT_COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "revenue", label: "Doanh thu", title: "Doanh thu của các đơn đã đối soát có giá vốn, cộng đơn hủy cùng kỳ (TikTok vẫn đếm đơn hủy vào doanh thu quảng cáo)." },
  { key: "margin", label: "Biên lãi", title: "Lãi trước quảng cáo ÷ doanh thu (lợi nhuận trên Lãi/Lỗ thực hiện, đã cộng ngược phí GMV Max TikTok trừ trong từng đơn). Trỏ chuột vào từng ô để xem số tiền lãi." },
  { key: "roi", label: "ROI hòa vốn", title: "= 1 ÷ biên lãi trước quảng cáo. ROI quảng cáo của sản phẩm thấp hơn mức này là quảng cáo đang ăn vào vốn." },
];
const sortValue = (p: TiktokProductBreakevenRow, k: SortKey, ads: AdsOf): number | null =>
  k === "revenue"
    ? p.revenue + p.missingCostRevenue
    : k === "margin"
      ? p.breakeven.margin
      : k === "adCost"
        ? ads && ads.cost > 0
          ? ads.cost
          : null
        : p.breakeven.roi;

export function TiktokProductBreakevenTab({ initialChannelId }: { initialChannelId: string }) {
  const [channelId, setChannelId] = useState(initialChannelId);
  const [quick, setQuick] = useState<QuickKey>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "revenue", dir: "desc" });
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const q = useApiQuery({
    queryKey: qk.tiktokProductBreakeven(channelId),
    queryFn: () => fetchTiktokProductBreakeven(channelId || undefined),
    staleTime: 5 * 60_000,
  });
  const data = q.data;
  const products = useMemo(() => data?.products ?? [], [data?.products]);
  // Số quảng cáo thật gọi TikTok (1 call / chiến dịch đang chạy) → chỉ gọi SAU khi bảng hòa vốn đã lên, lỗi thì bảng vẫn dùng được.
  const adsQ = useApiQuery({
    queryKey: qk.tiktokProductAds(data?.selectedChannelId ?? ""),
    queryFn: () => fetchTiktokProductAds(data?.selectedChannelId ?? undefined),
    enabled: !!data?.selectedChannelId,
    staleTime: 10 * 60_000,
  });
  const ads = adsQ.data;

  useEffect(() => setPage(0), [quick, search, sort, channelId]);

  // Số đếm + số tiền của từng ô: Cần sửa ngay = lỗ ước tính 30 ngày của phần quảng cáo; Có thể tăng = lãi ước tính 30 ngày; Nên chạy = số
  // sản phẩm bán ra 30 ngày của nhóm (tiềm năng); Theo dõi chỉ đếm.
  const counts = useMemo(() => {
    const c: Record<QuickKey, number> = { all: products.length, attention: 0, should_run: 0, can_scale: 0, watch: 0, no_cost: 0, waiting: 0 };
    const money = { attention: 0, can_scale: 0, should_run_units: 0 };
    for (const p of products) {
      const a = ads?.products[p.productId];
      for (const k of ["attention", "should_run", "can_scale", "watch", "no_cost", "waiting"] as QuickKey[]) {
        if (!inQuick(k, p.verdict, p, a)) continue;
        c[k]++;
        if (k === "attention") money.attention += Math.min(0, estAdsProfit(p, a) ?? 0);
        if (k === "can_scale") money.can_scale += Math.max(0, estAdsProfit(p, a) ?? 0);
        if (k === "should_run") money.should_run_units += p.units30d;
      }
    }
    return { ...c, money };
  }, [products, ads]);
  const withBreakeven = useMemo(() => products.filter((p) => hasBreakeven(p.verdict)).length, [products]);
  /** Nửa "đang chạy" chỉ có số sau khi gọi TikTok xong → ô Cần sửa / Có thể tăng hiện dấu chờ trong lúc đó. */
  const adsPending = !!data?.selectedChannelId && adsQ.loading && !ads;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const sign = sort.dir === "desc" ? -1 : 1;
    return products
      .filter((p) => inQuick(quick, p.verdict, p, ads?.products[p.productId]) && (!needle || p.name.toLowerCase().includes(needle) || p.productId.includes(needle)))
      .sort((a, b) => {
        const x = sortValue(a, sort.key, ads?.products[a.productId]);
        const y = sortValue(b, sort.key, ads?.products[b.productId]);
        // Dòng chưa có số luôn xếp cuối, bất kể chiều sắp xếp.
        const sold = (p: TiktokProductBreakevenRow) => p.revenue + p.missingCostRevenue;
        if (x == null || y == null) return x == null && y == null ? sold(b) - sold(a) : x == null ? 1 : -1;
        return sign * (x - y) || sold(b) - sold(a);
      });
  }, [products, quick, search, sort, ads]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      toast.error("Trình duyệt không cho sao chép. Hãy bôi đen mã sản phẩm rồi Ctrl+C.");
    }
  }

  if (q.error) return <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{q.error}</div>;
  if (!data) return <p className="py-10 text-center text-sm text-muted-foreground">Đang tính hòa vốn từ Lãi/Lỗ thực hiện…</p>;

  const toggleQuick = (k: QuickKey) => setQuick((cur) => (cur === k ? "all" : k));
  const cardMoney = (k: (typeof ACTION_CARDS)[number]["key"]): string | null => {
    if (k === "attention") return counts.money.attention < 0 ? `lỗ ước tính ${formatVND(-counts.money.attention)} / 30 ngày` : null;
    if (k === "can_scale") return counts.money.can_scale > 0 ? `đang lãi ${formatVND(counts.money.can_scale)} / 30 ngày` : null;
    if (k === "should_run") return counts.should_run > 0 ? `bán ${formatNumber(counts.money.should_run_units)} sản phẩm / 30 ngày` : null;
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className={cn(TEXT_SUB, "max-w-3xl flex-1")}>
          ROI hòa vốn = 1 ÷ biên lãi trước quảng cáo, lấy từ <span className="font-medium text-slate-700">Lãi/Lỗ thực hiện</span> của{" "}
          {data.windowDays} ngày gần nhất và chỉ tính đơn <span className="font-medium text-slate-700">đã đối soát</span> (giao thành công hoặc
          hoàn xong). Đơn đang giao, chờ đối soát chưa được tính. Quảng cáo của sản phẩm có ROI thấp hơn mức này là đang ăn vào vốn.
        </p>
        {data.channels.length > 1 && (
          <NativeSelect value={data.selectedChannelId ?? ""} onChange={(e) => setChannelId(e.target.value)} aria-label="Chọn gian hàng TikTok" className="w-52">
            {data.channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.shopName}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      {/* BỐN Ô THEO VIỆC — bấm ô = lọc bảng, bấm lại = bỏ lọc; ô 0 mờ đi chứ không ẩn ("không có gì phải sửa" cũng là một kết quả). */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ACTION_CARDS.map((card) => {
          const n = counts[card.key];
          const active = quick === card.key;
          const pending = adsPending && (card.key === "attention" || card.key === "can_scale" || card.key === "watch");
          const money = cardMoney(card.key);
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => toggleQuick(card.key)}
              aria-pressed={active}
              className={cn(
                "rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted/60",
                active ? CARD_TONE[card.tone].active : "border-border",
                n === 0 && !pending && !active && "opacity-60"
              )}
            >
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums", n > 0 ? CARD_TONE[card.tone].num : "text-slate-400")}>
                {formatNumber(n)} <span className="text-base font-normal text-slate-400">sản phẩm</span>
                {pending && <span className="ml-1.5 text-xs font-normal text-slate-400">đang đọc TikTok…</span>}
              </p>
              <p className={cn(TEXT_SUB, "mt-1 truncate")} title={card.hint}>
                {money ?? card.hint}
              </p>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Chất lượng dữ liệu — không phải việc quảng cáo nên để chữ nhỏ, vẫn bấm lọc được. */}
            <p className={cn(TEXT_SUB, "flex flex-wrap items-center gap-x-3 gap-y-1")}>
              <span>
                Hòa vốn toàn gian <TiktokBreakevenValue breakeven={data.shop} className="font-semibold text-slate-900" />
              </span>
              <span className="text-slate-300">·</span>
              <span>
                {formatNumber(withBreakeven)}/{formatNumber(products.length)} sản phẩm đã có mốc riêng (từ {data.minOrders} đơn đã đối soát)
              </span>
              {(counts.no_cost > 0 || quick === "no_cost") && (
                <>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => toggleQuick("no_cost")} className={cn("underline decoration-dotted underline-offset-2", quick === "no_cost" ? "font-semibold text-slate-900" : "text-amber-700")}>
                    {formatNumber(counts.no_cost)} thiếu giá vốn
                  </button>
                  <Link href="/finance/cost-prices" className="font-medium text-slate-900 underline underline-offset-2">
                    Nhập giá vốn
                  </Link>
                </>
              )}
              {(counts.waiting > 0 || quick === "waiting") && (
                <>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => toggleQuick("waiting")} className={cn("underline decoration-dotted underline-offset-2", quick === "waiting" ? "font-semibold text-slate-900" : "text-slate-500")}>
                    {formatNumber(counts.waiting)} chưa đủ đơn đối soát
                  </button>
                </>
              )}
              {quick !== "all" && (
                <>
                  <span className="text-slate-300">·</span>
                  <button type="button" onClick={() => setQuick("all")} className="font-medium text-slate-900 underline underline-offset-2">
                    Bỏ lọc, xem tất cả {formatNumber(products.length)}
                  </button>
                </>
              )}
            </p>
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm tên hoặc mã sản phẩm" className="pl-8" />
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {products.length === 0 ? `Gian chưa có đơn nào trong ${data.windowDays} ngày gần nhất.` : "Không có sản phẩm nào khớp bộ lọc."}
            </p>
          ) : (
            <div className={cn("min-w-0 rounded-lg border", PNL_TABLE_SCROLLER)}>
              <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-sm">
                <thead className={PNL_STICKY_HEAD}>
                  <tr className={cn(TEXT_TABLE_HEAD, "text-left")}>
                    <th className={TH}>Sản phẩm</th>
                    {SORT_COLUMNS.map((col) => {
                      const active = sort.key === col.key;
                      const Icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
                      return (
                        <th key={col.key} className={cn(TH, "text-right")} title={col.title} aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
                          <button
                            type="button"
                            onClick={() => setSort(active ? { key: col.key, dir: sort.dir === "desc" ? "asc" : "desc" } : { key: col.key, dir: "desc" })}
                            className={cn("inline-flex items-center gap-1 font-medium hover:text-slate-900", active && "text-slate-900")}
                          >
                            {col.label}
                            <Icon className={cn("size-3.5", active ? "text-slate-900" : "text-slate-400")} />
                          </button>
                        </th>
                      );
                    })}
                    {ads?.linked && (
                      <th
                        className={cn(TH, "text-right")}
                        title="Tiền quảng cáo GMV Max của sản phẩm trong các chiến dịch đang chạy, 30 ngày gần nhất (số của TikTok), kèm số đơn."
                        aria-sort={sort.key === "adCost" ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
                      >
                        <button
                          type="button"
                          onClick={() => setSort(sort.key === "adCost" ? { key: "adCost", dir: sort.dir === "desc" ? "asc" : "desc" } : { key: "adCost", dir: "desc" })}
                          className={cn("inline-flex items-center gap-1 font-medium hover:text-slate-900", sort.key === "adCost" && "text-slate-900")}
                        >
                          Chi quảng cáo 30 ngày
                          {sort.key !== "adCost" ? (
                            <ArrowUpDown className="size-3.5 text-slate-400" />
                          ) : sort.dir === "desc" ? (
                            <ArrowDown className="size-3.5 text-slate-900" />
                          ) : (
                            <ArrowUp className="size-3.5 text-slate-900" />
                          )}
                        </button>
                      </th>
                    )}
                    <th
                      className={TH}
                      title="Chiến dịch GMV Max đang chứa sản phẩm: ROI mục tiêu đang đặt và ROI thật 30 ngày gần nhất (số của TikTok). Doanh thu GMV Max gồm cả đơn tự nhiên nên ROI riêng của quảng cáo chỉ có thể thấp hơn."
                    >
                      Quảng cáo
                    </th>
                    <th className={TH}>Nhận định</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => {
                    const has = p.breakeven.orders > 0;
                    const a = ads?.products[p.productId];
                    const v = p.verdict;
                    // Sản phẩm ĐANG CHẠY quảng cáo: nhãn + lý do = đúng chẩn đoán của trang chiến dịch (hai trang nói cùng một câu — anh Trung 19/09).
                    const adv = decidedAdvice(a);
                    // Sản phẩm CHƯA chạy mà hòa vốn đã tin được: nói luôn Nên chạy / Chạy thử / Chưa nên (anh Trung 19/09: "Đã có mốc hòa vốn"
                    // chưa phải là gợi ý) — dữ kiện + kết luận từ backend product-run-advice.ts, trình bày chung khuôn ô lý do.
                    const run = adv ? null : (p.runAdvice ?? null);
                    const vd = adv ? { label: adv.label, className: ADVICE_TONE[adv.tone] } : run ? { label: run.label, className: ADVICE_TONE[run.tone] } : VERDICT[v];
                    const camp = p.campaigns[0];
                    const runningCamp = p.campaigns.find((c) => c.status === "ongoing" && c.roasTarget != null);
                    // Nhịp 7 ngày so với nhịp trung bình 30 ngày (quy về /ngày). Mốc 1,2 / 0,8 và "tồn dưới 14 ngày" dùng ĐÚNG số của bộ
                    // chấm gợi ý Shopee (ads-recommend.ts: momentum, minCoverDays) — cùng một khái niệm thì cùng một ngưỡng.
                    const pace = p.units30d > 0 ? p.units7d / 7 / (p.units30d / 30) : null;
                    const coverDays = p.stock != null && p.units30d > 0 ? Math.floor(p.stock / (p.units30d / 30)) : null;
                    return (
                      <tr key={p.productId} className="[&>td]:border-b [&>td]:border-slate-200/80">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-3">
                            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-400">
                              {p.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element -- ảnh sàn, không qua tối ưu ảnh của Next
                                <img src={p.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
                              ) : (
                                <ImageOff className="size-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="max-w-56 truncate text-slate-900" title={p.name}>
                                {p.name || "Sản phẩm chưa có tên"}
                              </p>
                              <button
                                type="button"
                                onClick={() => void copyId(p.productId)}
                                title="Sao chép mã sản phẩm"
                                className="group inline-flex items-center gap-1 text-xs tabular-nums text-slate-500 hover:text-slate-900"
                              >
                                {p.productId}
                                {copiedId === p.productId ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5 text-slate-400 group-hover:text-slate-900" />}
                                {p.skuCount > 1 && <span className="text-slate-400">· {formatNumber(p.skuCount)} phân loại</span>}
                              </button>
                              <p className="text-xs text-slate-400" title="Số sản phẩm bán ra 7 / 30 ngày gần nhất (mọi đơn đặt, trừ đơn hủy) · tồn trên sàn đủ bán bao nhiêu ngày theo nhịp 30 ngày">
                                bán {formatNumber(p.units7d)} / {formatNumber(p.units30d)}
                                {pace != null && pace >= 1.2 && <span className="text-emerald-600"> ▲ đang lên</span>}
                                {pace != null && pace <= 0.8 && <span className="text-red-500"> ▼ đang chậm lại</span>}
                                {coverDays != null && <span className={cn(coverDays < 14 && "text-amber-600")}> · tồn đủ ~{formatNumber(coverDays)} ngày</span>}
                                {coverDays == null && p.stock != null && <> · tồn {formatNumber(p.stock)}</>}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {/* Anh Trung 19/09: bỏ dòng vàng "+… thiếu giá vốn" — cột Nhận định đã nói. Sản phẩm CHƯA có giá vốn cho đơn nào vẫn
                              hiện doanh thu (xám — chưa vào phép tính) để thứ tự "bán nhiều đứng trước" không thành một hàng gạch ngang. */}
                          {p.revenue > 0 ? (
                            <Money value={p.revenue} className="text-slate-700" />
                          ) : p.missingCostRevenue > 0 ? (
                            <span title="Doanh thu đã đối soát nhưng chưa có giá vốn — chưa vào phép tính hòa vốn">
                              <Money value={p.missingCostRevenue} className="text-slate-400" />
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td
                          className={cn("px-3 py-2 text-right tabular-nums", p.breakeven.margin != null && p.breakeven.margin < 0 ? "text-red-500" : "text-slate-700")}
                          title={has ? `Lãi trước quảng cáo ${formatVND(p.profitBeforeAds)} trên ${formatVND(p.revenue)} doanh thu đã đối soát` : undefined}
                        >
                          {p.breakeven.margin != null ? `${(p.breakeven.margin * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%` : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <TiktokBreakevenValue breakeven={p.breakeven} className={cn("font-semibold", p.verdict === "low_sample" && "text-slate-400")} />
                        </td>
                        {ads?.linked && (
                          <td className="px-3 py-2 text-right">
                            {a && a.cost > 0 ? (
                              <>
                                <Money value={a.cost} className="text-slate-700" />
                                <span className="block text-xs text-slate-400">{formatNumber(a.orders)} đơn</span>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2">
                          {camp ? (
                            <>
                              <Link href={`/ads/tiktok/campaign?id=${camp.id}`} className="block max-w-44 truncate text-slate-900 underline decoration-dotted underline-offset-2" title={camp.name}>
                                {camp.name || "Chiến dịch"}
                              </Link>
                              <span className="block text-xs text-slate-500">
                                {camp.status !== "ongoing" && "Tạm dừng"}
                                {camp.status === "ongoing" && (camp.roasTarget != null ? `mục tiêu ${formatRoi(camp.roasTarget)}` : "phân phối tối đa")}
                                {a && a.cost > 0 && (
                                  <>
                                    {" · thực "}
                                    <span className={cn("font-medium tabular-nums", adv?.kind === "losing" ? "text-red-500" : "text-slate-700")}>{formatRoi(a.roi)}</span>
                                  </>
                                )}
                                {p.campaigns.length > 1 && ` · +${p.campaigns.length - 1}`}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-400">Chưa chạy</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Popover>
                            <PopoverTrigger openOnHover delay={80} render={<button type="button" className="cursor-pointer rounded-full" aria-label={`Lý do: ${vd.label}`} />}>
                              <Badge className={cn(vd.className, "underline decoration-dotted underline-offset-2")}>{vd.label}</Badge>
                            </PopoverTrigger>
                            <PopoverContent align="end" className={cn("gap-1.5 p-3 text-sm", run ? "w-[28rem] max-w-[calc(100vw-2rem)]" : "w-96")}>
                              <p className="font-semibold text-slate-900">{vd.label}</p>
                              {adv ? <TiktokAdviceBody advice={adv} /> : run ? <TiktokRunAdviceBody advice={run} /> : <p className="text-slate-700">{p.reason}</p>}
                              <p className="text-xs text-slate-500">
                                {formatNumber(p.breakeven.orders)} đơn đã đối soát
                                {p.breakeven.pendingOrders > 0 && ` · +${formatNumber(p.breakeven.pendingOrders)} đang giao / chờ đối soát (chưa tính)`}
                              </p>
                              {p.missingCostRevenue > 0 && (
                                <p className="text-amber-600">
                                  <Money value={p.missingCostRevenue} /> doanh thu đã đối soát chưa có giá vốn — chưa vào phép tính.
                                </p>
                              )}
                              {/* Sản phẩm đang nằm trong chiến dịch CHẠY: ROI mục tiêu chỉ sửa được trong Seller Center (chiến dịch tạo ở đó
                                  không sửa được qua API — probe 19/09/2026) → đưa khách tới đúng nơi, kèm tên chiến dịch cần tìm. */}
                              {adv && a?.adviceCampaign && <p className="text-xs text-slate-500">Theo chiến dịch {a.adviceCampaign} · số quảng cáo 30 ngày gần nhất.</p>}
                              {run && run.tier !== "not_yet" && (
                                <a
                                  href={TIKTOK_SELLER_CENTER_ADS_URL}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-1 inline-flex items-center gap-1.5 font-medium text-slate-900 underline decoration-dotted underline-offset-2 hover:decoration-solid"
                                >
                                  <ExternalLink className="size-3.5" />
                                  Tạo chiến dịch trong Seller Center
                                </a>
                              )}
                              {runningCamp && (adv ? adv.editInSellerCenter : v === "target_below" || v === "ok") && (
                                <a
                                  href={TIKTOK_SELLER_CENTER_ADS_URL}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-1 inline-flex items-center gap-1.5 font-medium text-slate-900 underline decoration-dotted underline-offset-2 hover:decoration-solid"
                                  title={`Seller Center → Quảng cáo cửa hàng → chiến dịch "${runningCamp.name}"`}
                                >
                                  <ExternalLink className="size-3.5" />
                                  Sửa chiến dịch trong Seller Center
                                </a>
                              )}
                            </PopoverContent>
                          </Popover>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Hiển thị</span>
                <NativeSelect className="w-20" aria-label="Số dòng mỗi trang" value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))}>
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </NativeSelect>
                <span className="text-sm text-muted-foreground">
                  dòng/trang · {formatNumber(rows.length)} sản phẩm · trang {safePage + 1}/{pageCount}
                </span>
              </div>
              {pageCount > 1 && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                    Trước
                  </Button>
                  <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
                    Sau
                  </Button>
                </div>
              )}
            </div>
          )}
          <p className={TEXT_SUB}>
            Chỉ liệt kê sản phẩm có đơn trong {data.windowDays} ngày. Đơn nhiều sản phẩm chia doanh thu và lãi theo tỷ trọng giá trị hàng. Cột “Chiến dịch đang chứa”
            theo danh sách sản phẩm của từng chiến dịch GMV Max mà Hubsell đã đọc được.
            {adsQ.error && ` Chưa lấy được ROI quảng cáo từ TikTok: ${adsQ.error}`}
            {ads && !ads.linked && " Gian chưa kết nối tài khoản quảng cáo nên chưa có cột ROI quảng cáo."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
