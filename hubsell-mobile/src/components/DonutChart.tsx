import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";

export interface GenericSlice {
  label: string;
  value: number;
  color: string;
  /** Dòng phụ bên phải chú giải (vd "12,3 tr" hoặc "13 đơn"). */
  detail?: string;
}

/**
 * Donut dùng chung (strokeDasharray trên Circle — không cần lib chart).
 * Bố cục DỌC cho mobile: donut CĂN GIỮA, chú giải nằm dưới.
 */
export function DonutChart({
  slices,
  centerLabel,
  centerSub,
  size = 168,
  showLegend = true,
}: {
  slices: GenericSlice[];
  centerLabel: string;
  centerSub: string;
  size?: number;
  /** false = chỉ vẽ donut, nơi gọi tự render danh sách cố định bên dưới. */
  showLegend?: boolean;
}) {
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
          <G rotation={-90} originX={size / 2} originY={size / 2}>
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke="#e2e8f0"
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
                strokeDasharray={`${Math.max(a.frac * c - 2, 0.5)} ${c}`}
                strokeDashoffset={-a.offset * c}
                strokeLinecap="butt"
              />
            ))}
          </G>
        </Svg>
        <View className="absolute inset-0 items-center justify-center">
          <Text className="text-xl font-bold text-slate-900">{centerLabel}</Text>
          <Text className="text-[11px] text-slate-400">{centerSub}</Text>
        </View>
      </View>

      {!showLegend ? null : (
      <View className="mt-4 w-full max-w-[280px]">
        {slices.map((s) => (
          <View key={s.label} className="mb-1.5 flex-row items-center gap-2">
            <View
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <Text className="flex-1 text-xs text-slate-600" numberOfLines={1}>
              {s.label}
            </Text>
            {s.detail ? (
              <Text className="text-xs font-semibold text-slate-900">{s.detail}</Text>
            ) : null}
            <Text className="w-10 text-right text-xs font-semibold text-slate-500">
              {total > 0 ? Math.round((Math.max(s.value, 0) / total) * 100) : 0}%
            </Text>
          </View>
        ))}
      </View>
      )}
    </View>
  );
}
