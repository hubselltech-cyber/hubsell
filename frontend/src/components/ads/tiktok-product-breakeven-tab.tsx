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

/** "ads_losing" chỉ có ở FE: ghép số quảng cáo thật (endpoint riêng, gọi TikTok) với mốc hòa vốn của sản phẩm. */
type RowVerdict = TiktokProductBreakevenVerdict | "ads_losing";
type AdsOf = TiktokProductAdsData["products"][string] | undefined;

/** Quảng cáo ĐANG LỖ: 30 ngày qua có tiêu tiền và ROI thật thấp hơn hòa vốn ĐÃ TIN ĐƯỢC của sản phẩm. Đứng trên mọi nhận định "ổn". */
function rowVerdict(p: TiktokProductBreakevenRow, ads: AdsOf): RowVerdict {
  const trusted = p.verdict === "ok" || p.verdict === "target_below";
  if (trusted && ads && ads.cost > 0 && ads.roi != null && p.breakeven.roi != null && ads.roi < p.breakeven.roi) return "ads_losing";
  return p.verdict;
}

const VERDICT: Record<RowVerdict, { label: string; className: string }> = {
  ads_losing: { label: "Quảng cáo đang lỗ", className: "bg-rose-50 text-red-500" },
  ok: { label: "Đã có mốc hòa vốn", className: "bg-emerald-50 text-emerald-700" },
  target_below: { label: "Mục tiêu dưới hòa vốn", className: "bg-rose-50 text-red-500" },
  loss: { label: "Lỗ trước quảng cáo", className: "bg-rose-50 text-red-500" },
  low_sample: { label: "Ít đơn — tham khảo", className: "bg-amber-50 text-amber-700" },
  no_cost: { label: "Thiếu giá vốn", className: "bg-amber-50 text-amber-700" },
  no_settled: { label: "Chưa có đơn đối soát", className: "bg-slate-100 text-slate-500" },
};

type QuickKey = "all" | "ok" | "attention" | "no_cost" | "waiting";
const inQuick = (k: QuickKey, v: RowVerdict) =>
  k === "all" ||
  (k === "ok" && v === "ok") ||
  (k === "attention" && (v === "ads_losing" || v === "target_below" || v === "loss")) ||
  (k === "no_cost" && v === "no_cost") ||
  (k === "waiting" && (v === "low_sample" || v === "no_settled"));

