"use client";

// ============================================================
// CƯỠNG CHẾ TRẦN GÓI — bộ 3 khối phía KHÁCH (GĐ2 thương mại hóa 22/08):
//
// 1) PlanQuotaBanner — dải bám TRẠNG THÁI dưới header (cùng triết lý banner
//    gian mất kết nối): vàng khi chạm 80% trần đơn / sắp hết hạn, đỏ khi vượt
//    trần / hết hạn / đã khóa. Mức vàng có nút tắt (theo tháng, localStorage);
//    mức đỏ KHÔNG tắt được — đó là chủ đích.
// 2) UpgradePlanDialog — popup nâng gói: bảng gói bậc cao hơn + hướng dẫn
//    thanh toán. STK nhận tiền là CỔNG CHỜ (env backend chưa đặt → mời liên
//    hệ + đường Ví Hubsell ở /referral). Tự bật MỘT lần mỗi (tháng, mức) khi
//    chạm mức đỏ.
// 3) PlanLockedScreen — màn thay nội dung các trang tầng giá trị gia tăng khi
//    bị khóa. Đơn + tồn kho vẫn đồng bộ ngầm phía backend — màn này phải nói
//    rõ điều đó để khách yên tâm dữ liệu không mất.
//
// Nguồn số liệu duy nhất: GET /api/subscription/me (qk.mySubscription — cache
// React Query dùng chung giữa banner, dialog và gate trong AppShell).
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpCircle,
  Check,
  Lock,
  TriangleAlert,
  Wallet,
  X,
} from "lucide-react";

import { fetchMySubscription, type MySubscriptionResponse } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Các nhánh route thuộc TẦNG GIÁ TRỊ GIA TĂNG — khớp danh sách mount gắn
 * requirePlanUnlocked ở backend/src/app.ts (backend mới là hàng rào thật,
 * đây chỉ là lớp trình bày để trang khóa hiện màn tử tế thay vì lỗi 403). */
const GATED_PREFIXES = [
  "/finance",
  "/invoicing",
  "/operations-assistant",
  "/ai-rules",
  "/chat",
  "/loss-orders",
  "/reviews",
  "/ads",
  "/koc-marketing",
];

export function isPlanGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Cache dùng chung cho banner + gate + dialog. Khối BỊ ĐỘNG: lỗi mạng/403 thì
 * lặng lẽ coi như không giới hạn, không được kéo cả trang sang màn lỗi. */
export function useMyPlan(enabled: boolean) {
  return useQuery({
    queryKey: qk.mySubscription(),
    queryFn: fetchMySubscription,
    enabled,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });
}

const nf = new Intl.NumberFormat("vi-VN");

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeyNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─────────────────────────── BANNER ───────────────────────────

const WARN_DISMISS_KEY = "hubsell_plan_banner_dismissed";
const POPUP_SEEN_KEY = "hubsell_plan_popup_seen";

interface BannerContent {
  /** Khóa định danh mức cảnh báo — dùng cho nút tắt (vàng) + auto-popup (đỏ). */
  key: string;
  tone: "amber" | "red";
  lead: string;
  detail: string;
  /** Mức đỏ tự bật popup một lần. */
  autoPopup: boolean;
  dismissible: boolean;
}

