"use client";

// ============================================================
// TRANG SOI VIDEO CỦA MỘT CHIẾN DỊCH GMV MAX — /ads/tiktok/campaign?id=…&days=…
//
// Màn làm việc chính của Quảng cáo TikTok: tìm video tiêu tiền mà không hiệu
// quả (bước sau: tick chọn → Loại video). Trang riêng thay cho hộp thoại vì
// cần chỗ cho ảnh bìa, bộ lọc, sắp xếp, phân trang, và địa chỉ gửi được cho
// người chạy quảng cáo.
//
// Dữ liệu: số đọc SỐNG từ báo cáo GMV Max (nhóm video sàn còn phân phối); ảnh
// bìa + kênh + caption lấy từ oEmbed công khai của TikTok, CHỈ cho ~20 video
// của trang đang xem — ảnh là phần phụ, thiếu thì dòng vẫn hiện mã + link.
// Lọc/sắp xếp/phân trang chạy phía trình duyệt trên tập đã tải (vài chục dòng).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, ImageOff } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import {
  fetchTiktokAdsCampaignVideos,
  fetchTiktokVideoMeta,
  getStoredUser,
  type TiktokAdsVideoRow,
} from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { can } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { TEXT_NUMBER_STRONG, TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

const DAY_PRESETS = [
  { label: "Hôm nay", value: 1 },
  { label: "7 ngày", value: 7 },
  { label: "14 ngày", value: 14 },
  { label: "30 ngày", value: 30 },
];

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  DELIVERING: { label: "Đang phân phối", className: "bg-emerald-50 text-emerald-700" },
  LEARNING: { label: "Đang học", className: "bg-sky-50 text-sky-700" },
  IN_QUEUE: { label: "Chờ thử", className: "bg-slate-100 text-slate-500" },
};

type QuickFilter = "all" | "noOrder" | "belowTarget" | "learning";
type SortKey = "cost" | "orders" | "roi" | "ctr" | "cvr";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "cost", label: "Chi phí cao nhất" },
  { key: "orders", label: "Nhiều đơn nhất" },
  { key: "roi", label: "ROI thấp nhất" },
  { key: "ctr", label: "Tỷ lệ bấm thấp nhất" },
  { key: "cvr", label: "Tỷ lệ chuyển đổi thấp nhất" },
];

const PAGE_SIZE = 20;