type SortKey = "orders" | "revenue" | "profit" | "margin" | "roi";
const SORT_COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "orders", label: "Đơn đối soát", title: "Số đơn ĐÃ ĐỐI SOÁT (giao thành công / hoàn xong) góp vào phép tính." },
  { key: "revenue", label: "Doanh thu", title: "Doanh thu của các đơn đã đối soát có giá vốn, cộng đơn hủy cùng kỳ (TikTok vẫn đếm đơn hủy vào doanh thu quảng cáo)." },
  { key: "profit", label: "Lãi trước QC", title: "Lãi trước quảng cáo: lợi nhuận trên Lãi/Lỗ thực hiện, đã cộng ngược phí GMV Max TikTok trừ trong từng đơn." },
  { key: "margin", label: "Biên lãi" },
  { key: "roi", label: "ROI hòa vốn", title: "= 1 ÷ biên lãi trước quảng cáo. ROI quảng cáo của sản phẩm thấp hơn mức này là quảng cáo đang ăn vào vốn." },
];
const sortValue = (p: TiktokProductBreakevenRow, k: SortKey): number | null =>
  k === "orders"
    ? p.breakeven.orders
    : k === "revenue"
      ? p.revenue + p.missingCostRevenue
      : k === "profit"
        ? p.breakeven.orders > 0
          ? p.profitBeforeAds
          : null
        : k === "margin"
          ? p.breakeven.margin
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
  const verdictOf = useMemo(() => {
    const m = new Map<string, RowVerdict>();
    for (const p of products) m.set(p.productId, rowVerdict(p, ads?.products[p.productId]));
    return m;
  }, [products, ads]);

  useEffect(() => setPage(0), [quick, search, sort, channelId]);

  const counts = useMemo(() => {
    const c: Record<QuickKey, number> = { all: products.length, ok: 0, attention: 0, no_cost: 0, waiting: 0 };
    for (const p of products) for (const k of ["ok", "attention", "no_cost", "waiting"] as QuickKey[]) if (inQuick(k, verdictOf.get(p.productId) ?? p.verdict)) c[k]++;
    return c;
  }, [products, verdictOf]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const sign = sort.dir === "desc" ? -1 : 1;
    return products
      .filter((p) => inQuick(quick, verdictOf.get(p.productId) ?? p.verdict) && (!needle || p.name.toLowerCase().includes(needle) || p.productId.includes(needle)))
      .sort((a, b) => {
        const x = sortValue(a, sort.key);
        const y = sortValue(b, sort.key);
        // Dòng chưa có số luôn xếp cuối, bất kể chiều sắp xếp.
        const sold = (p: TiktokProductBreakevenRow) => p.revenue + p.missingCostRevenue;
        if (x == null || y == null) return x == null && y == null ? sold(b) - sold(a) : x == null ? 1 : -1;
        return sign * (x - y) || sold(b) - sold(a);
      });
  }, [products, quick, search, sort, verdictOf]);

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

  const chips: { key: QuickKey; label: string }[] = [
    { key: "all", label: "Tất cả" },
    { key: "ok", label: "Đã có mốc hòa vốn" },
    { key: "attention", label: "Cần xem ngay" },
    { key: "no_cost", label: "Thiếu giá vốn" },
    { key: "waiting", label: "Chưa đủ đơn đối soát" },
  ];

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

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-slate-500">Hòa vốn toàn gian</p>
            <p className="mt-1 text-2xl">
              <TiktokBreakevenValue breakeven={data.shop} className="font-semibold" />
            </p>
            <p className={cn(TEXT_SUB, "mt-1")}>Mốc chung khi sản phẩm chưa đủ đơn để có số riêng.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-slate-500">Sản phẩm đã có mốc hòa vốn</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {formatNumber(counts.ok + counts.attention)}
              <span className="text-base font-normal text-slate-400"> / {formatNumber(products.length)} sản phẩm có đơn</span>
            </p>
            <p className={cn(TEXT_SUB, "mt-1")}>Từ {data.minOrders} đơn đã đối soát và đủ giá vốn trở lên.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-slate-500">Thiếu giá vốn</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", counts.no_cost > 0 ? "text-amber-600" : "text-slate-900")}>
              {formatNumber(counts.no_cost)} <span className="text-base font-normal text-slate-400">sản phẩm</span>
            </p>
            <p className={cn(TEXT_SUB, "mt-1")}>
              Chưa có giá vốn thì chưa tính được hòa vốn.{" "}
              <Link href="/finance/cost-prices" className="font-medium text-slate-900 underline underline-offset-2">
                Nhập giá vốn
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {chips
              .filter((x) => x.key === "all" || counts[x.key] > 0)
              .map((x) => (
                <button
                  key={x.key}
                  onClick={() => setQuick(x.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                    quick === x.key
                      ? "border-slate-900 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
                      : "border-slate-200 bg-card text-slate-600 hover:bg-muted"
                  )}
                >
                  {x.label}
                  <span className={cn("ml-1.5 tabular-nums", quick === x.key ? "opacity-80" : "text-slate-400")}>{formatNumber(counts[x.key])}</span>
                </button>
              ))}
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
              <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-sm">
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
                    <th className={TH}>Nhận định</th>
                    {ads?.linked && (
                      <th
                        className={cn(TH, "text-right")}
                        title="ROI thật của sản phẩm trong các chiến dịch GMV Max đang chạy, 30 ngày gần nhất (số của TikTok). Doanh thu GMV Max gồm cả đơn tự nhiên nên ROI riêng của quảng cáo chỉ có thể thấp hơn số này."
                      >
                        ROI quảng cáo 30 ngày
                      </th>
                    )}
                    <th className={cn(TH, "text-right")} title="Số sản phẩm bán ra 7 ngày và 30 ngày gần nhất (mọi đơn đặt, trừ đơn hủy). Mũi tên: nhịp 7 ngày so với nhịp trung bình 30 ngày.">
                      Bán 7 / 30 ngày
                    </th>
                    <th className={cn(TH, "text-right")} title="Tồn trên sàn cộng các phân loại, và số ngày còn đủ bán theo nhịp 30 ngày.">
                      Tồn trên sàn
                    </th>
                    <th className={TH}>Chiến dịch đang chứa</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => {
                    const has = p.breakeven.orders > 0;
                    const a = ads?.products[p.productId];
                    const v = verdictOf.get(p.productId) ?? p.verdict;
                    const vd = VERDICT[v];
                    const camp = p.campaigns[0];
                    const runningCamp = p.campaigns.find((c) => c.status === "ongoing" && c.roasTarget != null);
                    const reason =
                      v === "ads_losing" && a && a.roi != null && p.breakeven.roi != null
                        ? `30 ngày qua quảng cáo của sản phẩm tiêu ${formatVND(a.cost)}, ROI ${formatRoi(a.roi)} — thấp hơn hòa vốn ${formatRoi(p.breakeven.roi)}: đang ăn vào vốn. Doanh thu GMV Max gồm cả đơn tự nhiên nên thực tế còn thấp hơn.`
                        : p.reason;
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
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {formatNumber(p.breakeven.orders)}
                          {p.breakeven.pendingOrders > 0 && (
                            <span className="block text-xs text-slate-400" title="Đơn đang giao / chờ đối soát / đang hoàn — chưa được tính">
                              +{formatNumber(p.breakeven.pendingOrders)} chờ đối soát
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {p.revenue > 0 ? <Money value={p.revenue} className="text-slate-700" /> : p.missingCostRevenue > 0 ? null : <span className="text-slate-400">—</span>}
                          {p.missingCostRevenue > 0 && (
                            <span className="block text-xs text-amber-600" title="Doanh thu đã đối soát nhưng chưa có giá vốn — chưa vào phép tính hòa vốn">
                              +<Money value={p.missingCostRevenue} /> thiếu giá vốn
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {has ? <Money value={p.profitBeforeAds} className={p.profitBeforeAds < 0 ? "text-red-500" : "text-slate-700"} /> : <span className="text-slate-400">—</span>}
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular-nums", p.breakeven.margin != null && p.breakeven.margin < 0 ? "text-red-500" : "text-slate-700")}>
                          {p.breakeven.margin != null ? `${(p.breakeven.margin * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%` : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <TiktokBreakevenValue breakeven={p.breakeven} className={cn("font-semibold", p.verdict === "low_sample" && "text-slate-400")} />
                        </td>
                        <td className="px-3 py-2">
                          <Popover>
                            <PopoverTrigger openOnHover delay={80} render={<button type="button" className="cursor-pointer rounded-full" aria-label={`Lý do: ${vd.label}`} />}>
                              <Badge className={cn(vd.className, "underline decoration-dotted underline-offset-2")}>{vd.label}</Badge>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-80 gap-1.5 p-3 text-sm">
                              <p className="font-semibold text-slate-900">{vd.label}</p>
                              <p className="text-slate-700">{reason}</p>
                              {/* Sản phẩm đang nằm trong chiến dịch CHẠY: ROI mục tiêu chỉ sửa được trong Seller Center (chiến dịch tạo ở đó
                                  không sửa được qua API — probe 19/09/2026) → đưa khách tới đúng nơi, kèm tên chiến dịch cần tìm. */}
                              {runningCamp && (v === "target_below" || v === "ads_losing" || v === "ok") && (
                                <a
                                  href={TIKTOK_SELLER_CENTER_ADS_URL}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-1 inline-flex items-center gap-1.5 font-medium text-slate-900 underline decoration-dotted underline-offset-2 hover:decoration-solid"
                                  title={`Seller Center → Quảng cáo cửa hàng → chiến dịch "${runningCamp.name}"`}
                                >
                                  <ExternalLink className="size-3.5" />
                                  Sửa ROI mục tiêu trong Seller Center
                                </a>
                              )}
                            </PopoverContent>
                          </Popover>
                        </td>
                        {ads?.linked && (
                          <td className="px-3 py-2 text-right">
                            {a && a.cost > 0 ? (
                              <>
                                <span className={cn("font-semibold tabular-nums", v === "ads_losing" ? "text-red-500" : "text-slate-900")}>{formatRoi(a.roi)}</span>
                                <span className="block text-xs text-slate-500">
                                  tiêu <Money value={a.cost} /> · {formatNumber(a.orders)} đơn
                                </span>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {formatNumber(p.units7d)} / {formatNumber(p.units30d)}
                          {pace != null && (
                            <span className={cn("block text-xs", pace >= 1.2 ? "text-emerald-600" : pace <= 0.8 ? "text-red-500" : "text-slate-400")}>
                              {pace >= 1.2 ? "▲ đang lên" : pace <= 0.8 ? "▼ đang chậm lại" : "ổn định"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          {p.stock != null ? formatNumber(p.stock) : <span className="text-slate-400">—</span>}
                          {coverDays != null && (
                            <span className={cn("block text-xs", coverDays < 14 ? "text-amber-600" : "text-slate-400")}>đủ bán ~{formatNumber(coverDays)} ngày</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {camp ? (
                            <>
                              <Link href={`/ads/tiktok/campaign?id=${camp.id}`} className="block max-w-44 truncate text-slate-900 underline decoration-dotted underline-offset-2" title={camp.name}>
                                {camp.name || "Chiến dịch"}
                              </Link>
                              <span className="text-xs text-slate-500">
                                {camp.status === "ongoing" ? "Đang chạy" : "Tạm dừng"}
                                {camp.roasTarget != null && ` · ROI mục tiêu ${formatRoi(camp.roasTarget)}`}
                                {p.campaigns.length > 1 && ` · +${p.campaigns.length - 1} chiến dịch`}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate-400">Chưa chạy</span>
                          )}
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
