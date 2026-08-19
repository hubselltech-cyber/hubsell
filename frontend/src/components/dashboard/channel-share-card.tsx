"use client";

import { useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  type PieSectorDataItem,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import type { AnalyticsResponse, ChannelName } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { CHANNEL_COLORS, CHANNEL_COLOR_FALLBACK } from "@/lib/chart-colors";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_CARD_TITLE, TEXT_HERO_NUMBER, TEXT_SUB } from "@/lib/typography";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

interface ChannelRow {
  channelName: string;
  label: string;
  color: string;
  revenue: number;
  count: number;
}

/** Dữ liệu vòm nền — một lát 180° duy nhất nằm dưới các lát thật. */
const TRACK = [{ v: 1 }];

/**
 * TỶ TRỌNG KÊNH BÁN — BÁN NGUYỆT 180° + legend lưới bên dưới.
 *
 * Gom về cấp nền tảng (Shopee, TikTok…) thay vì xé lẻ từng gian hàng: đây là
 * khối liếc nhanh, hai gian Shopee cộng làm một là đủ; muốn soi từng gian đã
 * có bộ lọc gian hàng ở đầu trang. Màu lát = màu nhận diện thương hiệu sàn
 * (CHANNEL_COLORS — CSS var, dark mode tự đổi bản sáng cho TikTok/Lazada).
 *
 * Chiều sâu bằng LỚP, không bằng hiệu ứng: vòm nền (track) currentColor 6%
 * làm "rãnh" cho các lát, khe lát là viền màu card 3px (đều ở mọi bán kính —
 * paddingAngle thuần cho khe hình nêm), hover lát nở 6px + lát khác mờ đi.
 *
 * Kỹ thuật: Recharts tính bán kính % theo min(rộng, cao)/2 của hộp, nên vẽ
 * bán nguyệt trong hộp 2:1 thì vòm chỉ to bằng NỬA bề ngang. Ở đây vẽ trong
 * hộp VUÔNG (tâm 50%/50%, góc 180→0) rồi cắt bỏ nửa dưới bằng overflow-hidden
 * — vòm phủ trọn bề ngang, khối số đặt đúng lòng vòm. Animation vẽ vòm chỉ
 * chạy LẦN ĐẦU mount (đổi bộ lọc không nháy lại) và tắt khi người dùng bật
 * "giảm chuyển động".
 */