function bannerContentOf(data: MySubscriptionResponse): BannerContent | null {
  if (!data.hasSubscription || data.exempt || !data.plan) return null;
  const month = monthKeyNow();
  const planName = data.plan.name;
  const { orders, subscription, expiry } = data;
  const usedOfLimit =
    orders.limit != null ? `${nf.format(orders.used)}/${nf.format(orders.limit)} đơn` : "";

  // Ưu tiên theo độ nặng: khóa > hết hạn > vượt trần > 80% > sắp hết hạn.
  if (data.locked && data.lockedReason === "EXPIRED") {
    return {
      key: `${month}:locked-expired`,
      tone: "red",
      lead: `Gói ${planName} đã hết hạn — các tính năng nâng cao đang tạm khóa`,
      detail: "Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ; gia hạn là mở lại nguyên vẹn.",
      autoPopup: true,
      dismissible: false,
    };
  }
  if (data.locked) {
    return {
      key: `${month}:locked-orders`,
      tone: "red",
      lead: `Đã vượt trần đơn của gói ${planName} (${usedOfLimit}) — tính năng nâng cao tạm khóa`,
      detail: "Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ; nâng gói là mở lại nguyên vẹn.",
      autoPopup: true,
      dismissible: false,
    };
  }
  if (expiry.expired) {
    return {
      key: `${month}:expired`,
      tone: "red",
      lead: `Gói ${planName}${subscription?.isTrial ? " (dùng thử)" : ""} đã hết hạn`,
      detail: expiry.lockDeadline
        ? `Các tính năng nâng cao sẽ tạm khóa sau ngày ${fmtDate(expiry.lockDeadline)} nếu chưa gia hạn — đơn hàng vẫn đồng bộ bình thường.`
        : "Gia hạn để tiếp tục sử dụng đầy đủ tính năng.",
      autoPopup: true,
      dismissible: false,
    };
  }
  if (orders.state === "over") {
    return {
      key: `${month}:over`,
      tone: "red",
      lead: `Đã vượt trần đơn tháng này của gói ${planName} (${usedOfLimit})`,
      detail: orders.graceDeadline
        ? `Đơn vẫn được đồng bộ đầy đủ; sau ngày ${fmtDate(orders.graceDeadline)} các tính năng nâng cao sẽ tạm khóa nếu chưa nâng gói.`
        : "Đơn vẫn được đồng bộ đầy đủ — nâng gói để không gián đoạn tính năng nâng cao.",
      autoPopup: true,
      dismissible: false,
    };
  }
  if (orders.state === "warn") {
    return {
      key: `${month}:warn`,
      tone: "amber",
      lead: `Đã dùng ${Math.floor((orders.ratio ?? 0) * 100)}% trần đơn tháng này (${usedOfLimit}, gói ${planName})`,
      detail: "Nâng gói sớm để không gián đoạn khi shop tăng trưởng.",
      autoPopup: false,
      dismissible: true,
    };
  }
  if (
    subscription &&
    subscription.status === "ACTIVE" &&
    subscription.daysLeft !== null &&
    subscription.daysLeft <= 3 &&
    subscription.currentPeriodEnd
  ) {
    return {
      key: `expiring:${subscription.currentPeriodEnd}`,
      tone: "amber",
      lead: `Gói ${planName}${subscription.isTrial ? " (dùng thử)" : ""} hết hạn ngày ${fmtDate(subscription.currentPeriodEnd)}`,
      detail: "Gia hạn/thanh toán trước ngày hết hạn để không gián đoạn tính năng nâng cao.",
      autoPopup: false,
      dismissible: true,
    };
  }
  return null;
}

function readSeen(storageKey: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function markSeen(storageKey: string, key: string): void {
  // Chỉ giữ các khóa gần đây — danh sách không phình theo năm tháng.
  const next = [...new Set([...readSeen(storageKey), key])].slice(-20);
  localStorage.setItem(storageKey, JSON.stringify(next));
}

/** Dải cảnh báo trần gói — CHỈ CHỦ SHOP (đặt cạnh ChannelDisconnectedBanner
 * trong AppShell; nhân viên không nâng gói được nên không hiện). */
export function PlanQuotaBanner() {
  const { data } = useMyPlan(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(() => readSeen(WARN_DISMISS_KEY));
  // Nội dung suy từ data mỗi render — banner bám trạng thái, không bám sự kiện.
  const content = data ? bannerContentOf(data) : null;

  // Mức đỏ tự bật popup nâng gói MỘT lần mỗi (tháng, mức) — những lần sau
  // banner vẫn đứng đó, khách chủ động bấm.
  useEffect(() => {
    if (!content?.autoPopup) return;
    if (readSeen(POPUP_SEEN_KEY).includes(content.key)) return;
    markSeen(POPUP_SEEN_KEY, content.key);
    setDialogOpen(true);
  }, [content?.autoPopup, content?.key]);

  if (!content) return null;
  if (content.dismissible && dismissed.includes(content.key)) return null;

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-3 border-b px-4 py-2 text-sm md:px-6",
          content.tone === "red"
            ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
            : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
        )}
      >
        <TriangleAlert className="size-4 shrink-0" />
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{content.lead}</span>
          <span className="hidden lg:inline"> — {content.detail}</span>
        </p>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 font-medium transition-colors",
            content.tone === "red"
              ? "border-red-300 hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
              : "border-amber-400 hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
          )}
        >
          <ArrowUpCircle className="size-3.5" />
          Nâng gói
        </button>
        {content.dismissible && (
          <button
            type="button"
            onClick={() => {
              markSeen(WARN_DISMISS_KEY, content.key);
              setDismissed((prev) => [...prev, content.key]);
            }}
            title="Ẩn cảnh báo này (hiện lại khi chạm mức nặng hơn hoặc sang tháng)"
            aria-label="Ẩn cảnh báo trần gói"
            className="shrink-0 rounded-md p-1 opacity-70 transition-colors hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {data && (
        <UpgradePlanDialog open={dialogOpen} onOpenChange={setDialogOpen} data={data} />
      )}
    </>
  );
}

