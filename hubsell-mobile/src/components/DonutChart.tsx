import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { useColorScheme } from "nativewind";
import { TABULAR } from "../theme/tokens";

export interface GenericSlice {
  label: string;
  value: number;
  color: string;
}

/**
 * Donut dùng chung (strokeDasharray trên Circle — không cần lib chart).
 * CHỈ vẽ vòng + số tâm; chú giải do màn hình gọi tự render (Tổng quan cần
 * danh sách sàn cố định, Tài chính cần bóc chi tiết con — legend chung 22/08
 * không còn ai dùng nên đã gỡ).
 */
export function DonutChart({
  slices,
  centerLabel,
  centerSub,
  size = 168,
}: {
  slices: GenericSlice[];
  centerLabel: string;
  centerSub: string;
  size?: number;
}) {
  const { colorScheme } = useColorScheme();
  // Vòng nền donut: slate-200 sáng / slate-700 tối (SVG không ăn class dark:)
  const trackColor = colorScheme === "dark" ? "#334155" : "#e2e8f0";
  const total = slices.reduce((s, x) => s + Math.max(x.value, 0), 0);
  const stroke = Math.round(size * 0.13);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  let acc = 0;
  const arcs = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = total > 0 ? s.value / total : 0;
      const arc = { ...s, frac, offset: acc };
      acc += frac;
      return arc;
    });

  return (
    <View className="items-center">
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          {/* rotate dạng chuỗi SVG chuẩn — prop rotation/origin bị RN-web dịch
              thành attr transform-origin, React báo Invalid DOM property */}
          <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={trackColor}
              strokeWidth={stroke}
              fill="none"
            />
            {arcs.map((a) => (
              <Circle
                key={a.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={a.color}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={`${Math.max(a.frac * c - 3, 0.5)} ${c}`}
                strokeDashoffset={-a.offset * c}
                strokeLinecap="butt"
              />
            ))}
          </G>
        </Svg>
        <View className="absolute inset-0 items-center justify-center">
          <Text
            className="text-2xl font-bold text-slate-900 dark:text-slate-100"
            style={TABULAR}
          >
            {centerLabel}
          </Text>
          <Text className="text-[11px] text-slate-400 dark:text-slate-500">{centerSub}</Text>
        </View>
      </View>
    </View>
  );
}
