// ============================================================
// VẬN ĐƠN MẪU cho adapter giả lập (fake.ts) và cho test lớp chèn thông tin lên phiếu.
//
// KHÔNG phải vận đơn thật: bố cục chỉ BẮT CHƯỚC hai dạng phiếu hay gặp để có thứ soi
// giao diện và kiểm thuật toán — tem TikTok kèm bảng sản phẩm ở nửa dưới (bảng dài thì
// tràn sang trang 2), tem Shopee có ô "Nội dung hàng" ở giữa và dòng tiền thu ở đáy.
// Vị trí thật của từng khối trên phiếu thật phải đo bằng scripts/label-shape-probe.ts.
// ============================================================

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { ChannelName } from "@prisma/client";
import { A6_HEIGHT, A6_WIDTH, drawBarcode, loadFonts } from "./pick-list-pdf";

const INK = rgb(0, 0, 0);

export interface FakeLabelInput {
  platform: ChannelName;
  shopName: string;
  orderCode: string;
  trackingCode: string;
  carrierName: string;
  items: { name: string; variant: string | null; sku: string; quantity: number }[];
}

function box(page: PDFPage, x: number, y: number, w: number, h: number) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: INK, borderWidth: 0.8 });
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/** Số dòng sản phẩm vừa trang đầu của tem TikTok mẫu — dòng thứ 5 trở đi sang trang 2. */
export const FAKE_TIKTOK_ROWS_PAGE1 = 4;
/** Mép trên của bảng sản phẩm trên tem TikTok mẫu (pt, tính từ đáy trang). */
export const FAKE_TIKTOK_TABLE_TOP = 132;

