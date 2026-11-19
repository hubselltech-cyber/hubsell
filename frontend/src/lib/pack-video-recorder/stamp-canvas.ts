// ============================================================
// Canvas ghép hình: vẽ từng khung camera + NGÀY GIỜ ở góc trái trên, rồi đưa cho bộ mã hóa.
//
// Anh Trung 14/11/2026: video phải có ngày giờ quay trong hình ("sàn họ bắt"), đặt góc nhỏ TRÁI TRÊN. In lúc
// quay (sàn đòi video không chỉnh sửa), không in tên shop. Đo 16/11: vẽ một khung 1280×720 tốn ≈ 0,8 mili giây.
//
// 18/11/2026 — anh Trung: "Trước tiên cứ thử đường in thêm mã đơn hàng và mã vận đơn kèm xem sao" (đảo quyết
// định 14/11 "chỉ cần ngày giờ thôi"): sàn đòi video THẤY RÕ mã vận đơn mà tem thật trong hình quá nhỏ (tài liệu
// khảo sát mục 64.6). Dưới ngày giờ in thêm "Mã vận đơn: …" và, khi máy chủ khớp ra đơn, "Mã đơn hàng: …" — chữ
// to hơn ngày giờ một bậc. Cùng câu chữ với app điện thoại (hubsell-mobile/src/lib/pack-video-overlay.ts).
// ============================================================

import { STAMP_BOX_RATIO } from "./config";
import { pipRect, pipSourceCrop, type PipSettings } from "./pip-layout";

/**
 * Ô CẬN CẢNH cho MỘT khung hình (19/11/2026, mục 22 tài liệu thiết kế): hình mới nhất của camera cận + chỗ đặt.
 * `image` null = camera cận đang mất giữa chừng → vẽ ô xám có chữ `note` (video nói thật là lúc đó không có hình).
 */
export interface PipFrame {
  image: CanvasImageSource | null;
  srcW: number;
  srcH: number;
  settings: PipSettings;
  note: string | null;
}

/** Dòng mã cao hơn dòng ngày giờ ngần này lần (3,5 % → 4,2 % chiều cao khung, bằng app điện thoại). */
const CODE_LINE_SCALE = 1.2;
/** Mã dài hơn thế là rác (mã vận đơn / mã đơn hàng của ba sàn đều dưới 25 ký tự). */
const MAX_CODE_CHARS = 30;

const cleanCode = (v: string) => v.replace(/\s+/g, "").slice(0, MAX_CODE_CHARS);

/** Các dòng in dưới ngày giờ: mã vận đơn luôn có; mã đơn hàng có khi máy chủ đã khớp ra đơn. */
export function stampCodeLines(trackingCode: string, orderCode: string | null): string[] {
  const lines = [`Mã vận đơn: ${cleanCode(trackingCode)}`];
  const order = orderCode ? cleanCode(orderCode) : "";
  if (order) lines.push(`Mã đơn hàng: ${order}`);
  return lines;
}

export interface StampBox {
  text: string;
  fontPx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  padX: number;
}

/**
 * Xếp các dòng mã thành hộp từ trên xuống, bắt đầu ngay dưới hộp ngày giờ. Dòng rộng hơn khung thì thu nhỏ cỡ
 * chữ cho vừa; hết chỗ theo chiều cao thì bỏ các dòng còn lại. Hàm THUẦN (nhận hàm đo chữ) để test không cần canvas.
 */
export function layoutCodeBoxes(
  frame: { width: number; height: number; margin: number; top: number; baseBoxH: number },
  lines: readonly string[],
  measure: (text: string, fontPx: number) => number
): StampBox[] {
  const boxes: StampBox[] = [];
  const gap = Math.max(2, Math.round(frame.height * 0.004));
  const available = frame.width - frame.margin * 2;
  let y = frame.top + gap;
  for (const text of lines) {
    let h = Math.round(frame.baseBoxH * CODE_LINE_SCALE);
    let fontPx = Math.max(9, Math.round(h * 0.72));
    let padX = Math.round(h * 0.3);
    let textW = measure(text, fontPx);
    if (textW + padX * 2 > available && textW > 0) {
      fontPx = Math.max(8, Math.floor((fontPx * (available - padX * 2)) / textW));
      h = Math.max(10, Math.round(fontPx / 0.72));
      padX = Math.round(h * 0.3);
      textW = measure(text, fontPx);
    }
    const w = Math.ceil(textW) + padX * 2;
    if (w > available || y + h + frame.margin > frame.height) break;
    boxes.push({ text, fontPx, x: frame.margin, y, w, h, padX });
    y += h + gap;
  }
  return boxes;
}

const fontOf = (px: number) => `600 ${px}px Consolas, "Cascadia Mono", "Courier New", monospace`;

