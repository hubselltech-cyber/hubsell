"use client";

// ============================================================
// GÓI DỊCH VỤ (Cấu hình → Gói dịch vụ) — trang tự phục vụ của CHỦ SHOP,
// và từ 22/08 tối là NƠI MUA GÓI (anh Trung chốt: bày từng gói cho khách
// chọn ngay tại trang cấu hình):
//   1) Thẻ gói hiện tại + kỳ hạn + 3 thanh mức dùng so với trần.
//   2) "Chọn gói & thanh toán": lưới card từng gói, chọn KỲ 1/3/6/12 tháng
//      → nút "Đăng ký mua" (tạo yêu cầu — HQ liên hệ hướng dẫn chuyển khoản,
//      kế toán Ghi nhận thanh toán là yêu cầu tự đóng) hoặc "Trả bằng Ví"
//      khi số dư Ví Hubsell đủ (tái dùng /api/referral/renew — trừ ví + gia
//      hạn + hoa hồng trong một transaction, mở khóa NGAY).
//   3) Lịch sử thanh toán.
// Khi có STK (env PLAN_PAYMENT_BANK_*), khối yêu-cầu-đã-gửi tự hiện hướng
// dẫn chuyển khoản — không cần sửa code.
// ============================================================

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Gauge,
  ShoppingCart,
  Wallet,
  X,
} from "lucide-react";

import { PLAN_FEATURES, useMyPlan } from "@/components/shell/plan-quota-guard";
import { SettingsShell } from "@/components/settings/settings-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  cancelMyPlanUpgradeRequest,
  renewPackageWithWallet,
  requestPlanUpgrade,
  type BillingCycle,
  type MyUpgradePlan,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { TEXT_SUB } from "@/lib/typography";

const nf = new Intl.NumberFormat("vi-VN");

const CYCLES: { value: BillingCycle; label: string; months: number; key: keyof MyUpgradePlan }[] = [
  { value: "MONTHLY", label: "1 tháng", months: 1, key: "priceMonthly" },
  { value: "QUARTERLY", label: "3 tháng", months: 3, key: "priceQuarterly" },
  { value: "SEMIANNUAL", label: "6 tháng", months: 6, key: "priceSemiannual" },
  { value: "YEARLY", label: "12 tháng", months: 12, key: "priceYearly" },
];

const CYCLE_LABEL: Record<BillingCycle, string> = Object.fromEntries(
  CYCLES.map((c) => [c.value, c.label])
) as Record<BillingCycle, string>;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN");
}

