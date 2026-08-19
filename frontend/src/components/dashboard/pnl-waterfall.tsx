"use client";

import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Money } from "@/components/ui/money";
import { formatCompactVND, formatVND } from "@/lib/format";
import { moneyTone, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/** Một khoản bị trừ khỏi doanh thu gộp. */
export interface WaterfallStep {
  key: string;
  /** Tên đầy đủ (tooltip) */
  label: string;
  /** Tên ngắn cho trục X (card 5/12 cột chỉ ~60px mỗi cột) */
  short: string;
  amount: number;
  /** rose = khoản "bắt buộc" của bán hàng (giá vốn, sàn); amber = chi phí vận hành */
  hue: "rose" | "amber";
}

export interface PnlWaterfallProps {
  /** Doanh thu gộp — cột xuất phát */
  gross: number;
  /** Các khoản trừ theo đúng thứ tự nghiệp vụ; khoản 0 đồng tự ẩn */
  steps: WaterfallStep[];
  /** Lợi nhuận ròng — cột chốt sổ (truyền vào chứ không tự cộng để luôn khớp thẻ KPI) */
  net: number;
  /** Chiều cao vùng vẽ (px) */
  height?: number;
  className?: string;
}

type RowKind = "gross" | "step" | "net";

interface WaterfallRow {
  key: string;
  label: string;
  short: string;
  kind: RowKind;
  /** Số tiền CÓ DẤU theo ngữ nghĩa: gross/net là giá trị, step là −amount */
  signed: number;
  /** [thấp, cao] — Range Bar chính thức của Recharts, âm/dương đều đúng */
  range: [number, number];
  /** Mức "sàn" sau cột này — nét nối bậc thang kéo tới tâm cột kế tiếp */
  level: number;
  /** % so với doanh thu gộp (undefined khi gross = 0) */
  pct?: number;
  fill: string;
  /** Chữ trên đầu cột */
  tag: string;
}

// ── Bảng màu tín hiệu (cùng thang với lib/typography + chart khác trên trang) ──
const COLOR = {
  emerald: "#10b981", // emerald-500 — doanh thu
  emeraldDeep: "#059669", // emerald-600 — lợi nhuận ròng dương (tiền về túi)
  emeraldSoft: "#34d399", // emerald-400 — khoản "trừ âm" (sàn trả lại → cộng)
  rose: "#f43f5e", // rose-500 — giá vốn, sàn khấu trừ
  amber: "#f59e0b", // amber-500 — quảng cáo, vận hành
  red: "#ef4444", // red-500 — lỗ ròng
  axis: "#64748b", // slate-500
  connector: "#94a3b8", // slate-400
};

function buildRows(gross: number, steps: WaterfallStep[], net: number): WaterfallRow[] {
  const pctOf = (v: number) =>
    gross > 0 ? Math.round((Math.abs(v) / gross) * 1000) / 10 : undefined;

  const rows: WaterfallRow[] = [];
  rows.push({
    key: "gross",
    label: "Doanh thu gộp",
    short: "Doanh thu",
    kind: "gross",
    signed: gross,
    range: [Math.min(0, gross), Math.max(0, gross)],
    level: gross,
    pct: gross > 0 ? 100 : undefined,
    fill: "url(#pnl-wf-gross)", // thay bằng id thật khi render
    tag: formatCompactVND(gross),
  });

  let running = gross;
  for (const st of steps) {
    if (st.amount === 0) continue;
    const after = running - st.amount;
    rows.push({
      key: st.key,
      label: st.label,
      short: st.short,
      kind: "step",
      signed: -st.amount,
      range: [Math.min(running, after), Math.max(running, after)],
      level: after,
      pct: pctOf(st.amount),
      // Khoản trừ ÂM (sàn trả lại tiền) thực chất là CỘNG → xanh nhạt
      fill: st.amount < 0 ? COLOR.emeraldSoft : st.hue === "rose" ? COLOR.rose : COLOR.amber,
      tag: formatCompactVND(-st.amount),
    });
    running = after;
  }

  rows.push({
    key: "net",
    label: "Lợi nhuận ròng",
    short: "Lãi ròng",
    kind: "net",
    signed: net,
    range: [Math.min(0, net), Math.max(0, net)],
    level: net,
    pct: pctOf(net),
    fill: net >= 0 ? COLOR.emeraldDeep : COLOR.red,
    tag: formatCompactVND(net),
  });
  return rows;
}

/** Tooltip: tên khoản · số tiền đầy đủ · % so với doanh thu gộp. */
function WaterfallTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: WaterfallRow }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const pctLine =
    row.pct === undefined
      ? null
      : row.kind === "gross"
        ? "Mốc 100% để so các khoản"
        : row.kind === "net"
          ? `Biên lợi nhuận ${row.signed < 0 ? "−" : ""}${row.pct}% doanh thu gộp`
          : `${row.signed > 0 ? "Cộng thêm" : "Ăn mất"} ${row.pct}% doanh thu gộp`;
  return (
    <div className="rounded-lg border border-slate-200/80 bg-card px-3 py-2 text-card-foreground shadow-[0_2px_8px_-2px_rgb(15_23_42/0.15)]">
      <p className={TEXT_SUB}>{row.label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          row.kind === "step" && row.signed < 0
            ? "text-slate-900"
            : moneyTone(row.signed)
        )}
      >
        {row.kind === "step" && row.signed < 0 ? "− " : ""}
        {formatVND(Math.abs(row.signed))}
      </p>
      {pctLine && <p className={cn(TEXT_SUB, "mt-0.5")}>{pctLine}</p>}
    </div>
  );
}