interface Layout {
  width: number;
  height: number;
  boxH: number;
  boxW: number;
  font: string;
  padX: number;
  margin: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** dd/MM/yyyy HH:mm:ss theo giờ của máy đang quay. */
export function formatStamp(d: Date): string {
  return (
    `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

export class StampCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private layout: Layout | null = null;
  /** Hộp các dòng mã đã xếp cho đúng bộ dòng này (mã chỉ đổi khi đổi clip → không xếp lại mỗi khung hình). */
  private codeKey = "";
  private codeBoxes: StampBox[] = [];

  constructor() {
    this.canvas = document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Trình duyệt không tạo được canvas 2D");
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const boxH = Math.max(12, Math.round(height * STAMP_BOX_RATIO));
    const fontPx = Math.max(9, Math.round(boxH * 0.72));
    const font = fontOf(fontPx);
    this.ctx.font = font;
    // Chuỗi luôn dài 19 ký tự, phông đơn cách → đo một lần là đủ.
    const textW = Math.ceil(this.ctx.measureText("00/00/0000 00:00:00").width);
    const padX = Math.round(boxH * 0.3);
    const margin = Math.round(height * 0.012);
    this.layout = { width, height, boxH, font, padX, margin, boxW: textW + padX * 2 };
    this.codeKey = ""; // đổi khổ hình thì xếp lại các dòng mã
    this.codeBoxes = [];
  }

  private boxesFor(L: Layout, lines: readonly string[]): StampBox[] {
    const key = lines.join("\n");
    if (key === this.codeKey) return this.codeBoxes;
    this.codeKey = key;
    this.codeBoxes = layoutCodeBoxes(
      { width: L.width, height: L.height, margin: L.margin, top: L.margin + L.boxH, baseBoxH: L.boxH },
      lines,
      (text, fontPx) => {
        this.ctx.font = fontOf(fontPx);
        return this.ctx.measureText(text).width;
      }
    );
    return this.codeBoxes;
  }

  /**
   * Vẽ ô cận cảnh. Vẽ TRƯỚC ngày giờ và các dòng mã → khách có kéo ô lên góc trái trên thì chữ vẫn nằm trên, không
   * bao giờ bị che.
   */
  private drawPip(L: Layout, pip: PipFrame): void {
    const ctx = this.ctx;
    const r = pipRect(pip.settings, L);
    let drawn = false;
    if (pip.image && pip.srcW > 0 && pip.srcH > 0) {
      const c = pipSourceCrop(pip.settings, L, { width: pip.srcW, height: pip.srcH });
      try {
        ctx.drawImage(pip.image, c.sx, c.sy, c.sw, c.sh, r.x, r.y, r.w, r.h);
        drawn = true;
      } catch {
        // khung của camera cận vừa bị đóng (camera rớt đúng lúc vẽ) → vẽ ô báo bên dưới
      }
    }
    if (!drawn) {
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const note = pip.note ?? "";
      if (note) {
        let fontPx = Math.max(9, Math.round(L.boxH * 0.72));
        ctx.font = fontOf(fontPx);
        const textW = ctx.measureText(note).width;
        const room = r.w - Math.round(L.boxH * 0.6);
        if (textW > room && textW > 0) {
          fontPx = Math.max(7, Math.floor((fontPx * room) / textW));
          ctx.font = fontOf(fontPx);
        }
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(note, r.x + r.w / 2, r.y + r.h / 2);
      }
    }
    // Viền trắng mảnh, nằm trọn bên trong ô — tách ô khỏi cảnh toàn cảnh.
    const line = Math.max(2, Math.round(L.height / 360));
    ctx.lineWidth = line;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeRect(r.x + line / 2, r.y + line / 2, r.w - line, r.h - line);
  }

  /** Vẽ một khung camera kèm (nếu bật) ô cận cảnh, ngày giờ hiện tại và (nếu có) các dòng mã của clip đang quay. */
  draw(source: CanvasImageSource, now: Date = new Date(), lines: readonly string[] = [], pip: PipFrame | null = null): void {
    const L = this.layout;
    if (!L) throw new Error("Chưa đặt kích thước canvas");
    const ctx = this.ctx;
    ctx.drawImage(source, 0, 0, L.width, L.height);
    if (pip) this.drawPip(L, pip);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(L.margin, L.margin, L.boxW, L.boxH);
    ctx.font = L.font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(formatStamp(now), L.margin + L.padX, L.margin + L.boxH / 2 + 1);
    if (lines.length === 0) return;
    for (const box of this.boxesFor(L, lines)) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.font = fontOf(box.fontPx);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(box.text, box.x + box.padX, box.y + box.h / 2 + 1);
    }
  }
}
