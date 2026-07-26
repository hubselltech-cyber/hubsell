"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Banknote,
  Check,
  Copy,
  Headset,
  Loader2,
  Package,
  QrCode,
  ShoppingCart,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * MUA GÓI PHÔI HÓA ĐƠN ĐIỆN TỬ (Ưu đãi đối tác Hubsell) — widget thương mại
 * Multi-Vendor, chuẩn bị sẵn cho luồng "bán hộ/đại lý" phôi hóa đơn.
 *
 * DYNAMIC BRANDING: toàn bộ màu chủ đạo của section (tab active, nút Mua ngay,
 * badge "Bán chạy nhất", banner ưu đãi, modal thanh toán) đổi theo thương hiệu
 * của NCC đang chọn — xem `VENDOR_BRANDS`. Lưu ý Tailwind không JIT được class
 * nội suy từ biến, nên mỗi brand phải liệt kê CHUỖI CLASS TĨNH đầy đủ.
 *
 * TOÀN BỘ LÀ MOCKUP: danh mục gói, thông tin chuyển khoản và trạng thái quét
 * giao dịch đều là dữ liệu tĩnh. Các điểm gắn API thật được đánh dấu
 * `TODO(API)`:
 *   1. Danh sách NCC + gói phôi  → API Đại lý (MISA/Viettel/VNPT/BKAV).
 *   2. Tạo đơn + QR động          → API Sepay (tạo QR theo số tiền/nội dung).
 *   3. Xác nhận thanh toán        → Webhook Sepay báo tiền về, kích hoạt gói
 *                                    và tự cấu hình API Key cho shop.
 */

// ===== DANH MỤC (mock) =====

type PlanVendorId = "MISA" | "VIETTEL" | "VNPT" | "BKAV";

interface PlanVendor {
  id: PlanVendorId;
  label: string;
  /**
   * Chưa ký hợp đồng đại lý — vẫn CHO CHỌN để xem trước bảng giá + nhận diện
   * thương hiệu, nhưng khóa nút mua (đổi thành "Sắp ra mắt").
   */
  soon?: boolean;
}

// TODO(API): thay bằng danh sách NCC đã ký đại lý, trả về từ backend.
const PLAN_VENDORS: PlanVendor[] = [
  { id: "MISA", label: "MISA meInvoice" },
  { id: "VIETTEL", label: "Viettel SInvoice", soon: true },
  { id: "VNPT", label: "VNPT Invoice", soon: true },
  { id: "BKAV", label: "Bkav eHoadon", soon: true },
];

/** Bộ màu thương hiệu của từng NCC — chuỗi class tĩnh để Tailwind JIT bắt được. */
interface VendorBrand {
  /** Chữ trên logo mockup (TODO(assets): thay bằng file logo thật trong /public). */
  logoText: string;
  /** Nền logo mockup. */
  logoBg: string;
  /** Tab đang active. */
  tabActive: string;
  /** Nút hành động chính (Mua ngay gói popular, Xác nhận đã chuyển khoản). */
  buttonSolid: string;
  /** Nút Mua ngay phụ (gói thường) — viền + chữ theo brand. */
  buttonOutline: string;
  /** Badge "Bán chạy nhất". */
  badge: string;
  /** Viền card gói popular. */
  cardBorder: string;
  /** Chữ nhấn theo brand. */
  text: string;
  /** Box nền nhạt (banner ưu đãi, box trạng thái trong modal). */
  softBox: string;
  /** Spinner quét giao dịch trong modal. */
  spinner: string;
}

const VENDOR_BRANDS: Record<PlanVendorId, VendorBrand> = {
  // MISA — xanh navy/cyan (#0054A5 ~ blue-600/700)
  MISA: {
    logoText: "MISA",
    logoBg: "bg-blue-600",
    tabActive: "border-blue-600 bg-blue-600 text-white",
    buttonSolid: "bg-blue-600 text-white hover:bg-blue-600/85",
    buttonOutline: "border-blue-600/40 text-blue-700 hover:bg-blue-50",
    badge: "bg-blue-600 text-white",
    cardBorder: "border-blue-600/50",
    text: "text-blue-700",
    softBox: "border-blue-100 bg-blue-50",
    spinner: "text-blue-500",
  },
  // Viettel — đỏ đô (#EE0000 ~ red-600)
  VIETTEL: {
    logoText: "VT",
    logoBg: "bg-red-600",
    tabActive: "border-red-600 bg-red-600 text-white",
    buttonSolid: "bg-red-600 text-white hover:bg-red-600/85",
    buttonOutline: "border-red-600/40 text-red-700 hover:bg-red-50",
    badge: "bg-red-600 text-white",
    cardBorder: "border-red-600/50",
    text: "text-red-700",
    softBox: "border-red-100 bg-red-50",
    spinner: "text-red-500",
  },
  // VNPT — xanh dương đậm (#0066B3 ~ sky-700)
  VNPT: {
    logoText: "VNPT",
    logoBg: "bg-sky-700",
    tabActive: "border-sky-700 bg-sky-700 text-white",
    buttonSolid: "bg-sky-700 text-white hover:bg-sky-700/85",
    buttonOutline: "border-sky-700/40 text-sky-700 hover:bg-sky-50",
    badge: "bg-sky-700 text-white",
    cardBorder: "border-sky-700/50",
    text: "text-sky-700",
    softBox: "border-sky-100 bg-sky-50",
    spinner: "text-sky-600",
  },
  // BKAV — cam công nghệ (orange-500)
  BKAV: {
    logoText: "BKAV",
    logoBg: "bg-orange-500",
    tabActive: "border-orange-500 bg-orange-500 text-white",
    buttonSolid: "bg-orange-500 text-white hover:bg-orange-500/85",
    buttonOutline: "border-orange-500/40 text-orange-600 hover:bg-orange-50",
    badge: "bg-orange-500 text-white",
    cardBorder: "border-orange-500/50",
    text: "text-orange-600",
    softBox: "border-orange-100 bg-orange-50",
    spinner: "text-orange-500",
  },
};