/**
 * BIỂU ĐỒ THÁC NƯỚC P&L — Doanh thu gộp bị "xén" dần qua từng khoản cho tới
 * Lợi nhuận ròng. Mỗi cột là một Range Bar [thấp, cao] nên lợi nhuận ÂM vẫn
 * vẽ đúng (cột chốt rơi xuống dưới 0); nét đứt nối đáy cột trước với đỉnh cột
 * sau để mắt lần theo "bậc thang" tiền bị bào mòn.
 *
 * Không tự cộng trừ: gross/steps/net nhận từ P&L Engine (analytics SSOT) —
 * đẳng thức gross − Σsteps = net là trách nhiệm của backend, chart chỉ vẽ.
 */
export function PnlWaterfall({
  gross,
  steps,
  net,
  height = 256,
  className,
}: PnlWaterfallProps) {
  const rawId = useId();
  const gradId = `pnl-wf-gross-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rows = buildRows(gross, steps, net).map((r) =>
    r.kind === "gross" ? { ...r, fill: `url(#${gradId})` } : r
  );

  const empty = gross === 0 && rows.length <= 2 && net === 0;
  if (empty) {
    return (
      <p className="py-10 text-center text-sm text-slate-500">
        Chưa có đơn nào trong kỳ này.
      </p>
    );
  }

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 22, right: 4, bottom: 0, left: 4 }}
          barCategoryGap="22%"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR.emerald} stopOpacity={1} />
              <stop offset="100%" stopColor={COLOR.emerald} stopOpacity={0.55} />
            </linearGradient>
          </defs>
          {/* currentColor = màu chữ thẻ → lưới tự dịu trong dark mode, không hardcode */}
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="currentColor"
            strokeOpacity={0.12}
          />
          <XAxis
            dataKey="short"
            interval={0}
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.15 }}
            stroke={COLOR.axis}
            tickMargin={6}
          />
          {/* Ẩn trục Y để nhường bề ngang cho 6 cột; giá trị đã ghi trên đầu cột */}
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
            content={({ active, payload }) => (
              <WaterfallTooltip
                active={active}
                payload={payload as ReadonlyArray<{ payload?: WaterfallRow }>}
              />
            )}
          />
          {/* Nét nối bậc thang: từ tâm cột i tới tâm cột i+1 tại mức sau cột i.
              Đặt TRƯỚC <Bar> để cột đè lên nét, chỉ lộ đoạn nằm trong khe */}
          {rows.slice(0, -1).map((r, i) => (
            <ReferenceLine
              key={`link-${r.key}`}
              segment={[
                { x: r.short, y: r.level },
                { x: rows[i + 1].short, y: r.level },
              ]}
              stroke={COLOR.connector}
              strokeDasharray="3 3"
              strokeWidth={1}
              ifOverflow="extendDomain"
            />
          ))}
          <Bar
            dataKey="range"
            isAnimationActive={false}
            radius={[4, 4, 2, 2]}
            maxBarSize={44}
          >
            {rows.map((r) => (
              <Cell key={r.key} fill={r.fill} />
            ))}
            <LabelList
              dataKey="tag"
              position="top"
              fontSize={11}
              fill={COLOR.axis}
              className="tabular-nums"
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Dòng chốt sổ dưới biểu đồ — "tiền thực về túi" bằng số đầy đủ. */
export function PnlWaterfallFooter({ net, gross }: { net: number; gross: number }) {
  const margin = gross > 0 ? Math.round((net / gross) * 1000) / 10 : null;
  return (
    <div className="mt-2 flex items-baseline justify-between gap-3 border-t pt-3">
      <span className="text-sm font-medium text-slate-900">
        Lợi nhuận ròng
        {margin !== null && (
          <span className={cn(TEXT_SUB, "ml-2 font-normal")}>
            biên {margin}%
          </span>
        )}
      </span>
      <Money value={net} className={cn("text-lg font-bold", moneyTone(net))} />
    </div>
  );
}
