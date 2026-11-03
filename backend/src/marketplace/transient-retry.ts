/**
 * THỬ LẠI LỆNH ĐỌC DANH MỤC KHI SÀN CHẬM TẠM THỜI (03/11/2026).
 *
 * Sự cố: gian Hy Korea Official (Shopee, 38.889 dòng) kéo danh mục khoảng 10 phút thì một lệnh
 * get_model_list quá 30 giây → cả lượt bỏ đi, chờ 30 phút rồi kéo lại từ đầu, gian lớn khó có
 * lượt nào xong. Chỉ áp cho lệnh ĐỌC: lặp lại không gây tác dụng phụ. Lỗi khác (sai token, bị
 * giới hạn tần suất đã có đường xử lý riêng ở client) ném thẳng, không thử lại.
 */

/** Lỗi do sàn chậm hoặc đứt mạng, không phải sàn từ chối yêu cầu. */
export function isTransientPlatformError(err: unknown): boolean {
  const message = String((err as Error)?.message ?? err);
  // error_internal / "system busy": Shopee tự báo bận, hãy thử lại (Hy Korea 17:06 03/11/2026).
  return /không trả lời trong|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|error_internal|system busy/i.test(message);
}

export const TRANSIENT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 2000;

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  label: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientPlatformError(err) || attempt >= TRANSIENT_MAX_ATTEMPTS) throw err;
      const wait = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`[Catalog-sync] ${label} chậm, thử lại sau ${wait} ms (${attempt}/${TRANSIENT_MAX_ATTEMPTS})`);
      await sleep(wait);
    }
  }
}

/**
 * Đếm sản phẩm bỏ qua trong một lượt kéo. Hỏng lẻ tẻ thì đi tiếp (danh mục báo chưa đủ, không đánh
 * dấu gỡ); hỏng liên tiếp nhiều là sàn đang sập, dừng để lượt sau thử lại thay vì đọc hết trong vô vọng.
 */
export const SKIP_MAX_CONSECUTIVE = 10;

export class SkipBudget {
  skipped = 0;
  private streak = 0;

  ok(): void {
    this.streak = 0;
  }

  /** Ghi một lần bỏ qua; quá trần liên tiếp thì ném lại đúng lỗi đó. */
  skip(err: unknown): void {
    if (!isTransientPlatformError(err)) throw err;
    this.skipped++;
    this.streak++;
    if (this.streak >= SKIP_MAX_CONSECUTIVE) throw err;
  }
}
