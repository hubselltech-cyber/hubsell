// ============================================================
// GHÉP PDF: vận đơn sàn + phiếu nhặt hàng Hubsell → MỘT file in một lượt
//
// Thứ tự trang theo thứ tự đơn seller chọn; với mỗi đơn: trang vận đơn của
// sàn trước (dán kiện), phiếu nhặt hàng ngay sau (kho cầm). Kho in máy nhiệt
// A6 là ra đúng cặp cho từng kiện, không phải soạn lại.
//
// 19/11/2026 — CHÈN BẢNG SẢN PHẨM GỌN (services/label-overlay): vận đơn nào có `overlay`
// thì sau khi chép trang sang tệp ghép, bảng gọn được vẽ thẳng lên trang đó. Phông của
// bảng nhúng MỘT lần cho cả tệp ghép (nhúng riêng từng vận đơn tốn ~50 ms / tệp — đo
// 19/11). Lỗi vẽ không làm hỏng tệp: trang giữ nguyên phiếu sàn, đếm vào `overlay.missed`.
// ============================================================

import { PDFDocument } from "pdf-lib";
import { drawTableOnPage, embedOverlayFonts, planZone, type OverlayFonts, type OverlayPlan } from "../label-overlay";

export interface MergePart {
  /** PDF vận đơn chính chủ của sàn (có thể thiếu khi sàn chưa cấp). */
  label?: Buffer | Uint8Array | null;
  /** PDF phiếu nhặt hàng Hubsell (có thể tắt trong hộp thoại in). */
  pickList?: Uint8Array | null;
  /** Kế hoạch chèn bảng gọn lên vận đơn này (chủ shop bật mẫu cho sàn của đơn). */
  overlay?: OverlayPlan | null;
}

/** Ghép các phần theo thứ tự; bỏ qua phần hỏng nhưng ghi lại để báo. */
export async function mergePdfParts(
  parts: MergePart[]
): Promise<{ pdf: Buffer; pages: number; broken: number; overlay: { applied: number; missed: number } }> {
  const out = await PDFDocument.create();
  let broken = 0;
  const overlay = { applied: 0, missed: 0 };
  let fonts: OverlayFonts | null = null;

  const append = async (bytes: Buffer | Uint8Array, plan?: OverlayPlan | null) => {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch {
      broken += 1;
      if (plan) overlay.missed += 1;
      return;
    }
    try {
      // Tệp hỏng có khi vẫn "mở" được mà tới lúc đếm trang mới ném → mọi thao tác đọc trang
      // nằm trong try này.
      const zone = plan && src.getPageCount() > 0 ? planZone(plan, src.getPage(0).getSize()) : null;
      // Có vùng chèn + mẫu bật "mỗi đơn một tờ" → chỉ chép trang đầu (bỏ phần tràn của bảng sàn).
      const indices = plan && zone && plan.dropExtraPages ? [0] : src.getPageIndices();
      const copied = await out.copyPages(src, indices);
      for (const p of copied) out.addPage(p);
      if (!plan) return;
      if (!zone || copied.length === 0) {
        overlay.missed += 1;
        return;
      }
      try {
        fonts ??= await embedOverlayFonts(out);
        drawTableOnPage(copied[0], fonts, zone, plan.rows, plan.template);
        overlay.applied += 1;
      } catch (err) {
        // Trang đã chép vẫn là phiếu sàn hợp lệ — chỉ thiếu bảng gọn.
        overlay.missed += 1;
        console.error("[label-overlay] LỖI vẽ bảng sản phẩm lên tệp ghép:", err instanceof Error ? err.message : err);
      }
    } catch {
      broken += 1;
      if (plan) overlay.missed += 1;
    }
  };

  for (const part of parts) {
    if (part.label) await append(part.label, part.overlay);
    if (part.pickList) await append(part.pickList);
  }
  const bytes = await out.save();
  return { pdf: Buffer.from(bytes), pages: out.getPageCount(), broken, overlay };
}