interface InvoicePlan {
  id: string;
  name: string;
  /** Số lượng phôi hóa đơn trong gói. */
  invoices: number;
  /** Giá bán (VND). */
  price: number;
  /** Gói chủ lực — nổi bật badge "Bán chạy nhất". */
  popular?: boolean;
}

// TODO(API): thay bằng bảng giá thật theo từng NCC từ API Đại lý.
const INVOICE_PLANS: InvoicePlan[] = [
  { id: "starter", name: "Gói Khởi Nghiệp", invoices: 500, price: 350_000 },
  {
    id: "growth",
    name: "Gói Tăng Trưởng",
    invoices: 1_000,
    price: 600_000,
    popular: true,
  },
  {
    id: "business",
    name: "Gói Doanh Nghiệp",
    invoices: 2_000,
    price: 1_100_000,
  },
];

// TODO(API): thay bằng tài khoản nhận tiền cấu hình trên Sepay (trả từ backend,
// không hardcode ở client khi chạy thật).
const SEPAY_MOCK_ACCOUNT = {
  bank: "MB Bank (Ngân hàng Quân đội)",
  accountNumber: "0901234567890",
  accountHolder: "CONG TY TNHH HUBSELL",
};

const QR_MOCKUP_URL = "https://placehold.co/250x250/png?text=Sepay+QR+Mockup";

/** id của khối mua phôi — để nút "Nạp thêm" ở Báo cáo phôi cuộn mượt tới đây. */
export const INVOICE_PLAN_SECTION_ID = "invoice-plan-purchase";

// ===== TIỆN ÍCH =====

/** Sinh mã đơn hàng mock dạng HUBSELL9823 — mỗi lần mở modal một mã mới. */
function generateOrderCode(): string {
  return `HUBSELL${Math.floor(1000 + Math.random() * 9000)}`;
}

async function copyToClipboard(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`Đã copy ${label}`);
  } catch {
    toast.error("Không copy được — vui lòng copy thủ công");
  }
}

// ===== SUB-COMPONENTS =====

/** Logo mockup của NCC — khối chữ viết tắt trên nền màu thương hiệu. */
function VendorLogo({ brand }: { brand: VendorBrand }) {
  return (
    // TODO(assets): thay bằng <img> logo thật của NCC đặt trong /public.
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold tracking-tight text-white",
        brand.logoBg,
      )}
    >
      {brand.logoText}
    </span>
  );
}

/** Nút copy nhanh đặt cạnh các giá trị cần chuyển khoản chính xác. */
function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={`Copy ${label}`}
      onClick={() => copyToClipboard(value, label)}
    >
      <Copy />
    </Button>
  );
}

/**
 * Tab chọn nhà cung cấp — tab active nhuộm màu thương hiệu NCC. NCC "Soon" vẫn
 * chọn được để xem trước, chỉ khóa ở nút mua.
 */
