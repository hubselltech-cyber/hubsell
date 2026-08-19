"use client";

import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

import { cn } from "@/lib/utils";

/**
 * Sắc thái của đường sóng — chỉ 3 trạng thái, bám đúng hệ màu tín hiệu:
 *   positive → emerald (tăng / lãi)
 *   negative → rose    (giảm / lỗ)
 *   warning  → amber   (khoản chi — không tốt không xấu, chỉ cần để mắt)
 */
export type SparklineTone = "positive" | "negative" | "warning";

const STROKE: Record<SparklineTone, string> = {
  positive: "#10b981", // emerald-500
  negative: "#f43f5e", // rose-500
  warning: "#f59e0b", // amber-500
};

export interface KpiSparklineProps {
  /** Chuỗi giá trị theo ngày (đã đúng thứ tự thời gian). */
  data: number[];
  tone: SparklineTone;
  className?: string;
}

/**
 * ĐƯỜNG SÓNG TRANG TRÍ chìm dưới đáy thẻ KPI — thuần thị giác, không trục,
 * không tooltip, không bắt chuột (pointer-events-none ở lớp bọc). Dùng để
 * liếc thấy "nhịp" 14 ngày của chỉ số; con số chính xác vẫn là số to trên thẻ.
 *
 * Lưu ý kỹ thuật:
 *  - Mỗi thẻ cần id gradient RIÊNG (useId) — 4 thẻ cùng id SVG sẽ lấy nhầm
 *    màu của nhau vì <defs> là toàn cục trong document.
 *  - initialDimension để ResponsiveContainer không cảnh báo width 0 ở lần
 *    paint đầu khi nằm trong hộp absolute.
 *  - Dữ liệu phẳng (mọi điểm bằng nhau) thì không vẽ: trục Y suy biến, đường
 *    nằm lửng vô nghĩa.
 */
export function KpiSparkline({ data, tone, className }: KpiSparklineProps) {
  const rawId = useId();
  // useId có thể chứa ký tự lạ (":" / "«») — làm sạch để url(#…) luôn hợp lệ
  const gradId = `kpi-spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  if (min === max) return null;

  const points = data.map((v, i) => ({ i, v }));
  const stroke = STROKE[tone];

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 h-14 select-none",
        className
      )}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        initialDimension={{ width: 320, height: 56 }}
      >
        <AreaChart
          data={points}
          margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          {/* Trục ẩn chỉ để ép domain ôm sát dữ liệu — mặc định Recharts neo
              đáy ở 0 nên chuỗi dao động quanh 5–8tr sẽ bẹp dí sát mép trên */}
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.5}
            strokeOpacity={0.55}
            fill={`url(#${gradId})`}
            fillOpacity={1}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            // Cần baseValue để vùng tô luôn đổ về đáy thẻ kể cả khi min > 0
            baseValue="dataMin"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
