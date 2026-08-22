import React, { useMemo, useState } from "react";
import {
  Text as RNText,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import Svg, {
  Defs,
  Line,
  LinearGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { useColorScheme } from "nativewind";
import type { PnlDailyPoint } from "../types/api";
import { compactMoney, formatMoney } from "../lib/format";
import { TABULAR } from "../theme/tokens";

/**
 * Biểu đồ cột Lãi/Lỗ theo ngày — tự vẽ bằng react-native-svg, không lib chart.
 * Bản nâng cấp 22/08: gridline + nhãn trục Y, cột gradient bo đầu, CHẠM vào
 * cột để soi số từng ngày (thanh tooltip trên đầu chart), chân chart tổng kết
 * Tổng kỳ · TB/ngày — chuẩn đọc số của dashboard web.
 */
export function ProfitBarChart({ data }: { data: PnlDailyPoint[] }) {
  const { width } = useWindowDimensions();
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  // SVG không ăn class dark: — màu trục/lưới đổi bằng JS
  const baselineColor = dark ? "#475569" : "#cbd5e1";
  const gridColor = dark ? "#1e293b" : "#f1f5f9";
  const axisText = dark ? "#64748b" : "#94a3b8";
  const [selected, setSelected] = useState<number | null>(null);

  // Padding trang (16×2) + padding card (16×2) + cột nhãn trục Y (34)
  const yAxisW = 34;
  const chartW = Math.max(180, Math.min(width, 480) - 64 - yAxisW);
  const chartH = 150;

  const { maxProfit, minProfit, span, zeroY, total, avg } = useMemo(() => {
    const maxP = Math.max(0, ...data.map((d) => d.profit));
    const minP = Math.min(0, ...data.map((d) => d.profit));
    const sp = maxP - minP || 1;
    const sum = data.reduce((s, d) => s + d.profit, 0);
    return {
      maxProfit: maxP,
      minProfit: minP,
      span: sp,
      zeroY: (maxP / sp) * chartH,
      total: sum,
      avg: data.length > 0 ? sum / data.length : 0,
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <RNText className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">
        Chưa có dữ liệu trong khoảng này
      </RNText>
    );
  }

  const gap = data.length > 40 ? 1 : 2;
  const barW = Math.max(2, (chartW - gap * (data.length - 1)) / data.length);

  // Nhãn trục X: tối đa 4 mốc cho khỏi chồng chữ
  const labelIdx = new Set([
    0,
    Math.floor((data.length - 1) / 3),
    Math.floor(((data.length - 1) * 2) / 3),
    data.length - 1,
  ]);

  // Mốc lưới ngang: đỉnh lãi, nửa lãi, 0, (đáy lỗ nếu có) — đủ đọc cỡ số.
  // Dedupe theo giá trị: kỳ toàn lỗ thì đỉnh lãi = 0 trùng mốc baseline.
  const gridLines = [
    maxProfit,
    ...(maxProfit > 0 ? [maxProfit / 2] : []),
    0,
    ...(minProfit < 0 ? [minProfit] : []),
  ]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map((v) => ({ v, y: ((maxProfit - v) / span) * chartH }));

  // Chạm/kéo trên vùng chart → chọn cột theo toạ độ X
  const pick = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX;
    const idx = Math.min(
      data.length - 1,
      Math.max(0, Math.floor(x / (barW + gap)))
    );
    setSelected(idx);
  };

  const sel = selected !== null ? data[selected] : null;

  return (
    <View>
      {/* Thanh soi số — chạm cột nào hiện ngày đó, mặc định gợi ý thao tác */}
      <View className="mb-2 h-9 flex-row items-center justify-between rounded-xl bg-slate-50 px-3 dark:bg-slate-950">
        {sel ? (
          <>
            <RNText className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Ngày {sel.label} · {sel.orderCount} đơn
            </RNText>
            <RNText
              className={`text-[13px] font-bold ${
                sel.profit < 0
                  ? "text-red-500 dark:text-red-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
              style={TABULAR}
            >
              {formatMoney(sel.profit)}
            </RNText>
          </>
        ) : (
          <RNText className="text-[11px] text-slate-400 dark:text-slate-500">
            Chạm vào cột để xem số từng ngày
          </RNText>
        )}
      </View>

      <View className="flex-row">
        {/* Nhãn trục Y — đặt ngoài SVG để dùng font hệ thống + tabular */}
        <View style={{ width: yAxisW, height: chartH }}>
          {gridLines.map((g) => (
            <RNText
              key={`ax-${g.v}`}
              className="absolute right-1 text-[9px]"
              style={[{ top: Math.min(g.y, chartH - 10) - 4, color: axisText }, TABULAR]}
            >
              {g.v === 0 ? "0" : compactMoney(g.v)}
            </RNText>
          ))}
        </View>
        <View
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={pick}
          onResponderMove={pick}
        >
          <Svg width={chartW} height={chartH}>
            <Defs>
              <LinearGradient id="pbc-up" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#34d399" />
                <Stop offset="1" stopColor="#059669" />
              </LinearGradient>
              <LinearGradient id="pbc-down" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#f87171" />
                <Stop offset="1" stopColor="#dc2626" />
              </LinearGradient>
            </Defs>
            {gridLines.map((g) => (
              <Line
                key={`gl-${g.v}`}
                x1={0}
                y1={g.y}
                x2={chartW}
                y2={g.y}
                stroke={g.v === 0 ? baselineColor : gridColor}
                strokeWidth={1}
                strokeDasharray={g.v === 0 ? undefined : "3 4"}
              />
            ))}
            {data.map((d, i) => {
              const h = (Math.abs(d.profit) / span) * chartH;
              const x = i * (barW + gap);
              const y = d.profit >= 0 ? zeroY - h : zeroY;
              const dimmed = selected !== null && selected !== i;
              return (
                <Rect
                  key={d.date}
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(h, d.profit === 0 ? 0 : 1.5)}
                  rx={barW > 4 ? 2 : 0}
                  fill={d.profit >= 0 ? "url(#pbc-up)" : "url(#pbc-down)"}
                  opacity={dimmed ? 0.35 : 1}
                />
              );
            })}
          </Svg>
        </View>
      </View>

      <View className="mt-1 flex-row justify-between" style={{ marginLeft: yAxisW }}>
        {data
          .map((d, i) => ({ d, i }))
          .filter(({ i }) => labelIdx.has(i))
          .map(({ d }) => (
            <RNText
              key={d.date}
              className="text-[10px] text-slate-400 dark:text-slate-500"
              style={TABULAR}
            >
              {d.label}
            </RNText>
          ))}
      </View>

      {/* Tổng kết kỳ — đọc nhanh không cần cộng nhẩm theo cột */}
      <View className="mt-3 flex-row border-t border-slate-100 pt-2.5 dark:border-slate-800">
        <View className="flex-1">
          <RNText className="text-[10px] text-slate-400 dark:text-slate-500">
            Tổng kỳ
          </RNText>
          <RNText
            className={`text-[13px] font-bold ${
              total < 0
                ? "text-red-500 dark:text-red-400"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
            style={TABULAR}
          >
            {compactMoney(total)}
          </RNText>
        </View>
        <View className="flex-1">
          <RNText className="text-[10px] text-slate-400 dark:text-slate-500">
            TB mỗi ngày
          </RNText>
          <RNText
            className="text-[13px] font-bold text-slate-900 dark:text-slate-100"
            style={TABULAR}
          >
            {compactMoney(avg)}
          </RNText>
        </View>
        <View className="flex-1 items-end">
          <RNText className="text-[10px] text-slate-400 dark:text-slate-500">
            Đỉnh {minProfit < 0 ? "· đáy" : ""}
          </RNText>
          <RNText className="text-[13px] font-bold text-slate-900 dark:text-slate-100" style={TABULAR}>
            {compactMoney(maxProfit)}
            {minProfit < 0 ? (
              <RNText className="text-red-500 dark:text-red-400">
                {"  "}{compactMoney(minProfit)}
              </RNText>
            ) : null}
          </RNText>
        </View>
      </View>
    </View>
  );
}
