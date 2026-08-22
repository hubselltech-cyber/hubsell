"use client";

// ============================================================
// GÓI DỊCH VỤ (Cấu hình → Gói dịch vụ) — trang tự phục vụ của CHỦ SHOP:
// gói đang dùng + kỳ hạn, mức dùng so với trần (đơn tháng/gian/nhân viên),
// và lịch sử thanh toán. Chuông cảnh báo trần + popup nâng gói đều dẫn về đây.
//
// Nguồn số liệu: /api/subscription/me (cache qk.mySubscription dùng CHUNG với
// banner trần trong AppShell — vào trang thường là số hiện tức thì) +
// /api/subscription/payments (chỉ chủ shop). Nút "Nâng gói" mở lại đúng
// UpgradePlanDialog của plan-quota-guard — một nguồn nội dung duy nhất.
// ============================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, CircleDollarSign, Gauge } from "lucide-react";

import { UpgradePlanDialog, useMyPlan } from "@/components/plan-quota-guard";
import { SettingsShell } from "@/components/settings/settings-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchMySubscriptionPayments, type BillingCycle } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { TEXT_SUB } from "@/lib/typography";

const nf = new Intl.NumberFormat("vi-VN");

const CYCLE_LABEL: Record<BillingCycle, string> = {
  MONTHLY: "1 tháng",
  QUARTERLY: "3 tháng",
  SEMIANNUAL: "6 tháng",
  YEARLY: "12 tháng",
};

const METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: "Chuyển khoản",
  WALLET: "Ví Hubsell",
  GATEWAY: "Cổng thanh toán",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN");
}

