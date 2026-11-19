// ============================================================
// DÒ VÙNG BẢNG SẢN PHẨM CỦA SÀN trên vận đơn (19/11/2026)
//
// Không đoán tọa độ cứng theo hãng: đọc LỚP CHỮ của tệp PDF, tìm dòng tiêu đề bảng sản
// phẩm ("Tổng N mặt hàng" trên tem TikTok kèm phiếu đóng gói) rồi lấy vùng từ mép trên
// dòng đó xuống đáy trang. Tem của hãng nào, bảng nằm cao hay thấp cũng dò ra đúng.
//
// Không dò được (tệp là ảnh, không có lớp chữ; sàn đổi câu chữ) → trả null. Lớp gọi sẽ
// dùng vùng người bán tự đặt, hoặc để nguyên phiếu của sàn. KHÔNG BAO GIỜ che mò.
//
// Thư viện đọc chữ (pdf.js) rất nặng bộ nhớ (xem read-page.ts) nên chạy trong MỘT LUỒNG PHỤ
// có trần bộ nhớ: chỉ dựng luồng khi có mẫu đang bật, đọc tuần tự từng tệp, rảnh 15 giây
// thì tắt luồng để trả bộ nhớ. Luồng chết / quá trần chỉ làm kết quả = null (in nguyên phiếu
// sàn), không chặn lượt in và không kéo tiến trình web theo.
// ============================================================

import path from "node:path";
import { Worker } from "node:worker_threads";
import type { ChannelName } from "@prisma/client";
import { groupLines, type PageShape, type TextLine } from "./lines";

export { groupLines, type PageShape, type TextLine };

export interface GoodsZone {
  /** Tọa độ PDF (pt), gốc ở góc dưới trái trang đầu. */
  left: number;
  right: number;
  bottom: number;
  top: number;
  /** anchor = dò từ lớp chữ · manual = người bán tự đặt chiều cao. */
  via: "anchor" | "manual";
}

/** Dòng tiêu đề bảng sản phẩm của từng sàn. */
const ANCHORS: Partial<Record<ChannelName, RegExp>> = {
  TIKTOK: /(tổng|tong)\s*\d+\s*(mặt hàng|mat hang)|total\s*\d+\s*items?/i,
};

/** Lề trái / phải / đáy của vùng chèn — trong mép cắt của máy in nhiệt. */
const SIDE_MARGIN = 6;
const BOTTOM_MARGIN = 6;
/** Nới lên trên dòng tiêu đề để phủ hết khung kẻ của ô tiêu đề. */
const ANCHOR_PAD = 5;
const MM = 72 / 25.4;

/** Vùng chèn từ dòng tiêu đề bảng sản phẩm; null khi không thấy hoặc vùng quá mỏng để in. */
export function zoneFromLines(
  platform: ChannelName,
  lines: TextLine[],
  page: { width: number; height: number }
): GoodsZone | null {
  const re = ANCHORS[platform];
  if (!re) return null;
  const anchor = lines.find((l) => re.test(l.text));
  if (!anchor) return null;
  const top = Math.min(page.height - 4, anchor.y + anchor.height + ANCHOR_PAD);
  const zone: GoodsZone = {
    left: SIDE_MARGIN,
    right: page.width - SIDE_MARGIN,
    bottom: BOTTOM_MARGIN,
    top,
    via: "anchor",
  };
  // Bảng nằm cao quá nửa tem là dấu hiệu dò nhầm dòng (đề phòng sàn đổi bố cục) → không chèn.
  if (zone.top - zone.bottom < 30 || zone.top > page.height * 0.55) return null;
  return zone;
}

export function manualZone(mm: number, page: { width: number; height: number }): GoodsZone {
  return {
    left: SIDE_MARGIN,
    right: page.width - SIDE_MARGIN,
    bottom: BOTTOM_MARGIN,
    top: Math.min(page.height * 0.55, BOTTOM_MARGIN + mm * MM),
    via: "manual",
  };
}

// ───────── Cầu nối sang luồng phụ đọc PDF ─────────