// ─────────────────────────── POPUP NÂNG GÓI ───────────────────────────

/** Quyền lợi chung — MỌI gói đều full tính năng (chốt 22/08), nên bày MỘT
 * checklist dùng chung thay vì lặp 4 lần trên từng card; card chỉ nêu thứ
 * thật sự khác nhau giữa các gói (trần đơn + giá). Export cho /settings/plan
 * dùng lại — một nguồn nội dung duy nhất. */
export const PLAN_FEATURES = [
  "Đồng bộ đơn hàng & tồn kho Shopee, Lazada, TikTok",
  "Báo cáo tài chính — lãi/lỗ thực theo đối soát sàn",
  "Trợ lý quảng cáo: ROAS hòa vốn, cảnh báo cắt lỗ",
  "Trợ lý vận hành & chat CSKH đa kênh",
  "Cứu đơn giao thất bại, quản lý hoàn/trả",
  "Phân quyền nhân viên, chuông cảnh báo & báo cáo tự động",
];

/** Các kỳ mua dài hiển thị trên card (kỳ 1 tháng đã là giá chính). */
const CYCLE_ROWS = [
  { months: 3, label: "3 tháng", key: "priceQuarterly" },
  { months: 6, label: "6 tháng", key: "priceSemiannual" },
  { months: 12, label: "12 tháng", key: "priceYearly" },
] as const;

