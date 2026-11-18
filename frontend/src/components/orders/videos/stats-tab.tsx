"use client";

import * as React from "react";
import { Clock, Film, Hourglass, ShoppingBag, Timer } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { StatCard } from "@/components/dashboard/stat-card";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Refreshing } from "@/components/shared/refreshing";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchPackVideoStats, type PackVideoRow, type PackVideoStats } from "@/lib/api";
import { defaultRange, rangeToQuery, type DateRange } from "@/lib/date-range";
import { formatNumber } from "@/lib/format";
import {
  formatClipDuration,
  formatDayShort,
  formatHoursBalance,
  formatHoursMinutes,
  hoursLevel,
  secondsToHours,
} from "@/lib/pack-video";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";

import { HourLedgerCard } from "./hour-ledger";
import { remainingLabel, usePackVideoHours } from "./hours-balance";
import { QuickViewDialog } from "./video-quick-view";
import { VideoTable } from "./video-table";

/** Màu trục — cùng mã với biểu đồ Doanh thu của Tổng quan (đọc được ở cả sáng lẫn tối). */
const AXIS_COLOR = "#64748b";

function DayTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: PackVideoStats["byDay"][number] }>;
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-slate-200/80 bg-card px-3 py-2 text-card-foreground shadow-[0_2px_8px_-2px_rgb(15_23_42/0.15)]">
      <p className={TEXT_SUB}>Ngày {formatDayShort(p.day)}</p>
      <div className="mt-1 space-y-0.5 text-sm tabular-nums">
        <p className="flex justify-between gap-4">
          <span className="text-slate-500">Đã quay</span>
          <span className="font-semibold text-slate-900">{formatHoursMinutes(p.seconds)}</span>
        </p>
        <p className="flex justify-between gap-4">
          <span className="text-slate-500">Số video</span>
          <span className="text-slate-900">{formatNumber(p.videos)}</span>
        </p>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="py-5">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        <div className="mt-4">{children}</div>
      </CardContent>
    </Card>
  );
}

/**
 * TAB THỐNG KÊ — thứ xem thỉnh thoảng nên nằm tab riêng và CHỈ gọi máy chủ khi mở tab
 * (component này chỉ được dựng khi tab đang chọn).
 *
 * Hệ thống không nhắc "quay lâu" (anh Trung chốt 14/11) — shop tự soát bằng các bảng
 * dưới đây: giờ quay theo ngày, theo người quay, và danh sách video dài nhất.
 *
 * Hàng ô số đầu tab là số giờ TỪ TRƯỚC TỚI NAY (còn lại · đã mua · đã quay) + SỔ GIỜ (từng lần mua / cấp /
 * điều chỉnh, 18/11/2026); các khối dưới lọc theo kỳ.
 */
