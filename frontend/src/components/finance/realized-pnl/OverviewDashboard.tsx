"use client";

/**
 * DASHBOARD "TỔNG QUAN LỢI NHUẬN" — Executive P&L & Return Analytics.
 *
 * Thay bảng danh sách đơn (đã có ở các tab sàn con) bằng bức tranh điều hành:
 *   - 4 thẻ chỉ số: Lãi ròng thực nhận · Thất thu do đơn hoàn · Tỷ lệ hoàn
 *     toàn mạng · Sàn có tỷ lệ hoàn cao nhất (badge cảnh báo).
 *   - Khối 1: Lãi/Lỗ & Tỷ lệ hoàn theo ngày (cột tiền trục trái, line % trục phải).
 *   - Khối 2: So sánh 3 sàn về đơn hoàn (3 biểu đồ nhỏ CÙNG đơn vị — không
 *     trộn tiền/%/số đơn lên một trục cho đỡ nói dối thị giác).
 *   - Khối 3: Donut bóc tách thất thu thành 3 khoản (vốn mất · ship hoàn · phí sàn).
 *
 * Toàn bộ số liệu lấy NGUYÊN KHỐI từ summary của /api/finance/realized-pnl
 * (SSOT computePnlRow + computeReturnLoss) — component này KHÔNG tự tính lại
 * tài chính, chỉ cộng trừ hiển thị.
 */

import { AlertTriangle, PackageOpen, RotateCcw } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber, formatVND } from "@/lib/format";
import type { ChannelName, RealizedPnlSummary } from "@/lib/api";
import { moneyTone, TEXT_CARD_TITLE, TEXT_SUB } from "@/lib/typography";
// Màu nhận diện sàn trên biểu đồ — dùng chung bảng CHANNEL_COLORS toàn hệ thống.
import { CHANNEL_COLORS as PLATFORM_CHART_COLORS } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

// 3 sàn so sánh cố định (spec dashboard) — OFFLINE không có khái niệm "hoàn sàn".
const PLATFORMS: ChannelName[] = ["SHOPEE", "TIKTOK", "LAZADA"];

// Màu 3 lát donut thất thu: vốn mất (đỏ — nặng nhất) · ship hoàn · phí sàn.
const LOSS_COLORS = { cost: "#ef4444", ship: "#f59e0b", fee: "#64748b" };

