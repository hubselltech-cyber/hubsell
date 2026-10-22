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
 * Dòng nhắc dùng chung dưới mọi con số LỢI NHUẬN: đơn chưa có giá vốn bị loại
 * khỏi lợi nhuận (vẫn nằm trong doanh thu) — anh Trung chốt 30/09/2026. Kỳ
 * không có đơn nào thiếu giá vốn thì không hiện gì.
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
      {formatNumber(summary.orderCount)} đơn chưa có giá vốn nên không được tính
      vào lợi nhuận.{" "}
      <Link href={href} className="underline underline-offset-2">
        Nhập giá vốn
      </Link>
    </span>
  );
}