export function StatsTab() {
  const [range, setRange] = React.useState<DateRange>(() => defaultRange());
  const [viewing, setViewing] = React.useState<PackVideoRow | null>(null);

  const q = useApiQuery({
    queryKey: qk.packVideoStats(rangeToQuery(range)),
    queryFn: () => fetchPackVideoStats(range),
  });
  const stats = q.data;
  // Số dư giờ là TỪ TRƯỚC TỚI NAY (không theo kỳ đang chọn) — dùng chung lượt gọi với dải đầu trang.
  const hours = usePackVideoHours().data;
  const level = hours ? hoursLevel(hours.purchasedSeconds, hours.usedSeconds) : "none";
  const chartData = React.useMemo(
    () =>
      (stats?.byDay ?? []).map((d) => ({
        ...d,
        label: formatDayShort(d.day),
        hours: secondsToHours(d.seconds),
      })),
    [stats]
  );

  return (
    <div className="space-y-5">
      {hours && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Giờ còn lại"
            value={remainingLabel(hours).replace(/^Còn /, "")}
            icon={Hourglass}
            tone={level === "out" ? "negative" : level === "low" ? "warning" : "positive"}
            featured
            subtitle={
              level === "out"
                ? "Hết giờ thì không mở được video mới"
                : "Giờ đã mua trừ giờ đã quay, tính từ trước tới nay"
            }
          />
          <StatCard
            label="Giờ đã mua"
            value={formatHoursBalance(hours.purchasedSeconds)}
            icon={ShoppingBag}
            subtitle="Tổng các lần mua và được cấp"
          />
          <StatCard
            label="Giờ đã quay"
            value={formatHoursBalance(hours.usedSeconds)}
            icon={Clock}
            tone="info"
            subtitle="Chỉ tính video đã tải lên xong"
          />
        </div>
      )}

      {hours && <HourLedgerCard hours={hours} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Các số bên dưới tính theo video quay trong kỳ đang chọn.
        </p>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {q.error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{q.error}</CardContent>
        </Card>
      ) : !stats ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Đang tải thống kê…
          </CardContent>
        </Card>
      ) : (
        <Refreshing active={q.placeholder} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Giờ quay trong kỳ"
              value={formatHoursMinutes(stats.totalSeconds)}
              icon={Clock}
              tone="info"
              subtitle="Tổng thời lượng các video trong kỳ"
            />
            <StatCard
              label="Số video"
              value={formatNumber(stats.totalVideos)}
              icon={Film}
              subtitle="Video đóng hàng và video khui hàng"
            />
            <StatCard
              label="Trung bình mỗi video"
              value={formatClipDuration(stats.avgSeconds)}
              icon={Timer}
              subtitle="phút : giây"
            />
          </div>

          <SectionCard title="Giờ quay theo ngày" note="Mỗi cột là tổng thời lượng quay trong một ngày.">
            {chartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Chưa có video nào trong kỳ này.</p>
            ) : (
              <div className="h-56 text-slate-900">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.12} />
                    <XAxis
                      dataKey="label"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "currentColor", strokeOpacity: 0.15 }}
                      stroke={AXIS_COLOR}
                      minTickGap={16}
                    />
                    <YAxis
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      stroke={AXIS_COLOR}
                      // Trục tính bằng giờ nhưng nhãn đọc theo giờ + phút (0,135 giờ → "8 phút"):
                      // shop ít video thì cả trục nằm dưới 1 giờ, in số lẻ của giờ không ai đọc được.
                      tickFormatter={(v: number) => (v === 0 ? "0" : formatHoursMinutes(Math.round(v * 3600)))}
                      width={72}
                    />
                    <Tooltip
                      cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
                      content={({ active, payload }) => (
                        <DayTooltip
                          active={active}
                          payload={payload as ReadonlyArray<{ payload?: PackVideoStats["byDay"][number] }>}
                        />
                      )}
                    />
                    <Bar dataKey="hours" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SectionCard>

          <div className="grid gap-5 xl:grid-cols-2">
            <SectionCard
              title="Theo người quay"
              note="Người quay là tài khoản đang đăng nhập trên app lúc quay."
            >
              {stats.byRecorder.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Chưa có số liệu.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Người quay</TableHead>
                      <TableHead className="text-right">Số video</TableHead>
                      <TableHead className="text-right">Tổng giờ</TableHead>
                      <TableHead className="text-right">Trung bình</TableHead>
                      <TableHead className="text-right">Dài nhất</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.byRecorder.map((r) => (
                      <TableRow key={r.recordedById}>
                        <TableCell>
                          <span className="block max-w-48 truncate" title={r.name ?? undefined}>
                            {r.name ?? "Không rõ"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(r.videos)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatHoursMinutes(r.seconds)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatClipDuration(r.avgSeconds)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatClipDuration(r.maxSeconds)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>

            <SectionCard title="Theo gian hàng">
              {stats.byChannel.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Chưa có số liệu.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Gian hàng</TableHead>
                      <TableHead className="text-right">Số video</TableHead>
                      <TableHead className="text-right">Tổng giờ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.byChannel.map((c) => (
                      <TableRow key={c.channelId}>
                        <TableCell>
                          <span className="block max-w-64 truncate" title={c.shopName ?? undefined}>
                            {c.shopName ?? "Chưa khớp đơn"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(c.videos)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatHoursMinutes(c.seconds)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="Video dài nhất trong kỳ"
            note="Hệ thống không nhắc khi quay lâu — đây là chỗ tự soát các video chiếm nhiều giờ nhất."
          >
            {stats.longest.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Chưa có video nào trong kỳ này.</p>
            ) : (
              <VideoTable rows={stats.longest} onPlay={setViewing} compact initialSort={{ key: "duration", dir: "desc" }} />
            )}
          </SectionCard>
        </Refreshing>
      )}

      <QuickViewDialog video={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
