// ============================================================
// VẼ BẢNG SẢN PHẨM GỌN CỦA HUBSELL lên vùng chèn của vận đơn (19/11/2026)
//
// Phủ trắng đúng vùng bảng sản phẩm của sàn rồi vẽ: dòng nhắn của shop (nếu có) → dòng
// tổng → mỗi món một dòng "số lượng · SKU · phân loại · tên". Phần vận chuyển của sàn phía
// trên vùng chèn KHÔNG đụng tới. Bảng tự co cho vừa vùng: giảm cỡ chữ → chia hai cột → cuối
// cùng mới cắt bớt và ghi rõ còn bao nhiêu dòng chưa in.
// ============================================================

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { loadFonts } from "../fulfillment/pick-list-pdf";
import type { GoodsZone } from "./locate";
import { rowText, type LabelTemplate, type OverlayRow } from "./template";

const INK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const RULE = rgb(0.55, 0.55, 0.55);

/** Cỡ chữ thử lần lượt: một cột trước, không vừa mới sang hai cột. Dưới 5,5 pt máy nhiệt 203 dpi in nhòe. */
const SIZES_ONE_COL = [9, 8.5, 8, 7.5, 7, 6.5, 6];
const SIZES_TWO_COL = [7, 6.5, 6, 5.5];
const MIN_SIZE = 5.5;

export interface TableLayout {
  columns: 1 | 2;
  size: number;
  rowHeight: number;
  /** Số dòng in được; ít hơn tổng số dòng nghĩa là phải cắt. */
  fit: number;
}

/** Chọn cách xếp bảng cho vừa chiều cao `height` (pt) — thuần hàm để test. */
export function layoutTable(rowCount: number, height: number): TableLayout {
  const rowsAt = (size: number) => Math.floor(height / (size + 2.6));
  for (const size of SIZES_ONE_COL) {
    if (rowsAt(size) >= rowCount) return { columns: 1, size, rowHeight: size + 2.6, fit: rowCount };
  }
  for (const size of SIZES_TWO_COL) {
    if (rowsAt(size) * 2 >= rowCount) return { columns: 2, size, rowHeight: size + 2.6, fit: rowCount };
  }
  // Không vừa cả hai cột ở cỡ nhỏ nhất: in tối đa, chừa MỘT ô cuối cho câu "còn N dòng".
  const cap = Math.max(0, rowsAt(MIN_SIZE) * 2 - 1);
  return { columns: 2, size: MIN_SIZE, rowHeight: MIN_SIZE + 2.6, fit: Math.min(rowCount, cap) };
}

/** Bỏ ký tự phông Roboto không có (emoji, chữ Hán…) để không ra ô vuông trên tem. */
const charSets = new WeakMap<PDFFont, Set<number>>();

function printable(text: string, font: PDFFont): string {
  let has = charSets.get(font);
  if (!has) {
    has = new Set(font.getCharacterSet());
    charSets.set(font, has);
  }
  const known = has;
  return [...text.replace(/\s+/g, " ")]
    .filter((ch) => known.has(ch.codePointAt(0)!))
    .join("")
    .trim();
}

function truncate(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && font.widthOfTextAtSize(`${chars.join("")}…`, size) > maxWidth) chars.pop();
  return `${chars.join("")}…`;
}

function drawRow(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  row: OverlayRow,
  template: LabelTemplate,
  x: number,
  topY: number,
  width: number,
  layout: TableLayout
) {
  const { size, rowHeight } = layout;
  const baseline = topY - rowHeight + (rowHeight - size) / 2 + size * 0.22;
  // Ô số lượng: từ 2 trở lên in ĐẢO MÀU — người đóng hàng liếc là thấy đơn lấy nhiều hơn một.
  const qty = String(row.quantity);
  const qtyW = Math.max(size * 1.9, fonts.bold.widthOfTextAtSize(qty, size) + 5);
  if (row.quantity > 1) {
    page.drawRectangle({ x, y: topY - rowHeight + 0.8, width: qtyW, height: rowHeight - 1.6, color: INK });
  }
  page.drawText(qty, {
    x: x + (qtyW - fonts.bold.widthOfTextAtSize(qty, size)) / 2,
    y: baseline,
    size,
    font: fonts.bold,
    color: row.quantity > 1 ? WHITE : INK,
  });

  let cursor = x + qtyW + 4;
  const right = x + width;
  const parts = rowText(row, template);
  for (const [i, part] of parts.entries()) {
    const font = part.bold ? fonts.bold : fonts.regular;
    const sep = i > 0 ? " · " : "";
    if (sep) {
      const sw = fonts.regular.widthOfTextAtSize(sep, size);
      if (cursor + sw >= right) break;
      page.drawText(sep, { x: cursor, y: baseline, size, font: fonts.regular, color: INK });
      cursor += sw;
    }
    const text = truncate(printable(part.text, font), font, size, right - cursor);
    if (!text) break;
    page.drawText(text, { x: cursor, y: baseline, size, font, color: INK });
    cursor += font.widthOfTextAtSize(text, size);
    if (text.endsWith("…")) break;
  }
}

