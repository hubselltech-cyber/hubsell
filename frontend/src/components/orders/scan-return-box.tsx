"use client";

import * as React from "react";
import { toast } from "sonner";

import { ScanCodeBox } from "@/components/shared/scan-code-box";
import { ApiError, lookupOrderByCode, type Order } from "@/lib/api";

/**
 * Ô QUÉT MÃ HÀNG HOÀN — vỏ mỏng quanh ScanCodeBox dùng chung (01/11/2026 tách
 * ra để màn Đóng gói dùng lại; hành vi giữ nguyên): quét → tra đơn qua
 * GET /api/orders/lookup (mã chưa có thì máy chủ hỏi thẳng sàn) → onFound(order).
 */
export function ScanReturnBox({
  onFound,
  disabled,
  compact,
}: {
  /** Trả Promise thì ô quét chờ xong mới chạy mã kế trong hàng chờ. */
  onFound: (order: Order) => void | Promise<void>;
  disabled?: boolean;
  /** Bản gọn một dòng cho thanh công cụ — xem ScanCodeBox. */
  compact?: boolean;
}) {
  const onScan = React.useCallback(
    async (code: string) => {
      try {
        const res = await lookupOrderByCode(code);
        await onFound(res.order);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Không tra cứu được mã");
        throw err; // để ô quét hiện "Mã vừa lỗi" cho nhân viên nhìn lại
      }
    },
    [onFound]
  );
  return (
    <ScanCodeBox
      onScan={onScan}
      disabled={disabled}
      compact={compact}
      grabTyping
      placeholder={compact ? "Quét mã để nhận hàng hoàn…" : undefined}
      ariaLabel="Quét mã vận đơn hàng hoàn"
      hint="Máy quét barcode/2D hoạt động như bàn phím — bắn xong là tự tra, không cần bấm gì thêm. Ô nhập tự lấy lại tiêu điểm để quét liên tục cả xấp. Mã chưa có trong hệ thống sẽ được hỏi thẳng sàn — lượt đó chờ lâu hơn vài giây là bình thường."
    />
  );
}
