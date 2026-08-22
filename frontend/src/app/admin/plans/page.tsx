"use client";

// ============================================================
// GÓI DỊCH VỤ & THUÊ BAO (/admin/plans — lá hq.finance) — GĐ1 thương mại hóa:
//  1. BẢNG GIÁ GÓI    — giá/giới hạn là DỮ LIỆU, admin nghịch thử phương án gói
//     ngay tại đây (chỉ CHỦ NỀN TẢNG sửa được — backend gác).
//  2. THUÊ BAO        — khách nào gói nào, hết hạn ngày nào; sắp hết hạn nổi lên đầu.
//  3. GHI NHẬN THANH TOÁN — MỘT xác nhận tự sinh: gia hạn thuê bao + bút toán
//     THU sổ quỹ (chờ hóa đơn) + hoa hồng giới thiệu 10%. Kế toán không nhập tay lại.
// ============================================================

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  CircleDollarSign,
  Loader2,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AccessDenied } from "@/components/access-denied";
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
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
  createPlatformPlan,
  deletePlatformPlan,
  fetchPlatformPlans,
  fetchPlatformSubscriptions,
  recordSubscriptionPayment,
  updatePlatformPlan,
  type BillingCycle,
  type PlatformSubscription,
  type PlatformSubscriptionsResponse,
  type ServicePlan,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdminError, AdminPageHeader, StatCard, formatCount, formatMoney, useAdminPage } from "../shared";

type SubFilter = "all" | "expiring" | "expired";

const METHOD_LABEL: Record<string, string> = {
  BANK_TRANSFER: "Chuyển khoản",
  WALLET: "Ví Hubsell",
  GATEWAY: "Cổng thanh toán",
};

const CYCLES: { value: BillingCycle; label: string; months: number }[] = [
  { value: "MONTHLY", label: "1 tháng", months: 1 },
  { value: "QUARTERLY", label: "3 tháng", months: 3 },
  { value: "SEMIANNUAL", label: "6 tháng", months: 6 },
  { value: "YEARLY", label: "12 tháng", months: 12 },
];

const CYCLE_LABEL: Record<BillingCycle, string> = Object.fromEntries(
  CYCLES.map((c) => [c.value, c.label])
) as Record<BillingCycle, string>;

/** Nhãn tiếng Việt của các key module trong features.modules. */
const MODULE_LABEL: Record<string, string> = {
  dashboard: "Tổng quan",
  orders: "Đơn hàng",
  products: "Hàng hóa",
  warehouse: "Kho",
  finance: "Tài chính",
  channels: "Kênh bán",
  ads: "Trợ lý quảng cáo",
  operations: "Trợ lý vận hành",
  koc: "KOC & Affiliate",
  invoicing: "Hóa đơn & Thuế",
};

/** Dòng mô tả tính năng của gói từ features.modules. */
function featuresLabel(plan: ServicePlan): string | null {
  const modules = plan.features?.modules;
  if (modules === "all") return "Full tính năng";
  if (Array.isArray(modules) && modules.length > 0) {
    return `Chỉ gồm: ${modules.map((m) => MODULE_LABEL[m] ?? m).join(", ")}`;
  }
  return null;
}

/** Giá niêm yết của gói theo chu kỳ (0 = không bán kỳ đó). */
function planPriceFor(plan: ServicePlan, cycle: BillingCycle): number {
  switch (cycle) {
    case "QUARTERLY":
      return plan.priceQuarterly;
    case "SEMIANNUAL":
      return plan.priceSemiannual;
    case "YEARLY":
      return plan.priceYearly;
    default:
      return plan.priceMonthly;
  }
}