const fmtRoi = (v: number | null) => (v == null ? "—" : v.toLocaleString("vi-VN", { maximumFractionDigits: 2 }));
const fmtPct = (v: number) => `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;

export function TiktokCampaignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignRowId = searchParams.get("id") ?? "";
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [days, setDays] = useState(() => {
    const d = Number(searchParams.get("days"));
    return DAY_PRESETS.some((p) => p.value === d) ? d : 7;
  });
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [minCost, setMinCost] = useState("");
  const [sort, setSort] = useState<SortKey>("cost");
  const [page, setPage] = useState(0);

  useEffect(() => setAllowed(can(getStoredUser(), "ads.tiktok")), []);

  const q = useApiQuery({
    queryKey: qk.tiktokAdsVideos(campaignRowId, days),
    queryFn: () => fetchTiktokAdsCampaignVideos(campaignRowId, days),
    enabled: allowed === true && campaignRowId !== "",
    staleTime: 5 * 60_000,
  });
  const data = q.data;
  const c = data?.campaign;
  const target = c?.roasTarget ?? null;

  // Chỉ video CÓ tiêu tiền mới đáng soi; phần còn lại sàn chưa phân phối đồng nào.
  const spending = useMemo(() => (data?.videos ?? []).filter((v) => v.cost > 0), [data?.videos]);
  const isBelowTarget = (v: TiktokAdsVideoRow) => target != null && v.orders > 0 && v.roi != null && v.roi < target;
  const counts = {
    all: spending.length,
    noOrder: spending.filter((v) => v.noOrder).length,
    belowTarget: spending.filter(isBelowTarget).length,
    learning: spending.filter((v) => v.deliveryStatus === "LEARNING").length,
  };

  const rows = useMemo(() => {
    const min = Number(minCost) || 0;
    const list = spending.filter((v) => {
      if (v.cost < min) return false;
      if (quick === "noOrder") return v.noOrder;
      if (quick === "belowTarget") return target != null && v.orders > 0 && v.roi != null && v.roi < target;
      if (quick === "learning") return v.deliveryStatus === "LEARNING";
      return true;
    });
    const by: Record<SortKey, (a: TiktokAdsVideoRow, b: TiktokAdsVideoRow) => number> = {
      cost: (a, b) => b.cost - a.cost,
      orders: (a, b) => b.orders - a.orders || b.cost - a.cost,
      roi: (a, b) => (a.roi ?? 0) - (b.roi ?? 0) || b.cost - a.cost,
      ctr: (a, b) => a.ctr - b.ctr || b.cost - a.cost,
      cvr: (a, b) => a.cvr - b.cvr || b.cost - a.cost,
    };
    return [...list].sort(by[sort]);
  }, [spending, quick, minCost, sort, target]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pageIds = pageRows.map((v) => v.videoId);

  const metaQ = useApiQuery({
    queryKey: qk.tiktokVideoMeta(pageIds),
    queryFn: () => fetchTiktokVideoMeta(pageIds),
    enabled: pageIds.length > 0,
    staleTime: 60 * 60_000,
  });
  const meta = metaQ.data?.items ?? {};

  if (allowed === false || q.denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const t = data?.totals;
  const wastePct = t && t.videoSpend > 0 ? Math.round((t.noOrderSpend / t.videoSpend) * 100) : 0;
  const campaignRoi = c && c.spend > 0 ? c.gmv / c.spend : null;
  const backHref = c ? `/ads/tiktok?channelId=${c.channelId}` : "/ads/tiktok";

  const chips: { key: QuickFilter; label: string; count: number; hidden?: boolean }[] = [
    { key: "all", label: "Tất cả", count: counts.all },
    { key: "noOrder", label: "Chưa ra đơn", count: counts.noOrder },
    { key: "belowTarget", label: "Có đơn, ROI dưới mục tiêu", count: counts.belowTarget, hidden: target == null },
    { key: "learning", label: "Đang học", count: counts.learning },
  ];

  return (
    <AppShell>
      <div className="space-y-5 pb-10">
        {/* ===== ĐẦU TRANG ===== */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
              <ArrowLeft className="size-4" />
              Quảng cáo TikTok{c ? ` · ${c.shopName}` : ""}
            </Link>
            <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
              <span className="min-w-0 truncate">{c?.name || (q.loading ? "Đang tải…" : "Chiến dịch")}</span>
              {c &&
                (c.status === "ongoing" ? (
                  <Badge className="bg-emerald-500 text-white">Đang chạy</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-700">Tạm dừng</Badge>
                ))}
            </h1>
            {c && (
              <p className="text-sm text-muted-foreground">
                {target != null ? `ROI mục tiêu ${fmtRoi(target)}` : "Phân phối tối đa"} · ROI thực{" "}
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    target != null && campaignRoi != null && campaignRoi < target ? "text-red-500" : "text-slate-900"
                  )}
                >
                  {fmtRoi(campaignRoi)}
                </span>{" "}
                · chi {formatVND(c.spend)} · {formatNumber(c.orders)} đơn
              </p>
            )}
          </div>
          <div className="ml-auto flex overflow-hidden rounded-lg border">
            {DAY_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  setDays(p.value);
                  setPage(0);
                }}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium transition-colors",
                  days === p.value ? "bg-primary text-primary-foreground" : "bg-card text-slate-600 hover:bg-muted"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {!campaignRowId && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
            Thiếu mã chiến dịch.{" "}
            <button className="underline" onClick={() => router.push("/ads/tiktok")}>
              Về trang Quảng cáo TikTok
            </button>
          </div>
        )}
        {q.error && <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{q.error}</div>}

        {/* ===== BA CON SỐ KẾT LUẬN ===== */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="py-4">
              <p className={TEXT_SUB}>Video đang tiêu tiền</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                {t ? formatNumber(t.spendingCount) : "—"}
                {t && <span className="ml-1.5 text-sm font-normal text-slate-500">/ {formatNumber(t.videoCount)} video đang phân phối</span>}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className={TEXT_SUB}>Tiêu tiền, chưa ra đơn</p>
              <p className={cn("mt-1 text-2xl font-bold tabular-nums", t && t.noOrderCount > 0 ? "text-red-500" : "text-slate-900")}>
                {t ? `${formatNumber(t.noOrderCount)} video` : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className={TEXT_SUB}>Tiền vào các video đó</p>
              <p className={cn("mt-1 text-2xl font-bold tabular-nums", t && t.noOrderSpend > 0 ? "text-red-500" : "text-slate-900")}>
                {t ? formatVND(t.noOrderSpend) : "—"}
                {wastePct > 0 && <span className="ml-1.5 text-sm font-normal text-slate-500">· {wastePct}% chi cho video</span>}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ===== BẢNG VIDEO ===== */}
        <Card>
          <CardContent className="space-y-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {chips
                .filter((x) => !x.hidden)
                .map((x) => (
                  <button
                    key={x.key}
                    onClick={() => {
                      setQuick(x.key);
                      setPage(0);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                      quick === x.key
                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
                        : "border-slate-200 bg-card text-slate-600 hover:bg-muted"
                    )}
                  >
                    {x.label}
                    <span className={cn("ml-1.5 tabular-nums", quick === x.key ? "opacity-80" : "text-slate-400")}>
                      {formatNumber(x.count)}
                    </span>
                  </button>
                ))}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-500">
                  Chi phí từ
                  <CurrencyInput
                    value={minCost}
                    onValueChange={(v) => {
                      setMinCost(v);
                      setPage(0);
                    }}
                    placeholder="0"
                    className="h-8 w-28"
                    aria-label="Chỉ hiện video có chi phí từ"
                  />
                </label>
                <NativeSelect
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value as SortKey);
                    setPage(0);
                  }}
                  aria-label="Sắp xếp video"
                  className="w-60"
                >
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {!data && !q.error && campaignRowId && (
              <p className="py-12 text-center text-sm text-muted-foreground">Đang đọc số từ TikTok…</p>
            )}
            {data && rows.length === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {spending.length === 0 ? "Chưa có video nào tiêu tiền trong khoảng ngày này." : "Không có video nào khớp bộ lọc."}
              </p>
            )}

            {pageRows.length > 0 && (
              <div className="min-w-0 overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className={cn(TEXT_TABLE_HEAD, "text-left")}>
                      <th className="px-3 py-2 font-medium">Video</th>
                      <th className="px-3 py-2 font-medium">Trạng thái</th>
                      <th className="px-3 py-2 text-right font-medium">Chi phí</th>
                      <th className="px-3 py-2 text-right font-medium">Đơn</th>
                      <th className="px-3 py-2 text-right font-medium">Doanh thu</th>
                      <th className="px-3 py-2 text-right font-medium">Tỷ lệ bấm</th>
                      <th className="px-3 py-2 text-right font-medium">Chuyển đổi</th>
                      <th className="px-3 py-2 text-right font-medium">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((v) => {
                      const st = STATUS_LABEL[v.deliveryStatus];
                      const m = meta[v.videoId];
                      const bad = v.noOrder || isBelowTarget(v);
                      const href = `https://www.tiktok.com/@${m?.author ?? ""}/video/${v.videoId}`;
                      return (
                        <tr key={`${v.spuId}-${v.videoId}`} className={cn("border-t", v.noOrder && "bg-rose-50/60")}>
                          <td className="px-3 py-2">
                            <a href={href} target="_blank" rel="noreferrer" className="group flex items-center gap-3" title="Mở video trên TikTok">
                              <span className="flex h-16 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-400">
                                {m?.thumbnailUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- ảnh CDN TikTok có hạn, không qua tối ưu ảnh của Next
                                  <img src={m.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
                                ) : (
                                  <ImageOff className="size-4" />
                                )}
                              </span>
                              <span className="min-w-0">
                                <span className="flex items-center gap-1 text-sm text-slate-900 group-hover:underline">
                                  <span className="truncate">{m?.author ? `@${m.author}` : v.videoId}</span>
                                  <ExternalLink className="size-3.5 shrink-0 text-slate-400" />
                                </span>
                                <span className="block max-w-72 truncate text-xs text-slate-500">
                                  {m?.caption || (metaQ.loading ? "Đang lấy thông tin video…" : `Mã video ${v.videoId}`)}
                                </span>
                                {data && data.products.length > 1 && (
                                  <span className="block max-w-72 truncate text-xs text-slate-400">
                                    {data.products.find((p) => p.spuId === v.spuId)?.name}
                                  </span>
                                )}
                              </span>
                            </a>
                          </td>
                          <td className="px-3 py-2">
                            <Badge className={st?.className ?? "bg-slate-100 text-slate-500"}>{st?.label ?? v.deliveryStatus}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={v.cost} className="text-slate-900" />
                          </td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", v.noOrder ? "text-red-500" : "text-slate-900")}>
                            {formatNumber(v.orders)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={v.gmv} className="text-slate-900" />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtPct(v.ctr)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtPct(v.cvr)}</td>
                          <td className={cn("px-3 py-2 text-right", TEXT_NUMBER_STRONG, bad ? "text-red-500" : "text-slate-900")}>
                            {fmtRoi(v.roi)}
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
                <p className={TEXT_SUB}>
                  {formatNumber(rows.length)} video khớp bộ lọc · chi phí từng video TikTok cập nhật trễ tới 11 giờ, ROI gồm
                  cả đơn tự nhiên.
                </p>
                {pageCount > 1 && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                      Trước
                    </Button>
                    <span className="text-sm tabular-nums text-slate-500">
                      {safePage + 1} / {pageCount}
                    </span>
                    <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
                      Sau
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
