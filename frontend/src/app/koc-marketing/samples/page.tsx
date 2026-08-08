"use client";

import { useMemo, useState } from "react";
import { CircleDollarSign, PackageCheck, PackageOpen, Timer } from "lucide-react";

import {
  KOC_PLATFORM_META,
  SAMPLE_SHIPMENTS,
  SAMPLE_SKUS,
  SAMPLE_STATUS_META,
  type SampleShipment,
  type SampleSku,
} from "@/components/koc/koc-data";
import { KocShell } from "@/components/koc/koc-shell";
import { SampleExportModal } from "@/components/koc/sample-export-modal";
import { StatCard } from "@/components/dashboard/stat-card";
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
  TEXT_SUB,
} from "@/lib/typography";

/**
 * QUẢN LÝ HÀNG MẪU & SEEDING
 *
 * Theo dõi vòng đời hàng mẫu: xuất kho → KOC lên bài → có đơn đầu tiên.
 * Giá trị mẫu tính theo GIÁ VỐN và được cộng vào chi phí KOC ở Tổng quan
 * Net-ROI — gửi mẫu không phải "cho không", nó là một khoản đầu tư phải đòi
 * lại bằng đơn hàng.
 *
 * Preview: xuất kho chỉ trừ tồn mock trong phiên. Bản thật xem chú thích
 * trong SampleExportModal (StockMovement MARKETING_SAMPLE + CHI_PHI_MARKETING).
 */
export default function KocSamplesPage() {
  const [shipments, setShipments] = useState<SampleShipment[]>(SAMPLE_SHIPMENTS);
  const [skus, setSkus] = useState<SampleSku[]>(SAMPLE_SKUS);
  const [modalOpen, setModalOpen] = useState(false);

  function handleExport(shipment: SampleShipment) {
    // Phiếu mới lên đầu bảng — người dùng vừa bấm xong phải thấy ngay kết quả
    setShipments((prev) => [shipment, ...prev]);
    setSkus((prev) =>
      prev.map((s) =>
        s.sku === shipment.sku ? { ...s, stock: s.stock - shipment.qty } : s
      )
    );
  }

  const stats = useMemo(() => {
    const totalQty = shipments.reduce((s, x) => s + x.qty, 0);
    const totalCost = shipments.reduce((s, x) => s + x.cost, 0);
    const posted = shipments.filter((x) => x.status === "POSTED").length;
    const notPosted = shipments.filter((x) => x.status === "NOT_POSTED").length;
    return { totalQty, totalCost, posted, notPosted };
  }, [shipments]);

  return (
    <KocShell>
      {/* ===== CHỈ SỐ HÀNG MẪU ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sản phẩm mẫu đã xuất"
          value={formatNumber(stats.totalQty)}
          icon={PackageOpen}
          tone="neutral"
          subtitle={`${formatNumber(shipments.length)} phiếu xuất trong kỳ`}
        />
        <StatCard
          label="Giá trị hàng mẫu"
          value={<Money value={stats.totalCost} />}
          icon={CircleDollarSign}
          tone="negative"
          colorValue
          subtitle="Theo giá vốn — tính vào chi phí Net-ROI"
        />
        <StatCard
          label="Đã lên bài"
          value={`${formatNumber(stats.posted)}/${formatNumber(shipments.length)}`}
          icon={PackageCheck}
          tone="positive"
          subtitle="Phiếu mẫu đã có video/bài đăng"
        />
        <StatCard
          label="Quá hạn chưa đăng"
          value={formatNumber(stats.notPosted)}
          icon={Timer}
          tone="warning"
          subtitle="Cần nhắc KOC hoặc dừng gửi mẫu tiếp"
        />
      </div>

      {/* ===== BẢNG THEO DÕI XUẤT MẪU ===== */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Theo dõi xuất kho hàng mẫu</CardTitle>
              <CardDescription>
                Mỗi phiếu trừ thẳng tồn Kho vật lý và ghi chi phí Marketing
                theo giá vốn. Trạng thái lên bài cập nhật khi KOC đăng nội
                dung có gắn giỏ.
              </CardDescription>
            </div>
            <Button onClick={() => setModalOpen(true)}>
              <PackageOpen className="size-4" />
              Xuất kho hàng mẫu
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className={TABLE_HEAD_EMPHASIS}>
              <TableRow>
                <TableHead>KOC nhận mẫu</TableHead>
                <TableHead>SKU hàng mẫu</TableHead>
                <TableHead className="w-20 text-right">SL</TableHead>
                <TableHead className="text-right">Giá trị (giá vốn)</TableHead>
                <TableHead className="w-28">Ngày xuất</TableHead>
                <TableHead className="w-40">Trạng thái lên bài</TableHead>
                <TableHead className="w-32">Đơn đầu tiên</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.map((s) => {
                const status = SAMPLE_STATUS_META[s.status];
                const platform = KOC_PLATFORM_META[s.platform];
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{s.kocName}</p>
                      <p className={TEXT_SUB}>{platform.label}</p>
                    </TableCell>
                    <TableCell>
                      <p className="font-mono text-sm text-slate-900">{s.sku}</p>
                      <p className={TEXT_SUB}>{s.productName}</p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-slate-700">
                      {formatNumber(s.qty)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={s.cost} className={TEXT_NUMBER_MUTED} />
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {new Date(s.exportedAt).toLocaleDateString("vi-VN")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={status.badgeClass}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {s.firstOrderAt ? (
                        new Date(s.firstOrderAt).toLocaleDateString("vi-VN")
                      ) : (
                        <span className={TEXT_SUB}>Chưa có</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SampleExportModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        skus={skus}
        onExport={handleExport}
      />

      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · Quản lý Hàng mẫu &amp; Seeding (Preview)
      </p>
    </KocShell>
  );
}
