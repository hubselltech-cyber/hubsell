"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Receipt, Repeat, Scale, Trash2, TrendingDown, TrendingUp } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { can } from "@/lib/permissions";
import { AppShell } from "@/components/shell/app-shell";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { Refreshing } from "@/components/shared/refreshing";
import { defaultRange, type DateRange } from "@/lib/date-range";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddTxnDialog } from "@/components/finance/add-txn-dialog";
import { RecurringExpensesTab } from "@/components/finance/recurring-expenses-tab";
import { PageHeaderBand, PageTabs } from "@/components/ui/page-tabs";
import {
  ApiError,
  deleteExpense,
  fetchChannels,
  fetchExpenses,
  fetchShopRecurringExpenses,
  getStoredUser,
  getToken,
  type ExpenseType,
  type FundSourceType,
  type OperatingExpense,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { CHANNEL_META } from "@/lib/channel-meta";
import { cn } from "@/lib/utils";
import { formatVND, formatDateTime } from "@/lib/format";

const TYPE_META: Record<ExpenseType, { label: string; className: string }> = {
  FIXED: { label: "Cố định", className: "bg-blue-50 text-blue-700 border-blue-200" },
  VARIABLE: { label: "Biến đổi", className: "bg-amber-50 text-amber-700 border-amber-200" },
};
const SOURCE_LABEL: Record<FundSourceType, string> = {
  PLATFORM_WALLET: "Ví sàn",
  BANK_ACCOUNT: "Ngân hàng",
};

/** Nhãn nguồn tiền của một dòng thu/chi (gian + túi tiền).
 *  null fundChannel = KHOẢN CHUNG (cấp sàn nếu có fundPlatform, không thì toàn
 *  shop) — trả null để render badge riêng theo mức chung. */
function fundLabel(e: OperatingExpense): string | null {
  if (!e.fundShopName || !e.fundSource) return null;
  return `${e.fundShopName} — ${SOURCE_LABEL[e.fundSource]}`;
}

type TxnFilter = "ALL" | "INCOME" | "EXPENSE";
/** "entries" = các khoản thu chi đã ghi · "recurring" = luật chi phí định kỳ (máy tự ghi). */
type PageTab = "entries" | "recurring";

export default function FinanceExpensesPage() {
  const router = useRouter();
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [filter, setFilter] = useState<TxnFilter>("ALL");
  const [tab, setTab] = useState<PageTab>("entries");
  const allowed = can(getStoredUser(), "finance.expenses");

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const expensesQ = useApiQuery({
    queryKey: qk.expenses(range),
    queryFn: () => fetchExpenses(range),
    enabled: allowed,
  });
  // Danh sách gian hàng nuôi 2 dialog thêm khoản — cùng ô cache với ChannelFilter.
  const channelsQ = useQuery({
    queryKey: qk.channels(),
    queryFn: () => fetchChannels(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Luật chi phí định kỳ — nạp luôn để tab có số đếm; cùng tiền tố khóa "expenses" nên
  // thêm / xóa khoản nào cũng làm mới theo.
  const recurringQ = useApiQuery({
    queryKey: qk.recurringExpenses(),
    queryFn: () => fetchShopRecurringExpenses(),
    enabled: allowed,
  });
  const invalidate = useInvalidate();

  const rows = expensesQ.data ?? [];
  const rules = recurringQ.data ?? [];
  const activeRules = rules.filter((r) => r.status === "ACTIVE").length;
  const channels = channelsQ.data ?? [];
  const loading = expensesQ.refreshing;
  const denied = !allowed || expensesQ.denied;
  const load = () => invalidate(["expenses"]);

  // XOÁ LẠC QUAN (optimistic): dòng biến mất NGAY khi bấm, 3 card tổng tự trừ
  // theo; máy chủ báo lỗi mới trả dòng về chỗ cũ kèm toast — thao tác nhẹ không
  // bắt người dùng ngồi nhìn spinner (Tầng 1 kế hoạch UI).
  const queryClient = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: (e: OperatingExpense) => deleteExpense(e.id),
    onMutate: async (e) => {
      const key = qk.expenses(range);
      // Chặn refetch đang bay đè mất bản cập nhật lạc quan
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<OperatingExpense[]>(key);
      queryClient.setQueryData<OperatingExpense[]>(key, (old) =>
        old?.filter((r) => r.id !== e.id)
      );
      return { prev, key };
    },
    onError: (err, _e, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev);
      toast.error(
        err instanceof ApiError
          ? `${err.message} — đã hoàn tác`
          : "Không xoá được — đã hoàn tác"
      );
    },
    onSuccess: () => toast.success("Đã xoá khoản thu/chi"),
    // Thành công hay thất bại đều đối chiếu lại với máy chủ cho chắc
    onSettled: () => invalidate(["expenses"]),
  });

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  // Lọc theo loại giao dịch — bảng VÀ 3 card đều tính trên tập đã lọc.
  const shown = filter === "ALL" ? rows : rows.filter((e) => e.direction === filter);
  const totalIncome = shown
    .filter((e) => e.direction === "INCOME")
    .reduce((s, e) => s + Number(e.amount), 0);
  const totalExpense = shown
    .filter((e) => e.direction === "EXPENSE")
    .reduce((s, e) => s + Number(e.amount), 0);
  const net = totalIncome - totalExpense;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeaderBand>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {tab === "entries"
                ? `Thu & chi vận hành của shop (${shown.length} khoản).`
                : "Khoản chi lặp theo lịch — máy tự ghi mỗi ngày, mỗi tháng hoặc mỗi năm."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {/* Lọc ngày / loại chỉ có nghĩa với bảng khoản đã ghi. */}
              {tab === "entries" && (
                <>
                  <DateRangePicker value={range} onChange={setRange} disabled={loading} />
                  <NativeSelect
                    className="w-40"
                    aria-label="Lọc loại giao dịch"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as TxnFilter)}
                  >
                    <option value="ALL">Tất cả</option>
                    <option value="INCOME">Chỉ khoản thu</option>
                    <option value="EXPENSE">Chỉ khoản chi</option>
                  </NativeSelect>
                </>
              )}
              <AddTxnDialog direction="EXPENSE" channels={channels} onAdded={load} visibleRange={range} />
              <AddTxnDialog direction="INCOME" channels={channels} onAdded={load} visibleRange={range} />
            </div>
          </div>
          <PageTabs
            ariaLabel="Khu vực thu chi vận hành"
            className="mt-2 border-b-0"
            tabs={[
              { key: "entries", label: "Thu chi" },
              {
                key: "recurring",
                label: "Chi phí định kỳ",
                count: activeRules,
                countTitle: "Số khoản định kỳ đang chạy",
              },
            ]}
            value={tab}
            onChange={setTab}
          />
        </PageHeaderBand>

        {tab === "recurring" && (
          <RecurringExpensesTab
            rules={rules}
            loading={recurringQ.loading}
            refreshing={recurringQ.refreshing}
          />
        )}

        {/* Tab Thu chi chỉ ẨN chứ không tháo — đổi tab qua lại không nháy bảng. */}
        <div className={cn("space-y-6", tab !== "entries" && "hidden")}>

        {/* 3 card tổng hợp — theo tập đã lọc */}
        <Refreshing active={loading} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DashboardCard
            title="Tổng khoản thu"
            value={<Money value={totalIncome} />}
            icon={TrendingUp}
            tone="positive"
            colorValue
            subtitle="Tiền vào vận hành trong kỳ"
          />
          <DashboardCard
            title="Tổng khoản chi"
            value={<Money value={totalExpense} negative />}
            icon={TrendingDown}
            tone="negative"
            colorValue
            subtitle="Tiền ra vận hành trong kỳ"
          />
          <DashboardCard
            title="Dòng tiền thuần vận hành"
            value={<Money value={Math.abs(net)} negative={net < 0} />}
            icon={Scale}
            tone={net < 0 ? "negative" : "positive"}
            colorValue
            subtitle="Tổng thu − Tổng chi"
          />
        </Refreshing>

        <Card>
          <CardContent className="p-0">
            {/* Lần đầu mới hiện "Đang tải…"; đổi kỳ thì giữ bảng cũ và làm mờ */}
            {expensesQ.loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Đang tải…</p>
            ) : shown.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Receipt className="mx-auto mb-2 size-8" />
                Chưa có khoản thu/chi nào. Bấm “Thêm khoản thu” hoặc “Thêm chi phí”.
              </div>
            ) : (
              <Refreshing active={loading}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nội dung</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead>Nguồn tiền</TableHead>
                    <TableHead className="text-right">Số tiền</TableHead>
                    <TableHead className="text-right">Ngày</TableHead>
                    <TableHead className="text-center">Xoá</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((e) => {
                    const income = e.direction === "INCOME";
                    const meta = TYPE_META[e.type];
                    const src = fundLabel(e);
                    return (
                      <TableRow key={e.id}>
                        <TableCell>
                          <p>{e.name}</p>
                          {e.note && (
                            <p className="text-xs text-muted-foreground">{e.note}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          {income ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                              Thu
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                          )}
                          {e.recurringId && (
                            <span
                              className="ml-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600"
                              title="Khoản do Chi phí định kỳ tự ghi — xem ở tab Chi phí định kỳ"
                            >
                              <Repeat className="size-3" />
                              Định kỳ
                            </span>
                          )}
                          {!income && e.appliedSku && (
                            <span className="mt-0.5 block font-mono text-xs text-primary">
                              → {e.appliedSku}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {src ?? (
                            <span
                              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                              title={
                                e.fundPlatform
                                  ? 'Khoản chung của sàn — tính vào báo cáo khi bộ lọc để "Tất cả sàn" hoặc chọn đúng sàn này (tất cả shop)'
                                  : 'Khoản chung toàn shop — chỉ tính vào báo cáo khi bộ lọc để "Tất cả sàn"'
                              }
                            >
                              {e.fundPlatform
                                ? `${CHANNEL_META[e.fundPlatform]?.label ?? e.fundPlatform} — Tất cả shop`
                                : "Tất cả sàn / shop"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold",
                            income ? "text-emerald-500" : "text-red-500"
                          )}
                        >
                          {income ? "+ " : "− "}
                          {formatVND(e.amount)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatDateTime(e.expenseDate)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-red-500"
                            onClick={() => deleteMut.mutate(e)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </Refreshing>
            )}
          </CardContent>
        </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Hubsell Finance · Thu chi vận hành
        </p>
      </div>
    </AppShell>
  );
}