/** Rút gọn tiền trên trục biểu đồ: 1.2tr / 350k. */
function compactVND(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}tr`;
  return `${sign}${Math.round(abs / 1000)}k`;
}

/** Chấm chú giải thủ công dưới biểu đồ (cùng phong cách Dashboard chính). */
function LegendDot({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

export function OverviewDashboard({ summary }: { summary: RealizedPnlSummary }) {
  const returnRate =
    summary.count > 0 ? (summary.returnCount / summary.count) * 100 : 0;

  // Sàn có TỶ LỆ HOÀN cao nhất (chỉ xét sàn có phát sinh đơn trong kỳ).
  const platformRows = PLATFORMS.map((key) => {
    const b = summary.byPlatform[key];
    return {
      key,
      label: CHANNEL_META[key].label,
      count: b?.count ?? 0,
      returnCount: b?.returnCount ?? 0,
      returnLoss: b?.returnLoss ?? 0,
      returnRatePercent: b && b.count > 0 ? (b.returnCount / b.count) * 100 : 0,
    };
  });
  const worst = platformRows
    .filter((p) => p.count > 0)
    .reduce<(typeof platformRows)[number] | null>(
      (acc, p) =>
        acc === null || p.returnRatePercent > acc.returnRatePercent ? p : acc,
      null
    );

  // Phòng hộ lệch pha deploy: frontend (Vercel) có thể lên trước backend
  // (Render) vài phút — summary cũ chưa có 2 trường mới thì hiện 0 thay vì vỡ.
  const loss = summary.returnLoss ?? { total: 0, feeLoss: 0, shipLoss: 0, costLoss: 0 };
  const daily = summary.daily ?? [];
  const donutData = [
    { key: "cost", name: "Giá vốn hàng mất/hỏng", value: loss.costLoss, color: LOSS_COLORS.cost },
    { key: "ship", name: "Phí ship hoàn 2 chiều", value: loss.shipLoss, color: LOSS_COLORS.ship },
    { key: "fee", name: "Phí & thuế sàn không hoàn", value: loss.feeLoss, color: LOSS_COLORS.fee },
  ];
  const lossShare = (v: number) => (loss.total > 0 ? (v / loss.total) * 100 : 0);

  return (
    <div className="space-y-4">
      {/* ===== 4 THẺ CHỈ SỐ ĐIỀU HÀNH ===== */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="shadow-sm">
          <CardContent className="px-4 py-3">
            <p className={TEXT_CARD_TITLE}>Lợi nhuận ròng thực nhận</p>
            <p
              className={cn(
                "mt-1 text-xl font-bold tracking-tight",
                moneyTone(summary.totalProfitAfterTax)
              )}
            >
              <Money value={summary.totalProfitAfterTax} />
            </p>
            <p className={cn(TEXT_SUB, "mt-1")}>
              {formatNumber(summary.count)} đơn ·{" "}
              {formatNumber(summary.settledCount)} đã đối soát
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="px-4 py-3">
            <p className={TEXT_CARD_TITLE}>Thất thu do đơn hoàn</p>
            <p className="mt-1 text-xl font-bold tracking-tight text-red-500">
              − <Money value={loss.total} />
            </p>
            <p className={cn(TEXT_SUB, "mt-1")}>
              vốn mất + ship hoàn + phí sàn không hoàn
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="px-4 py-3">
            <p className={TEXT_CARD_TITLE}>Tỷ lệ hoàn toàn mạng</p>
            <p className="mt-1 flex items-center gap-1.5 text-xl font-bold tracking-tight text-slate-900">
              <RotateCcw className="size-4 text-slate-400" />
              {returnRate.toFixed(1)}%
            </p>
            <p className={cn(TEXT_SUB, "mt-1")}>
              {formatNumber(summary.returnCount)} / {formatNumber(summary.count)}{" "}
              đơn có hoàn/trả
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="px-4 py-3">
            <p className={TEXT_CARD_TITLE}>Sàn tỷ lệ hoàn cao nhất</p>
            {worst && worst.returnCount > 0 ? (
              <>
                <p className="mt-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
                      CHANNEL_META[worst.key].className
                    )}
                  >
                    <AlertTriangle className="size-3" />
                    {worst.label}
                  </span>
                  <span className="text-xl font-bold tracking-tight text-red-500">
                    {worst.returnRatePercent.toFixed(1)}%
                  </span>
                </p>
                <p className={cn(TEXT_SUB, "mt-1")}>
                  {formatNumber(worst.returnCount)} đơn hoàn · thất thu{" "}
                  {formatVND(worst.returnLoss)}
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-xl font-bold tracking-tight text-emerald-500">
                  Không có đơn hoàn
                </p>
                <p className={cn(TEXT_SUB, "mt-1")}>
                  chưa sàn nào phát sinh hoàn/trả trong kỳ
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== KHỐI 1 (7 cột) + KHỐI 3 DONUT (5 cột) ===== */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
        <Card className="h-full shadow-sm lg:col-span-7">
          <CardHeader>
            <CardTitle>Lãi/Lỗ &amp; Tỷ lệ hoàn theo thời gian</CardTitle>
            <CardDescription>
              Cột: lợi nhuận thực tế vs tiền thất thu đơn hoàn mỗi ngày · Đường:
              % đơn hoàn trên tổng đơn phát sinh trong ngày.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="label"
                    fontSize={12}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                    stroke="#64748b"
                  />
                  <YAxis
                    yAxisId="money"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    stroke="#64748b"
                    width={56}
                    tickFormatter={compactVND}
                  />
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    stroke="#64748b"
                    width={44}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    cursor={{ fill: "#f1f5f9" }}
                    formatter={(value, name) =>
                      name === "returnRatePercent"
                        ? [`${Number(value).toFixed(1)}%`, "Tỷ lệ hoàn"]
                        : [
                            formatVND(Number(value)),
                            name === "profit" ? "Lợi nhuận" : "Thất thu hoàn",
                          ]
                    }
                  />
                  <Bar
                    yAxisId="money"
                    dataKey="profit"
                    name="profit"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={24}
                  />
                  <Bar
                    yAxisId="money"
                    dataKey="returnLoss"
                    name="returnLoss"
                    fill="#ef4444"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={24}
                  />
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="returnRatePercent"
                    name="returnRatePercent"
                    stroke="#64748b"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className={cn(TEXT_SUB, "mt-3 flex flex-wrap items-center gap-4")}>
              <LegendDot color="#10b981">Lợi nhuận thực tế</LegendDot>
              <LegendDot color="#ef4444">Thất thu đơn hoàn</LegendDot>
              <LegendDot color="#64748b">Tỷ lệ hoàn (%)</LegendDot>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full shadow-sm lg:col-span-5">
          <CardHeader>
            <CardTitle>Bóc tách nguyên nhân thất thu</CardTitle>
            <CardDescription>
              Tổng thất thu đơn hoàn phân rã thành 3 khoản cấu thành.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loss.total > 0 ? (
              <>
                <div className="relative h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="62%"
                        outerRadius="88%"
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {donutData.map((d) => (
                          <Cell key={d.key} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [
                          `${formatVND(Number(value))} (${lossShare(Number(value)).toFixed(1)}%)`,
                          String(name),
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Số tổng đặt giữa lỗ donut — overlay tuyệt đối, không chặn hover */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className={TEXT_CARD_TITLE}>Tổng thất thu</span>
                    <span className="text-lg font-bold tracking-tight text-red-500">
                      {formatVND(loss.total)}
                    </span>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {donutData.map((d) => (
                    <li
                      key={d.key}
                      className="flex items-center justify-between text-sm"
                    >
                      <LegendDot color={d.color}>
                        <span className="text-slate-600">{d.name}</span>
                      </LegendDot>
                      <span className="font-medium tabular-nums text-slate-900">
                        {formatVND(d.value)}
                        <span className="ml-1.5 text-xs text-slate-500">
                          {lossShare(d.value).toFixed(1)}%
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="flex h-56 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <PackageOpen className="mb-2 size-8" />
                Kỳ này chưa phát sinh thất thu do đơn hoàn.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== KHỐI 2: SO SÁNH ĐA SÀN — 3 biểu đồ nhỏ cùng hàng, mỗi biểu đồ
          MỘT đơn vị đo (số đơn / % / tiền) để trục không phải trộn thang đo. ===== */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>So sánh tỷ lệ hoàn &amp; thất thu đa sàn</CardTitle>
          <CardDescription>
            Shopee vs TikTok Shop vs Lazada trong cùng kỳ &amp; bộ lọc hiện tại.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            {(
              [
                {
                  title: "Số đơn hoàn",
                  dataKey: "returnCount",
                  tickFormatter: (v: number) => formatNumber(v),
                  tooltip: (v: number) => formatNumber(v) + " đơn",
                },
                {
                  title: "Tỷ lệ hoàn (%)",
                  dataKey: "returnRatePercent",
                  tickFormatter: (v: number) => `${v}%`,
                  tooltip: (v: number) => `${v.toFixed(1)}%`,
                },
                {
                  title: "Tiền thất thu",
                  dataKey: "returnLoss",
                  tickFormatter: compactVND,
                  tooltip: (v: number) => formatVND(v),
                },
              ] as const
            ).map((m) => (
              <div key={m.dataKey}>
                <p className={cn(TEXT_CARD_TITLE, "mb-2 text-center")}>{m.title}</p>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={platformRows}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#e2e8f0"
                      />
                      <XAxis
                        dataKey="label"
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f0" }}
                        stroke="#64748b"
                      />
                      <YAxis
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        stroke="#64748b"
                        width={48}
                        allowDecimals={false}
                        tickFormatter={m.tickFormatter}
                      />
                      <Tooltip
                        cursor={{ fill: "#f1f5f9" }}
                        formatter={(value) => [m.tooltip(Number(value)), m.title]}
                      />
                      <Bar dataKey={m.dataKey} radius={[4, 4, 0, 0]} maxBarSize={40}>
                        {platformRows.map((p) => (
                          <Cell
                            key={p.key}
                            fill={PLATFORM_CHART_COLORS[p.key] ?? "#94a3b8"}
                          />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
          <div className={cn(TEXT_SUB, "mt-4 flex flex-wrap items-center gap-4")}>
            {platformRows.map((p) => (
              <LegendDot key={p.key} color={PLATFORM_CHART_COLORS[p.key] ?? "#94a3b8"}>
                {p.label} · {formatNumber(p.returnCount)}/{formatNumber(p.count)} đơn
                hoàn · thất thu {formatVND(p.returnLoss)}
              </LegendDot>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