export function ChannelShareCard({
  analytics,
  className,
}: {
  analytics: AnalyticsResponse;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  // Animate đúng một lần; onAnimationEnd tắt cờ để refetch/đổi lọc không vẽ lại
  const [animate, setAnimate] = useState(true);

  const byPlatform = new Map<string, { revenue: number; count: number }>();
  for (const r of analytics.ordersByChannel) {
    const cur = byPlatform.get(r.channelName) ?? { revenue: 0, count: 0 };
    cur.revenue += r.revenue;
    cur.count += r.count;
    byPlatform.set(r.channelName, cur);
  }
  const rows: ChannelRow[] = [...byPlatform.entries()]
    .map(([channelName, v]) => ({
      channelName,
      label: CHANNEL_META[channelName as ChannelName]?.label ?? channelName,
      color: CHANNEL_COLORS[channelName] ?? CHANNEL_COLOR_FALLBACK,
      ...v,
    }))
    .sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((sum, r) => sum + r.revenue, 0);
  const empty = rows.length === 0 || total === 0;
  const pctOf = (v: number) =>
    total > 0 ? Math.round((v / total) * 1000) / 10 : 0;

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>Tỷ trọng kênh bán hàng</CardTitle>
        {/* Một dòng để mép trên vòm gióng với mép trên chart Waterfall bên cạnh */}
        <CardDescription>
          Giá trị đơn phát sinh trong kỳ theo từng sàn, không tính đơn hủy/hoàn.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {/* VÒM — căn giữa phần cao còn lại của card; legend ghim đáy */}
        <div className="flex flex-1 items-center justify-center">
          <div className="relative w-full max-w-[26rem] xl:max-w-[28rem]">
            {/* Hộp nhìn thấy cao = nửa bề ngang + 4% đệm cho lát nở khi hover;
                bên trong là hộp VUÔNG chứa PieChart, nửa dưới bị cắt */}
            <div className="relative w-full overflow-hidden pb-[54%]">
              <div className="absolute inset-x-0 top-0 aspect-square">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    {/* Vòm nền: rãnh mờ cho các lát; không tooltip, không hover */}
                    <Pie
                      data={TRACK}
                      dataKey="v"
                      cx="50%"
                      cy="50%"
                      startAngle={180}
                      endAngle={0}
                      innerRadius="68%"
                      outerRadius="92%"
                      cornerRadius={8}
                      fill="currentColor"
                      fillOpacity={0.06}
                      stroke="none"
                      isAnimationActive={false}
                      tooltipType="none"
                      activeShape={false}
                    />
                    {!empty && (
                      <Pie
                        data={rows}
                        dataKey="revenue"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        startAngle={180}
                        endAngle={0}
                        innerRadius="68%"
                        outerRadius="92%"
                        // Khe lát = viền màu card → đều ở mọi bán kính; 1 kênh thì
                        // không khe, vòm liền 180°
                        paddingAngle={rows.length > 1 ? 1.5 : 0}
                        stroke="var(--card)"
                        strokeWidth={rows.length > 1 ? 3 : 0}
                        cornerRadius={6}
                        isAnimationActive={animate && !reducedMotion}
                        animationBegin={0}
                        animationDuration={600}
                        animationEasing="ease-out"
                        onAnimationEnd={() => setAnimate(false)}
                        // Hover: lát đang trỏ nở 6px, lát còn lại lùi về 35%
                        activeShape={(props: PieSectorDataItem) => (
                          <Sector
                            {...props}
                            outerRadius={(props.outerRadius ?? 0) + 6}
                          />
                        )}
                        inactiveShape={{ fillOpacity: 0.35 }}
                      >
                        {rows.map((r) => (
                          <Cell key={r.channelName} fill={r.color} />
                        ))}
                      </Pie>
                    )}
                    {!empty && (
                      <Tooltip
                        content={({ active, payload }) => {
                          const p = payload?.[0]?.payload as ChannelRow | undefined;
                          if (!active || !p) return null;
                          return (
                            <div className="rounded-lg border border-slate-200/80 bg-card px-3 py-2 text-card-foreground shadow-[0_2px_8px_-2px_rgb(15_23_42/0.15)]">
                              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span
                                  className="size-2 rounded-full"
                                  style={{ backgroundColor: p.color }}
                                />
                                {p.label}
                              </p>
                              <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                                {formatVND(p.revenue)}
                              </p>
                              <p className={cn(TEXT_SUB, "mt-0.5")}>
                                {pctOf(p.revenue)}% doanh thu ·{" "}
                                {formatNumber(p.count)} đơn
                              </p>
                            </div>
                          );
                        }}
                      />
                    )}
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Khối số trong lòng vòm: eyebrow / số hero / số kênh */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center pb-[2%] text-center">
                {empty ? (
                  <>
                    <span className={TEXT_CARD_TITLE}>Doanh thu</span>
                    <span className="mt-1 text-sm text-slate-500">
                      Chưa có đơn trong kỳ này
                    </span>
                  </>
                ) : (
                  <>
                    <span className={TEXT_CARD_TITLE}>Doanh thu</span>
                    <Money
                      value={total}
                      className={cn(
                        TEXT_HERO_NUMBER,
                        "mt-0.5 leading-none sm:text-3xl xl:text-[2rem]"
                      )}
                    />
                    <span className={cn(TEXT_SUB, "mt-1.5 font-medium")}>
                      {rows.length} kênh hoạt động
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Legend lưới auto-fit: thêm sàn mới không phải sửa số cột;
            mobile ~2 cột, card 7/12 ~3 cột, màn rộng 4 cột */}
        {!empty && (
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-x-4 gap-y-3 border-t border-slate-100 pt-4">
            {rows.map((r) => (
              <div key={r.channelName} className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="truncate">{r.label}</span>
                </p>
                <Money
                  value={r.revenue}
                  className="mt-0.5 block text-sm font-semibold text-slate-700"
                />
                <p className={cn(TEXT_SUB, "tabular-nums")}>
                  <span className="font-semibold text-slate-700">
                    {pctOf(r.revenue)}%
                  </span>{" "}
                  · {formatNumber(r.count)} đơn
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
