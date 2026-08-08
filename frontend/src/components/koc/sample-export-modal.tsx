"use client";

import { useMemo, useState } from "react";
import { PackageOpen } from "lucide-react";

import {
  KOC_PARTNERS,
  KOC_PLATFORM_META,
  type SampleShipment,
  type SampleSku,
} from "@/components/koc/koc-data";
import { Button } from "@/components/ui/button";
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
import { formatNumber } from "@/lib/format";

/**
 * MODAL XUẤT KHO HÀNG MẪU — luồng 3 bước trong 1 form:
 *   Chọn SKU kho vật lý → nhập số lượng (trừ tồn) → gắn ID KOC nhận mẫu.
 *
 * Bản preview chỉ cập nhật state phía client (bảng + tồn mock của trang
 * Samples). Bản thật sẽ POST /koc/samples: backend tạo StockMovement lý do
 * MARKETING_SAMPLE trừ tồn kho vật lý, đồng thời ghi 1 dòng chi phí nhóm
 * CHI_PHI_MARKETING (giá trị = qty × giá vốn) sang Thu chi vận hành — một
 * bản ghi nuôi cả Net-ROI lẫn Báo cáo dòng tiền.
 */
export function SampleExportModal({
  open,
  onOpenChange,
  skus,
  onExport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Tồn kho mẫu hiện tại (đã trừ các phiếu xuất trong phiên) */
  skus: SampleSku[];
  onExport: (shipment: SampleShipment) => void;
}) {
  const [kocId, setKocId] = useState(KOC_PARTNERS[0]?.id ?? "");
  const [sku, setSku] = useState(skus[0]?.sku ?? "");
  const [qty, setQty] = useState(1);

  const koc = useMemo(() => KOC_PARTNERS.find((k) => k.id === kocId), [kocId]);
  const picked = useMemo(() => skus.find((s) => s.sku === sku), [skus, sku]);

  const qtyValid = picked ? qty >= 1 && qty <= picked.stock : false;
  const cost = picked ? qty * picked.unitCost : 0;

  function handleExport() {
    if (!koc || !picked || !qtyValid) return;
    onExport({
      id: `smp-${Date.now()}`,
      kocId: koc.id,
      kocName: koc.name,
      platform: koc.platform,
      sku: picked.sku,
      productName: picked.name,
      qty,
      cost,
      exportedAt: new Date().toISOString().slice(0, 10),
      status: "WAITING",
    });
    onOpenChange(false);
    setQty(1);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="size-5 text-violet-600" />
            Xuất kho hàng mẫu
          </DialogTitle>
          <DialogDescription>
            Trừ tồn kho vật lý và ghi nhận giá trị mẫu (theo giá vốn) vào chi
            phí Marketing của KOC nhận hàng.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sample-koc">KOC nhận mẫu</Label>
            <NativeSelect
              id="sample-koc"
              value={kocId}
              onChange={(e) => setKocId(e.target.value)}
            >
              {KOC_PARTNERS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} — {KOC_PLATFORM_META[k.platform].label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sample-sku">SKU kho vật lý</Label>
            <NativeSelect
              id="sample-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
            >
              {skus.map((s) => (
                <option key={s.sku} value={s.sku} disabled={s.stock === 0}>
                  {s.sku} — {s.name} (tồn {formatNumber(s.stock)})
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sample-qty">Số lượng xuất</Label>
            <Input
              id="sample-qty"
              type="number"
              min={1}
              max={picked?.stock ?? 1}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              aria-invalid={!qtyValid}
            />
            {picked && !qtyValid && (
              <p className="text-xs text-red-500">
                Số lượng phải từ 1 đến {formatNumber(picked.stock)} (tồn hiện
                tại).
              </p>
            )}
          </div>

          {/* Tóm tắt chi phí sẽ ghi nhận — cho chủ shop thấy trước con số
              chảy vào Net-ROI, không có bất ngờ sau khi bấm */}
          <div className="flex items-center justify-between rounded-lg border bg-slate-50 px-3 py-2.5 text-sm">
            <span className="text-slate-500">
              Ghi nhận chi phí Marketing (giá vốn)
            </span>
            <Money value={cost} className="font-semibold text-red-500" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleExport} disabled={!qtyValid || !koc}>
            Xuất kho &amp; gắn KOC
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
