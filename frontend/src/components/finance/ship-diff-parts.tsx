"use client";

import { HintText } from "@/components/finance/hint-icon";
import { formatNumber } from "@/lib/format";
import {
  SHIP_GUARANTEE_GAP_META,
  shipDiffPartEntries,
  type ShipDiffParts,
  type ShipGuaranteeGap,
} from "@/lib/shipping-diff-reason";
import { cn } from "@/lib/utils";

/**
 * Dòng phụ dưới số "Bị trừ thêm": tiền lệch của MỘT đơn tách thành chiều đi · chiều về · phụ phí ·
 * sàn bù (khảo sát 13/11/2026, docs DOI-SOAT-PHI-SHIP-NGUYEN-NHAN-KHAO-SAT-31-10.md mục 8). Nhãn
 * nguyên nhân là một nhãn cho cả đơn nên đơn trả hàng nuốt luôn cước chiều đi; dòng này cho thấy tiền
 * thật sự nằm ở đâu. Các phần cộng lại đúng bằng số ở trên. Đơn chưa tách được (Shopee, Lazada) không in gì.
 */
export function ShipDiffPartsLine({ parts, className }: { parts: ShipDiffParts | null | undefined; className?: string }) {
  const entries = shipDiffPartEntries(parts);
  if (entries.length === 0) return null;
  return (
    // Mỗi phần một dòng (như một sổ nhỏ) thay vì nối ngang: cột hẹp lại, bảng 6 cột vẫn vừa màn 1280.
    <HintText
      className={cn("mt-1 ml-auto block text-right whitespace-nowrap tabular-nums", className)}
      hint={
        <div className="space-y-1">
          {entries.map((e) => (
            <p key={e.key}>
              <b>{e.label}</b> {formatNumber(e.amount)} đ<span className="opacity-80"> — {e.hint}</span>
            </p>
          ))}
          <p className="opacity-80">Các dòng cộng lại bằng số shop bị trừ thêm của đơn.</p>
        </div>
      }
    >
      {entries.map((e) => (
        <span key={e.key} className="block">
          {e.short} {formatNumber(e.amount)}
        </span>
      ))}
    </HintText>
  );
}

/** Dòng hổ phách dưới viên nguyên nhân: đơn hủy / trả hàng đã trả phí Bảo đảm phí vận chuyển mà vẫn lệch. */
export function ShipGuaranteeGapNote({ gap, className }: { gap: ShipGuaranteeGap | null | undefined; className?: string }) {
  if (!gap) return null;
  const meta = SHIP_GUARANTEE_GAP_META[gap];
  return (
    // Hai vế của nhãn không tự gãy giữa chừng: đủ chỗ thì một dòng, cột hẹp (màn 1280) thì xuống dòng ở dấu "·".
    <HintText className={cn("mt-1 block whitespace-normal text-amber-700 hover:text-amber-800", className)} hint={meta.hint}>
      {meta.label.split(" · ").map((part, i, all) => (
        <span key={part} className="inline-block whitespace-nowrap">
          {part}
          {i < all.length - 1 && <>&nbsp;·&nbsp;</>}
        </span>
      ))}
    </HintText>
  );
}
