import Link from "next/link";

import type { MissingCostSummary } from "@/lib/api";
import { formatNumber } from "@/lib/format";

/**
 * Dòng nhắc dùng chung dưới mọi con số LỢI NHUẬN: đơn chưa có giá vốn bị loại
 * khỏi lợi nhuận (vẫn nằm trong doanh thu) — anh Trung chốt 30/09/2026. Kỳ
 * không có đơn nào thiếu giá vốn thì không hiện gì.
 */
export function MissingCostNote({
  summary,
  className,
}: {
  summary?: MissingCostSummary;
  className?: string;
}) {
  if (!summary || summary.orderCount <= 0) return null;
  return (
    <span className={className}>
      {formatNumber(summary.orderCount)} đơn chưa có giá vốn nên không được tính
      vào lợi nhuận.{" "}
      <Link href="/finance/cost-prices" className="underline underline-offset-2">
        Nhập giá vốn
      </Link>
    </span>
  );
}
