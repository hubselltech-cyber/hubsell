import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import Svg, { Defs, Line, LinearGradient, Rect, Stop } from "react-native-svg";
import { useColorScheme } from "nativewind";
import { compactMoney } from "@/lib/format";
import { TABULAR } from "@/theme/tokens";

/** Một khoản bị trừ khỏi doanh thu — cùng shape với WaterfallStep của web. */
export interface WaterfallStep {
  key: string;
  /** Tên ngắn cho trục X (mỗi cột chỉ ~50px trên điện thoại). */
  short: string;
  amount: number;
  /** rose = khoản bắt buộc của bán hàng (giá vốn, sàn); amber = chi phí vận hành. */
  hue: "rose" | "amber";
}

interface Bar {
  key: string;
  short: string;
  /** [thấp, cao] theo đơn vị tiền — âm/dương đều đúng. */
  lo: number;
  hi: number;
  /** Mức SAU cột — nối chấm sang cột kế. */
  level: number;
  fill: string;
  tag: string;
  tagColor: string;
}

const COLOR = {
  rose: "#f43f5e",
  amber: "#f59e0b",
  emeraldSoft: "#6ee7b7",
  emeraldDeep: "#059669",
  red: "#dc2626",
};

/**
 * BÓC TÁCH DÒNG TIỀN — thác nước giống Tổng quan web (PnlWaterfall): cột đầu
 * Doanh thu (gradient xanh), các khoản trừ rơi dần (hồng = giá vốn/sàn, vàng =
 * vận hành; khoản ÂM = sàn trả lại → xanh nhạt), cột cuối Lãi ròng (xanh đậm,
 * đỏ nếu lỗ). Không tự cộng: gross/steps/net nhận từ backend, chart chỉ vẽ.
 *
 * CO GIÃN THEO MÀN HÌNH: đo bề rộng thật của card bằng onLayout rồi chia đều
 * cho số cột. Màn hẹp (≤ 320px) không đủ 48px/cột để đọc nhãn thì chart rộng
 * hơn card và trượt ngang được, thay vì cắt chữ.
 */
const MIN_SLOT = 48;
export function WaterfallChart({
  gross,
  steps,
  net,
  height = 190,
}: {
  gross: number;
  steps: WaterfallStep[];
  net: number;
  height?: number;
}) {
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  const [width, setWidth] = useState(0);
  const connector = dark ? "#475569" : "#94a3b8";
  const baseline = dark ? "#334155" : "#e2e8f0";
  const labelColor = dark ? "#94a3b8" : "#64748b";

  const bars: Bar[] = [];
  bars.push({
    key: "gross",
    short: "Doanh thu",
    lo: Math.min(0, gross),
    hi: Math.max(0, gross),
    level: gross,
    fill: "url(#wf-gross)",
    tag: compactMoney(gross),
    tagColor: dark ? "#e2e8f0" : "#334155",
  });
  let running = gross;
  for (const st of steps) {
    if (st.amount === 0) continue;
    const after = running - st.amount;
    bars.push({
      key: st.key,
      short: st.short,
      lo: Math.min(running, after),
      hi: Math.max(running, after),
      level: after,
      fill: st.amount < 0 ? COLOR.emeraldSoft : st.hue === "rose" ? COLOR.rose : COLOR.amber,
      tag: `${st.amount < 0 ? "+" : "−"}${compactMoney(Math.abs(st.amount))}`,
      tagColor: st.amount < 0 ? COLOR.emeraldDeep : st.hue === "rose" ? COLOR.rose : "#d97706",
    });
    running = after;
  }
  bars.push({
    key: "net",
    short: "Lãi ròng",
    lo: Math.min(0, net),
    hi: Math.max(0, net),
    level: net,
    fill: net >= 0 ? COLOR.emeraldDeep : COLOR.red,
    tag: compactMoney(net),
    tagColor: net >= 0 ? COLOR.emeraldDeep : COLOR.red,
  });

  // Thang đo: phủ từ mức thấp nhất (có thể âm khi lỗ) tới cao nhất
  const maxV = Math.max(0, ...bars.map((b) => b.hi));
  const minV = Math.min(0, ...bars.map((b) => b.lo));
  const span = Math.max(maxV - minV, 1);
  const TAG_H = 16; // chỗ cho nhãn số trên cột
  const LABEL_H = 28; // nhãn trục X (tối đa 2 dòng)
  const plotH = height - TAG_H - LABEL_H;
  const y = (v: number) => TAG_H + ((maxV - v) / span) * plotH;

  const n = bars.length;
  const slot = width > 0 ? Math.max(width / n, MIN_SLOT) : 0;
  const chartW = slot * n;
  const barW = Math.max(16, Math.min(44, slot * 0.58));
  const fontSize = slot < 56 ? 9 : 10;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: "100%" }}>
      {width > 0 ? (
        <ScrollView
          horizontal
          scrollEnabled={chartW > width}
          showsHorizontalScrollIndicator={false}
          bounces={false}
        >
        <View style={{ height, width: chartW }}>
          <Svg width={chartW} height={height}>
            <Defs>
              <LinearGradient id="wf-gross" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#34d399" />
                <Stop offset="1" stopColor="#10b981" />
              </LinearGradient>
            </Defs>
            {/* Đường 0 — hiện khi có khoản âm (lỗ) */}
            <Line x1={0} x2={chartW} y1={y(0)} y2={y(0)} stroke={baseline} strokeWidth={1} />
            {bars.map((b, i) => {
              const cx = slot * i + slot / 2;
              const top = y(b.hi);
              const h = Math.max(2, y(b.lo) - y(b.hi));
              return (
                <React.Fragment key={b.key}>
                  <Rect x={cx - barW / 2} y={top} width={barW} height={h} rx={3} fill={b.fill} />
                  {/* Chấm nối mức sau cột này sang cột kế */}
                  {i < n - 1 ? (
                    <Line
                      x1={cx + barW / 2}
                      x2={slot * (i + 1) + slot / 2 - barW / 2}
                      y1={y(b.level)}
                      y2={y(b.level)}
                      stroke={connector}
                      strokeWidth={1}
                      strokeDasharray="3,3"
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </Svg>
          {/* Nhãn số (trên cột) + nhãn tên (dưới) là Text RN để dark mode và
              font hệ thống xử lý, đặt tuyệt đối theo cùng tọa độ cột */}
          {bars.map((b, i) => (
            <React.Fragment key={`t-${b.key}`}>
              <Text
                className="absolute text-center font-semibold"
                style={[
                  TABULAR,
                  { left: slot * i, width: slot, top: y(b.hi) - TAG_H + 1, fontSize, color: b.tagColor },
                ]}
                numberOfLines={1}
              >
                {b.tag}
              </Text>
              <Text
                className="absolute text-center"
                style={{ left: slot * i, width: slot, top: height - LABEL_H + 3, fontSize, lineHeight: fontSize + 3, color: labelColor }}
                numberOfLines={2}
              >
                {b.short}
              </Text>
            </React.Fragment>
          ))}
        </View>
        </ScrollView>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}
