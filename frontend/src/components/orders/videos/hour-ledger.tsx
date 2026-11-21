"use client";

import { ReceiptText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PackVideoHourLedgerRow, PackVideoHours } from "@/lib/api";
import { formatDateTime, formatVND } from "@/lib/format";
import { formatHoursBalance } from "@/lib/pack-video";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<PackVideoHourLedgerRow["kind"], string> = {
  PURCHASE: "Mua giờ",
  GRANT: "Hubsell tặng",
  ADJUST: "Điều chỉnh",
};

/**
 * SỔ GIỜ QUAY (tab Thống kê, phác thảo 16/11): từng lần cộng / trừ giờ — ngày · loại · số giờ · số tiền ·
 * hóa đơn. Dòng "Mua giờ" có cột hóa đơn; phần xuất hóa đơn cho khoản mua giờ chưa nối (chờ anh Trung chốt,
 * docs/VIDEO-DONG-HANG-THIET-KE.md mục 19.8) nên hiện "—". Máy chủ trả 50 dòng mới nhất.
 */
export function HourLedgerCard({ hours }: { hours: PackVideoHours }) {
  if (hours.ledger.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ReceiptText className="size-4 text-muted-foreground" aria-hidden />
          Sổ giờ quay
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Table className="min-w-[36rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Ngày</TableHead>
              <TableHead>Loại</TableHead>
              <TableHead className="text-right">Số giờ</TableHead>
              <TableHead className="text-right">Số tiền</TableHead>
              <TableHead>Hóa đơn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {hours.ledger.map((r, i) => (
              <TableRow key={r.id} className={cn(i % 2 === 1 && "bg-muted/40")}>
                <TableCell className="tabular-nums">{formatDateTime(r.createdAt)}</TableCell>
                <TableCell>
                  <p>{KIND_LABEL[r.kind]}</p>
                  {r.note && (
                    <p className={cn(TEXT_SUB, "max-w-56 truncate")} title={r.note}>
                      {r.note}
                    </p>
                  )}
                </TableCell>
                <TableCell
                  className={cn("text-right font-semibold tabular-nums", r.seconds < 0 && "text-rose-600")}
                >
                  {r.seconds < 0 ? "−" : "+"}
                  {formatHoursBalance(r.seconds)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.amountVnd !== null ? formatVND(r.amountVnd) : <span className={TEXT_SUB}>—</span>}
                </TableCell>
                <TableCell>
                  {r.invoiceNo ?? <span className={TEXT_SUB}>{r.kind === "PURCHASE" ? "Chưa xuất" : "—"}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
