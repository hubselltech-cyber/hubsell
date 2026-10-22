"use client";

// ============================================================
// MA TRẬN GÓI × KỲ THANH TOÁN cho trang Cấu hình → Gói dịch vụ (22/10/2026, anh
// Trung: "phần cấu hình mua gói của khách cũng để dạng giống bên Landing cho dễ
// nhìn") — cùng bố cục với `hubsell-landing/src/components/landing/pricing.tsx`
// (bản 19/10 học bảng giá Salework): mỗi gói MỘT HÀNG (tên + 3 hạn mức + nút),
// mỗi kỳ 1 / 3 / 6 / 12 tháng MỘT CỘT, ô = giá trọn kỳ + quy đổi ₫/tháng + nhãn
// "Tiết kiệm N tháng" / "Tiết kiệm N%"; cột 12 tháng tô nổi + ruy băng "Lợi nhất".
// Khác landing (trang tĩnh): ở đây Ô GIÁ LÀ NÚT CHỌN KỲ — bấm ô nào thì nút
// "Thanh toán ngay / Đăng ký mua / Trả bằng Ví" của hàng đó mua đúng kỳ ấy.
// Dưới lg (điện thoại/tablet) bảng gập thành thẻ từng gói với 4 ô kỳ 2 × 2.
//
// Enterprise = hàng cuối, bán bằng TƯ VẤN: hiện giá CÔNG BỐ ₫/đơn (DATA
// `service_plans.pricePerOrder`, anh Trung chốt 65đ 22/10; null = "Liên hệ") và
// nút Đăng ký tư vấn — khách KHÔNG tự mua được, HQ tạo gói riêng.
//
// Màu: dùng token (bg-primary / bg-card / muted) thay slate-900 của landing vì
// app có giao diện tối (thang slate bị lật trong .dark — xem memory UI).
// ============================================================

import { useState } from "react";
import { Check, Clock, QrCode, ShoppingCart, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  BillingCycle,
  MyPlanInfo,
  MySubscriptionResponse,
  MyUpgradePlan,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("vi-VN");

export const CYCLES: {
  value: BillingCycle;
  label: string;
  months: number;
  key: keyof MyUpgradePlan;
  best?: boolean;
}[] = [
  { value: "MONTHLY", label: "1 tháng", months: 1, key: "priceMonthly" },
  { value: "QUARTERLY", label: "3 tháng", months: 3, key: "priceQuarterly" },
  { value: "SEMIANNUAL", label: "6 tháng", months: 6, key: "priceSemiannual" },
  { value: "YEARLY", label: "12 tháng", months: 12, key: "priceYearly", best: true },
];

export function priceOf(plan: MyUpgradePlan, cycle: BillingCycle): number {
  const c = CYCLES.find((x) => x.value === cycle)!;
  return Number(plan[c.key]) || 0;
}

/**
 * Khuyến mãi của một ô: so giá trọn kỳ với trả từng tháng cùng số tháng (TÍNH từ
 * data giá, không gõ tay — đổi bảng giá ở HQ là nhãn tự đúng).
 *  - giftMonths: kỳ = (months − k) × giá tháng → "Tiết kiệm k tháng" (12 tháng = trả
 *    10–11 tháng dùng 12); 0 = không theo kiểu tháng tròn.
 *  - pct: % tiết kiệm làm tròn; 0 = trả gộp không giảm (Starter/Growth 3 & 6 tháng).
 *  - perMonth: quy đổi ₫/tháng làm tròn tới 500 ₫.
 */
export function dealOf(plan: MyUpgradePlan, months: number, total: number) {
  const monthly = plan.priceMonthly;
  const full = monthly * months;
  const saved = full > 0 ? full - total : 0;
  const pct = full > 0 ? Math.round((saved / full) * 100) : 0;
  let giftMonths = 0;
  if (monthly > 0) {
    for (const k of [1, 2, 3]) if (monthly * (months - k) === total) giftMonths = k;
  }
  const raw = total / months;
  const perMonth = Math.round(raw / 500) * 500;
  return { total, pct, giftMonths, perMonth, approx: perMonth !== raw };
}

/** Mức lợi LỚN NHẤT của một cột (in ở đầu cột): "Tiết kiệm tới 2 tháng" / "tới 11%". */
function columnHint(plans: MyUpgradePlan[], c: (typeof CYCLES)[number]): string | null {
  if (c.months === 1) return null;
  const deals = plans
    .filter((p) => priceOf(p, c.value) > 0)
    .map((p) => dealOf(p, c.months, priceOf(p, c.value)));
  if (deals.length === 0) return null;
  const gift = Math.max(...deals.map((d) => d.giftMonths));
  if (gift > 0) return `Tiết kiệm tới ${gift} tháng`;
  const pct = Math.max(...deals.map((d) => d.pct));
  return pct > 0 ? `Tiết kiệm tới ${pct}%` : null;
}

function DealBadge({ deal }: { deal: ReturnType<typeof dealOf> }) {
  if (deal.giftMonths > 0) {
    return (
      <span className="inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
        Tiết kiệm {deal.giftMonths} tháng
      </span>
    );
  }
  if (deal.pct > 0) {
    return (
      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        Tiết kiệm {deal.pct}%
      </span>
    );
  }
  return null;
}

/** Ruy băng góc "Lợi nhất" cho ô kỳ 12 tháng (học nhãn BEST của bảng Salework). */
function BestRibbon() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -right-7 top-2.5 w-24 rotate-45 bg-gradient-to-r from-orange-500 to-orange-600 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wider text-white shadow-sm"
    >
      Lợi nhất
    </span>
  );
}

