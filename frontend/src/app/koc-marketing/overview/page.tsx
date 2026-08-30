"use client";

import { useState } from "react";

import { KocPerformanceTable } from "@/components/koc/koc-performance-table";
import { KocRealData } from "@/components/koc/koc-real-data";
import { KocShell } from "@/components/koc/koc-shell";
import { KocTopProducts } from "@/components/koc/koc-top-products";
import {
  ALL_CHANNELS,
  ChannelFilter,
  type ChannelFilterValue,
} from "@/components/shared/channel-filter";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { defaultRange, type DateRange } from "@/lib/date-range";

/**
 * TỔNG QUAN NET-ROI ĐA KÊNH — màn hình chính của Mạng lưới KOC (SỐ THẬT).
 *
 * Trả lời một câu hỏi duy nhất: "Đổ tiền booking + hàng mẫu cho từng KOC,
 * cuối cùng LÃI hay LỖ bao nhiêu?"
 *
 * BỘ LỌC Sàn → Gian → Thời gian dùng CHUNG cho cả trang (yêu cầu chủ shop
 * 30/08 — cùng khuôn với Tài chính/Tổng quan), truyền xuống 3 khối:
 *   1. KocRealData        — 4 thẻ chỉ số + bảng gian hàng + bảng đơn affiliate.
 *   2. KocTopProducts     — SKU nào đang hiệu quả qua kênh affiliate.
 *   3. KocPerformanceTable — hiệu quả TỪNG KOC (attribution từ file TTLK).
 */
export default function KocOverviewPage() {
  const [channel, setChannel] = useState<ChannelFilterValue>(ALL_CHANNELS);
  const [range, setRange] = useState<DateRange>(defaultRange());

  return (
    <KocShell>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ChannelFilter value={channel} onChange={setChannel} />
        <DateRangePicker value={range} onChange={setRange} />
      </div>
      <KocRealData channel={channel} range={range} />
      <KocTopProducts channel={channel} range={range} />
      <KocPerformanceTable channel={channel} range={range} />
      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · Tổng quan Net-ROI Đa kênh
      </p>
    </KocShell>
  );
}