function priceOf(plan: MyUpgradePlan, cycle: BillingCycle): number {
  const row = CYCLES.find((c) => c.value === cycle)!;
  return Number(plan[row.key]);
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
        <p className="text-sm">{label}</p>
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
  const qc = useQueryClient();
  const { data } = useMyPlan(true);

  // Kỳ đã chọn theo TỪNG gói (mặc định 1 tháng) — khách so giá kỳ dài tự do.
  const [cycleByPlan, setCycleByPlan] = useState<Record<string, BillingCycle>>({});
  // Bước xác nhận trước khi trừ Ví — trừ tiền không được là một cú click nhầm.
  const [walletBuy, setWalletBuy] = useState<{ plan: MyUpgradePlan; cycle: BillingCycle } | null>(
    null
  );
  // Bước "để lại SĐT" trước khi gửi yêu cầu mua/tư vấn (anh Trung 22/08 khuya:
  // HQ phải gọi lại được) — điền sẵn SĐT hồ sơ, khách sửa được.
  const [buyIntent, setBuyIntent] = useState<{
    planId: string;
    planName: string;
    cycle?: BillingCycle;
    price: number;
    isConsult: boolean;
  } | null>(null);
  const [phone, setPhone] = useState("");

  function openBuyDialog(intent: NonNullable<typeof buyIntent>) {
    setPhone(data?.contactPhone ?? "");
    setBuyIntent(intent);
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.mySubscription() });
  };

  const requestMutation = useMutation({
    mutationFn: (p: { planId: string; cycle?: BillingCycle; contactPhone: string }) =>
      requestPlanUpgrade(p),
    onSuccess: (res) => {
      setBuyIntent(null);
      refresh();
      toast.success(
        res.request.listedPrice === 0
          ? `Đã gửi yêu cầu tư vấn gói ${res.request.planName}. Hubsell sẽ gọi lại cho bạn sớm nhất.`
          : `Đã gửi yêu cầu mua gói ${res.request.planName} (${CYCLE_LABEL[res.request.cycle]}). Hubsell sẽ liên hệ hướng dẫn thanh toán.`
      );
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Gửi yêu cầu thất bại — thử lại sau."),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelMyPlanUpgradeRequest,
    onSuccess: () => {
      refresh();
      toast.success("Đã hủy yêu cầu mua gói.");
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Hủy yêu cầu thất bại — thử lại sau."),
  });

  const walletMutation = useMutation({
    mutationFn: (p: { planId: string; cycle: BillingCycle }) =>
      renewPackageWithWallet(`${p.planId}:${p.cycle}`),
    onSuccess: (res) => {
      setWalletBuy(null);
      refresh();
      toast.success(res.message || "Thanh toán bằng Ví thành công — gói đã được gia hạn.");
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiError ? err.message : "Thanh toán bằng Ví thất bại — thử lại sau."
      ),
  });

  const sub = data?.subscription ?? null;
  const pending = data?.pendingUpgradeRequest ?? null;
  const wallet = data?.walletBalance ?? 0;
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
      description="Gói đang dùng, mức sử dụng so với trần và chọn mua gói."
    >
      {/* ===== Gói hiện tại + mức dùng ===== */}
      <Card className="shadow-sm">
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
            {/* 3 thanh nằm ngang trên desktop — trang full-bleed không để trống sườn */}
            <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
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
            </div>
            <p className={TEXT_SUB}>
              Trần đơn tính theo tháng dương lịch trên mọi gian hàng của shop. Vượt trần
              đơn vẫn được đồng bộ đầy đủ — chỉ các tính năng nâng cao tạm khóa sau thời
              gian ân hạn nếu chưa nâng gói.
            </p>
          </CardContent>
        )}
      </Card>

      {/* ===== Chọn gói & thanh toán — trình bày kiểu bảng giá SaaS (anh Trung
          22/08 khuya: to, rõ, đẹp như đối thủ; nêu rõ 3 giới hạn dưới từng gói,
          chưa đặt số = Không giới hạn; bậc 3 gắn Bán chạy nhất) ===== */}
      {data && data.upgradePlans.length > 0 && (
        <div className="space-y-4">
          <div>
            <p className="text-base font-semibold">Chọn gói &amp; thanh toán</p>
            <p className={TEXT_SUB}>
              Mọi gói đều đầy đủ tính năng — chỉ khác giới hạn sử dụng. Chọn kỳ mua
              rồi bấm Đăng ký mua, Hubsell sẽ liên hệ hướng dẫn thanh toán.
            </p>
          </div>

          {/* Yêu cầu đang chờ — bám trạng thái, kèm hướng dẫn chuyển khoản khi có STK */}
          {pending && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100">
              <div className="flex items-start gap-2.5">
                <Clock className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p>
                    {pending.listedPrice === 0 ? (
                      <>Đã gửi yêu cầu tư vấn gói {pending.planName}</>
                    ) : (
                      <>
                        Đã gửi yêu cầu mua gói {pending.planName} — {CYCLE_LABEL[pending.cycle]} (
                        <span className="tabular-nums">{nf.format(pending.listedPrice)}₫</span>)
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs opacity-80">
                    Gửi lúc {fmtDate(pending.createdAt)}.{" "}
                    {pending.listedPrice === 0
                      ? "Hubsell sẽ gọi lại tư vấn và báo giá riêng cho shop của bạn."
                      : data.payment
                        ? `Chuyển khoản tới ${data.payment.bankName} — STK ${data.payment.bankAccount} (${data.payment.bankHolder}), nội dung: HUBSELL + email đăng nhập. Gói mở ngay khi Hubsell xác nhận tiền về.`
                        : "Hubsell sẽ liên hệ hướng dẫn thanh toán trong thời gian sớm nhất; gói mở ngay khi xác nhận tiền về."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                  title="Hủy yêu cầu này"
                  className="shrink-0 rounded-md p-1 opacity-70 transition-colors hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          )}

          {/* Quyền lợi chung — một lần cho mọi gói */}
          <div className="rounded-xl border bg-muted/40 p-4">
            <p className="text-sm font-semibold">Mọi gói đều bao gồm toàn bộ tính năng</p>
            <ul className="mt-2.5 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 pt-2 md:grid-cols-2 xl:grid-cols-4">
            {data.upgradePlans.map((p) => {
              const isCurrent = p.id === data.plan?.id;
              // Bậc 3 = gói "Bán chạy nhất" (anh Trung chốt 22/08) — theo tier
              // nên đổi thang gói sau này không phải sửa code.
              const isBestSeller = p.tier === 3;
              const cycle = cycleByPlan[p.id] ?? "MONTHLY";
              const price = priceOf(p, cycle);
              const months = CYCLES.find((c) => c.value === cycle)!.months;
              const save =
                p.priceMonthly > 0 && months > 1
                  ? Math.round((1 - price / (p.priceMonthly * months)) * 100)
                  : 0;
              const walletEnough = wallet >= price && price > 0;
              // 3 giới hạn nói RÕ dưới từng gói — chưa đặt số = Không giới hạn.
              const limitRows = [
                p.maxOrdersPerMonth != null
                  ? `${nf.format(p.maxOrdersPerMonth)} đơn hàng/tháng`
                  : "Không giới hạn đơn hàng",
                p.maxChannels != null
                  ? `${nf.format(p.maxChannels)} gian hàng`
                  : "Không giới hạn gian hàng",
                p.maxStaff != null
                  ? `${nf.format(p.maxStaff)} tài khoản nhân viên`
                  : "Không giới hạn nhân viên",
                "Đầy đủ mọi tính năng Hubsell",
              ];
              return (
                <div
                  key={p.id}
                  className={cn(
                    "relative flex flex-col rounded-2xl border bg-card p-5 shadow-sm",
                    isBestSeller
                      ? "border-emerald-500 shadow-md ring-1 ring-emerald-500"
                      : isCurrent && "border-sky-300"
                  )}
                >
                  {isBestSeller && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-sm">
                      Bán chạy nhất
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute right-4 top-4 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300">
                      Đang dùng
                    </span>
                  )}
                  <p className="text-lg font-bold">{p.name}</p>

                  {/* Chọn kỳ mua — chỉ hiện kỳ gói có bán (giá > 0) */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {CYCLES.filter((c) => Number(p[c.key]) > 0).map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() =>
                          setCycleByPlan((prev) => ({ ...prev, [p.id]: c.value }))
                        }
                        className={cn(
                          "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                          cycle === c.value
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>

                  <p className="mt-4 text-3xl font-extrabold tabular-nums tracking-tight">
                    {nf.format(price)}₫
                    <span className="text-sm text-muted-foreground">
                      /{CYCLE_LABEL[cycle]}
                    </span>
                  </p>
                  <p className="min-h-5 text-sm tabular-nums text-muted-foreground">
                    {months > 1 && (
                      <>
                        ≈ {nf.format(Math.round(price / months))}₫/tháng
                        {save >= 1 && (
                          <span className="ml-1.5 font-semibold text-emerald-600">
                            tiết kiệm {save}%
                          </span>
                        )}
                      </>
                    )}
                  </p>

                  <ul className="mt-4 space-y-2.5 border-t pt-4">
                    {limitRows.map((row) => (
                      <li key={row} className="flex items-start gap-2.5 text-sm">
                        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                        {row}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto space-y-2 pt-5">
                    <Button
                      className="w-full"
                      variant={isBestSeller ? "default" : "outline"}
                      onClick={() =>
                        openBuyDialog({
                          planId: p.id,
                          planName: p.name,
                          cycle,
                          price,
                          isConsult: false,
                        })
                      }
                    >
                      <ShoppingCart className="size-4" />
                      {isCurrent ? "Gia hạn gói này" : "Đăng ký mua"}
                    </Button>
                    {walletEnough && (
                      <Button
                        className="w-full"
                        variant="ghost"
                        onClick={() => setWalletBuy({ plan: p, cycle })}
                      >
                        <Wallet className="size-4" />
                        Trả bằng Ví Hubsell
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Enterprise "Liên hệ báo giá" — bán bằng TƯ VẤN: khách để lại
                SĐT, HQ gọi lại chốt trần đơn + giá riêng (anh Trung 22/08 khuya). */}
            {data.enterprisePlan && (
              <div className="relative flex flex-col rounded-2xl border border-slate-300 bg-card p-5 shadow-sm dark:border-slate-700">
                <p className="text-lg font-bold">{data.enterprisePlan.name}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Cho shop quy mô lớn / nhiều thương hiệu
                </p>
                <p className="mt-4 text-3xl font-extrabold tracking-tight">
                  Báo giá riêng
                </p>
                <p className="min-h-5 text-sm text-muted-foreground">
                  Theo quy mô vận hành của shop
                </p>
                <ul className="mt-4 space-y-2.5 border-t pt-4">
                  {[
                    "Trần đơn hàng theo thỏa thuận",
                    "Không giới hạn gian hàng",
                    "Không giới hạn nhân viên",
                    "Đầy đủ tính năng + hỗ trợ triển khai riêng",
                  ].map((row) => (
                    <li key={row} className="flex items-start gap-2.5 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                      {row}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-5">
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() =>
                      openBuyDialog({
                        planId: data.enterprisePlan!.id,
                        planName: data.enterprisePlan!.name,
                        price: 0,
                        isConsult: true,
                      })
                    }
                  >
                    <Clock className="size-4" />
                    Đăng ký tư vấn
                  </Button>
                </div>
              </div>
            )}
          </div>

          {wallet > 0 && (
            <p className={TEXT_SUB}>
              Số dư Ví Hubsell của bạn:{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {nf.format(wallet)}₫
              </span>{" "}
              — đủ số dư sẽ hiện nút Trả bằng Ví, gói mở ngay lập tức.
            </p>
          )}
        </div>
      )}

      {/* Lịch sử thanh toán CỐ TÌNH không hiển thị (anh Trung bỏ 22/08 khuya:
          đừng nhắc khách họ đã mất tiền) — chứng từ chỉ xem ở HQ /admin/plans. */}

      {/* ===== Để lại SĐT trước khi gửi yêu cầu mua/tư vấn — HQ phải gọi lại
          được (anh Trung 22/08 khuya); điền sẵn SĐT hồ sơ, khách sửa được ===== */}
      <Dialog open={buyIntent !== null} onOpenChange={(o) => !o && setBuyIntent(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {buyIntent?.isConsult ? "Đăng ký tư vấn" : "Đăng ký mua gói"}
            </DialogTitle>
            {buyIntent && (
              <DialogDescription>
                {buyIntent.isConsult ? (
                  <>
                    Gói <span className="text-foreground">{buyIntent.planName}</span> —
                    Hubsell sẽ gọi lại tư vấn và báo giá riêng theo quy mô shop của bạn.
                  </>
                ) : (
                  <>
                    Gói <span className="text-foreground">{buyIntent.planName}</span> — kỳ{" "}
                    {buyIntent.cycle ? CYCLE_LABEL[buyIntent.cycle] : ""} (
                    <span className="font-semibold tabular-nums text-foreground">
                      {nf.format(buyIntent.price)}₫
                    </span>
                    ). Hubsell sẽ gọi lại hướng dẫn thanh toán, gói mở ngay khi xác nhận
                    tiền về.
                  </>
                )}
              </DialogDescription>
            )}
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!buyIntent) return;
              requestMutation.mutate({
                planId: buyIntent.planId,
                cycle: buyIntent.cycle,
                contactPhone: phone,
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="buy-phone">Số điện thoại liên hệ</Label>
              <Input
                id="buy-phone"
                type="tel"
                required
                placeholder="VD: 0912 345 678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Hubsell chỉ dùng số này để liên hệ về yêu cầu của bạn.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBuyIntent(null)}
              >
                Thôi
              </Button>
              <Button type="submit" size="sm" disabled={requestMutation.isPending}>
                <ShoppingCart className="size-4" />
                {requestMutation.isPending ? "Đang gửi…" : "Gửi yêu cầu"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== Xác nhận trừ Ví — trừ tiền không được là một cú click nhầm ===== */}
      <Dialog open={walletBuy !== null} onOpenChange={(o) => !o && setWalletBuy(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Thanh toán bằng Ví Hubsell</DialogTitle>
            {walletBuy && (
              <DialogDescription>
                Trừ{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {nf.format(priceOf(walletBuy.plan, walletBuy.cycle))}₫
                </span>{" "}
                từ Ví (số dư{" "}
                <span className="tabular-nums">{nf.format(wallet)}₫</span>) để mua gói{" "}
                <span className="text-foreground">{walletBuy.plan.name}</span> kỳ{" "}
                {CYCLE_LABEL[walletBuy.cycle]}. Gói có hiệu lực ngay sau khi trừ.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setWalletBuy(null)}>
              Thôi
            </Button>
            <Button
              size="sm"
              disabled={walletMutation.isPending}
              onClick={() =>
                walletBuy &&
                walletMutation.mutate({ planId: walletBuy.plan.id, cycle: walletBuy.cycle })
              }
            >
              <Wallet className="size-4" />
              {walletMutation.isPending ? "Đang xử lý…" : "Xác nhận thanh toán"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}
