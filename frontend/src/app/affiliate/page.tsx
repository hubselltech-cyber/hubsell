"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  BadgePercent,
  Check,
  Copy,
  CreditCard,
  Gem,
  Landmark,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
  Wallet,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CurrencyInput, onlyDigits } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ApiError,
  createWalletWithdrawalRequest,
  fetchReferralHistory,
  fetchReferralSummary,
  getStoredUser,
  mockReferralPayment,
  renewPackageWithWallet,
  type ReferralHistory,
  type ReferralSummary,
  type WalletTxn,
  type WalletTxnType,
  type WithdrawalRequestStatus,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { canManageShop } from "@/lib/permissions";
import { TEXT_BIG_NUMBER, TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { cn } from "@/lib/utils";

// ============================================================
// AFFILIATE TIẾP THỊ & VÍ HUBSELL — trang quản lý phía Seller.
//
// Giới thiệu bạn bè dùng Hubsell, nhận 10% hoa hồng VĨNH VIỄN trên mọi lượt
// thanh toán/gia hạn của người được giới thiệu, tiền chảy vào Ví Hubsell —
// dùng gia hạn gói hoặc rút về ngân hàng (Hubsell duyệt tay 1-2 ngày).
//
// KHÁC hoàn toàn "Mạng lưới KOC & Marketing" (/koc-marketing — Net-ROI creator
// của chủ shop). Đây là chương trình growth của CHÍNH nền tảng.
// ============================================================

const TXN_META: Record<
  WalletTxnType,
  { label: string; className: string }
> = {
  COMMISSION: {
    label: "Hoa hồng 10%",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  PACKAGE_RENEWAL: {
    label: "Gia hạn gói",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  WITHDRAWAL: {
    label: "Rút tiền",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  ADJUSTMENT: {
    label: "Điều chỉnh",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

const WITHDRAWAL_STATUS_META: Record<
  WithdrawalRequestStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "Chờ duyệt",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  APPROVED: {
    label: "Đã chuyển khoản",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  REJECTED: {
    label: "Từ chối",
    className: "bg-red-50 text-red-600 border-red-200",
  },
};

/** Nút sao chép 1-click, tự đổi icon ✓ trong 1,5s cho biết đã copy. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0 gap-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(`Đã sao chép ${label}`);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Trình duyệt chặn sao chép — hãy bôi đen và copy tay");
        }
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <Copy className="size-3.5" />
      )}
      Sao chép
    </Button>
  );
}

function StatCard({
  icon: Icon,
  label,
  children,
  hint,
  chipClassName,
}: {
  icon: typeof Users;
  label: string;
  children: React.ReactNode;
  hint?: string;
  /** Màu chip icon — mỗi chỉ số một sắc riêng cho dễ quét mắt. */
  chipClassName: string;
}) {
  return (
    <Card className="shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              chipClassName
            )}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-500">
              {label}
            </p>
            <div className={cn(TEXT_BIG_NUMBER, "mt-0.5")}>{children}</div>
          </div>
        </div>
        {hint && <p className={cn(TEXT_SUB, "mt-2")}>{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function AffiliatePage() {
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [history, setHistory] = useState<ReferralHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        fetchReferralSummary(),
        fetchReferralHistory(),
      ]);
      setSummary(s);
      setHistory(h);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setDenied(true);
      else
        toast.error(
          err instanceof ApiError ? err.message : "Không kết nối được máy chủ"
        );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManageShop(getStoredUser())) {
      setDenied(true);
      setLoading(false);
      return;
    }
    void reload();
  }, [reload]);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {loading || !summary ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : (
          <>
            {/* ── HÀNG TRÊN: Grid 2 cột — Công cụ tiếp thị (trái) | Ví Hubsell (phải) ── */}
            <div className="grid items-stretch gap-6 lg:grid-cols-2">
            {/* Cột trái: banner + link & mã giới thiệu */}
            <Card className="h-full overflow-hidden border-emerald-500/20 shadow-sm">
              <div className="bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent">
                <CardHeader className="border-b border-emerald-500/10 pb-4">
                  <CardTitle className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-md">
                      <Gem className="size-5" />
                    </span>
                    <span>
                      Kiếm Tiền Cùng Hubsell — hoa hồng 10% vĩnh viễn
                      <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-emerald-700">
                        <Sparkles className="size-3.5" />
                        Giới thiệu càng nhiều, ví càng dày — không giới hạn số lần
                      </span>
                    </span>
                  </CardTitle>
                  <p className={cn(TEXT_SUB, "!text-slate-600")}>
                    Bạn bè đăng ký qua link/mã của bạn, mỗi lần họ thanh toán
                    hay gia hạn Hubsell, 10% giá trị chảy thẳng vào Ví Hubsell
                    của bạn — mãi mãi.
                  </p>
                </CardHeader>
              </div>
              <CardContent className="grid gap-4 pt-4 md:grid-cols-[1fr_auto]">
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-slate-500">
                      Link giới thiệu
                    </Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        readOnly
                        value={summary.referralLink}
                        className="font-mono text-[13px]"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <CopyButton value={summary.referralLink} label="link" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-500">
                      Mã giới thiệu
                    </Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        readOnly
                        value={summary.referralCode}
                        className="w-48 border-emerald-500/30 bg-emerald-50/50 font-mono text-base font-semibold tracking-wide text-emerald-700"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <CopyButton value={summary.referralCode} label="mã" />
                    </div>
                  </div>
                </div>

                {/* Cách hoạt động — nhấn mạnh LUẬT CHƠI: đăng ký suông chưa có
                    hoa hồng, chỉ khi bạn bè THANH TOÁN mới phát sinh 10%. */}
                <div className="col-span-full mt-1 grid gap-2 border-t border-emerald-500/10 pt-3 sm:grid-cols-3">
                  {[
                    { step: "1", text: "Chia sẻ link/mã cho bạn bè" },
                    { step: "2", text: "Bạn bè đăng ký (chưa tính hoa hồng)" },
                    {
                      step: "3",
                      text: "Bạn bè thanh toán/gia hạn → bạn nhận ngay 10%",
                      highlight: true,
                    },
                  ].map((s) => (
                    <div key={s.step} className="flex items-start gap-2">
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                          s.highlight
                            ? "bg-emerald-600 text-white"
                            : "bg-emerald-100 text-emerald-700"
                        )}
                      >
                        {s.step}
                      </span>
                      <p
                        className={cn(
                          "text-xs leading-5",
                          s.highlight
                            ? "font-semibold text-emerald-700"
                            : "text-slate-600"
                        )}
                      >
                        {s.text}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Cột phải: Ví Hubsell & hành động — nền emerald siêu nhẹ, dịu mắt */}
            <div className="flex h-full flex-col justify-between rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-5">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                    <Wallet className="size-4" />
                  </span>
                  Ví Hubsell
                </p>
                <p className={cn(TEXT_SUB, "mt-3")}>Số dư khả dụng</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-emerald-700">
                  <Money
                    value={summary.stats.balance}
                    symbolClassName="text-emerald-600/70"
                  />
                </p>
              </div>
              <div className="mt-5 space-y-3">
                {/* Nút LUÔN đậm màu, không bao giờ mờ vì disabled (anh Trung 09/08
                    chê bản nhạt): ví 0₫ vẫn bấm được — dialog tự giải thích số dư
                    không đủ, còn trực quan hơn một nút xám không nói gì. */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="gap-2 bg-emerald-700 font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-emerald-800 hover:shadow-lg"
                    onClick={() => setRenewOpen(true)}
                  >
                    <RefreshCw className="size-4" />
                    Dùng Ví gia hạn gói
                  </Button>
                  <Button
                    className="gap-2 bg-emerald-700 font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-emerald-800 hover:shadow-lg"
                    onClick={() => setWithdrawOpen(true)}
                  >
                    <Landmark className="size-4" />
                    Rút tiền về ngân hàng
                  </Button>
                </div>
                <p className="text-xs text-emerald-800/60">
                  Rút tối thiểu <Money value={summary.minWithdrawal} /> ·
                  Hubsell duyệt lệnh rút thủ công trong 1-2 ngày làm việc.
                </p>
              </div>
            </div>
            </div>

            {/* ── HÀNG GIỮA: 3 thẻ chỉ số (bỏ thẻ Số dư — Ví đã ngự cột phải) ── */}
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                icon={Users}
                label="Người đăng ký qua link"
                chipClassName="bg-emerald-50 text-emerald-600"
              >
                {summary.stats.referredCount}
              </StatCard>
              <StatCard
                icon={CreditCard}
                label="Lượt thanh toán thành công"
                chipClassName="bg-blue-50 text-blue-600"
              >
                {summary.stats.paidCount}
              </StatCard>
              <StatCard
                icon={BadgePercent}
                label="Tổng hoa hồng tích lũy (10%)"
                chipClassName="bg-amber-50 text-amber-600"
              >
                <span className="text-emerald-600">
                  <Money value={summary.stats.totalCommission} />
                </span>
              </StatCard>
            </div>

            {/* ── HÀNG CUỐI: Bạn bè đã đăng ký (trái) | Biến động số dư (phải) ── */}
            <div className="grid gap-6 lg:grid-cols-2">
              <FriendsTable history={history} />
              <TransactionsTable history={history} />
            </div>
            <WithdrawalsTable history={history} />

            {process.env.NODE_ENV === "development" && (
              <DevSimulator onDone={reload} />
            )}

            <RenewDialog
              open={renewOpen}
              onOpenChange={setRenewOpen}
              summary={summary}
              onDone={reload}
            />
            <WithdrawDialog
              open={withdrawOpen}
              onOpenChange={setWithdrawOpen}
              summary={summary}
              onDone={reload}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

// ---------- Khối 4a: bạn bè đã đăng ký ----------

function FriendsTable({ history }: { history: ReferralHistory | null }) {
  const rows = history?.referrals ?? [];
  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-slate-500" />
          Bạn bè đã đăng ký qua link ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {rows.length === 0 ? (
          <p className={cn(TEXT_SUB, "py-6 text-center")}>
            Chưa có ai đăng ký qua link của bạn — hãy chia sẻ link ngay!
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TEXT_TABLE_HEAD}>Người dùng</TableHead>
                <TableHead className={TEXT_TABLE_HEAD}>Ngày đăng ký</TableHead>
                <TableHead className={cn(TEXT_TABLE_HEAD, "text-right")}>
                  Lượt thanh toán
                </TableHead>
                <TableHead className={cn(TEXT_TABLE_HEAD, "text-right")}>
                  Hoa hồng của bạn
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <p className="font-medium text-slate-800">{r.fullName}</p>
                    <p className={TEXT_SUB}>{r.email}</p>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {formatDateTime(r.registeredAt)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {r.paidCount > 0 ? (
                      r.paidCount
                    ) : (
                      <span className="text-xs text-slate-400">
                        Chưa thanh toán
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold">
                    {r.paidCount > 0 ? (
                      <span className="text-emerald-600">
                        <Money value={r.totalCommission} />
                      </span>
                    ) : (
                      <span className="text-xs font-normal text-slate-400">
                        — chờ phát sinh
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Khối 4b: biến động số dư ----------

function TransactionsTable({ history }: { history: ReferralHistory | null }) {
  const rows = history?.transactions ?? [];
  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowDownToLine className="size-4 text-slate-500" />
          Biến động số dư Ví
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        {rows.length === 0 ? (
          <p className={cn(TEXT_SUB, "py-6 text-center")}>
            Chưa có giao dịch nào.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TEXT_TABLE_HEAD}>Loại</TableHead>
                <TableHead className={TEXT_TABLE_HEAD}>Diễn giải</TableHead>
                <TableHead className={cn(TEXT_TABLE_HEAD, "text-right")}>
                  Số tiền
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t: WalletTxn) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={TXN_META[t.type].className}
                    >
                      {TXN_META[t.type].label}
                    </Badge>
                    {t.status === "PENDING" && (
                      <p className={cn(TEXT_SUB, "mt-1")}>chờ duyệt</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="max-w-[280px] truncate text-sm text-slate-700">
                      {t.note ?? "—"}
                    </p>
                    <p className={TEXT_SUB}>{formatDateTime(t.createdAt)}</p>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-sm font-semibold",
                      t.amount >= 0 ? "text-emerald-600" : "text-red-500"
                    )}
                  >
                    {t.amount >= 0 ? "+" : "− "}
                    <Money value={Math.abs(t.amount)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Khối 4c: lệnh rút tiền ----------

function WithdrawalsTable({ history }: { history: ReferralHistory | null }) {
  const rows = history?.withdrawals ?? [];
  if (rows.length === 0) return null;
  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="size-4 text-slate-500" />
          Lịch sử rút tiền
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TEXT_TABLE_HEAD}>Ngày đặt lệnh</TableHead>
              <TableHead className={TEXT_TABLE_HEAD}>Tài khoản nhận</TableHead>
              <TableHead className={cn(TEXT_TABLE_HEAD, "text-right")}>
                Số tiền
              </TableHead>
              <TableHead className={TEXT_TABLE_HEAD}>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="text-sm text-slate-600">
                  {formatDateTime(w.createdAt)}
                </TableCell>
                <TableCell>
                  <p className="text-sm font-medium text-slate-800">
                    {w.bankName} — {w.bankAccountNumber}
                  </p>
                  <p className={TEXT_SUB}>{w.bankAccountName}</p>
                </TableCell>
                <TableCell className="text-right text-sm font-semibold">
                  <Money value={w.amount} />
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={WITHDRAWAL_STATUS_META[w.status].className}
                  >
                    {WITHDRAWAL_STATUS_META[w.status].label}
                  </Badge>
                  {w.reviewNote && (
                    <p className={cn(TEXT_SUB, "mt-1")}>{w.reviewNote}</p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------- Dialog: dùng ví gia hạn gói ----------

function RenewDialog({
  open,
  onOpenChange,
  summary,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  summary: ReferralSummary;
  onDone: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRenew() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await renewPackageWithWallet(selected);
      toast.success(res.message);
      onOpenChange(false);
      setSelected(null);
      await onDone();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được máy chủ"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dùng Ví Hubsell gia hạn gói</DialogTitle>
          <DialogDescription>
            Số dư hiện tại: <Money value={summary.stats.balance} /> — chọn gói
            để trừ trực tiếp vào ví.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {summary.packages.map((p) => {
            const affordable = summary.stats.balance >= p.price;
            return (
              <button
                key={p.id}
                type="button"
                disabled={!affordable}
                onClick={() => setSelected(p.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition",
                  selected === p.id
                    ? "border-slate-800 bg-slate-50 ring-1 ring-slate-800"
                    : "border-slate-200 hover:border-slate-400",
                  !affordable && "cursor-not-allowed opacity-45"
                )}
              >
                <span className="text-sm font-medium text-slate-800">
                  {p.name}
                </span>
                <span className="text-sm font-semibold">
                  <Money value={p.price} />
                </span>
              </button>
            );
          })}
        </div>
        <p className={TEXT_SUB}>
          Bảng giá đang là KHUNG demo (chưa thương mại hóa) — gia hạn tại đây
          chỉ trừ số dư ví và ghi lịch sử, chưa kích hoạt gói thật.
        </p>
        <Button
          className="w-full"
          disabled={!selected || submitting}
          onClick={handleRenew}
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Xác nhận gia hạn
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Dialog: rút tiền về ngân hàng ----------

function WithdrawDialog({
  open,
  onOpenChange,
  summary,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  summary: ReferralSummary;
  onDone: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const value = Number(onlyDigits(amount) || "0");

  async function handleWithdraw() {
    if (value < summary.minWithdrawal) {
      toast.error(
        `Số tiền rút tối thiểu là ${summary.minWithdrawal.toLocaleString("vi-VN")}₫`
      );
      return;
    }
    if (value > summary.stats.balance) {
      toast.error("Số tiền rút vượt quá số dư ví");
      return;
    }
    if (!bankName.trim() || !accountNumber.trim() || !accountName.trim()) {
      toast.error("Vui lòng điền đủ thông tin ngân hàng");
      return;
    }
    setSubmitting(true);
    try {
      const res = await createWalletWithdrawalRequest({
        amount: value,
        bankName: bankName.trim(),
        bankAccountNumber: accountNumber.trim(),
        bankAccountName: accountName.trim(),
      });
      toast.success(res.message);
      onOpenChange(false);
      setAmount("");
      await onDone();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được máy chủ"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rút tiền về ngân hàng</DialogTitle>
          <DialogDescription>
            Số dư khả dụng: <Money value={summary.stats.balance} /> — tiền được
            giữ lại ngay khi đặt lệnh, Hubsell duyệt trong 1-2 ngày làm việc.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="wd-amount">Số tiền muốn rút (₫)</Label>
            <CurrencyInput
              id="wd-amount"
              value={amount}
              onValueChange={setAmount}
              placeholder={summary.minWithdrawal.toLocaleString("vi-VN")}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="wd-bank">Ngân hàng</Label>
            <Input
              id="wd-bank"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Vietcombank, Techcombank..."
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="wd-number">Số tài khoản</Label>
            <Input
              id="wd-number"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="0123456789"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="wd-name">Tên chủ tài khoản</Label>
            <Input
              id="wd-name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="NGUYEN VAN A"
              className="mt-1"
            />
          </div>
        </div>
        <Button
          className="w-full"
          disabled={submitting}
          onClick={handleWithdraw}
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Đặt lệnh rút tiền
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Bảng điều khiển DEMO (chỉ hiện khi chạy dev local) ----------

function DevSimulator({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSimulate() {
    const value = Number(onlyDigits(amount) || "0");
    if (!email.trim() || value <= 0) {
      toast.error("Nhập email người được giới thiệu và số tiền thanh toán");
      return;
    }
    setSubmitting(true);
    try {
      const res = await mockReferralPayment(email.trim(), value);
      toast.success(
        `Đã mô phỏng thanh toán — người giới thiệu nhận ${res.commission.toLocaleString("vi-VN")}₫ hoa hồng`
      );
      await onDone();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không kết nối được máy chủ"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-dashed border-amber-300 bg-amber-50/40 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-amber-700">
          🧪 Mô phỏng thanh toán (chỉ hiện ở môi trường dev)
        </CardTitle>
        <p className={TEXT_SUB}>
          Giả lập một tài khoản ĐƯỢC GIỚI THIỆU thanh toán thành công để test
          luồng cộng hoa hồng 10% khi chưa có cổng thanh toán thật.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="sim-email" className="text-xs">
            Email người thanh toán
          </Label>
          <Input
            id="sim-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nguoi-duoc-gioi-thieu@email.com"
            className="mt-1 w-72"
          />
        </div>
        <div>
          <Label htmlFor="sim-amount" className="text-xs">
            Số tiền thanh toán (₫)
          </Label>
          <CurrencyInput
            id="sim-amount"
            value={amount}
            onValueChange={setAmount}
            placeholder="499.000"
            className="mt-1 w-40"
          />
        </div>
        <Button
          variant="outline"
          disabled={submitting}
          onClick={handleSimulate}
          className="gap-2"
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Mô phỏng thanh toán
        </Button>
      </CardContent>
    </Card>
  );
}
