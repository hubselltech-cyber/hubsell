// ============================================================
// BỘ NHỚ ĐỆM NGẮN HẠN THEO KHÓA — TTL mili-giây, giữ PROMISE (gọi trùng khi
// đang nạp dùng chung một lượt), lỗi thì bỏ khóa để lượt sau nạp lại.
//
// Có TRẦN số khóa (mặc định 500): khóa theo gian/danh mục tăng theo số khách,
// không trần thì RAM worker (320 MB) phình theo thời gian. Quá trần → bỏ khóa
// hết hạn trước, vẫn quá → bỏ khóa cũ nhất (Map giữ thứ tự chèn).
// Dùng cho cây danh mục / thuộc tính / thương hiệu / kho của sàn khi đăng SP.
// ============================================================

export class TtlCache<T> {
  private readonly map = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxKeys = 500
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.map.get(key);
    const now = Date.now();
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    const value = load().catch((err) => {
      this.map.delete(key);
      throw err;
    });
    this.map.delete(key);
    this.map.set(key, { at: now, value });
    if (this.map.size > this.maxKeys) this.evict(now);
    return value;
  }

  get size(): number {
    return this.map.size;
  }

  private evict(now: number): void {
    for (const [k, v] of this.map) if (now - v.at >= this.ttlMs) this.map.delete(k);
    while (this.map.size > this.maxKeys) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
