// Các hàm định dạng hiển thị.

// Định dạng tiền tệ Việt Nam (VND). Chấp nhận cả string lẫn number.
// Khoảng trắng trước ₫ là NO-BREAK SPACE: số tiền và ký hiệu là một khối,
// không bao giờ để "₫" mồ côi rớt xuống dòng riêng khi thẻ/cột bị hẹp.
export function formatVND(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "0 ₫";
  const formatted = new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
  return formatted.replace(/ ₫/, " ₫");
}

/**
 * Tách số tiền thành phần SỐ và KÝ HIỆU để tô màu riêng.
 *
 * Trong bảng tài chính, thứ mắt cần bắt là con số; ký hiệu "₫" lặp lại ở mọi
 * dòng nên phải lùi về sau. Tách ra để component <Money> cho số màu đậm còn
 * ký hiệu màu nhạt, thay vì cả cụm cùng một sắc độ.
 *
 * Intl của V8 chèn NO-BREAK SPACE (U+00A0) trước ₫, nên cắt theo ký tự đó.
 */
export function splitVND(value: string | number): {
  amount: string;
  symbol: string;
} {
  const formatted = formatVND(value);
  const index = formatted.lastIndexOf(" ");
  if (index === -1) return { amount: formatted, symbol: "" };
  return {
    amount: formatted.slice(0, index),
    symbol: formatted.slice(index + 1),
  };
}

// Định dạng số (ví dụ: 1.234)
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value);
}

// Định dạng ngày giờ
export function formatDateTime(value: string): string {
  const d = new Date(value);
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
