/**
 * Hỏi theo nhịp tới khi `check` trả true hoặc hết `maxMs`. Lỗi mạng thoáng qua trong
 * `check` được bỏ qua (lượt sau hỏi lại). Trả true = xong, false = hết giờ chờ.
 *
 * Dùng cho việc nền phía máy chủ mà giao diện muốn báo "Đang kéo trong vài phút…"
 * rồi tự nạp lại khi xong (kéo danh mục sản phẩm từ sàn, 03/11/2026).
 */
export async function pollUntil(
  check: () => Promise<boolean>,
  opts: { intervalMs: number; maxMs: number }
): Promise<boolean> {
  const deadline = Date.now() + opts.maxMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, opts.intervalMs));
    try {
      if (await check()) return true;
    } catch {
      // lỗi mạng thoáng qua — lượt sau hỏi lại
    }
  }
  return false;
}