/** Thanh mức dùng so với trần — cùng thang màu với banner: xanh → vàng 80% → đỏ 100%. */
function UsageBar({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | null;
  unit: string;
}) {
  const ratio = limit && limit > 0 ? used / limit : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-sm tabular-nums text-muted-foreground">
          {ratio === null ? (
            <>
              <span className="font-semibold text-foreground">{nf.format(used)}</span> {unit} ·
              Không giới hạn
            </>
          ) : (
            <>
              <span
                className={cn(
                  "font-semibold",
                  ratio >= 1
                    ? "text-rose-600"
                    : ratio >= 0.8
                      ? "text-amber-600"
                      : "text-foreground"
                )}
              >
                {nf.format(used)}
              </span>
              /{nf.format(limit!)} {unit} ({Math.floor(ratio * 100)}%)
            </>
          )}
        </p>
      </div>
      {ratio !== null && (
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              ratio >= 1 ? "bg-rose-500" : ratio >= 0.8 ? "bg-amber-500" : "bg-emerald-500"
            )}
            style={{ width: `${Math.min(100, ratio * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function SettingsPlanPage() {
  const { data } = useMyPlan(true);
  const { data: paymentsData } = useQuery({
    queryKey: qk.mySubscriptionPayments(),
    queryFn: fetchMySubscriptionPayments,
  });
  const [dialogOpen, setDialogOpen] = useState(false);

  const sub = data?.subscription ?? null;
  const statusBadge =
    sub === null
      ? null
      : sub.status === "ACTIVE"
        ? sub.isTrial
          ? { label: "Dùng thử", cls: "border-sky-200 bg-sky-50 text-sky-700" }
          : { label: "Hiệu lực", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" }
        : sub.status === "EXPIRED"
          ? {
              label: sub.isTrial ? "Hết dùng thử" : "Quá hạn",
              cls: "border-rose-200 bg-rose-50 text-rose-700",
            }
          : { label: "Đã hủy", cls: "border-slate-200 bg-slate-50 text-slate-600" };

  return (
    <SettingsShell
      title="Gói dịch vụ"
      description="Gói đang dùng, mức sử dụng so với trần và lịch sử thanh toán của shop."
    >
      {/* ===== Gói hiện tại + mức dùng ===== */}
      <Card className="max-w-2xl shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Gauge className="size-5 text-slate-500" />
            {data === undefined
              ? "Đang tải…"
              : data.hasSubscription && data.plan
                ? `Gói ${data.plan.name}`
                : "Chưa gán gói"}
            {statusBadge && (
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  statusBadge.cls
                )}
              >
                {statusBadge.label}
              </span>
            )}
            {data && (data.upgradePlans.length > 0 || data.locked) && (
              <Button size="sm" className="ml-auto" onClick={() => setDialogOpen(true)}>
                <ArrowUpCircle className="size-4" />
                Nâng gói
              </Button>
            )}
          </CardTitle>
          {sub && (
            <p className={TEXT_SUB}>
              {sub.currentPeriodEnd ? (
                <>
                  Kỳ hiện tại: {fmtDate(sub.currentPeriodStart)} →{" "}
                  {fmtDate(sub.currentPeriodEnd)}
                  {sub.daysLeft !== null &&
                    (sub.daysLeft >= 0
                      ? ` — còn ${sub.daysLeft} ngày`
                      : ` — đã quá hạn ${-sub.daysLeft} ngày`)}
                </>
              ) : (
                "Vô thời hạn"
              )}
            </p>
          )}
          {data && !data.hasSubscription && (
            <p className={TEXT_SUB}>
              Tài khoản chưa được gán gói dịch vụ — hiện không áp dụng giới hạn nào.
            </p>
          )}
        </CardHeader>
        {data && data.hasSubscription && (
          <CardContent className="space-y-4 pt-4">
            {data.locked && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
                {data.lockedReason === "EXPIRED"
                  ? "Gói đã hết hạn quá ân hạn — các tính năng nâng cao đang tạm khóa. Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ."
                  : "Shop đã vượt trần đơn quá ân hạn — các tính năng nâng cao đang tạm khóa. Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ."}
              </div>
            )}
            <UsageBar
              label="Đơn hàng tháng này"
              used={data.orders.used}
              limit={data.orders.limit}
              unit="đơn"
            />
            <UsageBar
              label="Gian hàng đang hoạt động"
              used={data.usage.channels}
              limit={data.plan?.maxChannels ?? null}
              unit="gian"
            />
            <UsageBar
              label="Tài khoản nhân viên"
              used={data.usage.staff}
              limit={data.plan?.maxStaff ?? null}
              unit="tài khoản"
            />
            <p className={TEXT_SUB}>
              Trần đơn tính theo tháng dương lịch trên mọi gian hàng của shop. Vượt trần
              đơn vẫn được đồng bộ đầy đủ — chỉ các tính năng nâng cao tạm khóa sau thời
              gian ân hạn nếu chưa nâng gói.
            </p>
          </CardContent>
        )}
      </Card>

      {/* ===== Lịch sử thanh toán ===== */}
      <Card className="max-w-2xl shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="size-5 text-slate-500" />
            Lịch sử thanh toán
          </CardTitle>
        </CardHeader>
        <CardContent className={paymentsData?.payments.length ? "p-0" : "pt-4"}>
          {paymentsData === undefined ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Đang tải dữ liệu…
            </p>
          ) : paymentsData.payments.length === 0 ? (
            <p className={TEXT_SUB}>
              Chưa có thanh toán nào
              {sub?.isTrial ? " — shop đang trong kỳ dùng thử miễn phí." : "."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gói · kỳ mua</TableHead>
                  <TableHead>Phương thức</TableHead>
                  <TableHead className="text-right">Số tiền</TableHead>
                  <TableHead>Ngày thanh toán</TableHead>
                  <TableHead>Hạn dùng đến</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentsData.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">
                      {p.planName}
                      <p className="text-xs text-muted-foreground">{CYCLE_LABEL[p.cycle]}</p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {METHOD_LABEL[p.method] ?? p.method}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">
                      {nf.format(p.amount)}₫
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                      {fmtDate(p.occurredAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                      {fmtDate(p.periodEnd)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && (
        <UpgradePlanDialog open={dialogOpen} onOpenChange={setDialogOpen} data={data} />
      )}
    </SettingsShell>
  );
}
