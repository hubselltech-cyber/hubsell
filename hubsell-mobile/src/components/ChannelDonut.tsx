import React from "react";
import type { ChannelName } from "../types/api";
import { CHANNEL_LABEL } from "../lib/labels";
import { DonutChart } from "./DonutChart";

/** Màu nhận diện từng sàn — dùng thống nhất cho donut + chú giải. */
export const CHANNEL_COLOR: Record<string, string> = {
  SHOPEE: "#ee4d2d",
  LAZADA: "#6d28d9",
  TIKTOK: "#0f172a",
  OFFLINE: "#94a3b8",
};

export interface DonutSlice {
  channel: string;
  value: number;
}

/** Donut tỷ trọng kênh — vỏ mỏng trên DonutChart dùng chung. */
export function ChannelDonut({
  slices,
  centerLabel,
  centerSub,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerSub: string;
}) {
  return (
    <DonutChart
      centerLabel={centerLabel}
      centerSub={centerSub}
      slices={slices.map((s) => ({
        label: CHANNEL_LABEL[s.channel as ChannelName] ?? s.channel,
        value: s.value,
        color: CHANNEL_COLOR[s.channel] ?? "#94a3b8",
        detail: `${s.value} đơn`,
      }))}
    />
  );
}
