// ============================================================
// PHIẾU XUẤT HÀNG HUBSELL (phiếu nhặt hàng cho kho) — khổ A6, chuẩn chung mọi sàn (04/09/2026)
//
// Đây là tờ cho KHO: mã đơn có mã vạch để quét đóng gói/tra cứu, gian hàng,
// vận đơn, hãng, cờ hỏa tốc, và danh sách SKU cần nhặt. KHÔNG phải vận đơn —
// vận đơn dán ngoài kiện là PDF chính chủ của sàn (mã vạch + QR phân loại do
// sàn sinh, Hubsell không tự vẽ lại để tránh bưu cục từ chối kiện).
//
// Dùng pdf-lib + Roboto (có dấu tiếng Việt) để trộn được với PDF của sàn thành
// MỘT file in một lượt. Không dùng font chuẩn PDF (Helvetica) vì không có dấu.
// ============================================================

import fs from "fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { encodeCode128B, code128TotalModules } from "./code128";

/** A6 = 105 × 148 mm — cùng khổ vận đơn nhiệt của sàn để in liền một máy. */
export const A6_WIDTH = 297.64;
export const A6_HEIGHT = 419.53;
const MARGIN = 14;
const CONTENT_W = A6_WIDTH - MARGIN * 2;

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.4, 0.45, 0.55);
const LINE = rgb(0.8, 0.84, 0.89);
const EXPRESS = rgb(0.86, 0.15, 0.15);

export interface PickListItem {
  sku: string;
  name: string;
  quantity: number;
}

export interface PickListOrder {
  orderCode: string;
  channelLabel: string;
  shopName: string;
  trackingCode: string | null;
  carrierLabel: string;
  isExpress: boolean;
  createdAt: Date;
  items: PickListItem[];
  /** Ghi chú nội bộ in cuối phiếu (tuỳ chọn). */
  note?: string | null;
}

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

/** Đọc font một lần cho cả tiến trình (mỗi file ~170KB). */
function loadFonts(): { regular: Uint8Array; bold: Uint8Array } {
  if (fontCache) return fontCache;
  const regular = fs.readFileSync(
    require.resolve("@expo-google-fonts/roboto/400Regular/Roboto_400Regular.ttf")
  );
  const bold = fs.readFileSync(
    require.resolve("@expo-google-fonts/roboto/700Bold/Roboto_700Bold.ttf")
  );
  fontCache = { regular, bold };
  return fontCache;
}