export function UpgradePlanDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MySubscriptionResponse;
}) {
  const { plan, orders, upgradePlans, payment } = data;

  // "Đề xuất" = gói RẺ NHẤT đủ trần cho mức đơn hiện tại — nhưng CHỈ khi khách
  // thật sự cần đổi gói (chưa có gói / gói hiện tại đã chật / đã hết hạn).
  // Khách đang ổn với gói của mình thì không gạ nâng cấp.
  const needsChange =
    !plan || orders.state !== "ok" || data.expiry.expired || data.locked;
  const recommendedId = needsChange
    ? (upgradePlans.find(
        (p) =>
          p.id !== plan?.id &&
          (p.maxOrdersPerMonth == null || p.maxOrdersPerMonth >= orders.used)
      ) ?? upgradePlans[upgradePlans.length - 1])?.id
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nâng gói dịch vụ</DialogTitle>
          <DialogDescription>
            {plan ? (
              <>
                Đang dùng gói <span className="font-medium text-foreground">{plan.name}</span>
                {orders.limit != null && (
                  <>
                    {" "}— tháng này đã có{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {nf.format(orders.used)}/{nf.format(orders.limit)}
                    </span>{" "}
                    đơn
                  </>
                )}
                . Mọi gói đều đầy đủ tính năng — chỉ khác trần số đơn mỗi tháng.
              </>
            ) : (
              "Mọi gói đều đầy đủ tính năng — chỉ khác trần số đơn mỗi tháng."
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Quyền lợi chung — khách thấy NGAY mình nhận được gì trước khi so giá */}
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-sm font-medium">Mọi gói đều bao gồm toàn bộ tính năng</p>
          <ul className="mt-2 grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
            {PLAN_FEATURES.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 text-xs text-muted-foreground"
              >
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {upgradePlans.length > 0 ? (
          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            {upgradePlans.map((p) => {
              const isCurrent = p.id === plan?.id;
              const isRecommended = p.id === recommendedId && !isCurrent;
              const scopeLine = [
                p.maxChannels != null
                  ? `${nf.format(p.maxChannels)} gian hàng`
                  : "Không giới hạn gian hàng",
                p.maxStaff != null
                  ? `${nf.format(p.maxStaff)} nhân viên`
                  : "không giới hạn nhân viên",
              ].join(" · ");
              return (
                <div
                  key={p.id}
                  className={cn(
                    "relative rounded-xl border bg-card p-4 shadow-sm",
                    isRecommended && "border-emerald-500 ring-1 ring-emerald-500",
                    isCurrent && "border-dashed opacity-90"
                  )}
                >
                  {isRecommended && (
                    <span className="absolute -top-2.5 left-4 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      Đề xuất cho shop bạn
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute right-3 top-3 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300">
                      Đang dùng
                    </span>
                  )}
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                    {p.maxOrdersPerMonth != null
                      ? `Đến ${nf.format(p.maxOrdersPerMonth)} đơn/tháng`
                      : "Không giới hạn đơn"}
                  </p>
                  <p className="mt-2 text-2xl font-bold tabular-nums">
                    {nf.format(p.priceMonthly)}₫
                    <span className="text-sm font-normal text-muted-foreground">
                      /tháng
                    </span>
                  </p>
                  {/* Kỳ dài kèm % tiết kiệm TÍNH TỪ DATA giá — bảng giá đổi là
                      con số tự đúng, không hardcode chính sách chiết khấu */}
                  <div className="mt-2 space-y-1 border-t pt-2 text-xs tabular-nums text-muted-foreground">
                    {CYCLE_ROWS.filter((c) => p[c.key] > 0).map((c) => {
                      const save = p.priceMonthly > 0
                        ? Math.round((1 - p[c.key] / (p.priceMonthly * c.months)) * 100)
                        : 0;
                      return (
                        <p key={c.key} className="flex justify-between gap-2">
                          <span>{c.label}</span>
                          <span>
                            {nf.format(p[c.key])}₫
                            {save >= 1 && (
                              <span className="ml-1.5 font-medium text-emerald-600">
                                −{save}%
                              </span>
                            )}
                          </span>
                        </p>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">{scopeLine}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Bạn đang ở bậc gói cao nhất — liên hệ Hubsell để được tư vấn gói Enterprise
            theo nhu cầu.
          </p>
        )}

        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Cách thanh toán</p>
          {/* Đường MUA chính: trang Gói dịch vụ có chọn kỳ + nút Đăng ký mua /
              trả bằng Ví — popup này chỉ là bảng so sánh nhanh. */}
          <Link
            href="/settings/plan"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <ArrowUpCircle className="size-4" />
            Chọn gói &amp; đăng ký mua
          </Link>
          {payment ? (
            <div className="mt-1 space-y-0.5 text-muted-foreground">
              <p>
                Chuyển khoản tới <span className="font-medium text-foreground">{payment.bankName}</span>{" "}
                — STK{" "}
                <span className="font-semibold tabular-nums text-foreground">
                  {payment.bankAccount}
                </span>{" "}
                ({payment.bankHolder}).
              </p>
              <p>
                Nội dung: <span className="font-medium text-foreground">HUBSELL + email đăng nhập</span>.
                Gói mở ngay khi Hubsell xác nhận tiền về.
              </p>
            </div>
          ) : (
            <p className="mt-1 text-muted-foreground">
              Liên hệ Hubsell qua kênh hỗ trợ để được hướng dẫn thanh toán — hoặc dùng số
              dư Ví Hubsell (hoa hồng giới thiệu) để thanh toán trực tiếp.
            </p>
          )}
          <Link
            href="/referral"
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Wallet className="size-4" />
            Thanh toán bằng Ví Hubsell
          </Link>
        </div>

        <p className="text-xs text-muted-foreground">
          Trong thời gian chờ nâng gói, đơn hàng và tồn kho vẫn được đồng bộ đầy đủ —
          không mất dữ liệu nào.{" "}
          <Link href="/settings/plan" className="font-medium underline underline-offset-2">
            Xem chi tiết gói &amp; lịch sử thanh toán
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── MÀN KHÓA ───────────────────────────

/** Thay nội dung trang tầng giá trị gia tăng khi bị khóa (AppShell quyết định
 * lúc nào render). Nhân viên thấy lời nhắn liên hệ chủ shop thay vì nút nâng gói. */
export function PlanLockedScreen({
  data,
  isShopAdmin,
}: {
  data: MySubscriptionResponse;
  isShopAdmin: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const expired = data.lockedReason === "EXPIRED";

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/50">
          <Lock className="size-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">
            {expired
              ? `Gói ${data.plan?.name ?? "dịch vụ"} đã hết hạn`
              : "Shop đã vượt trần đơn của gói hiện tại"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {expired
              ? "Tính năng này tạm khóa cho tới khi gia hạn."
              : data.orders.limit != null
                ? `Tháng này đã có ${nf.format(data.orders.used)}/${nf.format(data.orders.limit)} đơn — tính năng này tạm khóa cho tới khi nâng gói.`
                : "Tính năng này tạm khóa cho tới khi nâng gói."}{" "}
            Đơn hàng và tồn kho vẫn được đồng bộ đầy đủ phía sau — {expired ? "gia hạn" : "nâng gói"} là
            mọi số liệu hiện lại nguyên vẹn, không mất gì.
          </p>
        </div>
        {isShopAdmin ? (
          <Button onClick={() => setDialogOpen(true)}>
            <ArrowUpCircle className="size-4" />
            {expired ? "Gia hạn / nâng gói" : "Xem gói & nâng cấp"}
          </Button>
        ) : (
          <p className="text-sm font-medium">
            Liên hệ chủ shop để {expired ? "gia hạn" : "nâng"} gói dịch vụ.
          </p>
        )}
        <UpgradePlanDialog open={dialogOpen} onOpenChange={setDialogOpen} data={data} />
      </div>
    </div>
  );
}
