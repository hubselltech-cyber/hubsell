// ============================================================
// WORKER TỰ ĐIỀN MÃ VẠCH cho sản phẩm kho cũ — NHỊP CHẬM (05/11/2026 đêm,
// docs/QUAN-LY-KHO-TAI-CAU-TRUC.md mục 6.6; anh Trung chọn "Máy tự điền chậm").
//
// Lúc làm việc này Supabase đang hụt Disk IO (IO balance 0 % từ 28/10) nên chủ ý đi RẤT chậm:
// mỗi bước 100 dòng rồi nghỉ 15 giây (≈ 400 dòng / phút, 24.000 dòng / giờ); bắt đầu sau khi
// khởi động 3 phút để không tranh với lúc worker vừa lên. Anh Trung 05/11 đêm: "phần này cứ
// làm chậm giãn cách ra cũng được, chỉ cần tức thì cho sản phẩm mới tạo" — sản phẩm MỚI có mã
// ngay nhờ DEFAULT của cột, không phụ thuộc worker này. Hai con số là TỰ CHỌN — chỉnh bằng
// env, không cần deploy lại mã:
//   PRODUCT_BARCODE_BACKFILL_OFF=1         tắt hẳn
//   PRODUCT_BARCODE_BACKFILL_BATCH=100     số dòng mỗi bước (1–2000)
//   PRODUCT_BARCODE_BACKFILL_PAUSE_MS=15000  nghỉ giữa hai bước
// Tiến độ nằm ở bảng maintenance_jobs (khóa "product-barcode-backfill"): worker khởi động lại
// thì đi tiếp từ con trỏ; xong hẳn (doneAt) thì các lần sau chỉ đọc một dòng rồi thôi.
// Việc dài nên KHÔNG qua pg-boss (bẫy stately). Lỗi một bước → nghỉ 5 phút rồi thử lại.
// ============================================================
import { runBarcodeBackfillStep } from "../services/product-barcode-backfill";

const TAG = "[barcode-backfill]";
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;
const ERROR_RETRY_MS = 5 * 60 * 1000;
/** In tiến độ mỗi 50 bước (≈ 5.000 dòng với lô 100, khoảng 12 phút một dòng log). */
const LOG_EVERY_STEPS = 50;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });

let running = false;

async function runLoop(): Promise<void> {
  if (running) return;
  running = true;
  const batch = envInt("PRODUCT_BARCODE_BACKFILL_BATCH", 100, 1, 2000);
  const pauseMs = envInt("PRODUCT_BARCODE_BACKFILL_PAUSE_MS", 15_000, 0, 600_000);
  let steps = 0;
  let scanned = 0;
  try {
    for (;;) {
      let step;
      try {
        step = await runBarcodeBackfillStep({ batch });
      } catch (err) {
        console.error(`${TAG} lỗi một bước, thử lại sau 5 phút: ${(err as Error).message}`);
        await sleep(ERROR_RETRY_MS);
        continue;
      }
      if (step.done) {
        console.log(
          steps === 0
            ? `${TAG} đã xong từ trước (đã điền ${step.totalFilled} sản phẩm) — không làm gì`
            : `${TAG} XONG: lượt này duyệt ${scanned} dòng, tổng đã điền ${step.totalFilled} sản phẩm`
        );
        return;
      }
      steps += 1;
      scanned += step.scanned;
      if (steps === 1) console.log(`${TAG} bắt đầu: lô ${batch} dòng, nghỉ ${pauseMs} ms giữa hai lô`);
      if (steps % LOG_EVERY_STEPS === 0) {
        console.log(`${TAG} đang chạy: lượt này duyệt ${scanned} dòng, tổng đã điền ${step.totalFilled}`);
      }
      await sleep(pauseMs);
    }
  } finally {
    running = false;
  }
}

export function startProductBarcodeBackfillWorker(): void {
  if (process.env.PRODUCT_BARCODE_BACKFILL_OFF === "1") {
    console.log(`${TAG} tắt bằng PRODUCT_BARCODE_BACKFILL_OFF=1`);
    return;
  }
  setTimeout(() => void runLoop(), FIRST_RUN_DELAY_MS).unref();
}
