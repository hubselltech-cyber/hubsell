"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Info, X } from "lucide-react";

import { fetchNotBackYet, type RestockOnReturn } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";

/**
 * HAI DẢI THÔNG BÁO của bảng Tổng kho cho shop chạy cách "hàng trong kho" (kho chuẩn quốc tế, 20/11/2026,
 * docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 15):
 *
 * 1. Dải GIẢI THÍCH MỘT LẦN: ngày shop chuyển cách, cột Tồn kho tăng lên đúng bằng phần đang giữ cho
 *    đơn — phải nói rõ vì sao, và nói rõ số đẩy lên sàn không đổi. Bấm "Đã hiểu" là không hiện lại
 *    (luật: bỏ qua là không hiện lại), nhớ theo trình duyệt.
 * 2. Dải "CHƯA VỀ KHO": shop còn để "cộng tồn ngay khi sàn báo hủy" thì Tồn kho đang tính cả hàng của
 *    các đơn hủy sau giao mà kho chưa nhận kiện — là ngoại lệ so với chuẩn nên luôn có nhãn. Chỉ một
 *    dòng, không gạt được (số về 0 thì tự mất). Con số lấy bằng đường gọi RIÊNG, một lần lúc mở
 *    trang rồi nhớ 5 phút (26/11/2026) — không tính lại theo từng lượt lật trang / tìm kiếm của bảng;
 *    khóa truy vấn nằm dưới "products" nên sửa tồn / nhập kho hàng hoàn xong là tự lấy lại.
 */
const DISMISS_KEY = "hubsell_on_hand_notice_dismissed";

export function OnHandNotice({ restockOnReturn }: { restockOnReturn?: RestockOnReturn }) {
  const notBackYet = useApiQuery({
    queryKey: qk.products({ notBackYet: true }),
    queryFn: fetchNotBackYet,
    enabled: restockOnReturn === "ON_CANCEL",
    staleTime: 5 * 60 * 1000,
  }).data;
  // null = chưa đọc trình duyệt (SSR + lượt vẽ đầu) → chưa vẽ, tránh nháy.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const showIntro = dismissed === false;
  const showNotBack = (notBackYet?.units ?? 0) > 0;
  if (!showIntro && !showNotBack) return null;

  return (
    <div className="mb-3 space-y-2">
      {showIntro && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-medium">Tồn kho từ nay là hàng thực có trong kho</span>, gồm cả hàng đã có đơn chưa
            giao cho vận chuyển (cột Đang giữ). Giao cho vận chuyển thì Tồn kho mới giảm. Có thể bán và số đẩy lên sàn
            không đổi.
          </p>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(DISMISS_KEY, "1");
              } catch {
                // Trình duyệt chặn lưu → vẫn gạt được trong phiên này.
              }
              setDismissed(true);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-sky-800 hover:bg-sky-100"
          >
            <X className="size-3" aria-hidden />
            Đã hiểu
          </button>
        </div>
      )}
      {showNotBack && notBackYet && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          Tồn kho đang tính cả <span className="font-semibold">{formatNumber(notBackYet.units)} sản phẩm</span> của{" "}
          {formatNumber(notBackYet.orders)} đơn hủy sau khi giao
          {notBackYet.days ? ` trong ${notBackYet.days} ngày gần đây` : ""} mà kho chưa nhận kiện.{" "}
          <Link href="/warehouse/returns" className="font-medium underline underline-offset-2">
            Đối soát đơn hoàn
          </Link>
        </p>
      )}
    </div>
  );
}
