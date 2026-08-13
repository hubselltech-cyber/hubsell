import React from "react";
import { Text as RNText, View, useWindowDimensions } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import type { PnlDailyPoint } from "../types/api";
import { compactMoney } from "../lib/format";

/**
 * Biểu đồ cột Lãi/Lỗ theo ngày — tự vẽ bằng react-native-svg (~90 dòng) thay
 * vì kéo thư viện chart: chỉ cần cột emerald (lãi) / red (lỗ) quanh baseline 0.
 */
export function ProfitBarChart({ data }: { data: PnlDailyPoint[] }) {
  const { width } = useWindowDimensions();
  // Padding trang (16×2) + padding card (16×2)
  const chartW = Math.max(200, Math.min(width, 480) - 64);
  const chartH = 150;

  if (data.length === 0) {
    return (
      <RNText className="py-8 text-center text-sm text-slate-400">
        Chưa có dữ liệu trong khoảng này
      </RNText>
    );
  }

  const maxProfit = Math.max(0, ...data.map((d) => d.profit));
  const minProfit = Math.min(0, ...data.map((d) => d.profit));
  const span = maxProfit - minProfit || 1;
  const zeroY = (maxProfit / span) * chartH;

  const gap = data.length > 40 ? 1 : 2;
  const barW = Math.max(2, (chartW - gap * (data.length - 1)) / data.length);

  // Nhãn trục X: tối đa 4 mốc cho khỏi chồng chữ
  const labelIdx = new Set(
    [0, Math.floor((data.length - 1) / 3), Math.floor(((data.length - 1) * 2) / 3), data.length - 1]
  );

  return (
    <View>
      <View className="mb-1 flex-row justify-between">
        <RNText className="text-[11px] text-slate-400">
          Cao nhất: {compactMoney(maxProfit)}
        </RNText>
        {minProfit < 0 ? (
          <RNText className="text-[11px] text-red-400">
            Lỗ sâu nhất: {compactMoney(minProfit)}
          </RNText>
        ) : null}
      </View>
      <Svg width={chartW} height={chartH}>
        {data.map((d, i) => {
          const h = (Math.abs(d.profit) / span) * chartH;
          const x = i * (barW + gap);
          const y = d.profit >= 0 ? zeroY - h : zeroY;
          return (
            <Rect
              key={d.date}
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, d.profit === 0 ? 0 : 1.5)}
              rx={barW > 4 ? 2 : 0}
              fill={d.profit >= 0 ? "#10b981" : "#ef4444"}
            />
          );
        })}
        <Line x1={0} y1={zeroY} x2={chartW} y2={zeroY} stroke="#cbd5e1" strokeWidth={1} />
      </Svg>
      <View className="mt-1 flex-row justify-between">
        {data
          .map((d, i) => ({ d, i }))
          .filter(({ i }) => labelIdx.has(i))
          .map(({ d }) => (
            <RNText key={d.date} className="text-[10px] text-slate-400">
              {d.label}
            </RNText>
          ))}
      </View>
    </View>
  );
}
