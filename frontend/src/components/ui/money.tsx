import { splitVND } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * SỐ TIỀN CHUẨN CỦA HUBSELL
 *
 * Con số và ký hiệu "₫" được tô hai sắc độ khác nhau: số là thông tin, ký hiệu
 * chỉ là đơn vị lặp lại ở mọi dòng. Cho cả cụm cùng một màu đậm khiến bảng
 * trông đặc và mắt không biết bám vào đâu.
 *
 * Mặc định số dùng màu chữ đang kế thừa, nên đặt màu ở thẻ cha là đủ:
 *   <td className="text-rose-600"><Money value={-88700} /></td>
 */
export function Money({
  value,
  className,
  /** Cỡ ký hiệu ₫ — mặc định nhỏ hơn số một bậc */
  symbolClassName,
  /** Thêm dấu − phía trước cho các khoản khấu trừ */
  negative = false,
}: {
  value: string | number;
  className?: string;
  symbolClassName?: string;
  negative?: boolean;
}) {
  const { amount, symbol } = splitVND(value);
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {negative && "− "}
      {amount}
      {symbol && (
        <span
          className={cn(
            "ml-0.5 text-[0.85em] font-normal text-slate-400",
            symbolClassName
          )}
        >
          {symbol}
        </span>
      )}
    </span>
  );
}
