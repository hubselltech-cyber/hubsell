// ============================================================
// BIÊN BẢN BÀN GIAO ĐƠN HÀNG (01/11/2026) — khổ A4 dọc, một hãng vận chuyển
// một biên bản, mỗi dòng một kiện: STT · mã vạch Code 128 (mã vận đơn) · mã
// đơn + gian · người nhận · ô ký/ghi chú. Trang cuối có chỗ ký Bên giao / Bên
// nhận. Dùng cùng font Roboto + bộ vẽ mã vạch với phiếu xuất hàng để shipper /
// bưu cục quét đối chiếu được bằng máy cầm tay.
//
// Nhiều biên bản (nhiều hãng) ghép vào MỘT PDF, mỗi biên bản bắt đầu trang mới
// — seller bấm in một lần, xé tờ đưa từng shipper.
// ============================================================

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";
import { drawBarcode, loadFonts } from "./pick-list-pdf";

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 32;
const CONTENT_W = A4_W - MARGIN * 2;

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.4, 0.45, 0.55);
const LINE = rgb(0.8, 0.84, 0.89);
const EXPRESS = rgb(0.86, 0.15, 0.15);

export interface HandoverSheetLine {
  orderCode: string;
  trackingCode: string | null;
  channelName: string;
  shopName: string;
  customerName: string;
  customerPhone?: string | null;
  isExpress?: boolean;
}

export interface HandoverSheetDoc {
  code: string;
  carrierLabel: string;
  createdAt: Date;
  /** Tên shop / chủ shop in ở "Bên giao". */
  senderName: string;
  /** Người lập biên bản (nhân viên bấm nút). */
  createdByName?: string | null;
  lines: HandoverSheetLine[];
}

const CHANNEL_SHORT: Record<string, string> = {
  SHOPEE: "Shopee",
  TIKTOK: "TikTok",
  LAZADA: "Lazada",
  OFFLINE: "Offline",
};

// Cột (tổng = CONTENT_W ≈ 531): STT 26 · Vận đơn 150 · Đơn/gian 135 · Người nhận 120 · Ký nhận còn lại
const COL = { stt: 26, tracking: 150, order: 135, customer: 120 };
const COL_SIGN = CONTENT_W - COL.stt - COL.tracking - COL.order - COL.customer;
const ROW_H = 36;
const HEAD_H = 16;

const VN_TIME = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour12: false,
});

function fit(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
  let out = t;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth)
    out = out.slice(0, -1);
  return `${out}…`;
}

interface Ctx {
  regular: PDFFont;
  bold: PDFFont;
}

/** Đầu trang: tiêu đề, số biên bản, hãng, bên giao, ngày. Trả y bắt đầu bảng. */
function drawSheetHeader(
  ctx: Ctx,
  page: PDFPage,
  sheet: HandoverSheetDoc,
  pageNo: number,
  pageCount: number,
): number {
  const { regular, bold } = ctx;
  let y = A4_H - MARGIN;

  const title = "BIÊN BẢN BÀN GIAO ĐƠN HÀNG";
  page.drawText(title, {
    x: MARGIN,
    y: y - 14,
    size: 15,
    font: bold,
    color: INK,
  });
  const right =
    `Số: ${sheet.code}` +
    (pageCount > 1 ? ` · trang ${pageNo}/${pageCount}` : "");
  page.drawText(right, {
    x: A4_W - MARGIN - bold.widthOfTextAtSize(right, 9),
    y: y - 12,
    size: 9,
    font: bold,
    color: INK,
  });
  y -= 24;

  const meta: Array<[string, string]> = [
    ["Đơn vị vận chuyển", sheet.carrierLabel],
    ["Bên giao (shop)", sheet.senderName],
    [
      "Lập lúc",
      VN_TIME.format(sheet.createdAt) +
        (sheet.createdByName ? ` · người lập: ${sheet.createdByName}` : ""),
    ],
    ["Số kiện bàn giao", `${sheet.lines.length}`],
  ];
  for (const [k, v] of meta) {
    page.drawText(`${k}:`, {
      x: MARGIN,
      y: y - 9,
      size: 8.5,
      font: regular,
      color: MUTED,
    });
    page.drawText(fit(v, bold, 8.5, CONTENT_W - 110), {
      x: MARGIN + 110,
      y: y - 9,
      size: 8.5,
      font: bold,
      color: INK,
    });
    y -= 12;
  }
  y -= 4;

  // Tiêu đề bảng
  page.drawRectangle({
    x: MARGIN,
    y: y - HEAD_H,
    width: CONTENT_W,
    height: HEAD_H,
    color: rgb(0.95, 0.96, 0.98),
  });
  const heads: Array<[string, number, number]> = [
    ["STT", MARGIN, COL.stt],
    ["Mã vận đơn", MARGIN + COL.stt, COL.tracking],
    ["Mã đơn · Gian hàng", MARGIN + COL.stt + COL.tracking, COL.order],
    ["Người nhận", MARGIN + COL.stt + COL.tracking + COL.order, COL.customer],
    [
      "Ký nhận / Ghi chú",
      MARGIN + COL.stt + COL.tracking + COL.order + COL.customer,
      COL_SIGN,
    ],
  ];
  for (const [label, x] of heads) {
    page.drawText(label, {
      x: x + 4,
      y: y - 11,
      size: 7.5,
      font: bold,
      color: MUTED,
    });
  }
  y -= HEAD_H;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_W - MARGIN, y },
    thickness: 0.8,
    color: INK,
  });
  return y;
}

