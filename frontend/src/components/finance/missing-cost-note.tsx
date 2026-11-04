import Link from "next/link";

import { channelFilterToQuery, type ChannelFilterQuery, type MissingCostSummary } from "@/lib/api";
import { rangeToQuery, type DateRange } from "@/lib/date-range";
import { formatNumber } from "@/lib/format";

/**
 * Đường dẫn sang trang Giá vốn LỌC SẴN các SKU đã bán trong kỳ đang xem mà chưa
 * có giá vốn (khách vài nghìn SKU 22/10: "biết số đơn thiếu nhưng không biết đơn
 * nào"). Không có kỳ thì về trang Giá vốn thường.
 */
export function missingCostHref(range?: DateRange, channel?: ChannelFilterQuery): string {
  if (!range) return "/finance/cost-prices";
  const params = new URLSearchParams({
    missing: "period",
    ...rangeToQuery(range),
    ...channelFilterToQuery(channel),
  });
  return `/finance/cost-prices?${params.toString()}`;
}

/**
 * Dòng nhắc dùng chung dưới mọi con số LỢI NHUẬN: đơn chưa có giá vốn ĐANG TÍNH
 * VỚI GIÁ VỐN 0 đ (anh Trung chốt 02/11/2026, áp 04/11 — backend
 * lib/finance-definitions.ts; từ 30/09 tới 04/11 bị loại khỏi lợi nhuận). Câu
 * này phải có mặt ở MỌI nơi in Lợi nhuận để khách biết số đang cao hơn thật
 * chừng nào còn thiếu giá vốn. Kỳ không có đơn nào thiếu giá vốn thì không hiện gì.
 */
export function MissingCostNote({
  summary,
  href = "/finance/cost-prices",
  className,
}: {
  summary?: MissingCostSummary;
  /** Nơi bấm "Nhập giá vốn" dẫn tới — trang có kỳ thì truyền missingCostHref(range, channel). */
  href?: string;
  className?: string;
}) {
  if (!summary || summary.orderCount <= 0) return null;
  return (
    <span className={className}>
      {formatNumber(summary.orderCount)} đơn chưa có giá vốn — đang tính với giá
      vốn 0 đ.{" "}
      <Link href={href} className="underline underline-offset-2">
        Nhập giá vốn
      </Link>
    </span>
  );
}
