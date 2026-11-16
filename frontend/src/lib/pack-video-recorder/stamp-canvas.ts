// ============================================================
// Canvas ghép hình: vẽ từng khung camera + NGÀY GIỜ ở góc trái trên, rồi đưa cho bộ mã hóa.
//
// Anh Trung 14/11/2026: video phải có ngày giờ quay trong hình ("sàn họ bắt"), "chỉ cần ngày giờ thôi",
// đặt góc nhỏ TRÁI TRÊN. In lúc quay (sàn đòi video không chỉnh sửa), không in mã vận đơn, không in tên shop.
// Đo 16/11: vẽ một khung 1280×720 tốn ≈ 0,8 mili giây.
// ============================================================

import { STAMP_BOX_RATIO } from "./config";

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
    const font = `600 ${fontPx}px Consolas, "Cascadia Mono", "Courier New", monospace`;
    this.ctx.font = font;
    // Chuỗi luôn dài 19 ký tự, phông đơn cách → đo một lần là đủ.
    const textW = Math.ceil(this.ctx.measureText("00/00/0000 00:00:00").width);
    const padX = Math.round(boxH * 0.3);
    const margin = Math.round(height * 0.012);
    this.layout = { width, height, boxH, font, padX, margin, boxW: textW + padX * 2 };
  }

  /** Vẽ một khung camera kèm ngày giờ hiện tại. */
  draw(source: CanvasImageSource, now: Date = new Date()): void {
    const L = this.layout;
    if (!L) throw new Error("Chưa đặt kích thước canvas");
    const ctx = this.ctx;
    ctx.drawImage(source, 0, 0, L.width, L.height);
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(L.margin, L.margin, L.boxW, L.boxH);
    ctx.font = L.font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(formatStamp(now), L.margin + L.padX, L.margin + L.boxH / 2 + 1);
  }
}
