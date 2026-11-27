"use client";

// ============================================================
// HỎI LẠI KHI ĐỔI GIÁ VỐN Ở TỔNG KHO MÀ CÓ SKU SÀN ĐANG ĐẶT GIÁ RIÊNG LỆCH (27/11/2026 —
// docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 15.4).
//
// Luật anh Trung chốt: đã nối kho thì đổi giá vốn ở Tổng kho là đổi cho mọi SKU sàn đã nối. SKU sàn có giá
// riêng TRÙNG giá kho cũ / mới thì máy chủ tự cho theo, không hỏi. Chỉ SKU sàn có giá riêng LỆCH cả hai
// (khách cố ý đặt riêng cho gian, hoặc nối nhầm quy cách thùng ↔ set) mới hiện hộp này, kèm số cũ → số mới
// từng dòng — anh chốt "Hỏi lại ca này".
// Chữ hai nút do anh Trung đặt (27/11, bản đầu "Giữ giá riêng của gian" / "Áp giá mới cho tất cả" anh thấy khó hiểu):
// "Không thay đổi giá vốn của gian hàng" / "Áp thay đổi giá vốn lên gian hàng" — đừng đổi lại.
//
// `askOwnCost` trả "follow" (áp thay đổi), "keep" (không thay đổi) hoặc null (đóng hộp = quay lại sửa, chưa lưu).
// Đặt `ownCostDialog` vào JSX của component gọi — cùng cách với useGiftCostGuard.
// ============================================================

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { cn } from "@/lib/utils";

import type { OwnCostConflict } from "./draft";

export type OwnCostChoice = "follow" | "keep";

export function useOwnCostChoice() {
  const [pending, setPending] = React.useState<{ rows: OwnCostConflict[]; resolve: (choice: OwnCostChoice | null) => void } | null>(null);

  const askOwnCost = React.useCallback(
    (rows: OwnCostConflict[]): Promise<OwnCostChoice | null> =>
      rows.length === 0 ? Promise.resolve("keep") : new Promise((resolve) => setPending({ rows, resolve })),
    []
  );

  const close = (choice: OwnCostChoice | null) => {
    pending?.resolve(choice);
    setPending(null);
  };

  const rows = pending?.rows ?? [];
  const ownCostDialog = (
    <Dialog open={pending != null} onOpenChange={(open) => !open && close(null)}>
      {/* 42rem nhưng luôn chừa lề 1rem mỗi bên (`sm:max-w-2xl` trần trụi làm hộp chạm mép ở màn 640–700 px); màn thấp thì
          hộp tự cuộn, chân hộp dính đáy. */}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(42rem,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>{formatNumber(rows.length)} SKU sàn đang đặt giá vốn riêng</DialogTitle>
          <DialogDescription>
            Các SKU sàn này đã nối với sản phẩm bạn vừa đổi giá vốn, nhưng gian hàng đang tính theo giá vốn riêng, khác giá ở Tổng kho. Áp
            thay đổi thì từ nay gian hàng tính theo giá vốn ở Tổng kho. Đơn cũ đã có giá vốn giữ nguyên.
          </DialogDescription>
        </DialogHeader>

        {/* Mẫu nhiều phân loại × nhiều gian có thể ra vài chục dòng — bảng cuộn trong khung, nút luôn trong tầm mắt. */}
        {/* Điện thoại (< sm): 4 cột không vừa 300 px, hai cột giá từng trôi ra ngoài → ẩn cột Gian hàng + hai cột giá,
            in gian và "giá riêng → giá mới" ngay dưới tên SKU. */}
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-slate-200">
          <table className="w-full table-fixed text-sm sm:min-w-[520px]">
            <thead className="sticky top-0 bg-muted">
              <tr className={TEXT_TABLE_HEAD}>
                <th className="hidden w-[30%] px-3 py-2 text-left font-medium sm:table-cell">Gian hàng</th>
                <th className="px-3 py-2 text-left font-medium">SKU sàn</th>
                <th className="hidden w-[19%] px-3 py-2 text-right font-medium sm:table-cell">Giá riêng</th>
                <th className="hidden w-[19%] px-3 py-2 text-right font-medium sm:table-cell">Giá mới</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="hidden px-3 py-2 align-top sm:table-cell">
                    <span className="block truncate" title={r.shopName}>
                      {r.shopName}
                    </span>
                    <span className={cn(TEXT_SUB, "block")}>{CHANNEL_META[r.channelName]?.label ?? r.channelName}</span>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="block truncate" title={r.label}>
                      {r.label}
                    </span>
                    <span className={cn(TEXT_SUB, "block truncate font-mono")} title={`Mã SKU kho ${r.skuCode}`}>
                      {r.skuCode}
                    </span>
                    <span className={cn(TEXT_SUB, "block truncate sm:hidden")}>
                      {r.shopName} · {CHANNEL_META[r.channelName]?.label ?? r.channelName}
                    </span>
                    <span className="mt-0.5 block tabular-nums sm:hidden">
                      <span className="text-muted-foreground line-through">{formatVND(r.ownCost)}</span>
                      <span className="mx-1.5 text-muted-foreground">→</span>
                      <span className="font-medium">{formatVND(r.newCost)}</span>
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 text-right align-top tabular-nums text-muted-foreground line-through sm:table-cell">{formatVND(r.ownCost)}</td>
                  <td className="hidden px-3 py-2 text-right align-top font-medium tabular-nums sm:table-cell">{formatVND(r.newCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter className="sticky -bottom-4 z-10 bg-muted">
          <Button type="button" variant="outline" onClick={() => close("keep")}>
            Không thay đổi giá vốn của gian hàng
          </Button>
          <Button type="button" onClick={() => close("follow")}>
            Áp thay đổi giá vốn lên gian hàng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { askOwnCost, ownCostDialog };
}
