// ============================================================
// TEM VỊ TRÍ CHỨA HÀNG (đợt 2, 24/09/2026) — A4 lưới 3 × 7 tem, mỗi tem: tên vị trí
// (đậm, to) + mã vạch Code 128 theo MÃ vị trí (nếu có) để dán kệ / cửa kho, sau
// này quét khi nhập / nhặt / kiểm kê. Dùng chung font + vẽ vạch với phiếu nhặt.
// ============================================================
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { drawBarcode, loadFonts } from "./pick-list-pdf";

const A4_W = 595.28;
const A4_H = 841.89;
const COLS = 3;
const ROWS = 7;
const MARGIN_X = 24;
const MARGIN_Y = 28;
const GAP = 8;
const LABEL_W = (A4_W - MARGIN_X * 2 - GAP * (COLS - 1)) / COLS;
const LABEL_H = (A4_H - MARGIN_Y * 2 - GAP * (ROWS - 1)) / ROWS;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.45, 0.5, 0.58);
const BORDER = rgb(0.82, 0.85, 0.9);

export interface LocationLabel {
  name: string;
  code: string | null;
}

/** Code 128 B chỉ mã hoá ASCII in được — mã có ký tự lạ thì tem không vẽ vạch. */
function barcodeable(code: string | null): code is string {
  return Boolean(code) && /^[\x20-\x7e]+$/.test(code as string);
}

export async function buildLocationLabelsPdf(labels: LocationLabel[]): Promise<Uint8Array> {
  const fonts = loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });

  const perPage = COLS * ROWS;
  for (let start = 0; start < labels.length; start += perPage) {
    const page = doc.addPage([A4_W, A4_H]);
    labels.slice(start, start + perPage).forEach((label, idx) => {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      const x = MARGIN_X + col * (LABEL_W + GAP);
      const top = A4_H - MARGIN_Y - row * (LABEL_H + GAP);
      page.drawRectangle({
        x,
        y: top - LABEL_H,
        width: LABEL_W,
        height: LABEL_H,
        borderColor: BORDER,
        borderWidth: 0.6,
      });
      // Tên: co cỡ chữ cho vừa một dòng (tên kệ ngắn thì to, tên dài thì nhỏ dần)
      let size = 16;
      while (size > 8 && bold.widthOfTextAtSize(label.name, size) > LABEL_W - 16) size -= 1;
      const nameW = bold.widthOfTextAtSize(label.name, size);
      page.drawText(label.name, {
        x: x + (LABEL_W - nameW) / 2,
        y: top - 10 - size,
        size,
        font: bold,
        color: INK,
      });
      if (barcodeable(label.code)) {
        const barTop = top - 14 - size - 6;
        drawBarcode(page, label.code, x + 12, barTop, LABEL_W - 24, 34);
        const codeW = regular.widthOfTextAtSize(label.code, 8);
        page.drawText(label.code, {
          x: x + (LABEL_W - codeW) / 2,
          y: barTop - 34 - 11,
          size: 8,
          font: regular,
          color: MUTED,
        });
      } else {
        const hint = "(chưa có mã — đặt mã để in mã vạch)";
        const hw = regular.widthOfTextAtSize(hint, 7);
        page.drawText(hint, {
          x: x + (LABEL_W - hw) / 2,
          y: top - LABEL_H / 2 - 4,
          size: 7,
          font: regular,
          color: MUTED,
        });
      }
    });
  }
  return doc.save();
}