/** Cắt chuỗi thành nhiều dòng vừa độ rộng (ngắt theo từ; từ quá dài thì ngắt ký tự). */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  const width = (s: string) => font.widthOfTextAtSize(s, size);
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (width(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (width(word) <= maxWidth) {
      current = word;
    } else {
      // từ đơn dài hơn cả dòng (mã SKU dài) → bẻ theo ký tự
      let chunk = "";
      for (const ch of word) {
        if (width(chunk + ch) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      current = chunk;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Giờ VN cố định — máy chủ Render chạy UTC, getHours() sẽ lệch 7 tiếng.
const VN_TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour12: false,
});

function fmtDateTime(d: Date): string {
  // vi-VN cho ra "14:35 30/07/2026"
  return VN_TIME.format(d);
}

/** Vẽ mã vạch Code 128 căn giữa theo chiều ngang; trả về chiều cao đã dùng. */
function drawBarcode(page: PDFPage, text: string, x: number, topY: number, maxWidth: number, height: number) {
  const bars = encodeCode128B(text);
  const modules = code128TotalModules(bars);
  // Mô-đun ≥ 0.9pt (~0.32mm) để máy quét cầm tay đọc chắc; hẹp hơn là mờ.
  const moduleW = Math.min(1.1, maxWidth / modules);
  const totalW = moduleW * modules;
  let cursor = x + (maxWidth - totalW) / 2;
  for (const b of bars) {
    const w = b.width * moduleW;
    if (b.dark) {
      page.drawRectangle({ x: cursor, y: topY - height, width: w, height, color: INK });
    }
    cursor += w;
  }
}

interface Ctx {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * Vẽ header cố định của phiếu; trả về y hiện tại sau header.
 * Nén gọn (anh Trung 04/09 sau khi test đơn thật): mã vạch thấp, thông tin
 * vận chuyển gói 2 dòng nhỏ — nhường chỗ cho bảng SKU khi đơn nhiều sản phẩm.
 */
function drawHeader(ctx: Ctx, page: PDFPage, order: PickListOrder, pageNo: number, pageCount: number): number {
  const { regular, bold } = ctx;
  let y = A6_HEIGHT - MARGIN;

  page.drawText("PHIẾU XUẤT HÀNG", { x: MARGIN, y: y - 7, size: 7, font: bold, color: MUTED });
  const right = pageCount > 1 ? `Hubsell · trang ${pageNo}/${pageCount}` : "Hubsell";
  page.drawText(right, {
    x: A6_WIDTH - MARGIN - regular.widthOfTextAtSize(right, 6.5),
    y: y - 7,
    size: 6.5,
    font: regular,
    color: MUTED,
  });
  y -= 13;

  const shop = `${order.channelLabel} · ${order.shopName}`;
  page.drawText(wrapText(shop, bold, 8.5, CONTENT_W)[0] ?? shop, {
    x: MARGIN,
    y: y - 8,
    size: 8.5,
    font: bold,
    color: INK,
  });
  y -= 13;

  // Mã đơn + mã vạch (trang đầu mới vẽ mã vạch; trang sau chỉ chữ)
  page.drawText(order.orderCode, { x: MARGIN, y: y - 12, size: 13, font: bold, color: INK });
  if (order.isExpress) {
    const tag = "HỎA TỐC";
    const tw = bold.widthOfTextAtSize(tag, 7.5);
    page.drawRectangle({
      x: A6_WIDTH - MARGIN - tw - 10,
      y: y - 13,
      width: tw + 10,
      height: 12,
      color: EXPRESS,
    });
    page.drawText(tag, {
      x: A6_WIDTH - MARGIN - tw - 5,
      y: y - 9.8,
      size: 7.5,
      font: bold,
      color: rgb(1, 1, 1),
    });
  }
  y -= 17;
  if (pageNo === 1) {
    drawBarcode(page, order.orderCode, MARGIN, y, CONTENT_W, 26);
    y -= 26 + 2;
    const codeW = regular.widthOfTextAtSize(order.orderCode, 6);
    page.drawText(order.orderCode, {
      x: MARGIN + (CONTENT_W - codeW) / 2,
      y: y - 5,
      size: 6,
      font: regular,
      color: MUTED,
    });
    y -= 10;
  }

  // Vận chuyển: 2 dòng nhỏ
  const meta = [
    `Vận đơn: ${order.trackingCode ?? "chưa có"} · ${order.carrierLabel}`,
    `Đặt: ${fmtDateTime(order.createdAt)}`,
  ];
  for (const line of meta) {
    page.drawText(wrapText(line, regular, 7, CONTENT_W)[0] ?? line, {
      x: MARGIN,
      y: y - 7,
      size: 7,
      font: regular,
      color: INK,
    });
    y -= 9;
  }
  y -= 3;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A6_WIDTH - MARGIN, y }, thickness: 0.8, color: INK });
  y -= 3;

  // Tiêu đề bảng
  page.drawText("SKU / SẢN PHẨM", { x: MARGIN, y: y - 6, size: 6, font: bold, color: MUTED });
  page.drawText("SL", {
    x: A6_WIDTH - MARGIN - bold.widthOfTextAtSize("SL", 6),
    y: y - 6,
    size: 6,
    font: bold,
    color: MUTED,
  });
  y -= 9;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A6_WIDTH - MARGIN, y }, thickness: 0.4, color: LINE });
  return y - 2;
}

const FOOTER_H = 40;
const PROMO = rgb(0.8, 0.12, 0.12);

/**
 * Chân phiếu: dòng tổng, LỜI MỜI REFERRAL màu đỏ (anh Trung 04/09 — tận dụng
 * tờ phiếu kho: người đọc là chủ shop/nhân viên, nói thẳng với họ "giới thiệu
 * cho shop bạn", chương trình Kiếm Tiền Cùng Hubsell 10% vĩnh viễn), rồi dòng
 * lưu ý xám. Lời mời chỉ in ở trang cuối của đơn để không lặp.
 */
