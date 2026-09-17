"use client";

// ============================================================
// SOI VIDEO CỦA MỘT CHIẾN DỊCH GMV MAX — đọc SỐNG từ TikTok khi mở hộp.
//
// Một chiến dịch thật có gần 1.800 video mà chỉ vài chục cái tiêu tiền; backend
// đã lọc nhóm sàn còn phân phối (Đang phân phối / Đang học / Chờ) và xếp video
// TIÊU TIỀN KHÔNG RA ĐƠN lên đầu. Báo cáo tầng video của TikTok không trả tên
// video → hiện mã + link mở thẳng bài đăng để chủ shop nhận mặt.
// Chỉ đọc: việc loại video làm ở đợt sau.
// ============================================================

import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { fetchTiktokAdsCampaignVideos, type TiktokAdsCampaignRow } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { TEXT_NUMBER_STRONG, TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  DELIVERING: { label: "Đang phân phối", className: "bg-emerald-50 text-emerald-700" },
  LEARNING: { label: "Đang học", className: "bg-sky-50 text-sky-700" },
  IN_QUEUE: { label: "Chờ thử", className: "bg-slate-100 text-slate-500" },
};

const MAX_ROWS = 100;

function formatRoi(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

export function TiktokCampaignVideosDialog({
  campaign,
  days,
  onClose,
}: {
  campaign: TiktokAdsCampaignRow | null;
  days: number;
  onClose: () => void;
}) {
  const q = useApiQuery({
    queryKey: qk.tiktokAdsVideos(campaign?.id ?? "", days),
    queryFn: () => fetchTiktokAdsCampaignVideos(campaign!.id, days),
    enabled: campaign !== null,
    staleTime: 5 * 60_000,
  });
  const data = campaign && q.data?.campaign.id === campaign.id ? q.data : undefined;
  const t = data?.totals;
  const productName = new Map((data?.products ?? []).map((p) => [p.spuId, p.name]));
  // Chỉ video có tiêu tiền mới đáng nhìn; phần còn lại là video sàn chưa phân phối đồng nào.
  const spending = (data?.videos ?? []).filter((v) => v.cost > 0);
  const rows = spending.slice(0, MAX_ROWS);
  const wastePct = t && t.videoSpend > 0 ? Math.round((t.noOrderSpend / t.videoSpend) * 100) : 0;

  return (
    <Dialog open={campaign !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[min(56rem,calc(100%-2rem))]">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="min-w-0 truncate">{campaign?.name || `Chiến dịch #${campaign?.campaignId}`}</span>
          </DialogTitle>
          <DialogDescription>
            Video đang được TikTok phân phối trong chiến dịch, {days === 1 ? "hôm nay" : `${days} ngày gần nhất`}. Chi phí
            từng video TikTok cập nhật trễ tới 11 giờ.
          </DialogDescription>
        </DialogHeader>

        {q.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{q.error}</div>
        )}
        {!data && !q.error && <p className="py-10 text-center text-sm text-muted-foreground">Đang đọc số từ TikTok…</p>}

        {data && t && (
          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className={TEXT_SUB}>Video đang tiêu tiền</p>
                <p className={cn(TEXT_NUMBER_STRONG, "mt-1 text-base text-slate-900")}>
                  {formatNumber(t.spendingCount)}
                  <span className="ml-1 text-xs font-normal text-slate-500">/ {formatNumber(t.videoCount)} video</span>
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className={TEXT_SUB}>Tiêu tiền, chưa ra đơn</p>
                <p className={cn(TEXT_NUMBER_STRONG, "mt-1 text-base", t.noOrderCount > 0 ? "text-red-500" : "text-slate-900")}>
                  {formatNumber(t.noOrderCount)} video
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className={TEXT_SUB}>Tiền vào các video đó</p>
                <p className={cn(TEXT_NUMBER_STRONG, "mt-1 text-base", t.noOrderSpend > 0 ? "text-red-500" : "text-slate-900")}>
                  {formatVND(t.noOrderSpend)}
                  {wastePct > 0 && <span className="ml-1 text-xs font-normal text-slate-500">· {wastePct}% chi cho video</span>}
                </p>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Chưa có video nào tiêu tiền trong khoảng ngày này.
              </p>
            ) : (
              <div className="min-w-0 overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className={cn(TEXT_TABLE_HEAD, "text-left")}>
                      <th className="px-3 py-2 font-medium">Video</th>
                      <th className="px-3 py-2 font-medium">Trạng thái</th>
                      <th className="px-3 py-2 text-right font-medium">Chi phí</th>
                      <th className="px-3 py-2 text-right font-medium">Đơn</th>
                      <th className="px-3 py-2 text-right font-medium">Doanh thu</th>
                      <th className="px-3 py-2 text-right font-medium">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((v) => {
                      const st = STATUS_LABEL[v.deliveryStatus];
                      return (
                        <tr key={`${v.spuId}-${v.videoId}`} className={cn("border-t", v.noOrder && "bg-rose-50/60")}>
                          <td className="px-3 py-2">
                            <a
                              href={`https://www.tiktok.com/@/video/${v.videoId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 tabular-nums text-slate-900 hover:underline"
                              title="Mở video trên TikTok"
                            >
                              {v.videoId}
                              <ExternalLink className="size-3.5 text-slate-400" />
                            </a>
                            {data.products.length > 1 && (
                              <p className="max-w-64 truncate text-xs text-slate-500">{productName.get(v.spuId) ?? v.spuId}</p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Badge className={st?.className ?? "bg-slate-100 text-slate-500"}>{st?.label ?? v.deliveryStatus}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={v.cost} className="text-slate-700" />
                          </td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", v.noOrder ? "text-red-500" : "text-slate-700")}>
                            {formatNumber(v.orders)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={v.gmv} className="text-slate-700" />
                          </td>
                          <td className={cn("px-3 py-2 text-right", TEXT_NUMBER_STRONG, v.noOrder ? "text-red-500" : "text-slate-900")}>
                            {formatRoi(v.roi)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {spending.length > MAX_ROWS && (
              <p className={TEXT_SUB}>Đang hiện {MAX_ROWS} video tốn tiền nhất trên tổng {formatNumber(spending.length)}.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
