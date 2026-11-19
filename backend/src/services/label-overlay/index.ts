// ============================================================
// CHÈN THÔNG TIN LÊN VẬN ĐƠN — cửa vào cho route in (19/11/2026,
// docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md mục 5)
//
// Ba nguyên tắc:
//   1. Không bao giờ làm hỏng lượt in: mọi lỗi ở đây → đơn đó ra đúng tệp gốc của sàn.
//   2. Không che mò: chưa biết vùng bảng sản phẩm nằm đâu thì để nguyên, đếm vào `missed`
//      để giao diện nói rõ.
//   3. Không ăn bộ nhớ tiến trình web (Render 512 MB, từng OOM 03/11/2026):
//      - bảng được VẼ LÚC GHÉP TỆP (fulfillment/merge-pdf.ts) lên tài liệu ghép, phông nhúng
//        một lần — không dựng lại từng vận đơn;
//      - vùng chèn mặc định lấy từ SỐ ĐÃ LƯU trong mẫu (`manualZoneMm`). Tự dò bằng cách đọc
//        lớp chữ từng tệp (pdf.js, ~+115 MB) chỉ bật khi LABEL_OVERLAY_AUTODETECT=1 — mặc
//        định BẬT ngoài production (máy dev, test), TẮT ở production cho tới khi việc dò
//        được chuyển sang tiến trình worker.
//
// Hai đường dùng:
//   planOverlay   → route in cả lượt: trả "kế hoạch chèn" cho từng đơn, merge-pdf vẽ.
//   overlayLabels → phiếu lẻ (in lại từ kho, xem phiếu mẫu): trả luôn tệp đã chèn.
// ============================================================

import type { ChannelName } from "@prisma/client";
import { lineDisplay } from "../../lib/order-line-display";
import { drawGoodsTable } from "./draw";
import { locateGoodsZone, manualZone, type GoodsZone } from "./locate";
import { overlaySupported, type LabelTemplate, type OverlayRow } from "./template";

export * from "./template";
export { locateGoodsZone, manualZone, readFirstPage, closeLabelReader, type GoodsZone, type PageShape } from "./locate";
export { drawGoodsTable, drawTableOnPage, embedOverlayFonts, layoutTable, type OverlayFonts } from "./draw";

export interface OverlayItem {
  productName: string;
  channelSku: string | null;
  variantName?: string | null;
  externalId?: string | null;
  quantity: number;
}

/** Dòng đơn → dòng bảng gọn: tên / phân loại / mã NGƯỜI BÁN (mã máy của sàn không in ra). */
export function toOverlayRows(items: OverlayItem[]): OverlayRow[] {
  return items.map((it) => {
    const d = lineDisplay(it);
    return { sku: d.sellerSku, variant: d.variantName, name: d.baseName, quantity: it.quantity };
  });
}

/** Có tự dò vùng bằng cách đọc lớp chữ của tệp không (xem nguyên tắc 3 ở đầu tệp). */
export function autoDetectEnabled(): boolean {
  const raw = process.env.LABEL_OVERLAY_AUTODETECT;
  if (raw === "1") return true;
  if (raw === "0") return false;
  return process.env.NODE_ENV !== "production";
}

/** Kế hoạch chèn cho MỘT vận đơn — merge-pdf.ts dùng để vẽ lên trang đã chép sang tệp ghép. */
export interface OverlayPlan {
  rows: OverlayRow[];
  template: LabelTemplate;
  /** Vùng đã dò được từ lớp chữ; null = dùng `template.manualZoneMm` theo cỡ trang thật. */
  zone: GoodsZone | null;
  /**
   * Bỏ các trang sau trang đầu (phần tràn của bảng sản phẩm sàn). Chỉ đúng với loại tệp
   * "tem + bảng sản phẩm" một kiện một tệp — hiện là TikTok.
   */
  dropExtraPages: boolean;
}

/** Vùng chèn cuối cùng của một kế hoạch trên trang cỡ `page`; null = không chèn được. */
export function planZone(plan: OverlayPlan, page: { width: number; height: number }): GoodsZone | null {
  if (plan.zone) return plan.zone;
  return plan.template.manualZoneMm !== null ? manualZone(plan.template.manualZoneMm, page) : null;
}

/**
 * Lập kế hoạch chèn cho các vận đơn của MỘT sàn. Trả map rỗng khi mẫu tắt / sàn chưa hỗ
 * trợ. Đơn không có dòng hàng không có kế hoạch (in nguyên phiếu sàn). Không ném.
 */
export async function planOverlay(input: {
  platform: ChannelName;
  template: LabelTemplate | undefined;
  pdfs: Map<string, Buffer>;
  itemsByOrder: Map<string, OverlayItem[]>;
}): Promise<Map<string, OverlayPlan>> {
  const plans = new Map<string, OverlayPlan>();
  const t = input.template;
  if (!t?.enabled || !overlaySupported(input.platform)) return plans;
  const detect = autoDetectEnabled();
  for (const [orderId, pdf] of input.pdfs) {
    const items = input.itemsByOrder.get(orderId) ?? [];
    if (items.length === 0) continue;
    let zone: GoodsZone | null = null;
    if (detect) {
      try {
        zone = (await locateGoodsZone(input.platform, pdf)).zone;
      } catch {
        zone = null;
      }
    }
    plans.set(orderId, { rows: toOverlayRows(items), template: t, zone, dropExtraPages: t.onePage });
  }
  return plans;
}

export interface OverlayResult {
  /** Tệp để IN theo id đơn — đã chèn, hoặc đúng tệp gốc khi không chèn được. */
  pdfs: Map<string, Buffer>;
  applied: number;
  /** Đơn bật mẫu nhưng không chèn được (chưa có vùng / tệp lỗi) — in nguyên phiếu sàn. */
  missed: number;
}

/** Chèn bảng gọn cho từng tệp lẻ (in lại từ kho, xem phiếu mẫu). Không ném. */
export async function overlayLabels(input: {
  platform: ChannelName;
  template: LabelTemplate | undefined;
  pdfs: Map<string, Buffer>;
  itemsByOrder: Map<string, OverlayItem[]>;
}): Promise<OverlayResult> {
  const out: OverlayResult = { pdfs: new Map(input.pdfs), applied: 0, missed: 0 };
  const t = input.template;
  if (!t?.enabled || !overlaySupported(input.platform)) return out;
  const plans = await planOverlay(input);
  for (const [orderId, pdf] of input.pdfs) {
    const plan = plans.get(orderId);
    if (!plan) {
      out.missed += 1;
      continue;
    }
    try {
      // Vùng tự đặt cần cỡ trang thật — đọc bằng pdf-lib (nhẹ), không cần lớp chữ.
      let zone = plan.zone;
      if (!zone && t.manualZoneMm !== null) {
        const { PDFDocument } = await import("pdf-lib");
        const size = (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPage(0).getSize();
        zone = manualZone(t.manualZoneMm, size);
      }
      if (!zone) {
        out.missed += 1;
        continue;
      }
      const done = await drawGoodsTable(pdf, zone, plan.rows, t, plan.dropExtraPages);
      out.pdfs.set(orderId, Buffer.from(done));
      out.applied += 1;
    } catch (err) {
      out.missed += 1;
      console.error(
        `[label-overlay] LỖI chèn bảng sản phẩm đơn ${orderId} (${input.platform}) — in nguyên phiếu sàn:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return out;
}