function VendorTabs({
  value,
  onChange,
}: {
  value: PlanVendorId;
  onChange: (v: PlanVendorId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Nhà cung cấp gói phôi"
      className="flex flex-wrap gap-2"
    >
      {PLAN_VENDORS.map((v) => {
        const active = v.id === value;
        const brand = VENDOR_BRANDS[v.id];
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? brand.tabActive
                : "border-border bg-background hover:bg-muted",
              v.soon && !active && "opacity-70",
            )}
          >
            {v.label}
            {v.soon && (
              <Badge
                variant="secondary"
                className={cn(
                  "h-4 px-1.5 text-[10px]",
                  active && "bg-white/20 text-white",
                )}
              >
                Soon
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Thẻ một gói phôi trong grid 3 cột — màu nút/badge theo brand NCC đang chọn. */
function PlanCard({
  plan,
  brand,
  purchasable,
  onBuy,
}: {
  plan: InvoicePlan;
  brand: VendorBrand;
  /** NCC "Soon" → khóa mua, nút đổi thành "Sắp ra mắt". */
  purchasable: boolean;
  onBuy: (plan: InvoicePlan) => void;
}) {
  const perInvoice = Math.round(plan.price / plan.invoices);
  return (
    <div
      className={cn(
        "relative flex flex-col gap-1 rounded-lg border bg-card p-4",
        plan.popular && ["shadow-sm", brand.cardBorder],
      )}
    >
      {plan.popular && (
        <Badge
          className={cn(
            "absolute -top-2.5 left-1/2 -translate-x-1/2",
            brand.badge,
          )}
        >
          Bán chạy nhất
        </Badge>
      )}
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Package className="size-4 text-slate-500" />
        {plan.name}
      </p>
      <p className="text-sm text-muted-foreground">
        {formatNumber(plan.invoices)} hóa đơn
      </p>
      <p className="mt-1 text-lg font-semibold">{formatVND(plan.price)}</p>
      <p className={TEXT_SUB}>≈ {formatVND(perInvoice)}/hóa đơn</p>
      <Button
        type="button"
        variant={plan.popular ? "default" : "outline"}
        disabled={!purchasable}
        className={cn(
          "mt-3 w-full",
          purchasable &&
            (plan.popular ? brand.buttonSolid : brand.buttonOutline),
        )}
        onClick={() => onBuy(plan)}
      >
        <ShoppingCart className="size-4" />
        {purchasable ? "Mua ngay" : "Sắp ra mắt"}
      </Button>
    </div>
  );
}

/** Một dòng thông tin chuyển khoản: nhãn — giá trị — (tuỳ chọn) nút copy. */
function TransferRow({
  label,
  value,
  copyValue,
}: {
  label: string;
  value: string;
  /** Có nút copy khi truyền giá trị này (giá trị thô để copy, vd số tiền không dấu chấm). */
  copyValue?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-0.5 text-right font-medium">
        <span className="truncate">{value}</span>
        {copyValue !== undefined && (
          <CopyButton value={copyValue} label={label.toLowerCase()} />
        )}
      </span>
    </div>
  );
}

// ===== COMPONENT CHÍNH =====

export function InvoicePlanPurchaseSection() {
  // NCC đang chọn — quyết định toàn bộ bộ màu thương hiệu của section.
  const [selectedVendor, setSelectedVendor] = useState<PlanVendorId>("MISA");

  // Gói đang thanh toán — khác null nghĩa là modal thanh toán đang mở.
  const [payingPlan, setPayingPlan] = useState<InvoicePlan | null>(null);
  // Mã đơn hàng sinh mới mỗi lần mở modal (mock — sau này backend cấp).
  const [orderCode, setOrderCode] = useState("");
  // Dialog thông báo fallback sau khi khách bấm "Xác nhận đã chuyển khoản".
  const [noticeOpen, setNoticeOpen] = useState(false);

  const vendorMeta = PLAN_VENDORS.find((v) => v.id === selectedVendor);
  const vendorLabel = vendorMeta?.label ?? selectedVendor;
  const purchasable = vendorMeta?.soon !== true;
  const brand = VENDOR_BRANDS[selectedVendor];

  function handleBuy(plan: InvoicePlan) {
    // TODO(API): gọi backend tạo đơn hàng + lấy QR Sepay động (đúng số tiền,
    // đúng nội dung CK) rồi mới mở modal. Hiện mock toàn bộ.
    setOrderCode(generateOrderCode());
    setPayingPlan(plan);
  }

  function handleConfirmTransferred() {
    // TODO(API): khi có Webhook Sepay, nút này thay bằng trạng thái chờ webhook
    // xác nhận tiền về → tự kích hoạt gói + cấu hình API Key, không cần CSKH.
    setPayingPlan(null);
    setNoticeOpen(true);
  }

  return (
    <>
      {/* Widget thương mại — viền chuẩn Hubsell, nền xám siêu nhẹ + bóng đổ để
          tách phân khu thương mại khỏi các form cấu hình trắng phía trên. */}
      <Card
        id={INVOICE_PLAN_SECTION_ID}
        className="max-w-2xl scroll-mt-20 bg-slate-50/60 shadow-md"
      >
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Banknote className="size-5 text-slate-500" />
            Mua gói phôi hóa đơn điện tử
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              Ưu đãi đối tác Hubsell
            </span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 pt-5">
          {/* Banner ưu đãi — nhuộm theo màu thương hiệu NCC đang chọn. */}
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium",
              brand.softBox,
              brand.text,
            )}
          >
            🔥 Ưu đãi độc quyền cho thành viên Hubsell — Tiết kiệm đến 30% chi
            phí phôi
          </div>

          <p className={TEXT_SUB}>
            Mua phôi hóa đơn trực tiếp qua Hubsell với giá đối tác — thanh toán
            xong hệ thống tự kích hoạt gói và cấu hình API Key cho shop.
          </p>

          <VendorTabs value={selectedVendor} onChange={setSelectedVendor} />

          <div className="grid gap-4 pt-2 sm:grid-cols-3">
            {INVOICE_PLANS.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                brand={brand}
                purchasable={purchasable}
                onBuy={handleBuy}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ===== MODAL THANH TOÁN (mockup Sepay) ===== */}
      <Dialog
        open={payingPlan !== null}
        onOpenChange={(open) => {
          if (!open) setPayingPlan(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          {payingPlan && (
            <>
              {/* Logo NCC đặt trang trọng cạnh tiêu đề để tăng độ tin cậy. */}
              <div className="flex items-start gap-3">
                <VendorLogo brand={brand} />
                <DialogHeader>
                  <DialogTitle>
                    Thanh toán đơn hàng: {payingPlan.name} - {vendorLabel}
                  </DialogTitle>
                  <DialogDescription>
                    Quét mã QR hoặc chuyển khoản đúng số tiền và nội dung bên
                    dưới — hệ thống đối soát tự động qua Sepay.
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* --- Cột trái: QR + thông tin chuyển khoản --- */}
                <div className="space-y-3">
                  <div className="flex items-center justify-center rounded-lg border bg-white p-3">
                    {/* TODO(API): thay bằng QR động do Sepay sinh theo đơn hàng. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={QR_MOCKUP_URL}
                      alt={`Mã QR thanh toán ${payingPlan.name}`}
                      width={250}
                      height={250}
                      className="size-full max-w-60 rounded"
                    />
                  </div>
                  <div className="space-y-1.5 rounded-lg border p-3">
                    <TransferRow
                      label="Ngân hàng"
                      value={SEPAY_MOCK_ACCOUNT.bank}
                    />
                    <TransferRow
                      label="Số tài khoản"
                      value={SEPAY_MOCK_ACCOUNT.accountNumber}
                    />
                    <TransferRow
                      label="Chủ tài khoản"
                      value={SEPAY_MOCK_ACCOUNT.accountHolder}
                    />
                    <TransferRow
                      label="Số tiền"
                      value={formatVND(payingPlan.price)}
                      copyValue={String(payingPlan.price)}
                    />
                    <TransferRow
                      label="Nội dung CK"
                      value={orderCode}
                      copyValue={orderCode}
                    />
                  </div>
                </div>

                {/* --- Cột phải: trạng thái quét giao dịch (giả lập real-time),
                    nhuộm màu thương hiệu NCC --- */}
                <div className="flex flex-col gap-3">
                  <div
                    className={cn(
                      "flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border p-4 text-center",
                      brand.softBox,
                    )}
                  >
                    <Loader2
                      className={cn("size-8 animate-spin", brand.spinner)}
                    />
                    <p className={cn("text-sm font-medium", brand.text)}>
                      Hệ thống đang kiểm tra giao dịch tự động từ ngân hàng của
                      bạn...
                    </p>
                    <p className={TEXT_SUB}>
                      Gói phôi sẽ tự kích hoạt ngay khi nhận được tiền — bạn
                      không cần thao tác gì thêm.
                    </p>
                  </div>
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <QrCode className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Vui lòng giữ nguyên nội dung chuyển khoản{" "}
                      <b className="font-mono">{orderCode}</b> để hệ thống đối
                      soát chính xác.
                    </span>
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPayingPlan(null)}
                >
                  Hủy bỏ
                </Button>
                <Button
                  type="button"
                  className={brand.buttonSolid}
                  onClick={handleConfirmTransferred}
                >
                  <Check className="size-4" />
                  Xác nhận đã chuyển khoản
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== DIALOG FALLBACK: chưa nối API Đại lý & Webhook Sepay ===== */}
      <Dialog open={noticeOpen} onOpenChange={setNoticeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Headset className="size-5 text-slate-500" />
              Đã ghi nhận yêu cầu của bạn
            </DialogTitle>
            <DialogDescription>
              Cảm ơn bạn! Hệ thống thanh toán và kích hoạt tự động qua API Đại
              lý đang được bảo trì nâng cấp. Đội ngũ CSKH Hubsell đã ghi nhận
              yêu cầu của bạn. Vui lòng liên hệ Hotline/Zalo:{" "}
              <b>09x.xxx.xxxx</b> để được xác nhận giao dịch, kích hoạt gói phôi
              và tự động cấu hình API Key trong vòng 2 phút!
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => setNoticeOpen(false)}>
              Đã hiểu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
