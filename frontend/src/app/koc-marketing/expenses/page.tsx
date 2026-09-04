"use client";

import { useMemo, useState } from "react";
import {
  CircleCheck,
  CircleDollarSign,
  FileSignature,
  Hourglass,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  KOC_EXPENSE_TYPE_LABEL,
  kocPlatformMeta,
} from "@/components/koc/koc-data";
import { KocShell } from "@/components/koc/koc-shell";
import { BookingExpenseModal } from "@/components/koc/booking-expense-modal";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  deleteKocExpense,
  fetchKocExpenses,
  fetchKocPartners,
  updateKocExpense,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { formatNumber } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_SUB,
} from "@/lib/typography";

/**
 * SỔ BOOKING & HỢP ĐỒNG (số thật — nhịp 1 Sổ KOC).
 *
 * Nhánh "seller nhập tay" của Net-ROI: booking lẻ + hợp đồng MCN. Khoản gắn
 * KOC cụ thể chảy thẳng vào cột chi phí của KOC đó ở bảng Hiệu quả.
 * LƯU Ý: sổ này KHÔNG tự ghi sang Thu chi vận hành — nếu anh chị đã nhập
 * khoản chi bên đó thì đừng nhập lại đây (tránh đếm đôi chi phí).
 */
export default function KocExpensesPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const expensesQ = useApiQuery({
    queryKey: qk.kocExpenses(),
    queryFn: fetchKocExpenses,
  });
  const partnersQ = useApiQuery({
    queryKey: qk.kocPartners({}),
    queryFn: () => fetchKocPartners(),
  });
  const invalidate = useInvalidate();
  const reload = () => invalidate(["koc-expenses"], ["koc-partners"]);

  const expenses = useMemo(() => expensesQ.data?.expenses ?? [], [expensesQ.data]);

  const stats = useMemo(() => {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const paid = expenses
      .filter((e) => e.state === "PAID")
      .reduce((s, e) => s + e.amount, 0);
    const pendingItems = expenses.filter((e) => e.state === "PENDING");
    const pending = pendingItems.reduce((s, e) => s + e.amount, 0);
    return { total, paid, pending, pendingCount: pendingItems.length };
  }, [expenses]);

  async function markPaid(id: string) {
    setBusyId(id);
    try {
      await updateKocExpense(id, { state: "PAID" });
      toast.success("Đã chuyển sang Đã thanh toán");
      await reload();
    } catch {
      toast.error("Không cập nhật được khoản chi");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    try {
      await deleteKocExpense(id);
      toast.success("Đã xóa khoản chi");
      await reload();
    } catch {
      toast.error("Không xóa được khoản chi");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <KocShell>
      {/* ===== CHỈ SỐ CHI PHÍ ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tổng chi Booking"
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
          subtitle="Khoản đã chi thật"
        />
        <StatCard
          label="Chờ thanh toán"
          value={<Money value={stats.pending} />}
          icon={Hourglass}
          tone="warning"
          subtitle={`${formatNumber(stats.pendingCount)} khoản đã cam kết`}
        />
        <StatCard
          label="Tổng số khoản"
          value={formatNumber(expenses.length)}
          icon={FileSignature}
          tone="info"
          subtitle="Gồm cả booking lẻ đã chốt kèo"
        />
      </div>

      {/* ===== SỔ HỢP ĐỒNG & KHOẢN CHI ===== */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Sổ Booking &amp; Hợp đồng</CardTitle>
              <CardDescription>
                Khoản gắn KOC cộng thẳng vào chi phí Net-ROI của KOC đó.
                Sổ này KHÔNG tự ghi sang Thu chi vận hành — tránh đếm đôi.
              </CardDescription>
            </div>
            <Button onClick={() => setModalOpen(true)}>
              <CircleDollarSign className="size-4" />
              Ghi khoản chi
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className={TABLE_HEAD_EMPHASIS}>
              <TableRow>
                <TableHead className="w-32">Mã hợp đồng</TableHead>
                <TableHead>KOC / MCN</TableHead>
                <TableHead className="w-28">Sàn</TableHead>
                <TableHead className="w-32">Loại</TableHead>
                <TableHead className="text-right">Số tiền</TableHead>
                <TableHead className="w-32">Hạn / Ngày chi</TableHead>
                <TableHead className="w-36">Trạng thái</TableHead>
                <TableHead className="w-28 text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e) => {
                const platform = e.platform ? kocPlatformMeta(e.platform) : null;
                const busy = busyId === e.id;
                return (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-sm text-slate-900">
                      {e.contractCode || "—"}
                    </TableCell>
                    <TableCell className="text-slate-900">
                      {e.kocName || "—"}
                    </TableCell>
                    <TableCell>
                      {platform ? (
                        <Badge variant="outline" className={platform.badgeClass}>
                          {platform.label}
                        </Badge>
                      ) : (
                        <span className={TEXT_SUB}>—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {KOC_EXPENSE_TYPE_LABEL[e.kind] ?? e.kind}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={e.amount} className={TEXT_NUMBER_MUTED} />
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {e.dueDate
                        ? new Date(e.dueDate).toLocaleDateString("vi-VN")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {e.state === "PAID" ? (
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
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {e.state === "PENDING" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            title="Đã chuyển tiền — chuyển sang Đã thanh toán"
                            onClick={() => void markPaid(e.id)}
                          >
                            <CircleCheck className="size-4" /> Đã chi
                          </Button>
                        )}
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label="Xóa khoản chi"
                          title="Xóa khoản chi (nhập nhầm)"
                          className="text-red-500 hover:bg-rose-50 hover:text-red-600"
                          disabled={busy}
                          onClick={() => void remove(e.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {expenses.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {expensesQ.loading
                      ? "Đang tải dữ liệu…"
                      : "Chưa có khoản chi nào — bấm Ghi khoản chi để vào sổ khoản đầu tiên."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BookingExpenseModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        partners={partnersQ.data?.partners ?? []}
        onDone={() => void reload()}
      />

      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · Sổ Booking &amp; Hợp đồng
      </p>
    </KocShell>
  );
}
