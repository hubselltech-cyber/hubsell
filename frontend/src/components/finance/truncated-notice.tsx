/**
 * Dải nhắc dùng chung cho mọi báo cáo đọc đơn theo trang: backend dừng ở phanh
 * 20.000 đơn (`truncated`) thì số trên trang là CẬN DƯỚI — phải nói ra, không
 * im lặng hiện số thiếu (sự cố 29/09/2026, docs/KIEN-TRUC-QUY-MO-TRIEU-DON.md).
 */
export function TruncatedNotice({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
      Kỳ này vượt 20.000 đơn nên số liệu chưa đủ. Anh/chị chọn kỳ ngắn hơn hoặc
      lọc theo từng gian để xem số chính xác.
    </p>
  );
}