/**
 * Nhúng hai phông của bảng gọn vào MỘT tài liệu. Đo 19/11/2026: nhúng + cắt gọn phông tốn
 * ~50 ms mỗi tài liệu — nên route in nhúng MỘT lần vào tệp ghép rồi vẽ mọi bảng lên đó
 * (merge-pdf.ts), không nhúng riêng cho từng vận đơn.
 */
export async function embedOverlayFonts(doc: PDFDocument): Promise<OverlayFonts> {
  doc.registerFontkit(fontkit);
  const files = loadFonts();
  return {
    regular: await doc.embedFont(files.regular, { subset: true }),
    bold: await doc.embedFont(files.bold, { subset: true }),
  };
}

export interface OverlayFonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * Chèn bảng gọn vào vùng `zone` của TRANG ĐẦU một vận đơn. `dropExtraPages` = bỏ các trang
 * sau (phần tràn của bảng sản phẩm sàn). Trả tệp PDF mới; tệp vào không bị sửa. Dùng cho
 * phiếu lẻ (in lại, xem phiếu mẫu); in cả lượt thì vẽ lúc ghép tệp.
 */
export async function drawGoodsTable(
  pdf: Uint8Array,
  zone: GoodsZone,
  rows: OverlayRow[],
  template: LabelTemplate,
  dropExtraPages: boolean
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const fonts = await embedOverlayFonts(doc);
  drawTableOnPage(doc.getPage(0), fonts, zone, rows, template);
  if (dropExtraPages) {
    for (let i = doc.getPageCount() - 1; i >= 1; i--) doc.removePage(i);
  }
  return doc.save();
}

/** Vẽ bảng gọn lên một trang đã có sẵn (trang của tài liệu mang `fonts`). */
export function drawTableOnPage(
  page: PDFPage,
  fonts: OverlayFonts,
  zone: GoodsZone,
  rows: OverlayRow[],
  template: LabelTemplate
): void {
  const width = zone.right - zone.left;

  // Phủ trắng vùng bảng của sàn, viền mảnh để bảng mới trông là một khối của tem.
  page.drawRectangle({
    x: zone.left,
    y: zone.bottom,
    width,
    height: zone.top - zone.bottom,
    color: WHITE,
    borderColor: INK,
    borderWidth: 0.8,
  });

  const pad = 4;
  let y = zone.top - pad;
  const innerLeft = zone.left + pad;
  const innerW = width - pad * 2;

  // Dòng nhắn của shop — đậm, có nền viền riêng, luôn ở trên cùng.
  const note = printable(template.note, fonts.bold);
  if (note) {
    const size = 8;
    const h = size + 5;
    page.drawRectangle({ x: innerLeft, y: y - h, width: innerW, height: h, borderColor: INK, borderWidth: 0.6 });
    page.drawText(truncate(note, fonts.bold, size, innerW - 8), {
      x: innerLeft + 4,
      y: y - h + 3.6,
      size,
      font: fonts.bold,
      color: INK,
    });
    y -= h + 3;
  }

  // Dòng tổng: kho đếm số món trước khi dán tem.
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
  const head = `Tổng ${totalQty} sản phẩm · ${rows.length} dòng`;
  page.drawText(head, { x: innerLeft, y: y - 7, size: 7, font: fonts.bold, color: INK });
  y -= 10;
  page.drawLine({ start: { x: innerLeft, y }, end: { x: innerLeft + innerW, y }, thickness: 0.6, color: INK });
  y -= 1.5;

  const layout = layoutTable(rows.length, y - zone.bottom - pad);
  const gap = 8;
  const colW = layout.columns === 2 ? (innerW - gap) / 2 : innerW;
  const perCol = layout.columns === 2 ? Math.ceil((layout.fit + (layout.fit < rows.length ? 1 : 0)) / 2) : layout.fit;
  for (let i = 0; i < layout.fit; i++) {
    const col = layout.columns === 2 ? Math.floor(i / perCol) : 0;
    const rowIdx = layout.columns === 2 ? i % perCol : i;
    const x = innerLeft + col * (colW + gap);
    const top = y - rowIdx * layout.rowHeight;
    drawRow(page, fonts, rows[i], template, x, top, colW, layout);
    // Đường kẻ mảnh giữa các dòng — mắt không trượt dòng khi nhặt hàng.
    if (rowIdx > 0) {
      page.drawLine({ start: { x, y: top }, end: { x: x + colW, y: top }, thickness: 0.25, color: RULE });
    }
  }
  if (layout.fit < rows.length) {
    const i = layout.fit;
    const col = Math.floor(i / perCol);
    const rowIdx = i % perCol;
    const more = `+ ${rows.length - layout.fit} dòng nữa — xem phiếu xuất hàng`;
    page.drawText(truncate(more, fonts.bold, layout.size, colW), {
      x: innerLeft + col * (colW + gap),
      y: y - rowIdx * layout.rowHeight - layout.rowHeight + 2,
      size: layout.size,
      font: fonts.bold,
      color: INK,
    });
  }
  if (layout.columns === 2) {
    const mid = innerLeft + colW + gap / 2;
    page.drawLine({ start: { x: mid, y }, end: { x: mid, y: zone.bottom + pad }, thickness: 0.25, color: RULE });
  }
}
