// ============================================================
// Máy trạng thái TỰ CẮT CLIP THEO TEM — phần quyết định, thuần, không đụng camera hay bộ mã hóa.
//
//   nghỉ ──(mã hợp lệ X thấy 2 lần đọc liên tiếp)──▶ mở clip X
//   đang quay A ──(mã hợp lệ B ≠ A thấy 2 lần liên tiếp)──▶ cắt: lưu A, quay ngay B
//   mã đã có clip CÙNG LOẠI trong lượt này ──▶ KHÔNG mở clip, báo "Tem này đã quay rồi"
//
// Sổ "tem đã quay rồi" TÁCH THEO CHẾ ĐỘ (đóng hàng / khui hàng hoàn): kiện hoàn về vẫn dán tem cũ, nên một mã
// đã quay đóng vẫn phải quay khui được; chỉ quay khui lần hai cho cùng mã mới bị báo (anh Trung 16/11/2026).
//
// Anh Trung 14/11/2026: "cái anh cần là tự động" — đưa tem vào là quay, tem kế là cắt; và "tem đã quay rồi
// mà đưa vào lại thì BÁO, không mở clip mới". Bài học lát 0: cắt theo GIÁ TRỊ trông như mã vận đơn, không
// theo loại mã (tem có cả QR mang mã vận đơn lẫn QR đường link).
// ============================================================

import { CONFIRM_READS, REPEAT_NOTICE_MS } from "./config";
import { looksLikeTracking } from "./tracking-code";
import type { ClipKind, ScannedCode } from "./types";

export type CutDecision = { type: "start"; code: string } | { type: "repeat"; code: string } | null;

export class TemCutter {
  /** Mã của clip đang quay (tem hoặc QUAYTAY… / KHUITAY…), null khi đang nghỉ. */
  current: string | null = null;
  /** Chế độ đang quay — quyết định tra sổ "đã quay rồi" nào. */
  mode: ClipKind = "PACK";
  private currentKind: ClipKind = "PACK";
  private candidate: { code: string; count: number } | null = null;
  private readonly done: Record<ClipKind, Set<string>> = { PACK: new Set(), UNBOX: new Set() };
  private readonly lastRepeatAt = new Map<string, number>();

  /** Gọi sau MỖI lần thử đọc (kể cả lần không đọc được gì) — cần vậy mới đếm đúng "liên tiếp". */
  feed(codes: ScannedCode[], nowMs: number = performance.now()): CutDecision {
    const valid: { code: string; format: string }[] = [];
    for (const c of codes) {
      const value = looksLikeTracking(c.rawValue);
      if (value) valid.push({ code: value, format: c.format });
    }
    if (!valid.length) {
      this.candidate = null;
      return null;
    }
    // Tem đang quay vẫn còn trong hình → coi như chưa đổi kiện, kể cả khi thấy thêm mã khác.
    if (this.current && valid.some((v) => v.code === this.current)) {
      this.candidate = null;
      return null;
    }
    // Một tem có thể có nhiều mã hợp lệ → chọn cố định: ưu tiên mã vạch, rồi mã dài hơn, rồi theo thứ tự chữ.
    valid.sort(
      (a, b) =>
        (a.format === "code_128" ? 0 : 1) - (b.format === "code_128" ? 0 : 1) ||
        b.code.length - a.code.length ||
        a.code.localeCompare(b.code)
    );
    const pick = valid[0].code;
    if (this.candidate?.code === pick) this.candidate.count++;
    else this.candidate = { code: pick, count: 1 };
    if (this.candidate.count < CONFIRM_READS) return null;
    this.candidate = null;

    if (this.done[this.mode].has(pick)) {
      // Tem còn nằm trong hình thì cứ 2 lần đọc lại xác nhận một lần — chỉ nhắc mỗi vài giây.
      const key = `${this.mode}:${pick}`;
      const last = this.lastRepeatAt.get(key) ?? -Infinity;
      if (nowMs - last < REPEAT_NOTICE_MS) return null;
      this.lastRepeatAt.set(key, nowMs);
      return { type: "repeat", code: pick };
    }
    return { type: "start", code: pick };
  }

  /** Clip `code` vừa được mở (do tem hoặc quay tay). Clip trước đó (nếu có) coi như đã quay xong. */
  started(code: string): void {
    if (this.current) this.done[this.currentKind].add(this.current);
    this.current = code;
    this.currentKind = this.mode;
    this.candidate = null;
  }

  /** Đổi chế độ lúc đang NGHỈ (đang quay thì bộ quay không cho đổi — xem PackRecorder.setKind). */
  setMode(kind: ClipKind): void {
    this.mode = kind;
    this.candidate = null;
  }

  /** Đổi loại của CHÍNH clip đang quay (rào "đơn này đang hoàn về") và chuyển luôn chế độ. */
  relabelCurrent(kind: ClipKind): void {
    this.currentKind = kind;
    this.mode = kind;
    this.candidate = null;
  }

  /** Clip đang quay vừa được dừng bằng nút. */
  stopped(): void {
    if (this.current) this.done[this.currentKind].add(this.current);
    this.current = null;
    this.candidate = null;
  }

  /** Clip hỏng thì coi như chưa quay → cho phép quay lại tem này. */
  failed(code: string): void {
    this.done.PACK.delete(code);
    this.done.UNBOX.delete(code);
  }

  reset(): void {
    this.current = null;
    this.candidate = null;
  }
}
