"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, BellRing, CheckCircle2, Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { fetchAdsToday, getStoredUser, type AdsTodaySummary } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { can } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * THẺ "QUẢNG CÁO HÔM NAY" — thẻ ĐẦU TIÊN của Tổng quan (lát 2 định vị lại
 * "Trợ lý quảng cáo đa sàn", anh Trung chốt 15/10/2026): khách mở máy là thấy
 * chi tiêu 3 sàn hôm nay, bao nhiêu cảnh báo quảng cáo đang mở, và MỘT nút để
 * vào xử lý. Khách chưa nối quảng cáo thấy thẻ mời nối với MỘT nút (luật
 * "khách cần đơn giản"). Chưa có gian nào → không hiện (onboarding lo).
 *
 * Số đọc từ /api/quang-cao/hom-nay: bảng AdSpend theo ngày sàn + cảnh báo ads
 * đang mở; cùng độ tươi với xung đồng bộ quảng cáo, không gọi sàn khi mở trang.
 */
const PLATFORM_META: Record<
  AdsTodaySummary["platforms"][number]["platform"],
  { label: string; dot: string }
> = {
  shopee: { label: "Shopee", dot: "bg-orange-500" },
  lazada: { label: "Lazada", dot: "bg-violet-500" },
  tiktok: { label: "TikTok Shop", dot: "bg-slate-900 dark:bg-slate-100" },
};

export function AdsTodayCard() {
  const router = useRouter();
  const allowed = can(getStoredUser(), "ads");
  const { data } = useApiQuery({
    queryKey: qk.adsToday(),
    queryFn: fetchAdsToday,
    enabled: allowed,
  });

  if (!allowed || !data || !data.anyChannel) return null;

  // ---- Chưa nối quảng cáo sàn nào: mời nối, một nút ----
  if (!data.anyConnected) {
    return (
      <Card className="border-emerald-200/80 bg-emerald-50/40 dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
            <Megaphone className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Nối quảng cáo để trợ lý canh chiến dịch của bạn</p>
            <p className="text-sm text-muted-foreground">
              Một lần ủy quyền trên trang của sàn. Hubsell sẽ chỉ ra chiến dịch
              đang dưới ROAS hòa vốn, nhắc, hạ ngân sách hoặc dừng trước khi ví cháy.
            </p>
          </div>
          <Button className="h-10 sm:h-9" onClick={() => router.push(data.href)}>
            Nối quảng cáo
            <ArrowRight className="size-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  const connected = data.platforms.filter((p) => p.connected);
  const alerting = data.openAlerts > 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:gap-8">
        {/* Tổng chi hôm nay + cảnh báo */}
        <div className="min-w-0 lg:w-72 lg:shrink-0">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Megaphone className="size-4" />
            Quảng cáo hôm nay
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            <Money value={data.totalToday} />
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Hôm qua <Money value={data.totalYesterday} /> · {connected.length} sàn đã nối
          </p>
          <p
            className={cn(
              "mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium",
              alerting
                ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
            )}
          >
            {alerting ? (
              <BellRing className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {alerting
              ? `${formatNumber(data.openAlerts)} cảnh báo quảng cáo đang mở`
              : "Chưa có cảnh báo quảng cáo"}
          </p>
        </div>

        {/* Từng sàn */}
        <ul className="grid flex-1 gap-2 sm:grid-cols-3">
          {data.platforms
            .filter((p) => p.hasChannel)
            .map((p) => {
              const meta = PLATFORM_META[p.platform];
              return (
                <li
                  key={p.platform}
                  className="rounded-xl border border-slate-200/80 px-3.5 py-3 dark:border-slate-800"
                >
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className={cn("size-2 rounded-full", meta.dot)} />
                    {meta.label}
                  </p>
                  {p.connected ? (
                    <>
                      <p className="mt-1 font-semibold tabular-nums">
                        <Money value={p.spendToday} />
                      </p>
                      <p
                        className={cn(
                          "text-xs",
                          p.openAlerts > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
                        )}
                      >
                        {p.openAlerts > 0
                          ? `${formatNumber(p.openAlerts)} cảnh báo`
                          : "Không có cảnh báo"}
                      </p>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="mt-1 text-sm font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
                      onClick={() => router.push(`/ads/${p.platform}`)}
                    >
                      Chưa nối quảng cáo — nối ngay
                    </button>
                  )}
                </li>
              );
            })}
        </ul>

        <Button
          className="h-10 lg:h-9 lg:shrink-0"
          variant={alerting ? "default" : "outline"}
          onClick={() => router.push(data.href)}
        >
          {alerting ? "Xem và xử lý" : "Mở Trợ lý quảng cáo"}
          <ArrowRight className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
