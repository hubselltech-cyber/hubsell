"use client";

import { useMemo } from "react";
import {
  BadgePercent,
  Handshake,
  TrendingUp,
  UsersRound,
  Video,
} from "lucide-react";

import {
  KOC_PARTNERS,
  KOC_PLATFORM_META,
  campaignName,
  kocNetProfit,
  kocNetRoi,
  kocTotalCost,
  type KocPlatform,
} from "@/components/koc/koc-data";
import { KocShell } from "@/components/koc/koc-shell";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
 * TRANG KÊNH KOC THEO SÀN — TikTok Affiliate & MCN / Shopee Affiliate (SAP).
 *
 * Hai trang dùng chung component này, chỉ khác `platform` (cùng khuôn với
 * AdsAssistantPage). Phần khác biệt duy nhất là CARD ĐẶC THÙ SÀN cuối trang:
 * TikTok nói chuyện MCN + video gắn giỏ, Shopee nói chuyện gói hoa hồng SAP.
 * Lazada chưa có trang riêng — theo dõi ở Tổng quan Net-ROI.
 */

type ChannelPlatform = Extract<KocPlatform, "TIKTOK" | "SHOPEE">;

const CHANNEL_COPY: Record<
  ChannelPlatform,
  {
    displayName: string;
    specialTitle: string;
    specialDesc: string;
    specialRows: { label: string; value: string }[];
  }
> = {
  TIKTOK: {
    displayName: "TikTok Shop",
    specialTitle: "Hợp tác MCN & Open Plan",
    specialDesc:
      "Khi nối TikTok Affiliate API: đồng bộ Targeted Plan / Open Plan, tỷ lệ hoa hồng theo SP và danh sách creator thuộc MCN đang hợp tác.",
    specialRows: [
      { label: "MCN đang hợp tác", value: "VieNetwork (5 KOC · HĐ đến 15/09)" },
      { label: "Open Plan hoa hồng chung", value: "10% toàn gian · 12% nhóm túi canvas" },
      { label: "Targeted Plan đang mở", value: "3 kèo riêng — cao nhất 15% (TC054)" },
    ],
  },
  SHOPEE: {
    displayName: "Shopee",
    specialTitle: "Gói hoa hồng SAP (Shopee Affiliate Program)",
    specialDesc:
      "Khi nối Shopee Open API: đồng bộ gói hoa hồng người bán (AMS), mã voucher độc quyền cấp cho từng KOC và đơn quy về từ link affiliate.",
    specialRows: [
      { label: "Gói AMS đang bật", value: "Hoa hồng người bán 8% · tối đa 50k/đơn" },
      { label: "Voucher độc quyền KOC", value: "2 mã đang chạy (MEBO10, HUNG15)" },
      { label: "Sản phẩm gắn hoa hồng", value: "12 SKU — trọng tâm túi & tất thể thao" },
    ],
  },
};

export function KocChannelPage({ platform }: { platform: ChannelPlatform }) {
  const copy = CHANNEL_COPY[platform];
  const partners = useMemo(
    () =>
      KOC_PARTNERS.filter((k) => k.platform === platform).sort(
        (a, b) => kocNetProfit(b) - kocNetProfit(a)
      ),
    [platform]
  );

  const totals = useMemo(() => {
    const gmv = partners.reduce((s, k) => s + k.gmv, 0);
    const commission = partners.reduce((s, k) => s + k.commission, 0);
    const cost = partners.reduce((s, k) => s + kocTotalCost(k), 0);
    return { gmv, commission, cost };
  }, [partners]);

  return (
    <KocShell>
      {/* ===== CHỈ SỐ KÊNH ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={`GMV Affiliate ${copy.displayName}`}
          value={<Money value={totals.gmv} />}
          icon={TrendingUp}
          tone="info"
          subtitle="Quy cho KOC trong kỳ"
        />
        <StatCard
          label="Hoa hồng đã trả"
          value={<Money value={totals.commission} />}
          icon={BadgePercent}
          tone="negative"
          colorValue
          subtitle="Đồng bộ từ đối soát sàn"
        />
        <StatCard
          label="KOC đang hợp tác"
          value={formatNumber(partners.length)}
          icon={UsersRound}
          tone="neutral"
          subtitle="Có phát sinh GMV trong kỳ"
        />
        <StatCard
          label="Tổng chi phí kênh"
          value={<Money value={totals.cost} />}
          icon={Handshake}
          tone="warning"
          subtitle="Hoa hồng + booking + hàng mẫu"
        />
      </div>

      {/* ===== BẢNG KOC CỦA KÊNH ===== */}
      <Card>
        <CardHeader>
          <CardTitle>KOC trên {copy.displayName}</CardTitle>
          <CardDescription>
            Xếp theo Lợi nhuận ròng. Bấm sang Tổng quan Net-ROI để so chéo với
            các sàn khác.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className={TABLE_HEAD_EMPHASIS}>
              <TableRow>
                <TableHead>KOC / Kênh</TableHead>
                <TableHead className="w-32">Chiến dịch</TableHead>
                <TableHead className="text-right">GMV</TableHead>
                <TableHead className="w-24 text-right">Đơn</TableHead>
                <TableHead className="text-right">Hoa hồng</TableHead>
                <TableHead className="text-right">Lợi nhuận ròng</TableHead>
                <TableHead className="w-24 text-right">Net ROI</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((k) => {
                const profit = kocNetProfit(k);
                return (
                  <TableRow key={k.id}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{k.name}</p>
                      <p className={TEXT_SUB}>
                        {k.handle} · {formatNumber(k.followers)} followers
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={KOC_PLATFORM_META[k.platform].badgeClass}
                      >
                        {campaignName(k.campaignId)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={k.gmv} className="text-slate-900" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-slate-700">
                      {formatNumber(k.orders)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={k.commission} className={TEXT_NUMBER_MUTED} />
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ===== CARD ĐẶC THÙ SÀN ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="size-4.5 text-violet-600" />
            {copy.specialTitle}
          </CardTitle>
          <CardDescription>{copy.specialDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {copy.specialRows.map((row) => (
              <div
                key={row.label}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="text-sm text-slate-500">{row.label}</span>
                <span className="text-sm font-medium text-slate-900">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · {copy.displayName} Affiliate (Preview)
      </p>
    </KocShell>
  );
}