function drawRow(
  ctx: Ctx,
  page: PDFPage,
  line: HandoverSheetLine,
  idx: number,
  top: number,
) {
  const { regular, bold } = ctx;
  const bottom = top - ROW_H;
  let x = MARGIN;

  page.drawText(String(idx), {
    x: x + 4,
    y: top - 14,
    size: 8.5,
    font: regular,
    color: INK,
  });
  x += COL.stt;

  // Mã vạch + chữ mã vận đơn (thiếu vận đơn → mã đơn, để bưu cục vẫn quét được gì đó)
  const code = line.trackingCode || line.orderCode;
  drawBarcode(page, code, x + 4, top - 3, COL.tracking - 8, 20);
  page.drawText(fit(code, regular, 7, COL.tracking - 8), {
    x:
      x +
      4 +
      (COL.tracking -
        8 -
        regular.widthOfTextAtSize(fit(code, regular, 7, COL.tracking - 8), 7)) /
        2,
    y: bottom + 4,
    size: 7,
    font: regular,
    color: INK,
  });
  if (!line.trackingCode) {
    page.drawText("(mã đơn — chưa có vận đơn)", {
      x: x + 4,
      y: top - 10,
      size: 5.5,
      font: regular,
      color: EXPRESS,
    });
  }
  x += COL.tracking;

  page.drawText(fit(line.orderCode, bold, 8, COL.order - 8), {
    x: x + 4,
    y: top - 13,
    size: 8,
    font: bold,
    color: INK,
  });
  const shop = `${CHANNEL_SHORT[line.channelName] ?? line.channelName} · ${line.shopName}`;
  page.drawText(fit(shop, regular, 7, COL.order - 8), {
    x: x + 4,
    y: top - 24,
    size: 7,
    font: regular,
    color: MUTED,
  });
  if (line.isExpress) {
    const tag = "HỎA TỐC";
    const tw = bold.widthOfTextAtSize(tag, 6);
    page.drawRectangle({
      x: x + COL.order - tw - 10,
      y: top - 14,
      width: tw + 6,
      height: 9,
      color: EXPRESS,
    });
    page.drawText(tag, {
      x: x + COL.order - tw - 7,
      y: top - 11.5,
      size: 6,
      font: bold,
      color: rgb(1, 1, 1),
    });
  }
  x += COL.order;

  page.drawText(fit(line.customerName || "—", regular, 8, COL.customer - 8), {
    x: x + 4,
    y: top - 13,
    size: 8,
    font: regular,
    color: INK,
  });
  if (line.customerPhone) {
    // Che 3 số giữa: tờ giấy này đi theo shipper, không cần lộ trọn số khách.
    const masked = line.customerPhone.replace(
      /^(\d{3})\d{3,4}(\d{3})$/,
      "$1***$2",
    );
    page.drawText(masked, {
      x: x + 4,
      y: top - 24,
      size: 7,
      font: regular,
      color: MUTED,
    });
  }

  page.drawLine({
    start: { x: MARGIN, y: bottom },
    end: { x: A4_W - MARGIN, y: bottom },
    thickness: 0.4,
    color: LINE,
  });
}

