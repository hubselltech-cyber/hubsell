/**
 * LẤY PHIẾU IN CHO MẺ LỚN (27/11/2026, docs/CHUAN-BI-HANG-THEO-ME.md mục 7)
 *
 * Web cho tích tới 300 đơn một lần. /api/orders/bulk/labels là MỘT request đồng bộ: máy chủ
 * gọi sàn rồi ghép PDF trong RAM — 300 đơn đo được +156 MB RAM, tệp ~57 MB, phía sàn 30 giây
 * tới 2 phút, đủ để request bị cắt giữa chừng. Nên mẻ > LABEL_CHUNK đơn được cắt thành các
 * phần ≤ LABEL_CHUNK, gọi NỐI TIẾP (không song song — không dồn sàn, RAM máy chủ không chồng),
 * rồi ghép lại ngay trên trình duyệt thành một tệp → người dùng vẫn chỉ thấy MỘT hộp in.
 *
 * Tổng lượt gọi sàn không đổi so với một request (máy chủ vốn đã cắt 50 đơn / lượt gọi sàn).
 * Mẻ ≤ LABEL_CHUNK đơn đi đúng đường cũ: một request, không tải pdf-lib.
 */

import { ApiError, LabelsEmptyError, fetchOrderLabelsPdf, type LabelSummary } from "@/lib/api";

/** Số đơn tối đa một request /bulk/labels từ web. */
export const LABEL_CHUNK = 100;

export function chunkIds(ids: string[], size = LABEL_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Cộng tóm tắt của các phần thành tóm tắt cả mẻ. */
export function mergeLabelSummaries(parts: LabelSummary[]): LabelSummary {
  const out: LabelSummary = { orders: 0, labels: 0, pages: 0, broken: 0, failed: [], failedIds: [] };
  for (const p of parts) {
    out.orders += p.orders ?? 0;
    out.labels += p.labels ?? 0;
    out.pages += p.pages ?? 0;
    out.broken += p.broken ?? 0;
    out.failed.push(...(p.failed ?? []));
    out.failedIds.push(...(p.failedIds ?? []));
  }
  return out;
}

/** Ghép các tệp PDF theo đúng thứ tự; pdf-lib chỉ tải khi thật sự cần ghép. */
async function mergePdfBlobs(blobs: Blob[]): Promise<{ blob: Blob; pages: number }> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const b of blobs) {
    const src = await PDFDocument.load(await b.arrayBuffer(), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  const bytes = await out.save();
  return { blob: new Blob([bytes as BlobPart], { type: "application/pdf" }), pages: out.getPageCount() };
}

/**
 * Như fetchOrderLabelsPdf nhưng nhận tới 300 đơn. `onProgress` báo số đơn đã lấy xong phiếu
 * sau mỗi phần (chỉ gọi khi mẻ bị cắt).
 *
 * Một phần mà KHÔNG đơn nào có phiếu (máy chủ trả 409) không làm hỏng cả mẻ: các đơn của phần
 * đó vào danh sách thiếu phiếu, các phần khác vẫn in. Lỗi khác (mạng, 5xx) dừng cả mẻ — chưa
 * mở hộp in, chưa đánh dấu gì, người dùng bấm In lại (vận đơn sàn đã dựng thì sàn trả lại ngay).
 */
export async function fetchOrderLabelsPdfChunked(
  orderIds: string[],
  opts: { labels: boolean; pickList: boolean },
  onProgress?: (p: { done: number; total: number }) => void
): Promise<{ blob: Blob; summary: LabelSummary | null }> {
  if (orderIds.length <= LABEL_CHUNK) return fetchOrderLabelsPdf(orderIds, opts);

  const total = orderIds.length;
  const blobs: Blob[] = [];
  const summaries: LabelSummary[] = [];
  let lastEmpty: LabelsEmptyError | null = null;
  let done = 0;
  onProgress?.({ done, total });
  for (const part of chunkIds(orderIds)) {
    try {
      const r = await fetchOrderLabelsPdf(part, opts);
      blobs.push(r.blob);
      // Thiếu header tóm tắt (proxy cắt header lạ): coi như cả phần có phiếu, số trang đếm lúc ghép.
      summaries.push(r.summary ?? { orders: part.length, labels: 0, pages: 0, broken: 0, failed: [], failedIds: [] });
    } catch (err) {
      if (!(err instanceof LabelsEmptyError)) throw err;
      lastEmpty = err;
      summaries.push({ orders: part.length, labels: 0, pages: 0, broken: 0, failed: err.failed, failedIds: part });
    }
    done += part.length;
    onProgress?.({ done, total });
  }
  if (blobs.length === 0) throw lastEmpty ?? new ApiError(409, "Không có phiếu nào để in");

  const summary = mergeLabelSummaries(summaries);
  if (blobs.length === 1) return { blob: blobs[0], summary };
  let merged: { blob: Blob; pages: number };
  try {
    merged = await mergePdfBlobs(blobs);
  } catch (err) {
    console.error("[print-labels] ghép tệp in lỗi:", err);
    throw new Error("Đã lấy được vận đơn nhưng không ghép được thành một tệp in — thử in ít đơn hơn (tối đa 100 đơn một lần)");
  }
  summary.pages = merged.pages;
  return { blob: merged.blob, summary };
}
