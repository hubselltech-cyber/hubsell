"use client";

import { useMemo, useState } from "react";
import {
  HandCoins,
  OctagonPause,
  PackagePlus,
  RotateCcw,
  ShieldX,
  Siren,
  Sparkle,
  TriangleAlert,
  UserRoundPlus,
} from "lucide-react";
import { toast } from "sonner";

import { BookingExpenseModal } from "@/components/koc/booking-expense-modal";
import { ImportAmsDialog } from "@/components/koc/import-ams-dialog";
import { SampleExportModal } from "@/components/koc/sample-export-modal";
import {
  KOC_PARTNER_STATUS_META,
  kocPlatformMeta,
} from "@/components/koc/koc-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
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
  createKocPartner,
  fetchKocPartners,
  updateKocPartner,
  type ChannelName,
  type KocPartnerRow,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { formatNumber } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_NUMBER_STRONG,
  TEXT_SUB,
  moneyTone,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * BẢNG HIỆU QUẢ TỪNG KOC (SỐ THẬT — nhịp 1 Sổ KOC, 30/08).
 *
 * Nguồn số: GET /api/koc/partners — backend là SSOT của mọi chỉ số dẫn xuất
 * (Net-ROI, lãi ròng thật từ computePnlRow, badge); bảng này CHỈ render.
 * Danh tính KOC theo đơn đến từ import file Báo cáo chuyển đổi TTLK (nút
 * Import) — đơn affiliate chưa gán KOC được nhắc ngay trên đầu bảng.
 */

type RatingFilter = "ALL" | "STAR" | "LOSS" | "HIGH_REFUND";

const RATING_META: Record<
  "STAR" | "LOSS" | "HIGH_REFUND",
  { label: string; badgeClass: string; icon: typeof Sparkle }
> = {
  STAR: {
    label: "KOC Hiệu quả",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: Sparkle,
  },
  LOSS: {
    label: "KOC Bán Lỗ",
    badgeClass: "border-rose-200 bg-rose-50 text-red-500",
    icon: Siren,
  },
  HIGH_REFUND: {
    label: "Tỷ lệ hoàn cao",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
    icon: TriangleAlert,
  },
};

/** Kỳ mặc định của bảng — khớp tham số backend (90 ngày). */
const PARTNER_DAYS = 90;

function AddKocDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<ChannelName>("SHOPEE");
  const [followersRaw, setFollowersRaw] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSave() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createKocPartner({
        name: name.trim(),
        handle: handle.trim(),
        platform,
        followers: Number(followersRaw.replace(/\D/g, "")) || 0,
        contact: contact.trim(),
      });
      toast.success(`Đã thêm "${name.trim()}" vào mạng lưới KOC`);
      onOpenChange(false);
      setName("");
      setHandle("");
      setFollowersRaw("");
      setContact("");
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không thêm được KOC");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRoundPlus className="size-5 text-violet-600" />
            Thêm KOC vào mạng lưới
          </DialogTitle>
          <DialogDescription>
            Tên phải KHỚP “Tên đăng nhập đối tác” trong file báo cáo TTLK để số
            liệu tự chảy về đúng hồ sơ (import file cũng tự tạo hồ sơ mới).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="koc-name">Tên KOC *</Label>
            <Input
              id="koc-name"
              placeholder="VD: linhchi.daily"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="koc-handle">Handle kênh</Label>
              <Input
                id="koc-handle"
                placeholder="@linhchi.daily"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="koc-platform">Sàn chủ lực</Label>
              <NativeSelect
                id="koc-platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as ChannelName)}
              >
                <option value="SHOPEE">Shopee</option>
                <option value="LAZADA">Lazada</option>
                <option value="TIKTOK">TikTok Shop</option>
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="koc-followers">Followers</Label>
              <Input
                id="koc-followers"
                inputMode="numeric"
                placeholder="VD: 48.000"
                value={followersRaw ? formatNumber(Number(followersRaw.replace(/\D/g, ""))) : ""}
                onChange={(e) => setFollowersRaw(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="koc-contact">Liên hệ (Zalo/SĐT)</Label>
              <Input
                id="koc-contact"
                placeholder="09xx…"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || submitting}>
            {submitting ? "Đang lưu…" : "Thêm KOC"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KocPerformanceTable() {
  const [platform, setPlatform] = useState<string>("ALL");
  const [rating, setRating] = useState<RatingFilter>("ALL");
  const [sampleFor, setSampleFor] = useState<string | null>(null);
  const [bookingFor, setBookingFor] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useApiQuery({
    queryKey: qk.kocPartners(PARTNER_DAYS),
    queryFn: () => fetchKocPartners(PARTNER_DAYS),
  });
  const invalidate = useInvalidate();
  const reload = () => invalidate(["koc-partners"], ["koc-samples"], ["koc-expenses"]);

  const partners = useMemo(() => q.data?.partners ?? [], [q.data]);
  const rows = useMemo(
    () =>
      partners
        .filter((k) => {
          if (platform !== "ALL" && k.platform !== platform) return false;
          if (rating !== "ALL" && !k.stats.ratings.includes(rating)) return false;
          return true;
        })
        .sort((a, b) => b.stats.netProfit - a.stats.netProfit),
    [partners, platform, rating]
  );
  const unattributed = q.data?.unattributedOrders ?? 0;

  async function changeStatus(k: KocPartnerRow, status: KocPartnerRow["status"]) {
    setBusyId(k.id);
    try {
      await updateKocPartner(k.id, { status });
      toast.success(
        status === "ACTIVE"
          ? `Đã nối lại hợp tác với ${k.name}`
          : status === "PAUSED"
            ? `Đã tạm dừng hợp tác với ${k.name}`
            : `Đã đưa ${k.name} khỏi danh sách đen`
      );
      await reload();
    } catch {
      toast.error("Không đổi được trạng thái KOC");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Hiệu quả từng KOC</CardTitle>
            <CardDescription>
              Lãi ròng THẬT sau mọi phí sàn + tiền mẫu + booking của từng KOC —
              số hoa hồng lấy từ đối soát, danh tính theo đơn lấy từ file Báo
              cáo chuyển đổi TTLK (kỳ {PARTNER_DAYS} ngày gần nhất).
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              className="w-40"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              aria-label="Lọc theo sàn"
            >
              <option value="ALL">Tất cả sàn</option>
              <option value="TIKTOK">TikTok Shop</option>
              <option value="SHOPEE">Shopee</option>
              <option value="LAZADA">Lazada</option>
            </NativeSelect>
            <NativeSelect
              className="w-44"
              value={rating}
              onChange={(e) => setRating(e.target.value as RatingFilter)}
              aria-label="Lọc theo trạng thái đánh giá"
            >
              <option value="ALL">Mọi trạng thái</option>
              <option value="STAR">✨ KOC Hiệu quả</option>
              <option value="LOSS">🚨 KOC Bán lỗ</option>
              <option value="HIGH_REFUND">⚠️ Tỷ lệ hoàn cao</option>
            </NativeSelect>
            <ImportAmsDialog onDone={() => void reload()} />
            <Button onClick={() => setAddOpen(true)}>
              <UserRoundPlus className="size-4" />
              Thêm KOC
            </Button>
          </div>
        </div>
        {unattributed > 0 && (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Có <b>{formatNumber(unattributed)}</b> đơn affiliate sàn đã trừ hoa
            hồng nhưng CHƯA biết của KOC nào — import file Báo cáo chuyển đổi
            TTLK để gán về đúng người.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader className={TABLE_HEAD_EMPHASIS}>
            <TableRow>
              <TableHead>KOC / Kênh</TableHead>
              <TableHead className="w-28">Sàn</TableHead>
              <TableHead className="text-right">Doanh số (GMV)</TableHead>
              <TableHead className="w-24 text-right">Tỷ lệ hoàn</TableHead>
              <TableHead className="text-right">Chi phí Booking + Mẫu</TableHead>
              <TableHead className="text-right">Lợi nhuận ròng</TableHead>
              <TableHead className="w-24 text-right">Net ROI</TableHead>
              <TableHead className="w-44">Đánh giá</TableHead>
              <TableHead className="w-32 text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((k) => {
              const s = k.stats;
              const meta = kocPlatformMeta(k.platform);
              const statusMeta = KOC_PARTNER_STATUS_META[k.status];
              const inactive = k.status !== "ACTIVE";
              const busy = busyId === k.id;
              return (
                <TableRow key={k.id} className={cn(k.status === "PAUSED" && "opacity-55")}>
                  <TableCell>
                    <p className="font-medium text-slate-900">{k.name}</p>
                    <p className={TEXT_SUB}>
                      {k.handle || "—"}
                      {k.followers > 0 && <> · {formatNumber(k.followers)} followers</>}
                      {s.samplesOverdue > 0 && (
                        <>
                          {" · "}
                          <span className="font-semibold text-red-500">
                            {s.samplesOverdue} mẫu quá hạn
                          </span>
                        </>
                      )}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={meta.badgeClass}>
                      {meta.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={s.gmv} className="text-slate-900" />
                    <p className={TEXT_SUB}>{formatNumber(s.orders)} đơn</p>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      s.refundRate > 15
                        ? cn(TEXT_NUMBER_STRONG, "text-red-500")
                        : TEXT_NUMBER_MUTED
                    )}
                  >
                    {s.refundRate.toLocaleString("vi-VN")}%
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={s.totalCost} className={TEXT_NUMBER_MUTED} />
                    <p className={TEXT_SUB}>
                      Hoa hồng <Money value={s.commission} className="text-slate-500" />
                    </p>
                  </TableCell>
                  <TableCell
                    className={cn("text-right", TEXT_NUMBER_STRONG, moneyTone(s.netProfit))}
                  >
                    <Money value={Math.abs(s.netProfit)} negative={s.netProfit < 0} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      TEXT_NUMBER_STRONG,
                      moneyTone(s.netProfit)
                    )}
                  >
                    {s.roi.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}x
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {inactive && statusMeta && (
                        <Badge variant="outline" className={statusMeta.badgeClass}>
                          {statusMeta.label}
                        </Badge>
                      )}
                      {s.ratings.map((r) => {
                        const rm = RATING_META[r];
                        const Icon = rm.icon;
                        return (
                          <Badge key={r} variant="outline" className={rm.badgeClass}>
                            <Icon className="size-3" /> {rm.label}
                          </Badge>
                        );
                      })}
                      {!inactive && s.ratings.length === 0 && (
                        <span className={TEXT_SUB}>—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Gửi hàng mẫu cho ${k.name}`}
                        title="Gửi mẫu — tạo phiếu hàng mẫu có hạn lên bài"
                        disabled={inactive || busy}
                        onClick={() => setSampleFor(k.id)}
                      >
                        <PackagePlus className="size-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Nhập chi phí booking cho ${k.name}`}
                        title="Booking — ghi nhận chi phí ngoài sàn"
                        disabled={busy}
                        onClick={() => setBookingFor(k.id)}
                      >
                        <HandCoins className="size-4" />
                      </Button>
                      {k.status === "BLACKLISTED" ? (
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label={`Bỏ ${k.name} khỏi danh sách đen`}
                          title="Bỏ chặn — cho phép gửi mẫu trở lại"
                          disabled={busy}
                          onClick={() => void changeStatus(k, "ACTIVE")}
                        >
                          <ShieldX className="size-4 text-red-500" />
                        </Button>
                      ) : (
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label={
                            k.status === "PAUSED"
                              ? `Nối lại hợp tác với ${k.name}`
                              : `Tạm dừng hợp tác với ${k.name}`
                          }
                          title={
                            k.status === "PAUSED"
                              ? "Nối lại hợp tác"
                              : "Dừng — tạm ngừng hợp tác"
                          }
                          className={cn(
                            k.status === "ACTIVE" &&
                              "text-red-500 hover:bg-rose-50 hover:text-red-600"
                          )}
                          disabled={busy}
                          onClick={() =>
                            void changeStatus(k, k.status === "PAUSED" ? "ACTIVE" : "PAUSED")
                          }
                        >
                          {k.status === "PAUSED" ? (
                            <RotateCcw className="size-4" />
                          ) : (
                            <OctagonPause className="size-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {q.loading
                    ? "Đang tải dữ liệu…"
                    : partners.length === 0
                      ? "Chưa có KOC nào trong mạng lưới — bấm Thêm KOC, hoặc Import báo cáo TTLK để hệ thống tự tạo hồ sơ từ file."
                      : "Không có KOC nào khớp bộ lọc hiện tại."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* ===== MODAL THAO TÁC NHANH ===== */}
      <SampleExportModal
        open={sampleFor !== null}
        onOpenChange={(o) => !o && setSampleFor(null)}
        partners={partners}
        initialKocId={sampleFor ?? undefined}
        onDone={() => void reload()}
      />
      <BookingExpenseModal
        open={bookingFor !== null}
        onOpenChange={(o) => !o && setBookingFor(null)}
        partners={partners}
        initialKocId={bookingFor ?? undefined}
        onDone={() => void reload()}
      />
      <AddKocDialog open={addOpen} onOpenChange={setAddOpen} onDone={() => void reload()} />
    </Card>
  );
}
