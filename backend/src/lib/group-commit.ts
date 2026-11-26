// ============================================================
// GHI GỘP (group commit) — gom nhiều lượt ghi nhỏ thành MỘT lượt ghi lớn (M2.4, 26/11/2026 — thiết kế mục 29.5).
//
//   submit(item) ──▶ xếp vào mẻ đang mở ──▶ mẻ đủ `maxItems` HOẶC đã chờ `maxWaitMs` kể từ món đầu ──▶ flush(cả mẻ)
//   Người gọi CHỈ được trả lời sau khi mẻ của mình ghi xong (lời hứa của submit chờ flush).
//
// Luật:
//  · flush trả mảng kết quả CÙNG THỨ TỰ, cùng số phần tử với mảng đưa vào — món thứ i nhận kết quả thứ i.
//  · Một mẻ hỏng chỉ làm hỏng người gọi của CHÍNH mẻ đó; mẻ sau chạy bình thường.
//  · Mẻ đang ghi KHÔNG chặn mẻ kế hình thành: món tới trong lúc đang ghi vào mẻ mới, mẻ mới có đồng hồ riêng. Mỗi mẻ
//    tối đa `maxItems` món nên không có hàng chờ nào phình vô hạn trong mô-đun này.
// Thuần (không database, không env); đồng hồ lấy từ setTimeout nên test dùng đồng hồ giả được.
// ============================================================

export interface GroupCommitOptions<T, R> {
  /** Mẻ đủ ngần này món thì ghi ngay. */
  maxItems: number;
  /** Món đầu của mẻ chờ tối đa ngần này rồi ghi, dù mẻ chưa đầy. */
  maxWaitMs: number;
  /** Ghi cả mẻ một lượt; trả kết quả theo đúng thứ tự món đưa vào. */
  flush: (items: T[]) => Promise<R[]>;
}

export interface GroupCommit<T, R> {
  submit(item: T): Promise<R>;
}

interface Batch<T, R> {
  items: T[];
  waiters: { resolve: (value: R) => void; reject: (reason: unknown) => void }[];
  timer: ReturnType<typeof setTimeout> | null;
}

export function createGroupCommit<T, R>(opts: GroupCommitOptions<T, R>): GroupCommit<T, R> {
  if (!Number.isInteger(opts.maxItems) || opts.maxItems < 1) throw new Error("maxItems phải là số nguyên ≥ 1");
  let open: Batch<T, R> | null = null;

  function run(batch: Batch<T, R>): void {
    if (open === batch) open = null;
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = null;
    // Bọc trong lời hứa: flush ném lỗi đồng bộ cũng thành mẻ hỏng, không văng ra người gọi submit.
    Promise.resolve()
      .then(() => opts.flush(batch.items))
      .then((results) => {
        if (!Array.isArray(results) || results.length !== batch.items.length) {
          throw new Error("Ghi gộp: số kết quả không khớp số món của mẻ");
        }
        batch.waiters.forEach((w, i) => w.resolve(results[i]));
      })
      .catch((err: unknown) => {
        for (const w of batch.waiters) w.reject(err);
      });
  }

  return {
    submit(item: T): Promise<R> {
      return new Promise<R>((resolve, reject) => {
        const batch = (open ??= { items: [], waiters: [], timer: null });
        batch.items.push(item);
        batch.waiters.push({ resolve, reject });
        if (batch.items.length >= opts.maxItems) {
          run(batch);
        } else if (batch.items.length === 1) {
          batch.timer = setTimeout(() => run(batch), opts.maxWaitMs);
        }
      });
    },
  };
}