/** "22/08/2026" — kỳ hạn chỉ cần ngày, không cần giờ. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN");
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- Dialog tạo/sửa GÓI (backend chỉ cho chủ nền tảng) ----------

function PlanDialog({
  plan,
  onClose,
  onSaved,
}: {
  /** Có plan = SỬA; không có = TẠO MỚI. */
  plan: ServicePlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = plan !== null;
  const [code, setCode] = useState(plan?.code ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [tier, setTier] = useState(String(plan?.tier ?? 0));
  const [priceMonthly, setPriceMonthly] = useState(String(plan?.priceMonthly ?? 0));
  const [priceQuarterly, setPriceQuarterly] = useState(String(plan?.priceQuarterly ?? 0));
  const [priceSemiannual, setPriceSemiannual] = useState(String(plan?.priceSemiannual ?? 0));
  const [priceYearly, setPriceYearly] = useState(String(plan?.priceYearly ?? 0));
  const [maxChannels, setMaxChannels] = useState(plan?.maxChannels?.toString() ?? "");
  const [maxOrdersPerMonth, setMaxOrdersPerMonth] = useState(
    plan?.maxOrdersPerMonth?.toString() ?? ""
  );
  const [maxStaff, setMaxStaff] = useState(plan?.maxStaff?.toString() ?? "");
  const [isActive, setIsActive] = useState(plan?.isActive ?? false);
  const [isDefault, setIsDefault] = useState(plan?.isDefault ?? false);
  const [trialDays, setTrialDays] = useState(String(plan?.trialDays ?? 0));
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Vui lòng nhập tên gói");
      return;
    }
    const limit = (raw: string) => (raw.trim() === "" ? null : Math.floor(Number(raw)));
    setSubmitting(true);
    try {
      const data = {
        name: name.trim(),
        description: description.trim() || null,
        tier: Math.floor(Number(tier)) || 0,
        priceMonthly: Math.floor(Number(priceMonthly)) || 0,
        priceQuarterly: Math.floor(Number(priceQuarterly)) || 0,
        priceSemiannual: Math.floor(Number(priceSemiannual)) || 0,
        priceYearly: Math.floor(Number(priceYearly)) || 0,
        maxChannels: limit(maxChannels),
        maxOrdersPerMonth: limit(maxOrdersPerMonth),
        maxStaff: limit(maxStaff),
        isActive,
        isDefault,
        trialDays: Math.floor(Number(trialDays)) || 0,
      };
      if (isEdit) {
        await updatePlatformPlan(plan.id, data);
        toast.success(`Đã cập nhật gói ${data.name}`);
      } else {
        await createPlatformPlan({ ...data, code: code.trim().toUpperCase() });
        toast.success(`Đã tạo gói ${data.name}`);
      }
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được gói");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="size-5" />
            {isEdit ? `Sửa gói ${plan.name}` : "Tạo gói mới"}
          </DialogTitle>
          <DialogDescription>
            Giá và giới hạn là dữ liệu — đổi thoải mái, lịch sử thanh toán đã chốt
            không bị ảnh hưởng (mỗi chứng từ giữ snapshot giá lúc thu).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Mã gói {isEdit && <span className="font-normal text-muted-foreground">(bất biến)</span>}</Label>
            <Input
              placeholder="vd: STARTER"
              value={code}
              disabled={isEdit}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid gap-2">
            <Label>Tên gói</Label>
            <Input placeholder="vd: Starter" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Mô tả ngắn</Label>
          <Input
            placeholder="Hiện cho khách khi chọn gói"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label>Bậc gói</Label>
          <Input
            type="number"
            min={0}
            className="w-24"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label>Giá theo kỳ mua (₫) — để 0 là không bán kỳ đó</Label>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["1 tháng", priceMonthly, setPriceMonthly],
                ["3 tháng", priceQuarterly, setPriceQuarterly],
                ["6 tháng", priceSemiannual, setPriceSemiannual],
                ["12 tháng", priceYearly, setPriceYearly],
              ] as [string, string, (v: string) => void][]
            ).map(([label, value, setter]) => (
              <div key={label} className="grid gap-1">
                <p className="text-xs text-muted-foreground">{label}</p>
                <Input type="number" min={0} value={value} onChange={(e) => setter(e.target.value)} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-2">
            <Label>Trần gian hàng</Label>
            <Input
              type="number"
              min={1}
              placeholder="Trống = ∞"
              value={maxChannels}
              onChange={(e) => setMaxChannels(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Trần đơn/tháng</Label>
            <Input
              type="number"
              min={1}
              placeholder="Trống = ∞"
              value={maxOrdersPerMonth}
              onChange={(e) => setMaxOrdersPerMonth(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Trần nhân viên</Label>
            <Input
              type="number"
              min={1}
              placeholder="Trống = ∞"
              value={maxStaff}
              onChange={(e) => setMaxStaff(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Số ngày dùng thử cho tài khoản mới</Label>
          <Input
            type="number"
            min={0}
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Chỉ có tác dụng với gói mặc định — khách mới được dùng thử ngần này
            ngày rồi mới phải trả tiền. 0 = không dùng thử.
          </p>
        </div>

        <div className="grid gap-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Đang bán</p>
              <p className="text-xs text-muted-foreground">
                Tắt = gói nháp/ngừng bán — thuê bao cũ vẫn chạy bình thường.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Gói mặc định cho tài khoản mới</p>
              <p className="text-xs text-muted-foreground">
                Chủ shop mới đăng ký tự vào gói này kèm kỳ dùng thử. Chỉ một gói giữ cờ.
              </p>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? "Lưu gói" : "Tạo gói"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Dialog GHI NHẬN THANH TOÁN ----------

function PaymentDialog({
  sub,
  plans,
  onClose,
  onSaved,
}: {
  sub: PlatformSubscription;
  plans: ServicePlan[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Gói chọn được: gói đang bán, HOẶC chính gói hiện tại của khách (gia hạn
  // tiếp gói đã ngừng bán — grandfathering).
  const selectable = useMemo(
    () => plans.filter((p) => p.isActive || p.id === sub.plan.id),
    [plans, sub.plan.id]
  );
  const [planId, setPlanId] = useState(
    selectable.some((p) => p.id === sub.plan.id) ? sub.plan.id : selectable[0]?.id ?? ""
  );
  const [cycle, setCycle] = useState<BillingCycle>("MONTHLY");
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [occurredAt, setOccurredAt] = useState(toDateInput(new Date()));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedPlan = selectable.find((p) => p.id === planId) ?? null;
  const listPrice = selectedPlan ? planPriceFor(selectedPlan, cycle) : 0;
  // Số tiền tự điền theo giá niêm yết — kế toán sửa tay khi thu lệch (khuyến mãi).
  const effectiveAmount = amountTouched ? amount : String(listPrice);

  async function handleSave() {
    if (!selectedPlan) {
      toast.error("Vui lòng chọn gói");
      return;
    }
    const value = Math.floor(Number(effectiveAmount));
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Số tiền không hợp lệ");
      return;
    }
    setSubmitting(true);
    try {
      const result = await recordSubscriptionPayment(sub.user.id, {
        planId: selectedPlan.id,
        cycle,
        amount: value,
        occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
        note: note.trim() || undefined,
      });
      const end = result.subscription.currentPeriodEnd;
      toast.success(
        `Đã ghi nhận ${formatMoney(value)} — hạn mới: ${end ? formatDate(end) : "vô thời hạn"}`
      );
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không ghi nhận được thanh toán");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDollarSign className="size-5" />
            Ghi nhận thanh toán
          </DialogTitle>
          <DialogDescription>
            {sub.user.fullName} ({sub.user.email ?? "—"}) — một xác nhận tự sinh đủ:
            gia hạn thuê bao, bút toán THU chờ hóa đơn trong sổ quỹ, và hoa hồng
            giới thiệu 10% (nếu khách được ai giới thiệu).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label>Gói</Label>
          <NativeSelect value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {selectable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? "" : " (ngừng bán — gia hạn riêng khách cũ)"}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="grid gap-2">
          <Label>Chu kỳ</Label>
          <div className="flex flex-wrap gap-1.5">
            {CYCLES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCycle(c.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  cycle === c.value
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label>Số tiền thực thu (₫)</Label>
            <Input
              type="number"
              min={0}
              value={effectiveAmount}
              onChange={(e) => {
                setAmountTouched(true);
                setAmount(e.target.value);
              }}
            />
            {selectedPlan && Number(effectiveAmount) !== listPrice && (
              <p className="text-xs text-amber-600">
                Lệch giá niêm yết {formatMoney(listPrice)} — chỉ thu lệch khi có
                khuyến mãi/thỏa thuận.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label>Ngày thực nhận tiền</Label>
            <Input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Ghi chú</Label>
          <Input
            placeholder="vd: CK Vietcombank, mã GD 12345"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Quy tắc kỳ hạn: cùng gói còn hạn → cộng NỐI TIẾP từ cuối kỳ (gia hạn sớm
          không mất ngày); đổi gói hoặc đã quá hạn → kỳ mới tính từ ngày thu tiền.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={submitting || !selectedPlan}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Xác nhận đã nhận tiền
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Trang chính ----------

interface PageData {
  plans: ServicePlan[];
  subs: PlatformSubscriptionsResponse;
}

export default function PlatformPlansPage() {
  const [filter, setFilter] = useState<SubFilter>("all");
  const [q, setQ] = useState("");
  // Chỉ nạp lại khi bấm tìm/đổi lọc — gõ chữ không dội API.
  const [committedQ, setCommittedQ] = useState("");

  const fetcher = useCallback(async (): Promise<PageData> => {
    const [plansRes, subs] = await Promise.all([
      fetchPlatformPlans(),
      fetchPlatformSubscriptions({ filter, q: committedQ || undefined }),
    ]);
    return { plans: plansRes.plans, subs };
  }, [filter, committedQ]);
  const { data, loading, denied, error, reload } = useAdminPage(fetcher);

  const [planDialog, setPlanDialog] = useState<
    { mode: "create" } | { mode: "edit"; plan: ServicePlan } | null
  >(null);
  const [paymentFor, setPaymentFor] = useState<PlatformSubscription | null>(null);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  async function handleDeletePlan(plan: ServicePlan) {
    setDeletingPlanId(plan.id);
    try {
      await deletePlatformPlan(plan.id);
      toast.success(`Đã xoá gói ${plan.name}`);
      reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xoá được gói");
    } finally {
      setDeletingPlanId(null);
    }
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const summary = data?.subs.summary;

  return (
    <AppShell>
      <div className="space-y-6">
        <AdminPageHeader
          description="Bảng giá gói Hubsell + thuê bao của từng khách. Xác nhận thanh toán tại đây — sổ quỹ, hóa đơn, hoa hồng tự chảy theo."
          loading={loading}
          onReload={reload}
        />

        {error && <AdminError message={error} />}

        {/* ===== Khối 1: Bảng giá gói ===== */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Bảng giá gói</p>
              <p className="text-xs text-muted-foreground">
                Giá/giới hạn là dữ liệu — nghịch thử phương án gói thoải mái, chỉ
                gói bật &ldquo;Đang bán&rdquo; mới hiện cho khách. Sửa bảng giá:
                chỉ chủ nền tảng.
              </p>
            </div>
            <Button onClick={() => setPlanDialog({ mode: "create" })}>
              <Plus className="size-4" />
              Thêm gói
            </Button>
          </div>

          {data && data.plans.length === 0 ? (
            <Card>
              <CardContent>
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Chưa có gói nào — chạy script backfill-starter-subscriptions để
                  tạo gói Starter 99k (dùng thử 14 ngày), hoặc bấm &ldquo;Thêm gói&rdquo;.
                </p>
              </CardContent>
            </Card>
          ) : data ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.plans.map((p) => (
                <Card key={p.id} className={cn(!p.isActive && "opacity-70")}>
                  <CardContent className="space-y-3 py-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="flex items-center gap-2 font-semibold">
                          {p.name}
                          {p.isDefault && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700"
                              title="Tài khoản mới đăng ký tự vào gói này"
                            >
                              <BadgeCheck className="size-3" />
                              Mặc định
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.code}
                          {" · "}
                          {p.isActive ? (
                            <span className="font-medium text-emerald-600">Đang bán</span>
                          ) : (
                            "Nháp / ngừng bán"
                          )}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          title="Sửa gói (chỉ chủ nền tảng)"
                          onClick={() => setPlanDialog({ mode: "edit", plan: p })}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {p.subscriberCount === 0 && (
                          <Button
                            variant="outline"
                            size="icon-sm"
                            title="Xoá gói (chỉ gói chưa có thuê bao)"
                            className="text-muted-foreground hover:text-red-500"
                            disabled={deletingPlanId === p.id}
                            onClick={() => handleDeletePlan(p)}
                          >
                            {deletingPlanId === p.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-2xl font-bold tracking-tight">
                        {p.priceMonthly > 0 ? (
                          <>
                            {formatMoney(p.priceMonthly)}
                            <span className="text-sm font-normal text-muted-foreground">/tháng</span>
                          </>
                        ) : (
                          "0₫"
                        )}
                      </p>
                      {CYCLES.some((c) => c.months > 1 && planPriceFor(p, c.value) > 0) && (
                        <p className="text-xs text-muted-foreground">
                          {CYCLES.filter((c) => c.months > 1 && planPriceFor(p, c.value) > 0)
                            .map((c) => `${c.label}: ${formatMoney(planPriceFor(p, c.value))}`)
                            .join(" · ")}
                        </p>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {[
                        p.maxChannels != null ? `${p.maxChannels} gian hàng` : "Gian hàng ∞",
                        p.maxOrdersPerMonth != null
                          ? `${formatCount(p.maxOrdersPerMonth)} đơn/tháng`
                          : "Đơn ∞",
                        p.maxStaff != null ? `${p.maxStaff} nhân viên` : "Nhân viên ∞",
                      ].join(" · ")}
                      {p.trialDays > 0 && ` · Dùng thử ${p.trialDays} ngày`}
                    </p>

                    {featuresLabel(p) && (
                      <p
                        className={cn(
                          "text-xs",
                          p.features?.modules === "all"
                            ? "font-medium text-emerald-600"
                            : "text-muted-foreground"
                        )}
                      >
                        {featuresLabel(p)}
                      </p>
                    )}

                    <p className="text-xs font-medium">
                      {formatCount(p.subscriberCount)} thuê bao
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </div>

        <Separator />

        {/* ===== Khối 2: Thuê bao ===== */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Thuê bao khách hàng</p>
              <p className="text-xs text-muted-foreground">
                Sắp hết hạn nổi lên đầu — gọi/nhắn khách gia hạn rồi bấm
                &ldquo;Ghi nhận thanh toán&rdquo; khi tiền về.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setCommittedQ(q.trim());
                }}
              >
                <Input
                  className="w-52"
                  placeholder="Tìm email / tên khách…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </form>
              <NativeSelect
                className="w-40"
                value={filter}
                onChange={(e) => setFilter(e.target.value as SubFilter)}
              >
                <option value="all">Tất cả</option>
                <option value="expiring">Sắp hết hạn (7 ngày)</option>
                <option value="expired">Đã quá hạn</option>
              </NativeSelect>
            </div>
          </div>

          {summary && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Đang hiệu lực"
                value={formatCount(summary.active)}
                hint={`Thuê bao còn hạn — ${formatCount(summary.trialing)} đang dùng thử`}
              />
              <StatCard
                label="Sắp hết hạn"
                value={formatCount(summary.expiringSoon)}
                hint="Trong 7 ngày tới — gọi khách gia hạn"
              />
              <StatCard
                label="Đã quá hạn"
                value={formatCount(summary.expired)}
                hint="Hết hạn chưa gia hạn — nguy cơ rời bỏ"
              />
              <StatCard
                label="Doanh thu gói tháng này"
                value={formatMoney(summary.revenueThisMonth)}
                hint={`${formatCount(summary.paymentsThisMonth)} lượt thanh toán`}
              />
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              {loading && !data ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Đang tải dữ liệu…</p>
              ) : data && data.subs.subscriptions.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {committedQ || filter !== "all"
                    ? "Không có thuê bao nào khớp bộ lọc."
                    : "Chưa có thuê bao nào — chạy script backfill để gán khách hiện có vào gói mặc định."}
                </p>
              ) : data ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Khách hàng</TableHead>
                      <TableHead>Gói</TableHead>
                      <TableHead>Đơn tháng này</TableHead>
                      <TableHead>Kỳ hiện tại</TableHead>
                      <TableHead>Còn lại</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.subs.subscriptions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm">
                          {s.user.fullName}
                          <p className="text-xs text-muted-foreground">{s.user.email ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{s.plan.name}</TableCell>
                        {/* %trần đơn/tháng (GĐ2): đỏ khi đã vượt, vàng từ 80% —
                            gọi khách mời nâng gói TRƯỚC khi hệ thống tự khóa. */}
                        <TableCell className="whitespace-nowrap text-sm tabular-nums">
                          {s.orderLimit != null ? (
                            <span
                              className={cn(
                                "font-medium",
                                s.ordersThisMonth >= s.orderLimit
                                  ? "text-rose-600"
                                  : s.ordersThisMonth >= s.orderLimit * 0.8
                                    ? "text-amber-600"
                                    : "text-muted-foreground"
                              )}
                            >
                              {formatCount(s.ordersThisMonth)}/{formatCount(s.orderLimit)}{" "}
                              ({Math.floor((s.ordersThisMonth / s.orderLimit) * 100)}%)
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {formatCount(s.ordersThisMonth)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {s.currentPeriodEnd
                            ? `${formatDate(s.currentPeriodStart)} → ${formatDate(s.currentPeriodEnd)}`
                            : "Vô thời hạn"}
                        </TableCell>
                        <TableCell>
                          {s.daysLeft === null ? (
                            <span className="text-sm text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                s.daysLeft < 0
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : s.daysLeft <= 7
                                    ? "border-amber-300 bg-amber-50 text-amber-700"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              )}
                            >
                              {s.daysLeft < 0 ? `Quá ${-s.daysLeft} ngày` : `${s.daysLeft} ngày`}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                              s.status === "ACTIVE"
                                ? s.isTrial
                                  ? "border-sky-200 bg-sky-50 text-sky-700"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : s.status === "EXPIRED"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600"
                            )}
                          >
                            {s.status === "ACTIVE"
                              ? s.isTrial
                                ? "Dùng thử"
                                : "Hiệu lực"
                              : s.status === "EXPIRED"
                                ? s.isTrial
                                  ? "Hết dùng thử"
                                  : "Quá hạn"
                                : "Đã hủy"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setPaymentFor(s)}>
                            <CircleDollarSign className="size-4" />
                            Ghi nhận thanh toán
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* ===== Khối 3: Thanh toán gần đây ===== */}
        {data && data.subs.recentPayments.length > 0 && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Thanh toán gần đây</p>
              <p className="text-xs text-muted-foreground">
                Chứng từ append-only — mỗi dòng đã có bút toán THU tương ứng trong
                sổ quỹ (trừ thanh toán bằng Ví Hubsell: bù trừ công nợ, không có
                tiền vào quỹ).
              </p>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ngày thu</TableHead>
                      <TableHead>Khách hàng</TableHead>
                      <TableHead>Gói</TableHead>
                      <TableHead>Hình thức</TableHead>
                      <TableHead className="text-right">Số tiền</TableHead>
                      <TableHead>Hạn mới</TableHead>
                      <TableHead>Người xác nhận</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.subs.recentPayments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDateTime(p.occurredAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.user.fullName}
                          <p className="text-xs text-muted-foreground">{p.user.email ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.planName}
                          <p className="text-xs text-muted-foreground">{CYCLE_LABEL[p.cycle]}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {METHOD_LABEL[p.method] ?? p.method}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold text-emerald-600">
                          +{formatMoney(p.amount)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(p.periodEnd)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.confirmedByName}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {planDialog && (
          <PlanDialog
            plan={planDialog.mode === "edit" ? planDialog.plan : null}
            onClose={() => setPlanDialog(null)}
            onSaved={reload}
          />
        )}
        {paymentFor && data && (
          <PaymentDialog
            sub={paymentFor}
            plans={data.plans}
            onClose={() => setPaymentFor(null)}
            onSaved={reload}
          />
        )}
      </div>
    </AppShell>
  );
}