/** Ô giá = NÚT chọn kỳ: giá trọn kỳ to, quy đổi ₫/tháng nhỏ, nhãn khuyến mãi, dấu chọn. */
function PriceCell({
  plan,
  c,
  selected,
  onSelect,
  featured,
  compact,
}: {
  plan: MyUpgradePlan;
  c: (typeof CYCLES)[number];
  selected: boolean;
  onSelect: () => void;
  featured: boolean;
  compact?: boolean;
}) {
  const total = priceOf(plan, c.value);
  if (total <= 0) {
    return (
      <div className="flex h-full min-h-20 items-center justify-center text-sm text-muted-foreground">
        —
      </div>
    );
  }
  const deal = dealOf(plan, c.months, total);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`Chọn kỳ ${c.label}`}
      className={cn(
        // Mobile (compact): ô là grid item bị kéo giãn nên h-full tính theo CẢ ô (đè lên
        // dải "Lợi nhất" + nhãn kỳ, chữ "Đã chọn" lọt dưới đáy) → dùng flex-1 trong flex-col.
        "flex w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-3 text-center transition-colors",
        compact ? "flex-1" : "h-full",
        selected
          ? "bg-primary/5 ring-2 ring-inset ring-primary"
          : "hover:bg-muted/60 ring-1 ring-inset ring-transparent"
      )}
    >
      <p
        className={cn(
          "whitespace-nowrap font-bold tabular-nums tracking-tight",
          compact ? "text-lg" : "text-xl",
          featured ? "text-emerald-700" : "text-foreground"
        )}
      >
        {nf.format(total)} ₫
      </p>
      <p className="whitespace-nowrap text-xs text-muted-foreground">
        {c.months === 1 ? (
          "mỗi tháng"
        ) : (
          <>
            {deal.approx ? "≈ " : ""}
            {nf.format(deal.perMonth)} ₫/tháng
          </>
        )}
      </p>
      <DealBadge deal={deal} />
      <span
        className={cn(
          "mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium",
          selected ? "text-primary" : "text-transparent"
        )}
        aria-hidden={!selected}
      >
        <Check className="size-3" /> Đã chọn
      </span>
    </button>
  );
}

type Badge = { label: string; cls: string };

