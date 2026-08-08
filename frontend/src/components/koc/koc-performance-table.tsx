"use client";

import { useMemo, useState } from "react";
import {
  HandCoins,
  OctagonPause,
  PackagePlus,
  RotateCcw,
  Siren,
  Sparkle,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { BookingExpenseModal } from "@/components/koc/booking-expense-modal";
import {
  KOC_CAMPAIGNS,
  KOC_PARTNERS,
  KOC_PLATFORM_META,
  SAMPLE_SKUS,
  campaignName,
  kocNetProfit,
  kocNetRoi,
  kocRatings,
  kocTotalCost,
  type KocPartner,
  type KocPlatform,
  type KocRating,
  type SampleShipment,
  type SampleSku,
} from "@/components/koc/koc-data";
import { SampleExportModal } from "@/components/koc/sample-export-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { formatNumber, formatVND } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_NUMBER_STRONG,
  TEXT_SUB,
  moneyTone,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * BẢNG HIỆU QUẢ TỪNG KOC (Preview) — trái tim thao tác của Tổng quan Net-ROI.
 *
 * 3 badge chuẩn hoá (xem kocRatings): ✨ Hiệu quả / 🚨 Bán Lỗ / ⚠️ Hoàn cao —
 * một KOC có thể mang 2 nhãn cảnh báo cùng lúc.
 *
 * CỘT THAO TÁC NHANH thay nhãn chữ thụ động: nhìn thấy KOC lỗ là xử lý được
 * ngay tại dòng — Gửi mẫu (mở modal xuất kho, chọn sẵn KOC), Nhập booking
 * (modal chi phí ngoài sàn), Dừng hợp tác (tạm ngừng, bấm lại để nối).
 * Hai modal cộng thẳng vào sampleCost/bookingFee trong state nên Net-ROI và
 * badge ĐỔI NGAY sau thao tác — preview nhưng phải cho thấy vòng phản hồi.
 */

type RatingFilter = "ALL" | KocRating;

const RATING_META: Record<
  KocRating,
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

export function KocPerformanceTable() {
  // Bản sao mutable của mock — hai modal cộng chi phí vào đây để bảng tự tính lại
  const [partners, setPartners] = useState<KocPartner[]>(KOC_PARTNERS);
  const [skus, setSkus] = useState<SampleSku[]>(SAMPLE_SKUS);
  // KOC đã bấm "Dừng hợp tác" trong phiên xem
  const [paused, setPaused] = useState<Set<string>>(new Set());

  const [platform, setPlatform] = useState<KocPlatform | "ALL">("ALL");
  const [campaign, setCampaign] = useState<string>("ALL");
  const [rating, setRating] = useState<RatingFilter>("ALL");

  // Modal nào đang mở + KOC đích của nút thao tác vừa bấm
  const [sampleFor, setSampleFor] = useState<string | null>(null);
  const [bookingFor, setBookingFor] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      partners
        .filter((k) => {
          if (platform !== "ALL" && k.platform !== platform) return false;
          if (campaign !== "ALL" && k.campaignId !== campaign) return false;
          if (rating !== "ALL" && !kocRatings(k).includes(rating)) return false;
          return true;
        })
        // Lợi nhuận ròng giảm dần — KOC đáng tiền nhất lên đầu, KOC lỗ chìm xuống đáy
        .sort((a, b) => kocNetProfit(b) - kocNetProfit(a)),
    [partners, platform, campaign, rating]
  );

  function handleSampleExport(shipment: SampleShipment) {
    setSkus((prev) =>
      prev.map((s) =>
        s.sku === shipment.sku ? { ...s, stock: s.stock - shipment.qty } : s
      )
    );
    // Giá trị mẫu (giá vốn) cộng vào chi phí KOC → Net-ROI dòng đó đổi ngay
    setPartners((prev) =>
      prev.map((k) =>
        k.id === shipment.kocId
          ? { ...k, sampleCost: k.sampleCost + shipment.cost }
          : k
      )
    );
    toast.success(
      `Đã xuất ${shipment.qty} × ${shipment.sku} cho ${shipment.kocName} — ghi chi phí ${formatVND(shipment.cost)}`
    );
  }

  function handleBookingSave(input: { kocId: string; amount: number }) {
    setPartners((prev) =>
      prev.map((k) =>
        k.id === input.kocId
          ? { ...k, bookingFee: k.bookingFee + input.amount }
          : k
      )
    );
    const name = partners.find((k) => k.id === input.kocId)?.name ?? "KOC";
    toast.success(`Đã ghi ${formatVND(input.amount)} chi phí booking cho ${name}`);
  }

  function togglePause(k: KocPartner) {
    setPaused((prev) => {
      const next = new Set(prev);
      if (next.has(k.id)) {
        next.delete(k.id);
        toast.success(`Đã nối lại hợp tác với ${k.name}`);
      } else {
        next.add(k.id);
        toast.warning(`Đã tạm dừng hợp tác với ${k.name}`);
      }
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Hiệu quả từng KOC (Preview)</CardTitle>
            <CardDescription>
              Bản mẫu giao diện — API seller của sàn chưa trả danh tính creator
              theo đơn nên hồ sơ từng KOC chờ TikTok Affiliate API (shop thật +
              scope Affiliate) mới có số thật.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              className="w-40"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as KocPlatform | "ALL")}
              aria-label="Lọc theo sàn"
            >
              <option value="ALL">Tất cả sàn</option>
              <option value="TIKTOK">TikTok Shop</option>
              <option value="SHOPEE">Shopee</option>
              <option value="LAZADA">Lazada</option>
            </NativeSelect>
            <NativeSelect
              className="w-52"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              aria-label="Lọc theo chiến dịch"
            >
              <option value="ALL">Tất cả chiến dịch</option>
              {KOC_CAMPAIGNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
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
          </div>
        </div>
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
              <TableHead className="w-40">Đánh giá</TableHead>
              <TableHead className="w-32 text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((k) => {
              const profit = kocNetProfit(k);
              const ratings = kocRatings(k);
              const meta = KOC_PLATFORM_META[k.platform];
              const isPaused = paused.has(k.id);
              return (
                <TableRow key={k.id} className={cn(isPaused && "opacity-55")}>
                  <TableCell>
                    <p className="font-medium text-slate-900">{k.name}</p>
                    <p className={TEXT_SUB}>
                      {k.handle} · {formatNumber(k.followers)} followers ·{" "}
                      {campaignName(k.campaignId)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={meta.badgeClass}>
                      {meta.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={k.gmv} className="text-slate-900" />
                    <p className={TEXT_SUB}>{formatNumber(k.orders)} đơn</p>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      k.refundRate > 15
                        ? cn(TEXT_NUMBER_STRONG, "text-red-500")
                        : TEXT_NUMBER_MUTED
                    )}
                  >
                    {k.refundRate.toLocaleString("vi-VN")}%
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={kocTotalCost(k)} className={TEXT_NUMBER_MUTED} />
                    <p className={TEXT_SUB}>
                      Hoa hồng{" "}
                      <Money value={k.commission} className="text-slate-500" />
                    </p>
                  </TableCell>
                  <TableCell
                    className={cn("text-right", TEXT_NUMBER_STRONG, moneyTone(profit))}
                  >
                    <Money value={Math.abs(profit)} negative={profit < 0} />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      TEXT_NUMBER_STRONG,
                      moneyTone(profit)
                    )}
                  >
                    {kocNetRoi(k).toLocaleString("vi-VN", {
                      maximumFractionDigits: 1,
                    })}
                    x
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {isPaused && (
                        <Badge
                          variant="outline"
                          className="border-slate-200 bg-slate-50 text-slate-500"
                        >
                          Tạm dừng hợp tác
                        </Badge>
                      )}
                      {ratings.map((r) => {
                        const rm = RATING_META[r];
                        const Icon = rm.icon;
                        return (
                          <Badge key={r} variant="outline" className={rm.badgeClass}>
                            <Icon className="size-3" /> {rm.label}
                          </Badge>
                        );
                      })}
                      {!isPaused && ratings.length === 0 && (
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
                        title="Gửi mẫu — mở phiếu xuất kho hàng mẫu"
                        disabled={isPaused}
                        onClick={() => setSampleFor(k.id)}
                      >
                        <PackagePlus className="size-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Nhập chi phí booking cho ${k.name}`}
                        title="Booking — ghi nhận chi phí ngoài sàn"
                        disabled={isPaused}
                        onClick={() => setBookingFor(k.id)}
                      >
                        <HandCoins className="size-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={
                          isPaused
                            ? `Nối lại hợp tác với ${k.name}`
                            : `Tạm dừng hợp tác với ${k.name}`
                        }
                        title={
                          isPaused ? "Nối lại hợp tác" : "Dừng — tạm ngừng hợp tác"
                        }
                        className={cn(
                          !isPaused &&
                            "text-red-500 hover:bg-rose-50 hover:text-red-600"
                        )}
                        onClick={() => togglePause(k)}
                      >
                        {isPaused ? (
                          <RotateCcw className="size-4" />
                        ) : (
                          <OctagonPause className="size-4" />
                        )}
                      </Button>
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
                  Không có KOC nào khớp bộ lọc hiện tại.
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
        skus={skus}
        initialKocId={sampleFor ?? undefined}
        onExport={handleSampleExport}
      />
      <BookingExpenseModal
        open={bookingFor !== null}
        onOpenChange={(o) => !o && setBookingFor(null)}
        initialKocId={bookingFor ?? undefined}
        onSave={handleBookingSave}
      />
    </Card>
  );
}
