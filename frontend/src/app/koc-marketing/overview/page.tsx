"use client";

import { useMemo, useState } from "react";
import { Sparkle, TriangleAlert } from "lucide-react";

import {
  KOC_CAMPAIGNS,
  KOC_PARTNERS,
  KOC_PLATFORM_META,
  campaignName,
  kocNetProfit,
  kocNetRoi,
  kocRating,
  kocTotalCost,
  type KocPlatform,
} from "@/components/koc/koc-data";
import { KocRealData } from "@/components/koc/koc-real-data";
import { KocShell } from "@/components/koc/koc-shell";
import { Badge } from "@/components/ui/badge";
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
 * TỔNG QUAN NET-ROI ĐA KÊNH — màn hình chính của Mạng lưới KOC.
 *
 * Trả lời một câu hỏi duy nhất: "Đổ tiền booking + hàng mẫu cho từng KOC,
 * cuối cùng LÃI hay LỖ bao nhiêu?"
 *
 * HAI TẦNG DỮ LIỆU, TÁCH BẠCH TRÊN UI:
 *   1. KocRealData — số THẬT cấp sàn/gian hàng từ /api/koc/* (đối soát sàn
 *      ghi Order.affiliateFee). 4 thẻ chỉ số vàng + bảng gian hàng + bảng đơn.
 *   2. Bảng hồ sơ TỪNG KOC bên dưới — vẫn PREVIEW MOCK: API seller của
 *      Shopee/Lazada không trả danh tính creator theo đơn, phải chờ TikTok
 *      Affiliate API (shop thật + scope) mới có attribution thật.
 */

type RoiFilter = "ALL" | "PROFIT" | "LOSS";

export default function KocOverviewPage() {
  const [platform, setPlatform] = useState<KocPlatform | "ALL">("ALL");
  const [campaign, setCampaign] = useState<string>("ALL");
  const [roi, setRoi] = useState<RoiFilter>("ALL");

  const rows = useMemo(
    () =>
      KOC_PARTNERS.filter((k) => {
        if (platform !== "ALL" && k.platform !== platform) return false;
        if (campaign !== "ALL" && k.campaignId !== campaign) return false;
        if (roi === "PROFIT" && kocNetProfit(k) <= 0) return false;
        if (roi === "LOSS" && kocNetProfit(k) > 0) return false;
        return true;
      })
        // Lợi nhuận ròng giảm dần — KOC đáng tiền nhất lên đầu, KOC lỗ chìm xuống đáy
        .sort((a, b) => kocNetProfit(b) - kocNetProfit(a)),
    [platform, campaign, roi]
  );

  return (
    <KocShell>
      {/* ===== TẦNG 1: DỮ LIỆU AFFILIATE THẬT TỪ SÀN ===== */}
      <KocRealData />

      {/* ===== TẦNG 2 (PREVIEW): HỒ SƠ TỪNG KOC + FILTER BAR ===== */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Hiệu quả từng KOC (Preview)</CardTitle>
              <CardDescription>
                Bản mẫu giao diện — API seller của sàn chưa trả danh tính
                creator theo đơn nên hồ sơ từng KOC chờ TikTok Affiliate API
                (shop thật + scope Affiliate) mới có số thật.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <NativeSelect
                className="w-40"
                value={platform}
                onChange={(e) =>
                  setPlatform(e.target.value as KocPlatform | "ALL")
                }
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
                className="w-36"
                value={roi}
                onChange={(e) => setRoi(e.target.value as RoiFilter)}
                aria-label="Lọc theo trạng thái ROI"
              >
                <option value="ALL">Mọi trạng thái</option>
                <option value="PROFIT">Có lời</option>
                <option value="LOSS">Bán lỗ</option>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((k) => {
                const profit = kocNetProfit(k);
                const rating = kocRating(k);
                const meta = KOC_PLATFORM_META[k.platform];
                return (
                  <TableRow key={k.id}>
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
                      <Money
                        value={kocTotalCost(k)}
                        className={TEXT_NUMBER_MUTED}
                      />
                      <p className={TEXT_SUB}>
                        Hoa hồng <Money value={k.commission} className="text-slate-500" />
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
                      {rating === "STAR" && (
                        <Badge
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700"
                        >
                          <Sparkle className="size-3" /> KOC Hiệu quả
                        </Badge>
                      )}
                      {rating === "HIGH_REFUND" && (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-amber-700"
                        >
                          <TriangleAlert className="size-3" /> Tỷ lệ hoàn cao
                        </Badge>
                      )}
                      {rating === null && (
                        <span className={TEXT_SUB}>Đang theo dõi</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Không có KOC nào khớp bộ lọc hiện tại.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · Tổng quan Net-ROI Đa kênh (Preview)
      </p>
    </KocShell>
  );
}