/** Trần heap của luồng phụ (MB) — vượt là luồng bị tắt, đơn đó in nguyên phiếu sàn. */
const WORKER_HEAP_MB = Number(process.env.LABEL_OVERLAY_WORKER_HEAP_MB ?? 128);
/** Rảnh ngần này thì tắt luồng (mặc định tự chọn: đủ cho các lượt in sát nhau dùng chung). */
const WORKER_IDLE_MS = Number(process.env.LABEL_OVERLAY_WORKER_IDLE_MS ?? 15_000);
/** Một tệp đọc quá lâu coi như hỏng — không để lượt in treo vì một tệp lạ. */
const READ_TIMEOUT_MS = 10_000;

type PageRead = { shape: PageShape; lines: TextLine[] } | null;

let worker: Worker | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (v: PageRead) => void; timer: NodeJS.Timeout }>();

function stopWorker(reason?: string) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const w = worker;
  worker = null;
  const jobs = [...waiting.values()];
  waiting.clear();
  for (const job of jobs) {
    clearTimeout(job.timer);
    job.resolve(null);
  }
  if (w) {
    if (reason) console.warn(`[label-overlay] tắt luồng đọc PDF: ${reason}`);
    void w.terminate();
  }
}

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    // Bản build chạy tệp .js cạnh tệp này; máy dev / test chạy thẳng .ts qua tsx.
    const isTs = __filename.endsWith(".ts");
    const w = new Worker(path.join(__dirname, isTs ? "locate-worker.ts" : "locate-worker.js"), {
      execArgv: isTs ? ["--import", "tsx"] : [],
      resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
    });
    w.on("message", (msg: { id: number; page: PageRead }) => {
      const job = waiting.get(msg.id);
      if (!job) return;
      waiting.delete(msg.id);
      clearTimeout(job.timer);
      job.resolve(msg.page);
    });
    w.on("error", (err) => {
      if (worker === w) stopWorker(`lỗi ${err instanceof Error ? err.message : String(err)}`);
    });
    w.on("exit", () => {
      if (worker === w) stopWorker();
    });
    // Luồng phụ không được giữ tiến trình sống (script / test thoát bình thường).
    w.unref();
    worker = w;
    return w;
  } catch (err) {
    console.error("[label-overlay] LỖI dựng luồng đọc PDF — sẽ không tự dò được vùng chèn:", err);
    return null;
  }
}

/**
 * Đọc trang đầu của vận đơn (kích thước, số trang, các dòng chữ) trong luồng phụ. Không ném:
 * tệp hỏng / luồng chết / quá giờ đều trả null.
 */
export function readFirstPage(pdf: Uint8Array): Promise<PageRead> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const id = ++seq;
  return new Promise<PageRead>((resolve) => {
    const timer = setTimeout(() => {
      // Tệp làm luồng treo: bỏ cả luồng (các tệp đang chờ cũng nhận null), lượt sau dựng lại.
      if (waiting.has(id)) stopWorker("đọc một tệp quá 10 giây");
    }, READ_TIMEOUT_MS);
    waiting.set(id, {
      timer,
      resolve: (v) => {
        resolve(v);
        if (waiting.size === 0 && worker) {
          idleTimer = setTimeout(() => stopWorker(), WORKER_IDLE_MS);
          idleTimer.unref();
        }
      },
    });
    // Gửi BẢN SAO: tệp gốc còn dùng để chèn ở luồng chính.
    const copy = new Uint8Array(pdf);
    w.postMessage({ id, pdf: copy }, [copy.buffer]);
  });
}

/** Tắt luồng phụ ngay (test / script dọn dẹp). */
export function closeLabelReader() {
  stopWorker();
}

/** Dò vùng bảng sản phẩm của sàn trên một vận đơn; null = không dò được. */
export async function locateGoodsZone(
  platform: ChannelName,
  pdf: Uint8Array
): Promise<{ zone: GoodsZone | null; shape: PageShape | null }> {
  const page = await readFirstPage(pdf);
  if (!page) return { zone: null, shape: null };
  return { zone: zoneFromLines(platform, page.lines, page.shape), shape: page.shape };
}
