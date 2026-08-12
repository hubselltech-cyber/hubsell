"use client";

// TAB KẾ TOÁN NỘI BỘ (GĐ3 — lá hq.finance): Ví Hubsell toàn hệ thống + duyệt
// lệnh rút tiền hoa hồng giới thiệu. Tiền đã bị TRỪ ví ngay lúc user đặt lệnh:
//  - DUYỆT  = xác nhận đã chuyển khoản (chốt sổ, không đụng số dư)
//  - TỪ CHỐI = hoàn tiền vào ví bằng giao dịch ADJUSTMENT (backend tự lo)
// Doanh thu gói cước CHƯA thương mại hóa — chú thích rõ, không vẽ số giả.

import { useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, BadgeX, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  approveWithdrawal,
  rejectWithdrawal,
  type PlatformFinanceResponse,
  type PlatformWithdrawalRow,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatCard, formatCount, formatMoney } from "./shared";

const WITHDRAWAL_STATUS_META: Record<
  PlatformWithdrawalRow["status"],
  { label: string; className: string }
> = {
  PENDING: { label: "Chờ duyệt", className: "border-amber-200 bg-amber-50 text-amber-700" },
  APPROVED: { label: "Đã chi trả", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  REJECTED: { label: "Từ chối", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

/** Hộp thoại xử lý MỘT lệnh rút — mode quyết định duyệt hay từ chối. */
function ProcessDialog({
  withdrawal,
  mode,
  onClose,
  onDone,
}: {
  withdrawal: PlatformWithdrawalRow;
  mode: "approve" | "reject";
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const approving = mode === "approve";

  async function handleConfirm() {
    if (!approving && !note.trim()) {
      toast.error("Vui lòng nhập lý do từ chối — người dùng sẽ nhìn thấy lý do này");
      return;
    }
    setSubmitting(true);
    try {
      if (approving) await approveWithdrawal(withdrawal.id, note.trim() || undefined);
      else await rejectWithdrawal(withdrawal.id, note.trim());
      toast.success(
        approving
          ? `Đã duyệt chi ${formatMoney(withdrawal.amount)} cho ${withdrawal.user.fullName}`
          : `Đã từ chối và hoàn ${formatMoney(withdrawal.amount)} vào ví ${withdrawal.user.fullName}`
      );
      onClose();
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xử lý được");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {approving ? (
              <BadgeCheck className="size-5 text-emerald-600" />
            ) : (
              <BadgeX className="size-5 text-rose-600" />
            )}
            {approving ? "Duyệt chi trả" : "Từ chối lệnh rút"}
          </DialogTitle>
          <DialogDescription>
            <b>{formatMoney(withdrawal.amount)}</b> cho <b>{withdrawal.user.fullName}</b> —{" "}
            {withdrawal.bankName} · {withdrawal.bankAccountNumber} ·{" "}
            {withdrawal.bankAccountName}.
            {approving
              ? " Chỉ bấm duyệt SAU KHI đã chuyển khoản xong."
              : " Tiền sẽ được hoàn lại vào Ví Hubsell của người dùng."}
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder={approving ? "Mã giao dịch chuyển khoản (tuỳ chọn)" : "Lý do từ chối (bắt buộc)"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Huỷ
          </Button>
          <Button
            variant={approving ? "default" : "destructive"}
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {approving ? "Xác nhận đã chuyển khoản" : "Từ chối & hoàn tiền"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawalTable({
  rows,
  emptyText,
  onAction,
}: {
  rows: PlatformWithdrawalRow[];
  emptyText: string;
  /** Có mặt = bảng lệnh CHỜ, hiện nút Duyệt/Từ chối. */
  onAction?: (w: PlatformWithdrawalRow, mode: "approve" | "reject") => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Đặt lệnh lúc</TableHead>
          <TableHead>Người rút</TableHead>
          <TableHead className="text-right">Số tiền</TableHead>
          <TableHead>Tài khoản nhận</TableHead>
          {onAction ? (
            <TableHead className="text-right">Xử lý</TableHead>
          ) : (
            <>
              <TableHead className="text-center">Kết quả</TableHead>
              <TableHead>Ghi chú duyệt</TableHead>
            </>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((w) => (
          <TableRow key={w.id}>
            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
              {formatDateTime(w.createdAt)}
            </TableCell>
            <TableCell>
              <p className="text-sm font-medium">{w.user.fullName}</p>
              <p className="text-xs text-muted-foreground">{w.user.email}</p>
            </TableCell>
            <TableCell className="whitespace-nowrap text-right font-semibold">
              {formatMoney(w.amount)}
            </TableCell>
            <TableCell className="text-sm">
              {w.bankName}
              <p className="font-mono text-xs text-muted-foreground">
                {w.bankAccountNumber} · {w.bankAccountName}
              </p>
            </TableCell>
            {onAction ? (
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => onAction(w, "approve")}>
                    <BadgeCheck className="size-4" />
                    Duyệt
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-rose-600 hover:text-rose-700"
                    onClick={() => onAction(w, "reject")}
                  >
                    <BadgeX className="size-4" />
                    Từ chối
                  </Button>
                </div>
              </TableCell>
            ) : (
              <>
                <TableCell className="text-center">
                  <span
                    className={cn(
                      "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                      WITHDRAWAL_STATUS_META[w.status].className
                    )}
                  >
                    {WITHDRAWAL_STATUS_META[w.status].label}
                  </span>
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                  {w.reviewNote ?? ""}
                </TableCell>
              </>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function FinanceTab({
  data,
  loading,
  onChanged,
}: {
  data: PlatformFinanceResponse | null;
  loading: boolean;
  /** Gọi sau khi duyệt/từ chối để trang cha nạp lại số liệu. */
  onChanged: () => void;
}) {
  const [processing, setProcessing] = useState<{
    withdrawal: PlatformWithdrawalRow;
    mode: "approve" | "reject";
  } | null>(null);

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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Đang nợ người dùng (tổng số dư ví)"
          value={formatMoney(data.wallet.totalBalance)}
          hint="Tổng số dư khả dụng của mọi Ví Hubsell"
        />
        <StatCard
          label="Hoa hồng đã phát sinh"
          value={formatMoney(data.wallet.totalCommission)}
          hint={`${formatCount(data.wallet.commissionCount)} lượt cộng hoa hồng 10%`}
        />
        <StatCard
          label="Đã chi trả"
          value={formatMoney(data.wallet.totalPaidOut)}
          hint={`${formatCount(data.wallet.paidOutCount)} lệnh rút đã duyệt`}
        />
        <StatCard
          label="Chờ duyệt"
          value={formatMoney(data.wallet.pendingAmount)}
          hint={`${formatCount(data.wallet.pendingCount)} lệnh đang xếp hàng`}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <p className="border-b px-4 py-3 text-sm font-semibold">
            Lệnh rút chờ duyệt
            {data.pendingWithdrawals.length > 0 &&
              ` (${data.pendingWithdrawals.length})`}
          </p>
          <WithdrawalTable
            rows={data.pendingWithdrawals}
            emptyText="Không có lệnh rút nào đang chờ. 🎉"
            onAction={(withdrawal, mode) => setProcessing({ withdrawal, mode })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <p className="border-b px-4 py-3 text-sm font-semibold">
            Đã xử lý gần đây
          </p>
          <WithdrawalTable
            rows={data.processedWithdrawals}
            emptyText="Chưa xử lý lệnh rút nào."
          />
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Doanh thu gói cước sẽ xuất hiện ở đây khi Hubsell thương mại hóa — hiện
        bảng giá còn ở giai đoạn Beta miễn phí.
      </p>

      {processing && (
        <ProcessDialog
          withdrawal={processing.withdrawal}
          mode={processing.mode}
          onClose={() => setProcessing(null)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}
