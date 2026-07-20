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
