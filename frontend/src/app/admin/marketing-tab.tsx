"use client";

// TAB MARKETING & GIỚI THIỆU (GĐ4 — lá hq.marketing): hiệu quả chương trình
// "Kiếm Tiền Cùng Hubsell" trên toàn hệ thống — dữ liệu thật từ cây giới thiệu
// (User.referredById) và sổ cái hoa hồng.

import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlatformMarketingResponse } from "@/lib/api";
import { StatCard, formatCount, formatMoney } from "./shared";

export function MarketingTab({
  data,
  loading,
}: {
  data: PlatformMarketingResponse | null;
  loading: boolean;
}) {
  if (loading && !data) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Đang tải dữ liệu…
      </p>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Đăng ký qua giới thiệu"
          value={formatCount(data.totalReferred)}
          hint={`+${formatCount(data.referred30d)} trong 30 ngày qua`}
        />
        <StatCard
          label="Người giới thiệu tích cực"
          value={formatCount(data.activeReferrers)}
          hint="Đã giới thiệu được ít nhất 1 người"
        />
        <StatCard
          label="Kênh khác (quảng cáo, tự nhiên…)"
          value="Sắp có"
          hint="Gắn UTM khi chạy chiến dịch trả phí"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <p className="border-b px-4 py-3 text-sm font-semibold">
            Top người giới thiệu
          </p>
          {data.topReferrers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Chưa ai giới thiệu được người dùng nào.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Người giới thiệu</TableHead>
                  <TableHead>Mã</TableHead>
                  <TableHead className="text-center">Đã giới thiệu</TableHead>
                  <TableHead className="text-right">Hoa hồng tích lũy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topReferrers.map((r, i) => (
                  <TableRow key={r.userId}>
                    <TableCell className="text-sm text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{r.fullName}</p>
                      <p className="text-xs text-muted-foreground">{r.email}</p>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {r.referralCode ?? "—"}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      {formatCount(r.referredCount)} người
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold">
                      {formatMoney(r.totalCommission)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
