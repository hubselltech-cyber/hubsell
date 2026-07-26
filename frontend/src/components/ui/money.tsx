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
 *   <td className="text-red-500"><Money value={-88700} /></td>
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
            // align-baseline khai báo tường minh: span cỡ chữ nhỏ hơn nằm trong
            // dòng có leading-tight/tracking-tight dễ bị trình duyệt đẩy lệch,
            // ghim baseline để "₫" luôn đứng ngang chân các chữ số.
            // Span INLINE thuần (không inline-block): chữ cỡ nhỏ hơn tự động
            // dùng chung baseline với chữ số của thẻ cha, không treo cao cũng
            // không tụt thấp. inline-block sẽ tự sinh baseline riêng và lệch.
            "ml-1 align-baseline text-[0.7em] font-normal text-slate-400",
            symbolClassName
          )}
        >
          {symbol}
        </span>
      )}
    </span>
  );
}