const SIGN_H = 86;

function drawSignatures(
  ctx: Ctx,
  page: PDFPage,
  sheet: HandoverSheetDoc,
  y: number,
) {
  const { regular, bold } = ctx;
  page.drawText(`Tổng cộng: ${sheet.lines.length} kiện`, {
    x: MARGIN,
    y: y - 12,
    size: 9,
    font: bold,
    color: INK,
  });
  const half = CONTENT_W / 2;
  const blocks: Array<[string, string, number]> = [
    ["BÊN GIAO (shop)", sheet.senderName, MARGIN],
    ["BÊN NHẬN (nhân viên giao nhận)", sheet.carrierLabel, MARGIN + half],
  ];
  for (const [title, sub, x] of blocks) {
    const cx = x + half / 2;
    page.drawText(title, {
      x: cx - bold.widthOfTextAtSize(title, 8.5) / 2,
      y: y - 30,
      size: 8.5,
      font: bold,
      color: INK,
    });
    const s = fit(sub, regular, 7.5, half - 20);
    page.drawText(s, {
      x: cx - regular.widthOfTextAtSize(s, 7.5) / 2,
      y: y - 41,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
    const hint = "(Ký, ghi rõ họ tên)";
    page.drawText(hint, {
      x: cx - regular.widthOfTextAtSize(hint, 7) / 2,
      y: y - 51,
      size: 7,
      font: regular,
      color: MUTED,
    });
  }
  page.drawText("Lập bằng Hubsell — hubsell.vn", {
    x: MARGIN,
    y: MARGIN - 10,
    size: 6.5,
    font: regular,
    color: MUTED,
  });
}

/**
 * Dựng MỘT PDF gồm các biên bản nối tiếp nhau (mỗi biên bản bắt đầu trang mới).
 */
export async function buildHandoverSheetsPdf(
  sheets: HandoverSheetDoc[],
): Promise<Uint8Array> {
  const fonts = loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const ctx: Ctx = { regular, bold };

  for (const sheet of sheets) {
    // Phân trang trước để header in "trang x/y": trang nào cũng cùng header,
    // trang cuối chừa chỗ ký.
    const probe = doc.addPage([A4_W, A4_H]);
    const tableTop = drawSheetHeader(ctx, probe, sheet, 1, 1);
    doc.removePage(doc.getPageCount() - 1);
    const availPlain = tableTop - MARGIN - 8;
    const rowsPerPage = Math.max(1, Math.floor(availPlain / ROW_H));
    const rowsLastPage = Math.max(1, Math.floor((availPlain - SIGN_H) / ROW_H));

    const pages: HandoverSheetLine[][] = [];
    let rest = sheet.lines.slice();
    if (rest.length === 0) pages.push([]);
    while (rest.length > 0) {
      // Nếu phần còn lại vừa trang cuối (có chỗ ký) thì kết thúc; không thì cắt trang thường
      if (rest.length <= rowsLastPage) {
        pages.push(rest);
        rest = [];
      } else {
        pages.push(rest.slice(0, rowsPerPage));
        rest = rest.slice(rowsPerPage);
        if (rest.length > 0 && rest.length <= rowsLastPage) {
          pages.push(rest);
          rest = [];
        }
      }
    }

    let idx = 0;
    pages.forEach((rows, pi) => {
      const page = doc.addPage([A4_W, A4_H]);
      let y = drawSheetHeader(ctx, page, sheet, pi + 1, pages.length);
      for (const line of rows) {
        idx += 1;
        drawRow(ctx, page, line, idx, y);
        y -= ROW_H;
      }
      if (pi === pages.length - 1) {
        drawSignatures(ctx, page, sheet, y - 6);
      } else {
        page.drawText("(tiếp trang sau)", {
          x: MARGIN,
          y: y - 12,
          size: 7.5,
          font: regular,
          color: MUTED,
        });
      }
    });
  }

  return doc.save();
}
