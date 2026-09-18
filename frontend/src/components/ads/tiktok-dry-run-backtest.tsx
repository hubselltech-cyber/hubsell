"use client";

// ============================================================
// ĐỐI CHIẾU DIỄN TẬP — "máy định loại có đúng không?" (anh Trung 18/09)
//
// Căn cứ để chủ shop quyết bật "Tự loại thật": những video máy ĐỊNH loại trong
// các lượt diễn tập, từ HÔM SAU ngày định loại tới nay tiêu thêm bao nhiêu, ra
// mấy đơn. Kết luận từng video so với đúng các mốc khách đã cài (ROI mục tiêu,
// mức loại, sàn dữ liệu) — luật ở backend integrations/tiktok-ads/backtest.ts.
// Chỉ hiện khi chiến dịch đang ở chế độ Diễn tập; chưa có lượt nào định loại
// video thì backend trả rỗng mà không gọi TikTok.
// ============================================================

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, ExternalLink, ImageOff } from "lucide-react";
import { toast } from "sonner";

import { formatRoi } from "@/components/ads/tiktok-ads-format";
import { PNL_STICKY_HEAD, PNL_TABLE_SCROLLER } from "@/components/finance/realized-pnl/cells";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import {
  fetchTiktokAdsBacktest,
  fetchTiktokVideoMeta,
  type TiktokAdsBacktestVerdict,
  type TiktokAdsBacktestVideo,
} from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_NUMBER_STRONG, TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

const VERDICT: Record<TiktokAdsBacktestVerdict, { label: string; className: string; hint: string }> = {
  right: { label: "Máy đúng", className: "bg-emerald-50 text-emerald-700", hint: "Sau ngày máy định loại, video vẫn không ra đơn hoặc ROI vẫn dưới mức loại." },
  middle: { label: "Lưng chừng", className: "bg-amber-50 text-amber-700", hint: "ROI đã lên trên mức loại nhưng vẫn dưới ROI mục tiêu." },
  recovered: { label: "Hồi phục", className: "bg-rose-50 text-red-500", hint: "Video đã lên tới ROI mục tiêu — nếu loại thật hôm đó thì tiếc." },
  insufficient: { label: "Chưa đủ dữ liệu", className: "bg-slate-100 text-slate-500", hint: "Từ đó tới nay video tiêu chưa tới sàn dữ liệu anh/chị đã cài — chưa phán được." },
};
const VERDICT_ORDER: TiktokAdsBacktestVerdict[] = ["right", "middle", "recovered", "insufficient"];

