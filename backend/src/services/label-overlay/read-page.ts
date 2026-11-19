// ============================================================
// ĐỌC LỚP CHỮ TRANG ĐẦU CỦA VẬN ĐƠN bằng pdf.js (gói unpdf, không cần canvas).
//
// ⚠ NẶNG BỘ NHỚ: đo 19/11/2026 trên máy dev — nạp thư viện + đọc 1 tệp làm tiến trình tăng
// ~115 MB RSS, đọc 50 tệp tăng ~245 MB và KHÔNG tự trả lại. Tiến trình web Render từng OOM
// (03/11/2026), nên hàm này KHÔNG được gọi thẳng trong tiến trình web: locate.ts chạy nó
// trong một luồng phụ có trần bộ nhớ và tắt luồng khi rảnh (locate-worker.ts). Chỉ test đo
// đạc mới gọi thẳng.
// ============================================================

import { groupLines, type PageShape, type TextLine } from "./lines";

type PdfjsDoc = {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(o: { scale: number }): { width: number; height: number };
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
  destroy?: () => Promise<void> | void;
};

let loader: Promise<((data: Uint8Array) => Promise<PdfjsDoc>) | null> | null = null;

/** Nạp thư viện đọc chữ một lần cho cả tiến trình; nạp hỏng thì nhớ luôn là không có. */
function loadReader() {
  if (!loader) {
    loader = import("unpdf")
      .then((m) => (data: Uint8Array) => m.getDocumentProxy(data) as unknown as Promise<PdfjsDoc>)
      .catch((err) => {
        console.error("[label-overlay] LỖI nạp thư viện đọc PDF — sẽ không tự dò được vùng chèn:", err);
        return null;
      });
  }
  return loader;
}

/**
 * Đọc trang đầu của vận đơn: kích thước, số trang, các dòng chữ. Không ném — tệp hỏng /
 * thư viện không nạp được thì trả null. Chạy NGAY trong luồng đang gọi (xem cảnh báo đầu tệp).
 */
export async function readFirstPageInProcess(pdf: Uint8Array): Promise<{ shape: PageShape; lines: TextLine[] } | null> {
  const open = await loadReader();
  if (!open) return null;
  let doc: PdfjsDoc | null = null;
  try {
    // pdf.js giữ luôn vùng nhớ được trao → trao BẢN SAO, tệp gốc còn dùng để chèn.
    doc = await open(new Uint8Array(pdf));
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform?: number[]; height?: number }[])
      .filter((i) => typeof i.str === "string" && Array.isArray(i.transform))
      .map((i) => ({
        str: i.str as string,
        x: i.transform![4],
        y: i.transform![5],
        height: i.height || Math.abs(i.transform![3]) || 0,
      }));
    return {
      shape: { width: vp.width, height: vp.height, pageCount: doc.numPages, textItems: items.length },
      lines: groupLines(items),
    };
  } catch (err) {
    console.warn("[label-overlay] không đọc được lớp chữ của vận đơn:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    try {
      await doc?.destroy?.();
    } catch {
      // bỏ qua
    }
  }
}
