/**
 * CỬA CHỐNG BẮN LẶP của màn Quét đóng gói (05/11/2026) — hàm thuần, không React, không
 * đồng hồ thật (mọi mốc thời gian truyền vào) để test được bằng node.
 *
 * Vì sao cần: màn quét đóng gói quét LIÊN TỤC, không bấm gì giữa hai kiện. Camera bắn
 * ~10 lượt đọc mỗi giây cho mỗi mã đang nằm trong khung, và tem của sàn thường có 2–3
 * mã vạch (mã vận đơn, mã đơn, mã phân tuyến / QR). Không có cửa này thì một kiện gọi
 * máy chủ hàng chục lần, kêu "đã quét rồi" ngay sau khi kêu "đã ghi", hoặc kêu "không
 * thấy mã" vì đọc trúng mã phân tuyến của chính tem vừa quét xong.
 *
 * BỐN LUẬT (docs/MOBILE-DAI-TU-DON-HANG-KHO.md mục 3):
 *   1. Mỗi lúc MỘT lượt gọi — đang gọi thì mã mới chưa được nhận (lượt đọc sau thử lại).
 *   2. Mã đã xử lý mà CÒN trong khung → không bắn lại; rời khung đủ REARM_MS mới nhận lại
 *      (đưa kiện vào lần hai là cố ý → máy chủ trả "đã quét rồi").
 *   3. Mã lạ xuất hiện khi một mã ĐÃ RA ĐƠN còn trong khung (thấy trong COMPANION_MS gần
 *      nhất) → là mã vạch khác của CÙNG TEM, bỏ qua, không gọi. Sang kiện kế thì mã cũ
 *      rời khung, mã mới được nhận ngay — không phải chờ màn báo tắt.
 *   4. (ở màn quét, không ở đây) máy chủ trả "đã quét" cho đúng đơn vừa ghi trong phiên → im.
 *
 * Mã KHÔNG ra đơn (404) không làm "neo" cho luật 3: đọc trúng mã phân tuyến trước rồi
 * mới tới mã vận đơn thì mã vận đơn vẫn phải được gửi đi.
 */

/** Mã đã xử lý phải rời khung chừng này mới nhận lại. Mặc định tự chọn; web chặn lặp 2 giây. */
export const REARM_MS = 2000;
/** Hai mã thấy cách nhau trong khoảng này coi là cùng một tem. Mặc định tự chọn, chỉnh sau khi thử tem thật. */
export const COMPANION_MS = 600;
/** Lượt gọi hỏng vì mạng: thử lại sau chừng này dù mã vẫn nằm trong khung. Mặc định tự chọn. */
export const NETWORK_RETRY_MS = 2500;

export type GateVerdict =
  /** Gửi mã này lên máy chủ. */
  | "fire"
  /** Luật 1: đang có lượt gọi. */
  | "busy"
  /** Luật 2: mã đã xử lý, còn trong khung. */
  | "same"
  /** Luật 3: mã vạch khác của tem vừa ra đơn. */
  | "companion"
  /** Vừa hỏng mạng với mã này, chưa tới giờ thử lại. */
  | "cooldown";

type Outcome = "order" | "unknown" | "network";

export class PackScanGate {
  /** Lần gần nhất camera THẤY từng mã — làm mới ở mọi lượt đọc. */
  private lastSeen = new Map<string, number>();
  /** Kết cục của mã đã gửi máy chủ. */
  private outcome = new Map<string, Outcome>();
  /** Mốc được thử lại của mã hỏng mạng. */
  private retryAt = new Map<string, number>();
  private inFlight: string | null = null;

  /** Camera vừa đọc được `code` lúc `now` → có gửi máy chủ không. */
  admit(code: string, now: number): GateVerdict {
    const prev = this.lastSeen.get(code);
    this.lastSeen.set(code, now);

    const done = this.outcome.get(code);
    if (done === "network") {
      if (now < (this.retryAt.get(code) ?? 0)) return "cooldown";
    } else if (done && prev !== undefined && now - prev < REARM_MS) {
      return "same";
    }

    for (const [other, o] of this.outcome) {
      if (o !== "order" || other === code) continue;
      const seen = this.lastSeen.get(other);
      if (seen !== undefined && now - seen < COMPANION_MS) return "companion";
    }

    if (this.inFlight !== null) return "busy";
    this.inFlight = code;
    return "fire";
  }

  /** Máy chủ nhận ra một đơn (ghi được / đã quét / bị chặn). */
  resolved(code: string): void {
    this.finish(code, "order");
  }

  /** Máy chủ không thấy đơn nào với mã này (404) hoặc mã khớp nhiều đơn (409). */
  unknown(code: string): void {
    this.finish(code, "unknown");
  }

  /** Lượt gọi hỏng (mất mạng, quá giờ, máy chủ lỗi) — kiện CHƯA được ghi, cho thử lại. */
  networkFailed(code: string, now: number): void {
    this.finish(code, "network");
    this.retryAt.set(code, now + NETWORK_RETRY_MS);
  }

  /** Gõ tay: người dùng chủ động gửi, không qua luật 2–3 nhưng vẫn giữ luật 1. */
  admitManual(code: string): boolean {
    if (this.inFlight !== null) return false;
    this.inFlight = code;
    return true;
  }

  private finish(code: string, o: Outcome): void {
    if (this.inFlight === code) this.inFlight = null;
    this.outcome.set(code, o);
    this.prune();
  }

  /** Ca dài quét vài nghìn kiện — bỏ bớt mã cũ, giữ bộ nhớ phẳng. */
  private prune(): void {
    if (this.lastSeen.size <= 400) return;
    const keep = [...this.lastSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200);
    this.lastSeen = new Map(keep);
    for (const k of [...this.outcome.keys()]) if (!this.lastSeen.has(k)) this.outcome.delete(k);
    for (const k of [...this.retryAt.keys()]) if (!this.lastSeen.has(k)) this.retryAt.delete(k);
  }
}
