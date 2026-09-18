"use client";

// ============================================================
// ROI HÒA VỐN của một chiến dịch GMV Max — con số + ô giải thích (trỏ chuột / bấm).
//
// Hòa vốn = 1 ÷ biên lãi TRƯỚC quảng cáo, tính ở backend (integrations/tiktok-ads/
// breakeven.ts) CHỈ trên đơn đã có kết cục cuối — đã đối soát thật: giao thành
// công / hoàn xong (anh Trung 18/09: TikTok đối soát lâu, đơn chưa chốt không
// được tính). Đã cộng ngược phí GMV Max TikTok trừ trong từng đơn; đơn hủy cùng
// lứa vẫn nằm trong doanh thu như cách TikTok đếm.
// Mỗi căn cứ một gạch đầu dòng cho seller dễ đọc (anh Trung 18/09).
// ============================================================

import { formatRoi } from "@/components/ads/tiktok-ads-format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TiktokAdsBreakeven } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";

const pct = (x: number) => `${(x * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;

/** Các căn cứ của con số hòa vốn — mỗi ý một dòng. */
export function breakevenPoints(b: TiktokAdsBreakeven): string[] {
  const out: string[] = [];
  if (b.negativeMargin && b.margin != null) {
    out.push(`Bán đang lỗ ${pct(Math.abs(b.margin))} trên doanh thu TRƯỚC cả quảng cáo — ROI nào cũng lỗ`);
    out.push("Xem lại giá bán, giá vốn và phí sàn của sản phẩm trước khi chạy tiếp");
  } else if (b.roi != null && b.margin != null) {
    out.push(`Biên lãi trước quảng cáo ${pct(b.margin)} → hòa vốn = 1 ÷ ${pct(b.margin)} = ${formatRoi(b.roi)}`);
    out.push(`ROI thực dưới ${formatRoi(b.roi)} là quảng cáo đang ăn vào vốn`);
  } else {
    out.push("Chưa có đơn nào trong 60 ngày vừa ĐÃ ĐỐI SOÁT vừa đủ giá vốn");
  }
  if (b.source === "campaign") {
    out.push(`Chỉ tính ${formatNumber(b.orders)} đơn ĐÃ ĐỐI SOÁT (giao thành công / hoàn xong) trong 60 ngày của chính các sản phẩm trong chiến dịch`);
  }
  if (b.source === "product") {
    out.push(`Chỉ tính ${formatNumber(b.orders)} đơn ĐÃ ĐỐI SOÁT (giao thành công / hoàn xong) trong 60 ngày của chính sản phẩm này`);
  }
  if (b.source === "shop") {
    out.push(`Chiến dịch chưa đủ 5 đơn đã đối soát có giá vốn nên tạm lấy biên lãi toàn gian (${formatNumber(b.orders)} đơn đã đối soát, 60 ngày)`);
  }
  if (b.pendingOrders > 0) out.push(`${formatNumber(b.pendingOrders)} đơn đang giao / chờ đối soát / đang hoàn chưa được tính — kết cục chưa chốt`);
  if (b.source != null) {
    out.push(
      `Đã cộng ngược phí GMV Max TikTok trừ trong từng đơn${
        b.cancelledOrders > 0 ? `; ${formatNumber(b.cancelledOrders)} đơn hủy cùng kỳ vẫn tính vào doanh thu như cách TikTok đếm` : ""
      }`
    );
  }
  if (b.costCoveragePct != null && b.costCoveragePct < 100) {
    out.push(`Mới ${b.costCoveragePct}% doanh thu có giá vốn — nhập đủ giá vốn thì số này mới đại diện cả chiến dịch`);
  }
  if (b.check && b.check.tiktokGmv > 0) {
    const d = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}`;
    out.push(
      `Đối chiếu doanh thu đơn đặt ${d(b.check.from)}–${d(b.check.to)}: Hubsell thấy ${formatVND(b.check.revenuePlaced)} · TikTok báo ${formatVND(b.check.tiktokGmv)}`
    );
  }
  return out;
}

export function TiktokBreakevenValue({ breakeven, className }: { breakeven: TiktokAdsBreakeven | null; className?: string }) {
  if (!breakeven) return <span className={cn("text-slate-400", className)}>—</span>;
  const label = breakeven.negativeMargin ? "Lỗ sẵn" : formatRoi(breakeven.roi);
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={80}
        render={<button type="button" className="cursor-pointer rounded" aria-label="Căn cứ ROI hòa vốn" onClick={(e) => e.stopPropagation()} />}
      >
        <span
          className={cn(
            "tabular-nums underline decoration-dotted underline-offset-2",
            // Mốc hòa vốn là con số để SO — xanh đậm cho nổi giữa dòng chữ xám (anh Trung 18/09); lỗ sẵn đỏ, chưa có số thì xám.
            breakeven.negativeMargin ? "text-red-500" : breakeven.roi == null ? "text-slate-400" : "text-emerald-700",
            className
          )}
        >
          {label}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-1.5 p-3 text-left text-sm font-normal" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-slate-900">ROI hòa vốn</p>
        <ul className="list-disc space-y-1 pl-4 text-slate-700 marker:text-slate-400">
          {breakevenPoints(breakeven).map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