function drawFooter(ctx: Ctx, page: PDFPage, order: PickListOrder, isLast: boolean) {
  const { regular, bold } = ctx;
  let y = MARGIN + FOOTER_H;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A6_WIDTH - MARGIN, y }, thickness: 0.8, color: INK });
  if (isLast) {
    const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
    const total = `Tổng ${totalQty} món · ${order.items.length} dòng`;
    page.drawText(total, { x: MARGIN, y: y - 10, size: 8, font: bold, color: INK });
    if (order.note) {
      const note = wrapText(`Ghi chú: ${order.note}`, regular, 6.5, CONTENT_W - 110)[0];
      page.drawText(note, { x: MARGIN + 110, y: y - 10, size: 6.5, font: regular, color: INK });
    }
    // Lời mời referral — 2 dòng đỏ, dòng đầu đậm
    // Câu chữ anh Trung chốt 04/09: dòng đậm ngắn gọn, ai quan tâm đọc dòng dưới
    const promo1 = 'NHẬN NGAY 10% HOA HỒNG "VĨNH VIỄN"';
    const promo2 = "Giới thiệu Hubsell cho shop bạn · Chi tiết tại mục Kiếm Tiền Cùng Hubsell.";
    page.drawText(wrapText(promo1, bold, 7.5, CONTENT_W)[0] ?? promo1, {
      x: MARGIN,
      y: MARGIN + 17,
      size: 7.5,
      font: bold,
      color: PROMO,
    });
    page.drawText(wrapText(promo2, regular, 6.3, CONTENT_W)[0] ?? promo2, {
      x: MARGIN,
      y: MARGIN + 9,
      size: 6.3,
      font: regular,
      color: PROMO,
    });
  } else {
    page.drawText("(tiếp trang sau)", { x: MARGIN, y: y - 10, size: 7, font: regular, color: MUTED });
  }
  y = MARGIN;
  page.drawText("Phiếu nội bộ cho kho — không phải vận đơn. Dán vận đơn của sàn ngoài kiện.", {
    x: MARGIN,
    y,
    size: 5.5,
    font: regular,
    color: MUTED,
  });
}

/**
 * Dựng PDF phiếu xuất hàng cho MỘT đơn (thường 1 trang A6; đơn nhiều SKU tự
 * sang trang, header ghi "trang x/y"). Trả về bytes PDF để merge-pdf ghép sau
 * vận đơn của sàn.
 */
export async function buildPickListPdf(order: PickListOrder): Promise<Uint8Array> {
  const fonts = loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const ctx: Ctx = { doc, regular, bold };

  const ROW_SIZE = 7.5;
  const LINE_H = 9;
  const qtyColW = 26;
  const nameW = CONTENT_W - qtyColW - 4;

  // Mỗi item = 1 dòng SKU (đậm, cùng hàng với SL) + tối đa 2 dòng tên
  const rows = order.items.map((it) => {
    const nameLines = wrapText(it.name || "(không tên)", regular, ROW_SIZE, CONTENT_W).slice(0, 2);
    const skuLine = wrapText(it.sku || "—", bold, ROW_SIZE, nameW)[0] ?? "—";
    return { skuLine, nameLines, qty: it.quantity, height: LINE_H * (1 + nameLines.length) + 3 };
  });

  // Phân trang trước để header in "trang x/y"
  const pages: (typeof rows)[] = [];
  {
    // Chiều cao khả dụng của trang đầu (có mã vạch) — trang sau rộng hơn chút,
    // dùng số trang đầu cho cả hai để đơn giản và an toàn.
    const probe = doc.addPage([A6_WIDTH, A6_HEIGHT]);
    const startY = drawHeader(ctx, probe, order, 1, 1);
    doc.removePage(doc.getPageCount() - 1);
    const avail = startY - (MARGIN + FOOTER_H + 4);
    let cur: typeof rows = [];
    let used = 0;
    for (const r of rows) {
      if (used + r.height > avail && cur.length > 0) {
        pages.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(r);
      used += r.height;
    }
    pages.push(cur);
  }

  pages.forEach((pageRows, idx) => {
    const page = doc.addPage([A6_WIDTH, A6_HEIGHT]);
    let y = drawHeader(ctx, page, order, idx + 1, pages.length);
    for (const r of pageRows) {
      page.drawText(r.skuLine, { x: MARGIN, y: y - ROW_SIZE, size: ROW_SIZE, font: bold, color: INK });
      const qty = `×${r.qty}`;
      page.drawText(qty, {
        x: A6_WIDTH - MARGIN - bold.widthOfTextAtSize(qty, 9.5),
        y: y - ROW_SIZE - 1,
        size: 9.5,
        font: bold,
        color: INK,
      });
      y -= LINE_H;
      for (const line of r.nameLines) {
        page.drawText(line, { x: MARGIN, y: y - ROW_SIZE, size: ROW_SIZE, font: regular, color: INK });
        y -= LINE_H;
      }
      y -= 3;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: A6_WIDTH - MARGIN, y }, thickness: 0.3, color: LINE });
    }
    if (pageRows.length === 0) {
      page.drawText("(đơn không có chi tiết dòng hàng)", {
        x: MARGIN,
        y: y - ROW_SIZE,
        size: ROW_SIZE,
        font: regular,
        color: MUTED,
      });
    }
    drawFooter(ctx, page, order, idx === pages.length - 1);
  });

  return doc.save();
}
