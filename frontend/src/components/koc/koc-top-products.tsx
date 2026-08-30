"use client";

import { useEffect, useState } from "react";
import { ImageIcon, PackageSearch } from "lucide-react";

import { Button } from "@/components/ui/button";

import { kocPlatformMeta } from "@/components/koc/koc-data";
import { HintIcon } from "@/components/finance/hint-icon";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchKocTopProducts, channelFilterToQuery } from "@/lib/api";
import type { ChannelFilterValue } from "@/components/shared/channel-filter";
import type { DateRange } from "@/lib/date-range";
import { rangeToQuery } from "@/lib/date-range";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";
import { formatNumber } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_NUMBER_STRONG,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * SẢN PHẨM HIỆU QUẢ QUA KÊNH AFFILIATE (yêu cầu chủ shop 30/08) — trả lời
 * "KOC đang bán chạy SKU nào của tôi": gom dòng hàng mọi đơn affiliate trong
 * kỳ, đa sàn, xếp theo GMV. Hoa hồng/tiền hoàn cấp đơn được PHÂN BỔ về SKU
 * theo tỷ trọng giá trị dòng (sàn không trả phí theo dòng — ước lượng, có
 * ghi chú) — dùng để chọn SKU nên đẩy mẫu/booking tiếp.
 */
const PAGE_SIZE = 10;

export function KocTopProducts({
  channel,
  range,
}: {
  channel: ChannelFilterValue;
  range: DateRange;
}) {
  const [page, setPage] = useState(1);
  // Đổi bộ lọc sàn/kỳ thì quay về trang 1 — tránh đứng ở trang không tồn tại.
  useEffect(() => {
    setPage(1);
  }, [channel, range]);
  const q = useApiQuery({
    queryKey: qk.kocTopProducts({
      ...rangeToQuery(range),
      channel: channelFilterToQuery(channel),
      page,
    }),
    queryFn: () => fetchKocTopProducts({ channel, range, page, pageSize: PAGE_SIZE }),
  });
  const products = q.data?.products ?? [];
  const total = q.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageSearch className="size-4.5 text-emerald-600" />
          Sản phẩm hiệu quả qua KOC/Affiliate
        </CardTitle>
        <CardDescription>
          SKU nào đang được kênh affiliate bán ra nhiều nhất trong kỳ — căn cứ
          chọn sản phẩm đẩy mẫu/booking tiếp theo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader className={TABLE_HEAD_EMPHASIS}>
            <TableRow>
              <TableHead>Sản phẩm</TableHead>
              <TableHead className="w-28">Sàn</TableHead>
              <TableHead className="w-20 text-right">SL bán</TableHead>
              <TableHead className="w-20 text-right">Đơn</TableHead>
              <TableHead className="text-right">GMV</TableHead>
              <TableHead className="text-right">Doanh thu ròng</TableHead>
              <TableHead className="text-right">
                <span className="inline-flex items-center gap-1">
                  Hoa hồng
                  <HintIcon hint="Tổng hoa hồng affiliate của SKU trong kỳ. Sàn chỉ báo hoa hồng cấp ĐƠN nên số này được phân bổ về SKU theo tỷ trọng giá trị dòng hàng — ước lượng sát, không phải số sàn kê từng dòng." />
                </span>
              </TableHead>
              <TableHead className="text-right">
                <span className="inline-flex items-center gap-1">
                  Hoa hồng / SP bán
                  <HintIcon hint="Bình quân MỖI SẢN PHẨM bán ra qua kênh affiliate mất bao nhiêu tiền hoa hồng (= tổng hoa hồng ÷ số lượng bán). Đem so với LÃI GỘP mỗi sản phẩm: nếu hoa hồng/SP xấp xỉ hoặc vượt lãi gộp/SP thì đẩy SKU này qua KOC là đang bán hộ sàn — cân nhắc hạ % hoa hồng hoặc đổi SKU khác." />
                </span>
              </TableHead>
              <TableHead className="w-24 text-right">Tỷ lệ hoàn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => {
              const meta = kocPlatformMeta(p.channelName);
              return (
                <TableRow key={`${p.channelName}-${p.channelSku}`}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imageUrl}
                          alt={p.productName}
                          loading="lazy"
                          className="size-9 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <ImageIcon className="size-4" />
                        </div>
                      )}
                      {/* max-w cứng để truncate có hiệu lực — cell bảng auto
                          giãn theo nội dung nên chỉ min-w-0 là không cắt được.
                          Tên đầy đủ vẫn xem được qua tooltip khi di chuột. */}
                      <div className="min-w-0 max-w-[300px]">
                        <p className="font-mono text-sm text-slate-900">{p.channelSku}</p>
                        <p className={cn(TEXT_SUB, "truncate")} title={p.productName}>
                          {p.productName}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={meta.badgeClass}>
                      {meta.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-slate-700">
                    {formatNumber(p.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-slate-700">
                    {formatNumber(p.orders)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={p.gmv} className="text-slate-900" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={p.netRevenue} className={TEXT_NUMBER_MUTED} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money
                      value={p.commission}
                      className={cn(TEXT_NUMBER_STRONG, "text-red-500")}
                    />
                    <p className={TEXT_SUB}>
                      {p.commissionRate.toLocaleString("vi-VN")}% GMV
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money
                      value={p.commissionPerUnit}
                      className={cn(TEXT_NUMBER_STRONG, "text-red-500")}
                    />
                    <p className={TEXT_SUB}>/ sản phẩm</p>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      p.refundRate > 15
                        ? cn(TEXT_NUMBER_STRONG, "text-red-500")
                        : TEXT_NUMBER_MUTED
                    )}
                  >
                    {p.refundRate.toLocaleString("vi-VN")}%
                  </TableCell>
                </TableRow>
              );
            })}
            {products.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  {q.loading
                    ? "Đang tải dữ liệu…"
                    : "Chưa có đơn affiliate nào trong kỳ đã chọn."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {pageCount > 1 && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <span className={TEXT_SUB}>
              {formatNumber(total)} SKU · trang {page}/{pageCount}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || q.refreshing}
              onClick={() => setPage((p) => p - 1)}
            >
              Trước
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pageCount || q.refreshing}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
