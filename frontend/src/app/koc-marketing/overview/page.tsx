"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

import { KocPerformanceTable } from "@/components/koc/koc-performance-table";
import { KocKpiCards, KocOrdersPanel } from "@/components/koc/koc-real-data";
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
 * LAYOUT TAB (yêu cầu chủ shop 30/08 — bản dàn dọc 5 khối quá dài, rối):
 *   · LUÔN HIỆN: bộ lọc Sàn → Gian → Kỳ + 4 thẻ KPI — mọi tab đều cần ngữ
 *     cảnh tổng, giấu KPI vào tab là mỗi lần chuyển tab mất phương hướng.
 *   · Tab "Hiệu quả KOC" (mặc định — câu trả lời chính của trang).
 *   · Tab "Sản phẩm" — SKU nào hiệu quả qua kênh affiliate.
 *   · Tab "Đơn hàng" — bằng chứng từng dòng: bảng nguồn theo gian + bảng đơn
 *     (bảng gian hàng xếp vào đây luôn: cùng tính chất "kiểm chứng nguồn",
 *     ít xem hằng ngày, để ngoài chỉ kéo dài trang).
 */

type OverviewTab = "koc" | "products" | "orders";

const TABS: { key: OverviewTab; label: string }[] = [
  { key: "koc", label: "Hiệu quả KOC" },
  { key: "products", label: "Sản phẩm" },
  { key: "orders", label: "Đơn hàng" },
];

export default function KocOverviewPage() {
  const [channel, setChannel] = useState<ChannelFilterValue>(ALL_CHANNELS);
  const [range, setRange] = useState<DateRange>(defaultRange());
  const [tab, setTab] = useState<OverviewTab>("koc");

  return (
    <KocShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <Button
              key={t.key}
              variant={tab === t.key ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChannelFilter value={channel} onChange={setChannel} />
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      {/* KPI luôn hiện — ngữ cảnh tổng cho mọi tab */}
      <KocKpiCards channel={channel} range={range} />

      {tab === "koc" && <KocPerformanceTable channel={channel} range={range} />}
      {tab === "products" && <KocTopProducts channel={channel} range={range} />}
      {tab === "orders" && <KocOrdersPanel channel={channel} range={range} />}

      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · Tổng quan Net-ROI Đa kênh
      </p>
    </KocShell>
  );
}