type SortKey = "cost" | "orders" | "gmv" | "roi";
const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "cost", label: "Tiêu thêm" },
  { key: "orders", label: "Đơn" },
  { key: "gmv", label: "Doanh thu" },
  { key: "roi", label: "ROI" },
];
const META_CHUNK = 20;
const TH = "whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 font-medium";
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function TiktokDryRunBacktest({ campaignRowId, enabled }: { campaignRowId: string; enabled: boolean }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "desc" | "asc" }>({ key: "cost", dir: "desc" });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const q = useApiQuery({
    queryKey: qk.tiktokAdsBacktest(campaignRowId),
    queryFn: () => fetchTiktokAdsBacktest(campaignRowId),
    enabled: enabled && campaignRowId !== "",
    staleTime: 5 * 60_000,
  });
  const data = q.data;

  const rows = useMemo(() => {
    const sign = sort.dir === "desc" ? -1 : 1;
    const val = (v: TiktokAdsBacktestVideo) => (sort.key === "roi" ? v.roi : v[sort.key]);
    return [...(data?.videos ?? [])].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      // Chưa có ROI (chưa tiêu thêm đồng nào) luôn xếp cuối.
      if (x == null || y == null) return x == null && y == null ? b.cost - a.cost : x == null ? 1 : -1;
      return sign * (x - y) || b.cost - a.cost;
    });
  }, [data?.videos, sort]);

  const metaChunks = useMemo(() => {
    const ids = rows.map((v) => v.videoId);
    const out: string[][] = [];
    for (let i = 0; i < ids.length; i += META_CHUNK) out.push(ids.slice(i, i + META_CHUNK));
    return out;
  }, [rows]);
  const metaQs = useQueries({
    queries: metaChunks.map((ids) => ({
      queryKey: qk.tiktokVideoMeta(ids),
      queryFn: () => fetchTiktokVideoMeta(ids),
      staleTime: 60 * 60_000,
    })),
  });
  const meta = Object.assign({}, ...metaQs.map((x) => x.data?.items ?? {})) as Record<
    string,
    { author: string; caption: string; thumbnailUrl: string }
  >;

  async function copyVideoId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      toast.error("Trình duyệt không cho sao chép. Hãy bôi đen mã video rồi Ctrl+C.");
    }
  }

  if (!enabled) return null;
  if (q.error) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-red-700">Chưa lấy được bảng đối chiếu diễn tập: {q.error}</CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const t = data.totals;
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">Đối chiếu diễn tập — máy định loại có đúng không?</p>
          {t.videos === 0 ? (
            <p className={cn(TEXT_SUB, "mt-1")}>
              {data.planDays === 0
                ? "Chưa có lượt diễn tập nào định loại video. Khi máy định loại video nào, bảng này theo dõi video đó chạy tiếp ra sao để anh/chị quyết có bật Tự loại thật hay không."
                : "Các lượt diễn tập chưa định loại video nào."}
            </p>
          ) : data.from == null ? (
            <p className={cn(TEXT_SUB, "mt-1")}>
              Máy vừa định loại {formatNumber(t.videos)} video trong lượt hôm nay. Số đối chiếu tính từ ngày mai.
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-700">
              Từ {ddmm(data.from)} đến nay, {formatNumber(t.videos)} video máy định loại đã tiêu thêm{" "}
              <span className={cn(TEXT_NUMBER_STRONG, "text-red-500")}>{formatVND(t.cost)}</span>, ra{" "}
              <span className={TEXT_NUMBER_STRONG}>{formatNumber(t.orders)} đơn</span> · doanh thu {formatVND(t.gmv)} · ROI cả nhóm{" "}
              <span className={cn(TEXT_NUMBER_STRONG, t.roi != null && t.roi < data.marks.roiTarget ? "text-red-500" : "text-slate-900")}>
                {formatRoi(t.roi)}
              </span>{" "}
              (mục tiêu {formatRoi(data.marks.roiTarget)}, mức loại {formatRoi(data.marks.hardRoi)}).
            </p>
          )}
        </div>

        {t.videos > 0 && data.from != null && (
          <div className="flex flex-wrap gap-2">
            {VERDICT_ORDER.filter((k) => data.counts[k] > 0).map((k) => (
              <Badge key={k} className={VERDICT[k].className} title={VERDICT[k].hint}>
                {VERDICT[k].label} · {formatNumber(data.counts[k])}
              </Badge>
            ))}
          </div>
        )}

        {t.videos > 0 && (
          <div className={cn("min-w-0 rounded-lg border", PNL_TABLE_SCROLLER)}>
            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
              <thead className={PNL_STICKY_HEAD}>
                <tr className={cn(TEXT_TABLE_HEAD, "text-left")}>
                  <th className={TH}>Video</th>
                  <th className={TH}>Máy định loại từ</th>
                  {SORT_COLUMNS.map((col) => {
                    const active = sort.key === col.key;
                    const Icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
                    return (
                      <th key={col.key} className={cn(TH, "text-right")} aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}>
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
                  <th className={TH}>Kết luận</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const m = meta[v.videoId];
                  const href = `https://www.tiktok.com/@${m?.author ?? ""}/video/${v.videoId}`;
                  const vd = VERDICT[v.verdict];
                  return (
                    <tr key={v.videoId} className="[&>td]:border-b [&>td]:border-slate-200/80">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            title="Mở video trên TikTok"
                            className="flex h-12 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-400"
                          >
                            {m?.thumbnailUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- ảnh CDN TikTok có hạn, không qua tối ưu ảnh của Next
                              <img src={m.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
                            ) : (
                              <ImageOff className="size-4" />
                            )}
                          </a>
                          <div className="min-w-0">
                            <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-slate-900 hover:underline">
                              <span className="truncate">{m?.author ? `@${m.author}` : "Video TikTok"}</span>
                              <ExternalLink className="size-3.5 shrink-0 text-slate-400" />
                            </a>
                            <button
                              type="button"
                              onClick={() => void copyVideoId(v.videoId)}
                              title="Sao chép mã video"
                              className="group inline-flex items-center gap-1 rounded text-xs tabular-nums text-slate-500 hover:text-slate-900"
                            >
                              {v.videoId}
                              {copiedId === v.videoId ? (
                                <Check className="size-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="size-3.5 text-slate-400 group-hover:text-slate-900" />
                              )}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <p className="whitespace-nowrap text-sm tabular-nums text-slate-900">
                          {ddmm(v.firstPlannedOn)}
                          <span className="text-slate-500"> · {formatNumber(v.plannedDays)} lượt</span>
                        </p>
                        {v.noteAtPlan && <p className="max-w-80 text-xs text-slate-500">{v.noteAtPlan}</p>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Money value={v.cost} className="text-slate-700" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatNumber(v.orders)}</td>
                      <td className="px-3 py-2 text-right">
                        <Money value={v.gmv} className="text-slate-700" />
                      </td>
                      <td className={cn("px-3 py-2 text-right", TEXT_NUMBER_STRONG, v.roi == null ? "text-slate-400" : "text-slate-900")}>{formatRoi(v.roi)}</td>
                      <td className="px-3 py-2">
                        <Badge className={vd.className} title={vd.hint}>
                          {vd.label}
                        </Badge>
                        {v.deliveryStatus === "EXCLUDED" && <p className="mt-0.5 text-xs text-slate-500">Đã loại tay</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {t.videos > 0 && (
          <p className={TEXT_SUB}>
            Số tính từ hôm sau ngày máy định loại tới hôm nay (chi phí video TikTok về trễ tới 11 giờ; ROI gồm cả đơn tự nhiên). Nếu loại thật, TikTok
            dồn khoản tiền này sang video khác của chiến dịch — đây là tiền được đổi chỗ, không phải tiền bớt chi.
            {data.truncated && " Diễn tập đã quá 30 ngày: TikTok chỉ cho số theo ngày của 30 ngày gần nhất."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
