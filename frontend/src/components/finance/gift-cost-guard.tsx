"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { checkGiftCost, type GiftCostCheck } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";

/**
 * HỎI LẠI KHI NHẬP GIÁ VỐN CAO CHO MÃ ĐANG LÀ QUÀ TẶNG (05/11/2026, lớp 1 của
 * docs/TAI-CHINH-GIA-VON-0-ROI-ROAS-KHAO-SAT-02-11.md mục 12). Ca thật: thẻ cảm ơn nhập 686.868 đ làm hòa vốn thành "Lỗ sẵn".
 * Chỉ cảnh báo, luôn có nút Vẫn lưu. Phép kiểm lỗi hoặc mạng chậm thì cho lưu luôn, không chặn việc của khách.
 *
 * `confirmGiftCost` trả true nếu được lưu tiếp. Đặt `giftCostDialog` vào JSX của component gọi.
 */
export function useGiftCostGuard() {
  const [pending, setPending] = React.useState<{ check: GiftCostCheck; cost: number; resolve: (ok: boolean) => void } | null>(null);

  const confirmGiftCost = React.useCallback(async (skuIds: string[], cost: number): Promise<boolean> => {
    if (!(cost > 0) || skuIds.length === 0) return true;
    let check: GiftCostCheck;
    try {
      check = await checkGiftCost(skuIds, cost);
    } catch {
      return true;
    }
    if (check.exceedOrders <= 0) return true;
    return new Promise<boolean>((resolve) => setPending({ check, cost, resolve }));
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const giftCostDialog = (
    <Dialog open={pending != null} onOpenChange={(open) => !open && close(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mã này đang là quà tặng</DialogTitle>
          <DialogDescription>
            {pending
              ? `Giá vốn ${formatVND(pending.cost)} cao hơn doanh thu của ${formatNumber(pending.check.exceedOrders)}/${formatNumber(pending.check.giftOrders)} đơn có quà này trong 60 ngày qua. Nhập sai sẽ làm lãi/lỗ và hòa vốn quảng cáo của các đơn mới bị lệch. Giá này đúng không?`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Sửa lại
          </Button>
          <Button type="button" onClick={() => close(true)}>
            Vẫn lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirmGiftCost, giftCostDialog };
}
