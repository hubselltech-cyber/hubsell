"use client";

import { useMemo } from "react";
import { CircleCheck, CircleDollarSign, FileSignature, Hourglass } from "lucide-react";

import {
  KOC_EXPENSES,
  KOC_EXPENSE_TYPE_LABEL,
  KOC_PLATFORM_META,
  campaignName,
} from "@/components/koc/koc-data";
import { KocShell } from "@/components/koc/koc-shell";
import { StatCard } from "@/components/dashboard/stat-card";
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
import { formatNumber } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_SUB,
} from "@/lib/typography";

/**
 * CHI PHÍ BOOKING & HỢP ĐỒNG
 *
 * Sổ theo dõi các khoản chi trả cho KOC/MCN: booking lẻ theo bài và hợp đồng
 * MCN theo kỳ. Đây là nhánh "Seller nhập tay" của Net-ROI (nhánh còn lại —
 * hoa hồng — đồng bộ từ API sàn). Bản thật: mỗi khoản PAID ghi một dòng nhóm
 * CHI_PHI_MARKETING sang Thu chi vận hành để Báo cáo dòng tiền và Net-ROI
 * cùng đọc một số.
 */
export default function KocExpensesPage() {
  const stats = useMemo(() => {
    const total = KOC_EXPENSES.reduce((s, e) => s + e.amount, 0);
    const paid = KOC_EXPENSES.filter((e) => e.status === "PAID").reduce(
      (s, e) => s + e.amount,
      0
    );
    const pendingItems = KOC_EXPENSES.filter((e) => e.status === "PENDING");
    const pending = pendingItems.reduce((s, e) => s + e.amount, 0);
    return { total, paid, pending, pendingCount: pendingItems.length };
  }, []);

  return (
    <KocShell>
      {/* ===== CHỈ SỐ CHI PHÍ ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tổng chi Booking kỳ này"
          value={<Money value={stats.total} />}
          icon={CircleDollarSign}
          tone="negative"
          colorValue
          subtitle="Booking lẻ + hợp đồng MCN"
        />
        <StatCard
          label="Đã thanh toán"
          value={<Money value={stats.paid} />}
          icon={CircleCheck}
          tone="neutral"
          subtitle="Đã ghi vào Thu chi vận hành"
        />
        <StatCard
          label="Chờ thanh toán"
          value={<Money value={stats.pending} />}
          icon={Hourglass}
          tone="warning"
          subtitle={`${formatNumber(stats.pendingCount)} khoản đến hạn trong kỳ`}
        />
        <StatCard
          label="Hợp đồng đang hiệu lực"
          value={formatNumber(KOC_EXPENSES.length)}
          icon={FileSignature}
          tone="info"
          subtitle="Gồm cả booking lẻ đã chốt kèo"
        />
      </div>

      {/* ===== SỔ HỢP ĐỒNG & KHOẢN CHI ===== */}
      <Card>
        <CardHeader>
          <CardTitle>Sổ Booking &amp; Hợp đồng</CardTitle>
          <CardDescription>
            Khoản PENDING đến hạn sẽ nhảy cảnh báo; khoản PAID tự đổ về Thu chi
            vận hành (nhóm Chi phí Marketing) khi nối backend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className={TABLE_HEAD_EMPHASIS}>
              <TableRow>
                <TableHead className="w-32">Mã hợp đồng</TableHead>
                <TableHead>KOC / MCN</TableHead>
                <TableHead className="w-28">Sàn</TableHead>
                <TableHead>Chiến dịch</TableHead>
                <TableHead className="w-32">Loại</TableHead>
                <TableHead className="text-right">Số tiền</TableHead>
                <TableHead className="w-32">Hạn / Ngày chi</TableHead>
                <TableHead className="w-36">Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {KOC_EXPENSES.map((e) => {
                const platform = KOC_PLATFORM_META[e.platform];
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-sm text-slate-900">
                      {e.contractCode}
                    </TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {e.kocName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={platform.badgeClass}>
                        {platform.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {campaignName(e.campaignId)}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {KOC_EXPENSE_TYPE_LABEL[e.type]}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={e.amount} className={TEXT_NUMBER_MUTED} />
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {new Date(e.dueDate).toLocaleDateString("vi-VN")}
                    </TableCell>
                    <TableCell>
                      {e.status === "PAID" ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          Đã thanh toán
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-700"
                        >
                          Chờ thanh toán
                        </Badge>
                      )}
                      {e.status === "PENDING" && (
                        <p className={TEXT_SUB}>
                          Đến hạn {new Date(e.dueDate).toLocaleDateString("vi-VN")}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · Chi phí Booking &amp; Hợp đồng (Preview)
      </p>
    </KocShell>
  );
}
