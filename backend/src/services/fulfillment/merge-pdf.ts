// ============================================================
// GHÉP PDF: vận đơn sàn + phiếu nhặt hàng Hubsell → MỘT file in một lượt
//
// Thứ tự trang theo thứ tự đơn seller chọn; với mỗi đơn: trang vận đơn của
// sàn trước (dán kiện), phiếu nhặt hàng ngay sau (kho cầm). Kho in máy nhiệt
// A6 là ra đúng cặp cho từng kiện, không phải soạn lại.
// ============================================================

import { PDFDocument } from "pdf-lib";

export interface MergePart {
  /** PDF vận đơn chính chủ của sàn (có thể thiếu khi sàn chưa cấp). */
  label?: Buffer | Uint8Array | null;
  /** PDF phiếu nhặt hàng Hubsell (có thể tắt trong hộp thoại in). */
  pickList?: Uint8Array | null;
}

/** Ghép các phần theo thứ tự; bỏ qua phần hỏng nhưng ghi lại để báo. */
export async function mergePdfParts(
  parts: MergePart[]
): Promise<{ pdf: Buffer; pages: number; broken: number }> {
  const out = await PDFDocument.create();
  let broken = 0;
  const append = async (bytes: Buffer | Uint8Array) => {
    try {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copied = await out.copyPages(src, src.getPageIndices());
      for (const p of copied) out.addPage(p);
    } catch {
      broken += 1;
    }
  };
  for (const part of parts) {
    if (part.label) await append(part.label);
    if (part.pickList) await append(part.pickList);
  }
  const bytes = await out.save();
  return { pdf: Buffer.from(bytes), pages: out.getPageCount(), broken };
}