/** Tên gói + huy hiệu + mô tả + 3 hạn mức — dùng chung cột đầu bảng desktop và đầu thẻ mobile. */
function PlanHead({
  name,
  description,
  badges,
  limits,
}: {
  name: string;
  description: string | null;
  badges: Badge[];
  limits: string[];
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-bold">{name}</p>
        {badges.map((b) => (
          <span
            key={b.label}
            className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold", b.cls)}
          >
            {b.label}
          </span>
        ))}
      </div>
      {description && <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{description}</p>}
      <ul className="mt-2.5 space-y-1.5 text-[13px]">
        {limits.map((row) => (
          <li key={row} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <span>{row}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

const BADGE_BEST: Badge = {
  label: "Bán chạy nhất",
  cls: "bg-emerald-600 text-white shadow-sm",
};
const BADGE_CURRENT: Badge = {
  label: "Đang dùng",
  cls: "border border-sky-200 bg-sky-50 text-sky-700",
};
const BADGE_LOWER: Badge = {
  label: "Thấp hơn gói hiện tại",
  cls: "border border-border bg-muted text-muted-foreground",
};
const BADGE_CONSULT: Badge = {
  label: "Báo giá riêng",
  cls: "border border-border bg-card text-foreground",
};

/** Hạn mức 3 trục nói RÕ dưới từng gói — chưa đặt số = Không giới hạn (gói VẪN SẼ giới hạn cả 3 trục). */
function limitsOf(p: MyPlanInfo): string[] {
  return [
    p.maxOrdersPerMonth != null ? `${nf.format(p.maxOrdersPerMonth)} đơn / tháng` : "Không giới hạn đơn hàng",
    p.maxChannels != null ? `${nf.format(p.maxChannels)} gian hàng trên sàn` : "Không giới hạn gian hàng",
    p.maxStaff != null ? `${nf.format(p.maxStaff)} tài khoản nhân viên` : "Không giới hạn nhân viên",
  ];
}

export type PlanPricingMatrixProps = {
  plans: MyUpgradePlan[];
  currentPlan: MyPlanInfo | null;
  enterprisePlan: MySubscriptionResponse["enterprisePlan"];
  /** Trần đơn của gói tự mua lớn nhất — mốc "Trên N đơn/tháng" của Enterprise; 0 = không nói. */
  topSelfServeOrders: number;
  /** Có cổng thanh toán tự động (payOS) → nút chính "Thanh toán ngay". */
  gateway: boolean;
  /** Số dư Ví Hubsell (0 = không có) — đủ tiền thì hiện nút Trả bằng Ví. */
  wallet: number;
  /** Đang mở trang thanh toán — khóa nút chính. */
  checkoutPending: boolean;
  onCheckout: (plan: MyUpgradePlan, cycle: BillingCycle) => void;
  onRequestBuy: (plan: MyUpgradePlan, cycle: BillingCycle, price: number) => void;
  onWalletBuy: (plan: MyUpgradePlan, cycle: BillingCycle) => void;
  onConsult: () => void;
};

type RowInfo = { isCurrent: boolean; isLower: boolean; isBestSeller: boolean; badges: Badge[] };

/** Cụm nút mua của một gói — hành động theo kỳ ĐANG CHỌN của hàng. */
function PlanActions({
  p,
  row,
  cycle,
  gateway,
  wallet,
  checkoutPending,
  onCheckout,
  onRequestBuy,
  onWalletBuy,
  className,
}: {
  p: MyUpgradePlan;
  row: RowInfo;
  cycle: BillingCycle;
  className?: string;
} & Pick<
  PlanPricingMatrixProps,
  "gateway" | "wallet" | "checkoutPending" | "onCheckout" | "onRequestBuy" | "onWalletBuy"
>) {
  const { isCurrent, isLower, isBestSeller } = row;
  const price = priceOf(p, cycle);
  const label = CYCLES.find((c) => c.value === cycle)!.label;
  const walletEnough = wallet >= price && price > 0;
  return (
    <div className={cn("space-y-2", className)}>
      {gateway && (
        <Button
          className="w-full"
          variant={isBestSeller ? "default" : "outline"}
          disabled={checkoutPending || price <= 0}
          onClick={() => onCheckout(p, cycle)}
        >
          <QrCode className="size-4" />
          {checkoutPending
            ? "Đang mở trang thanh toán…"
            : isCurrent
              ? "Gia hạn — thanh toán ngay"
              : isLower
                ? "Chuyển sang gói này"
                : "Thanh toán ngay"}
        </Button>
      )}
      <Button
        className={cn("w-full", gateway && "h-auto whitespace-normal py-2 text-muted-foreground")}
        variant={gateway ? "ghost" : isBestSeller ? "default" : "outline"}
        disabled={price <= 0}
        onClick={() => onRequestBuy(p, cycle, price)}
      >
        <ShoppingCart className="size-4" />
        {gateway ? "Nhờ Hubsell hỗ trợ mua" : isCurrent ? "Gia hạn gói này" : "Đăng ký mua"}
      </Button>
      {walletEnough && (
        <Button className="w-full" variant="ghost" onClick={() => onWalletBuy(p, cycle)}>
          <Wallet className="size-4" />
          Trả bằng Ví Hubsell
        </Button>
      )}
      <p className="text-center text-xs text-muted-foreground">
        Kỳ {label} · <span className="font-medium tabular-nums text-foreground">{nf.format(price)} ₫</span>
      </p>
    </div>
  );
}

/** Ô giá của Enterprise: có giá công bố → "65 ₫ / đơn hàng" + câu giải thích; không → "Liên hệ". */
function EnterpriseOffer({ pricePerOrder, compact }: { pricePerOrder: number | null; compact?: boolean }) {
  return (
    <div className={cn(compact && "text-center")}>
      {pricePerOrder !== null ? (
        <>
          <p className="font-bold tabular-nums tracking-tight">
            <span className="text-2xl">{nf.format(pricePerOrder)} ₫</span>
            <span className="text-sm text-muted-foreground"> / đơn hàng</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tính theo số đơn thực tế mỗi tháng. Hạn mức, kỳ hạn và hỗ trợ triển khai thỏa thuận
            riêng — Hubsell tạo gói cho bạn sau khi tư vấn.
          </p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold tracking-tight">Liên hệ</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Báo giá theo quy mô — hạn mức, kỳ hạn và hỗ trợ triển khai thỏa thuận riêng.
          </p>
        </>
      )}
    </div>
  );
}

function ConsultButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button className={cn("w-full", className)} onClick={onClick}>
      <Clock className="size-4" />
      Đăng ký tư vấn
    </Button>
  );
}

export function PlanPricingMatrix({
  plans,
  currentPlan,
  enterprisePlan,
  topSelfServeOrders,
  gateway,
  wallet,
  checkoutPending,
  onCheckout,
  onRequestBuy,
  onWalletBuy,
  onConsult,
}: PlanPricingMatrixProps) {
  // Kỳ đã chọn theo TỪNG gói (mặc định 1 tháng) — khách so giá kỳ dài tự do.
  const [cycleByPlan, setCycleByPlan] = useState<Record<string, BillingCycle>>({});
  const cycleFor = (p: MyUpgradePlan) => cycleByPlan[p.id] ?? "MONTHLY";
  const select = (p: MyUpgradePlan, cycle: BillingCycle) =>
    setCycleByPlan((prev) => ({ ...prev, [p.id]: cycle }));

  const rowOf = (p: MyUpgradePlan) => {
    const isCurrent = p.id === currentPlan?.id;
    const isLower = currentPlan != null && p.tier < currentPlan.tier;
    // Bậc 3 = gói "Bán chạy nhất" (anh Trung chốt 22/08) — theo tier nên đổi thang
    // gói sau này không phải sửa code.
    const isBestSeller = p.tier === 3;
    const badges: Badge[] = [];
    if (isBestSeller) badges.push(BADGE_BEST);
    if (isCurrent) badges.push(BADGE_CURRENT);
    else if (isLower) badges.push(BADGE_LOWER);
    return { isCurrent, isLower, isBestSeller, badges };
  };

  const actionProps = { gateway, wallet, checkoutPending, onCheckout, onRequestBuy, onWalletBuy };

  const enterpriseDesc =
    enterprisePlan?.description ||
    (topSelfServeOrders > 0
      ? `Cho shop trên ${nf.format(topSelfServeOrders)} đơn/tháng`
      : "Cho shop quy mô lớn / nhiều thương hiệu");
  // Hạn mức Enterprise ghi "theo thỏa thuận" cả 3 trục — khớp landing (trước đây app
  // ghi "Không giới hạn nhân viên" lệch với landing "Thỏa thuận số nhân viên").
  const enterpriseLimits = [
    "Trần đơn hàng theo thỏa thuận",
    "Số gian hàng theo thỏa thuận",
    "Số nhân viên theo thỏa thuận",
  ];

  return (
    <>
      {/* ---------- MA TRẬN GÓI × KỲ — bản DESKTOP (lg trở lên) ---------- */}
      <div className="hidden lg:block">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="w-[30%] bg-primary px-5 py-4 align-middle text-primary-foreground">
                  <span className="block text-xs font-semibold uppercase tracking-wider opacity-70">
                    Gói dịch vụ
                  </span>
                  <span className="mt-1 block text-sm font-normal opacity-90">
                    Bấm vào ô giá để chọn kỳ — mua càng dài càng lợi
                  </span>
                </th>
                {CYCLES.map((c) => {
                  const hint = columnHint(plans, c);
                  return (
                    <th
                      key={c.value}
                      className={cn(
                        "px-3 py-4 text-center align-middle",
                        c.best ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground"
                      )}
                    >
                      <span className="block text-sm font-bold uppercase tracking-wide">Gói {c.label}</span>
                      <span className="mt-0.5 block text-[11px] font-normal opacity-80">
                        {hint ?? "Không cam kết dài hạn"}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const row = rowOf(p);
                const { isBestSeller, badges } = row;
                const cycle = cycleFor(p);
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "[&>td]:border-t",
                      isBestSeller ? "bg-emerald-50/40 [&>td]:border-t-emerald-200" : "[&>td]:border-t-border"
                    )}
                  >
                    <td
                      className={cn(
                        "px-5 py-5 align-top",
                        isBestSeller && "shadow-[inset_3px_0_0_0_var(--color-emerald-500)]"
                      )}
                    >
                      <PlanHead
                        name={p.name}
                        description={p.description ?? null}
                        badges={badges}
                        limits={[...limitsOf(p), "Đầy đủ mọi tính năng Hubsell"]}
                      />
                      <PlanActions
                        p={p}
                        row={row}
                        cycle={cycle}
                        className="mt-4 max-w-[240px]"
                        {...actionProps}
                      />
                    </td>
                    {CYCLES.map((c) => (
                      <td
                        key={c.value}
                        className={cn(
                          "relative overflow-hidden border-l p-2 align-middle",
                          c.best ? "border-l-amber-100 bg-amber-50/70" : "border-l-border/60"
                        )}
                      >
                        {c.best && priceOf(p, c.value) > 0 && <BestRibbon />}
                        <PriceCell
                          plan={p}
                          c={c}
                          selected={cycle === c.value}
                          onSelect={() => select(p, c.value)}
                          featured={isBestSeller}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {enterprisePlan && (
                <tr className="bg-gradient-to-r from-card via-emerald-50/30 to-card [&>td]:border-t [&>td]:border-t-border">
                  <td className="px-5 py-5 align-top">
                    <PlanHead
                      name={enterprisePlan.name}
                      description={enterpriseDesc}
                      badges={[BADGE_CONSULT]}
                      limits={[...enterpriseLimits, "Đầy đủ tính năng + hỗ trợ triển khai riêng"]}
                    />
                  </td>
                  <td colSpan={CYCLES.length} className="border-l border-l-border/60 px-6 py-5 align-middle">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="min-w-0 max-w-xl flex-1">
                        <EnterpriseOffer pricePerOrder={enterprisePlan.pricePerOrder} />
                      </div>
                      <ConsultButton onClick={onConsult} className="w-full sm:w-auto sm:min-w-[200px]" />
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- bản ĐIỆN THOẠI / TABLET (dưới lg): mỗi gói một thẻ, 4 ô kỳ 2 × 2 ---------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:hidden">
        {plans.map((p) => {
          const row = rowOf(p);
          const { isBestSeller, badges } = row;
          const cycle = cycleFor(p);
          return (
            <div
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-5 shadow-sm",
                isBestSeller && "border-emerald-500 ring-1 ring-emerald-500"
              )}
            >
              <PlanHead
                name={p.name}
                description={p.description ?? null}
                badges={badges}
                limits={[...limitsOf(p), "Đầy đủ mọi tính năng Hubsell"]}
              />
              <div className="mt-4 grid grid-cols-2 gap-2">
                {CYCLES.map((c) => (
                  <div
                    key={c.value}
                    className={cn(
                      "relative flex flex-col overflow-hidden rounded-xl border",
                      c.best ? "border-amber-200 bg-amber-50/70" : "border-border bg-muted/40"
                    )}
                  >
                    {/* Ô hẹp: "Lợi nhất" là DẢI MỎNG trên đầu ô (ruy băng góc đè chữ ở 375px) */}
                    {c.best && priceOf(p, c.value) > 0 && (
                      <p className="bg-gradient-to-r from-orange-500 to-orange-600 py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wider text-white">
                        Lợi nhất
                      </p>
                    )}
                    <p className="mt-2 whitespace-nowrap text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {c.label}
                    </p>
                    <PriceCell
                      plan={p}
                      c={c}
                      selected={cycle === c.value}
                      onSelect={() => select(p, c.value)}
                      featured={isBestSeller}
                      compact
                    />
                  </div>
                ))}
              </div>
              <PlanActions p={p} row={row} cycle={cycle} className="mt-auto pt-5" {...actionProps} />
            </div>
          );
        })}
        {enterprisePlan && (
          <div className="relative flex flex-col rounded-2xl border border-slate-300 bg-card p-5 shadow-sm dark:border-slate-700">
            <PlanHead
              name={enterprisePlan.name}
              description={enterpriseDesc}
              badges={[BADGE_CONSULT]}
              limits={[...enterpriseLimits, "Đầy đủ tính năng + hỗ trợ triển khai riêng"]}
            />
            <div className="mt-4 flex-1 rounded-xl border border-border bg-muted/40 px-4 py-4">
              <EnterpriseOffer pricePerOrder={enterprisePlan.pricePerOrder} compact />
            </div>
            <div className="mt-auto pt-5">
              <ConsultButton onClick={onConsult} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