export async function buildFakeLabelPdf(input: FakeLabelInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = loadFonts();
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const M = 8;
  const W = A6_WIDTH - M * 2;

  const page = doc.addPage([A6_WIDTH, A6_HEIGHT]);
  let y = A6_HEIGHT - M;

  // Đầu tem: sàn · hãng · dịch vụ
  const platformLabel = input.platform === "TIKTOK" ? "TikTok Shop" : input.platform === "SHOPEE" ? "Shopee" : "Lazada";
  page.drawText(platformLabel, { x: M + 2, y: y - 12, size: 11, font: bold });
  page.drawText(fit(input.carrierName, bold, 11, 110), { x: M + 96, y: y - 12, size: 11, font: bold });
  page.drawRectangle({ x: A6_WIDTH - M - 78, y: y - 16, width: 78, height: 15, color: INK });
  page.drawText("MẪU THỬ", { x: A6_WIDTH - M - 62, y: y - 12, size: 9, font: bold, color: rgb(1, 1, 1) });
  y -= 20;

  drawBarcode(page, input.trackingCode, M, y, W, 40);
  y -= 44;
  const tw = bold.widthOfTextAtSize(input.trackingCode, 15);
  page.drawText(input.trackingCode, { x: M + (W - tw) / 2, y: y - 13, size: 15, font: bold });
  y -= 20;

  // Khối người gửi / người nhận / mã phân tuyến
  const blockH = 118;
  box(page, M, y - blockH, W, blockH);
  page.drawLine({ start: { x: M + W * 0.62, y }, end: { x: M + W * 0.62, y: y - blockH }, thickness: 0.8 });
  page.drawText(`Người gửi: ${fit(input.shopName, regular, 7, 120)}`, { x: M + 4, y: y - 11, size: 7, font: regular });
  page.drawText("Người nhận", { x: M + 4, y: y - 26, size: 6, font: regular });
  page.drawText("n****m", { x: M + 44, y: y - 28, size: 11, font: bold });
  page.drawText("(+84)36*****94", { x: M + 44, y: y - 41, size: 7.5, font: regular });
  page.drawText("Số 6* ngõ 1*, P******* D** T**,", { x: M + 4, y: y - 58, size: 8.5, font: bold });
  page.drawText("N*** B***", { x: M + 4, y: y - 70, size: 8.5, font: bold });
  page.drawText(`Order ID: ${input.orderCode}`, { x: M + 4, y: y - 108, size: 6, font: regular });
  for (const [i, code] of ["420", "C226A02", "006"].entries()) {
    page.drawText(code, { x: M + W * 0.62 + 8, y: y - 20 - i * 22, size: 15, font: bold });
  }
  y -= blockH;

  if (input.platform === "TIKTOK") {
    // Bảng sản phẩm của sàn ở nửa dưới — dài thì tràn sang trang 2 ("in sang 2 tờ").
    const total = input.items.reduce((s, i) => s + i.quantity, 0);
    const rowH = 26;
    const drawRows = (p: PDFPage, top: number, rows: FakeLabelInput["items"], withHeader: boolean) => {
      let yy = top;
      if (withHeader) {
        box(p, M, yy - 14, W, 14);
        p.drawLine({ start: { x: M + 20, y: yy }, end: { x: M + 20, y: yy - 14 }, thickness: 0.8 });
        p.drawText(String(total), { x: M + 6, y: yy - 10, size: 7, font: regular });
        const head = `Tổng ${input.items.length} mặt hàng`;
        p.drawText(head, { x: M + 20 + (W - 20 - regular.widthOfTextAtSize(head, 7)) / 2, y: yy - 10, size: 7, font: regular });
        yy -= 14;
      }
      for (const it of rows) {
        box(p, M, yy - rowH, W, rowH);
        p.drawLine({ start: { x: M + 20, y: yy }, end: { x: M + 20, y: yy - rowH }, thickness: 0.8 });
        p.drawText(String(it.quantity), { x: M + 6, y: yy - 15, size: 9, font: bold });
        const variant = it.variant ?? "Default";
        p.drawText(fit(variant, bold, 6.5, W - 28), { x: M + 24, y: yy - 10, size: 6.5, font: bold });
        p.drawText(fit(it.name, regular, 6.5, W - 28), { x: M + 24, y: yy - 20, size: 6.5, font: regular });
        yy -= rowH;
      }
    };
    // Bảng luôn bắt đầu ở FAKE_TIKTOK_TABLE_TOP để test có mốc cố định.
    drawRows(page, FAKE_TIKTOK_TABLE_TOP, input.items.slice(0, FAKE_TIKTOK_ROWS_PAGE1), true);
    const rest = input.items.slice(FAKE_TIKTOK_ROWS_PAGE1);
    for (let i = 0; i < rest.length; i += 14) {
      const p2 = doc.addPage([A6_WIDTH, A6_HEIGHT]);
      drawRows(p2, A6_HEIGHT - M, rest.slice(i, i + 14), false);
    }
  } else {
    // Shopee / Lazada: ô "Nội dung hàng" ở giữa, dòng tiền thu + chữ ký ở đáy.
    const total = input.items.reduce((s, i) => s + i.quantity, 0);
    const contentH = 96;
    box(page, M, y - contentH, W, contentH);
    page.drawText(`Nội dung hàng (Tổng SL sản phẩm: ${total})`, { x: M + 4, y: y - 10, size: 7, font: bold });
    let yy = y - 21;
    for (const [i, it] of input.items.slice(0, 7).entries()) {
      const line = `${i + 1}. ${it.name}${it.variant ? `, ${it.variant}` : ""}, SL: ${it.quantity}`;
      page.drawText(fit(line, regular, 6.5, W - 10), { x: M + 4, y: yy, size: 6.5, font: regular });
      yy -= 10;
    }
    if (input.items.length > 7) {
      page.drawText(`… và ${input.items.length - 7} sản phẩm khác`, { x: M + 4, y: yy, size: 6.5, font: regular });
    }
    y -= contentH;
    box(page, M, M, W, y - M);
    page.drawText("Tiền thu Người nhận:", { x: M + 4, y: y - 14, size: 7.5, font: regular });
    page.drawText("0 VND", { x: M + 4, y: y - 32, size: 15, font: bold });
    page.drawText("Chữ ký người nhận", { x: M + W * 0.62, y: y - 14, size: 7, font: regular });
  }

  return doc.save();
}
