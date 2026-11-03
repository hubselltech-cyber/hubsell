// ============================================================
// BỘ ĐỆM MỘT GIÁ TRỊ, TRẢ NGAY RỒI LÀM MỚI Ở NỀN — cho số tổng hợp nặng mà người
// xem không cần tươi từng giây (trang Tổng quan HQ quét cả bảng đơn mỗi lần mở).
//
//   · còn tươi (< freshMs): trả ngay, không nạp;
//   · đã cũ nhưng < maxStaleMs: trả bản cũ ngay, nạp lại ở nền (mỗi lúc một lượt),
//     lỗi nền thì giữ bản cũ và ghi log;
//   · chưa có, hoặc quá maxStaleMs: chờ nạp, không đưa số quá cũ cho người xem.
//
// Nằm trong RAM tiến trình nên khởi động lại là mất, lượt đầu chờ nạp như thường.
// ============================================================

export class StaleCache<T> {
  private entry: { at: number; value: T } | null = null;
  private inFlight: Promise<T> | null = null;

  constructor(
    private readonly label: string,
    private readonly load: () => Promise<T>,
    private readonly freshMs: number,
    private readonly maxStaleMs: number
  ) {}

  get(): Promise<T> {
    const age = this.entry ? Date.now() - this.entry.at : Infinity;
    if (this.entry && age < this.freshMs) return Promise.resolve(this.entry.value);
    if (this.entry && age < this.maxStaleMs) {
      this.refresh().catch((err) => {
        console.error(`[Đệm ${this.label}] Làm mới ở nền lỗi, giữ bản cũ:`, (err as Error).message);
      });
      return Promise.resolve(this.entry.value);
    }
    return this.refresh();
  }

  private refresh(): Promise<T> {
    if (this.inFlight) return this.inFlight;
    const run = this.load()
      .then((value) => {
        this.entry = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }
}
