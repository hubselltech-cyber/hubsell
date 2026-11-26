"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CirclePause, Loader2, Repeat, Trash2 } from "lucide-react";

import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  deleteShopRecurringExpense,
  stopShopRecurringExpense,
  type RecurringCadence,
  type ShopRecurringExpense,
  type RecurringStatus,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDayKeyVN } from "@/lib/date-input";
import { formatNumber, formatVND } from "@/lib/format";
import { useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

const PER_UNIT: Record<RecurringCadence, string> = {
  DAILY: "ngày",
  MONTHLY: "tháng",
  YEARLY: "năm",
};

const STATUS_META: Record<RecurringStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Đang chạy", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  STOPPED: { label: "Đã dừng", className: "border-slate-200 bg-slate-50 text-slate-600" },
  ENDED: { label: "Đã hết kỳ", className: "border-slate-200 bg-slate-50 text-slate-600" },
};

/** "ngày 5 hằng tháng" / "ngày 15/01 hằng năm" — hằng ngày thì không cần nói thêm. */
function scheduleHint(r: ShopRecurringExpense): string | null {
  if (r.cadence === "MONTHLY") return `ngày ${Number(r.startDay.slice(8, 10))} hằng tháng`;
  if (r.cadence === "YEARLY") return `ngày ${r.startDay.slice(8, 10)}/${r.startDay.slice(5, 7)} hằng năm`;
  return null;
}

/**
 * TAB "CHI PHÍ ĐỊNH KỲ" của trang Thu chi vận hành (26/11/2026).
 * Mỗi dòng là một LUẬT: máy tự ghi khoản chi thường mỗi ngày / tháng / năm, tới hết hôm
 * nay. Tạo luật ở nút "Thêm chi phí" (ô Lặp lại). Ở đây chỉ xem + Dừng + Xóa:
 *   Dừng — thôi ghi từ ngày mai, các khoản đã ghi giữ nguyên.
 *   Xóa  — bỏ luật VÀ mọi khoản luật đã ghi (hỏi lại kèm số khoản + tổng tiền).
 */
export function RecurringExpensesTab({
  rules,
  loading,
  refreshing,
}: {
  rules: ShopRecurringExpense[];
  loading: boolean;
  refreshing: boolean;
}) {
  const invalidate = useInvalidate();
  const [confirm, setConfirm] = useState<{ action: "stop" | "delete"; rule: ShopRecurringExpense } | null>(null);

  const actMut = useMutation({
    mutationFn: (c: { action: "stop" | "delete"; rule: ShopRecurringExpense }) =>
      c.action === "stop" ? stopShopRecurringExpense(c.rule.id) : deleteShopRecurringExpense(c.rule.id),
    onSuccess: (_res, c) => {
      toast.success(
        c.action === "stop"
          ? `Đã dừng "${c.rule.name}" — các khoản đã ghi giữ nguyên`
          : `Đã xóa "${c.rule.name}" và các khoản đã ghi`
      );
      setConfirm(null);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ"),
    // Dừng / xóa đều đổi cả bảng thu chi (khoản hôm nay được ghi nốt, hoặc bị xóa).
    onSettled: () => invalidate(["expenses"]),
  });

  const target = confirm?.rule;

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang tải…</p>
          ) : rules.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <Repeat className="mx-auto mb-2 size-8" />
              <p>Chưa có khoản chi phí định kỳ nào.</p>
              <p className="mt-1">
                Bấm “Thêm chi phí”, ở ô <b>Lặp lại</b> chọn Hằng ngày, Hằng tháng hoặc Hằng năm — máy sẽ
                tự ghi khoản chi mỗi kỳ (ví dụ tiền kho 100.000 ₫ mỗi ngày).
              </p>
            </div>
          ) : (
            <Refreshing active={refreshing}>
              <Table>
                <TableHeader>
                  <TableRow>
                    {/* Cột tên CO GIÃN (w-full + max-w-0 → truncate ăn theo chỗ còn lại): 5 cột
                        số / ngày bên phải không xuống dòng, màn 1280 vẫn vừa không cuộn ngang. */}
                    <TableHead className="w-full">Nội dung</TableHead>
                    <TableHead className="text-right">Số tiền</TableHead>
                    <TableHead>Thời gian</TableHead>
                    <TableHead className="text-right">Đã ghi</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((r) => {
                    const status = STATUS_META[r.status];
                    const hint = scheduleHint(r);
                    const fund =
                      r.fundShopName ??
                      (r.fundPlatform
                        ? `${CHANNEL_META[r.fundPlatform]?.label ?? r.fundPlatform} — Tất cả shop`
                        : "Tất cả sàn / shop");
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="w-full max-w-0">
                          <p className="truncate" title={r.note ? `${r.name}\n${r.note}` : r.name}>
                            {r.name}
                          </p>
                          {/* Nguồn tiền = dòng phụ (không thành cột riêng — bảng đủ 6 cột rồi). */}
                          <p className="truncate text-xs text-muted-foreground" title={fund}>
                            {fund}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <p>
                            <span className="font-semibold text-red-500">− {formatVND(r.amount)}</span>
                            <span className="text-muted-foreground"> / {PER_UNIT[r.cadence]}</span>
                          </p>
                          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <p>Từ {formatDayKeyVN(r.startDay)}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.endDay ? `đến ${formatDayKeyVN(r.endDay)}` : "không thời hạn"}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <p className="tabular-nums">{formatVND(r.entryTotal)}</p>
                          <p className="text-xs text-muted-foreground">{formatNumber(r.entryCount)} khoản</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                              status.className
                            )}
                          >
                            {status.label}
                          </span>
                          {r.nextDay && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Ghi tiếp {formatDayKeyVN(r.nextDay)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {r.status === "ACTIVE" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirm({ action: "stop", rule: r })}
                            >
                              <CirclePause className="size-4" />
                              Dừng
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="ml-1 text-muted-foreground hover:text-red-500"
                            aria-label={`Xóa khoản định kỳ ${r.name}`}
                            title="Xóa khoản định kỳ và mọi khoản đã ghi"
                            onClick={() => setConfirm({ action: "delete", rule: r })}
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

      {/* Hộp hỏi lại — Dialog của hệ thống (window.confirm bị trình duyệt nhúng nuốt). */}
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !actMut.isPending) setConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirm?.action === "stop" ? "Dừng khoản chi định kỳ?" : "Xóa khoản chi định kỳ?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.action === "stop" ? (
                <>
                  <b>{target?.name}</b>: từ ngày mai máy thôi ghi khoản này.{" "}
                  {formatNumber(target?.entryCount ?? 0)} khoản đã ghi (tổng{" "}
                  {formatVND(target?.entryTotal ?? 0)}) giữ nguyên trong báo cáo.
                </>
              ) : (
                <>
                  <b>{target?.name}</b>: xóa khoản định kỳ này <b>và</b>{" "}
                  {formatNumber(target?.entryCount ?? 0)} khoản đã ghi (tổng{" "}
                  {formatVND(target?.entryTotal ?? 0)}) — báo cáo các ngày đó sẽ không còn khoản chi này,
                  không khôi phục được. Chỉ muốn thôi ghi tiếp thì bấm Dừng.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={actMut.isPending}>
              Không
            </Button>
            <Button
              variant={confirm?.action === "delete" ? "destructive" : "default"}
              disabled={actMut.isPending}
              onClick={() => confirm && actMut.mutate(confirm)}
            >
              {actMut.isPending && <Loader2 className="size-4 animate-spin" />}
              {confirm?.action === "stop" ? "Dừng từ ngày mai" : "Xóa hết"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
