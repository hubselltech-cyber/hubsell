// ============================================================
// ĐẨY TỒN — ĐƯỜNG HÀNG ĐỢI BỀN (giai đoạn 2 bước 4, docs/HANG-DOI-BEN.md mục 3.4 + 4.5)
//
// Bảng stock_push_jobs là nơi giữ trạng thái VÀ là nguồn sự thật: dòng nào chờ
// đẩy, đã thử mấy lượt, giờ thử lại. Dòng được ghi chung giao dịch với biến
// động kho (inventory-push.ts) nên đơn đã ghi thì lượt đẩy tồn chắc chắn có.
//
// Tệp này lo phần CHẠY:
//
//   · Bộ chạy theo gian: mỗi lượt nhận MỘT LÔ dòng tới hạn của một gian rồi đẩy
//     (claimChannelBatch + processClaimedJobs ở stock-push-worker.ts). Các gian
//     chạy song song tới trần mỗi tiến trình; gian còn dòng thì quay lại cuối
//     hàng, nên một gian nhiều việc không chiếm chỗ của gian khác. Một gian
//     không bao giờ có hai tiến trình cùng đẩy: việc nhận lô được khóa theo gian
//     ở database và chỉ nhận khi gian không còn dòng nào đang RUNNING.
//   · Hai nguồn gọi bộ chạy:
//       1. Tín hiệu qua hàng đợi pg-boss stock.channel — được xếp cùng lúc ghi
//          dòng, worker nhận trong khoảng nửa giây. Hàm xử lý chỉ ghi tên gian
//          vào hàng chờ trong tiến trình rồi trả về NGAY.
//       2. Lưới quét mỗi vài giây: gian nào có dòng tới hạn (kể cả dòng tới giờ
//          thử lại, dòng kẹt của tiến trình đã chết) thì gọi bộ chạy. Lưới quét
//          đọc thẳng bảng, không qua pg-boss — hàng đợi có trục trặc thì đẩy
//          tồn vẫn chạy, chỉ chậm hơn vài giây.
//   · stock.verify — đọc lại tồn Shopee sau khi đẩy (việc hẹn giờ); phần xử lý
//     nằm ở integrations/shopee/inventory-sync.ts.
//
// VÌ SAO việc đẩy KHÔNG chạy bên trong việc của pg-boss (đo 01/10/2026, pg-boss
// 12.35.1): với hàng đợi "gộp theo khóa", khi một khóa đang có việc chạy mà lại
// có việc chờ cùng khóa đứng đầu hàng, mọi lượt lấy việc của CẢ hàng đợi trả về
// rỗng cho tới khi việc đang chạy xong (thư viện coi lỗi trùng chỉ mục lúc lấy
// việc là "lượt lấy rỗng", và danh sách khóa đang chạy nó dùng để né thì chỉ làm
// mới mỗi phút). Việc đẩy một gian kéo dài hàng chục giây nên sẽ chặn mọi gian
// khác. Để hàm xử lý của stock.channel chỉ dài vài mili-giây thì khe đó không
// đáng kể; còn "không hai tiến trình cùng đẩy một gian" do khóa ở database lo.
//
// Lỗi đẩy của TỪNG DÒNG (sàn từ chối, quá nhịp...) xử lý như đường cũ: dòng tự
// đếm lượt, hẹn giờ thử lại trong bảng, hết lượt thì cảnh báo.
// ============================================================

import { type StockChannelJob } from "../integrations/inventory-push";
import { runStockVerifyJob, type StockVerifyJob } from "../integrations/shopee/inventory-sync";
import { claimChannelBatch, processClaimedJobs } from "../integrations/stock-push-worker";
import { prisma } from "../lib/prisma";
import { QUEUES, registerWorker } from "../lib/queue";
import { STOCK_PUSH_LEASE_SECONDS, stockChannelConcurrency, stockSweepSeconds } from "../lib/queue-config";

// ---------- Bộ chạy theo gian (trong tiến trình) ----------
// Trạng thái dưới đây chỉ là HÀNG CHỜ TỚI LƯỢT trong tiến trình này. Mất khi
// tiến trình chết cũng không mất việc: dòng vẫn nằm trong bảng, lưới quét của
// tiến trình còn sống (hoặc bản mới) gọi lại gian.

/** Gian chờ tới lượt, theo thứ tự được gọi. */
const waiting = new Set<string>();
/** Gian đang chạy một lượt. */
const running = new Map<string, Promise<void>>();
/** Gian được gọi lại trong lúc đang chạy — xong lượt này phải chạy thêm lượt nữa. */
const again = new Set<string>();
let stopping = false;

/**
 * Một lượt của một gian: nhận một lô rồi đẩy. Trả true khi có dòng được nhận
 * (gian có thể còn dòng → cho quay lại cuối hàng); false khi gian không còn
 * dòng tới hạn hoặc đang có tiến trình khác đẩy.
 */
async function runChannelTurn(channelId: string): Promise<boolean> {
  const claimed = await claimChannelBatch(channelId);
  if (claimed.length === 0) return false;
  await processClaimedJobs(channelId, claimed, () => stopping);
  return true;
}

function pump(): void {
  const max = stockChannelConcurrency();
  while (!stopping && running.size < max && waiting.size > 0) {
    const channelId = waiting.values().next().value as string;
    waiting.delete(channelId);
    again.delete(channelId);
    const turn = runChannelTurn(channelId)
      .then((worked) => {
        // Vừa đẩy xong một lô: quay lại cuối hàng để lấy lô kế (hoặc để thấy
        // gian đã hết dòng). Lượt rỗng mà giữa chừng có người gọi thì cũng chạy lại.
        if ((worked || again.has(channelId)) && !stopping) waiting.add(channelId);
      })
      .catch((err) => {
        // Lỗi ngoài dự kiến (database): dòng còn nguyên trong bảng, lưới quét gọi lại sau.
        console.error(`[Stock-queue] Gian ${channelId}: lượt đẩy lỗi —`, (err as Error).message);
      })
      .finally(() => {
        running.delete(channelId);
        again.delete(channelId);
        pump();
      });
    running.set(channelId, turn);
  }
}

/** Gọi bộ chạy cho một gian. Trả về ngay; gian đang chạy thì đánh dấu chạy thêm một lượt. */
export function requestChannelPush(channelId: string): void {
  if (stopping) return;
  if (running.has(channelId)) {
    again.add(channelId);
    return;
  }
  waiting.add(channelId);
  pump();
}

/** Cho test: chờ tới khi không còn gian nào đang chạy hay chờ tới lượt. */
export async function whenStockRunnersIdle(): Promise<void> {
  while (running.size > 0 || waiting.size > 0) {
    await Promise.allSettled([...running.values()]);
  }
}

/**
 * Dừng êm lúc tiến trình tắt (SIGTERM khi deploy): thôi nhận gian mới, lượt đang
 * chạy dừng sau dòng đang đẩy và trả các dòng chưa đụng tới về hàng chờ. Chờ tối
 * đa `timeoutMs`; quá hạn thì dòng đang dở nằm ở RUNNING tới khi hết hạn thuê.
 */
export async function stopStockRunners(timeoutMs: number): Promise<void> {
  stopping = true;
  waiting.clear();
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  if (running.size === 0) return;
  await Promise.race([
    Promise.allSettled([...running.values()]),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref()),
  ]);
}

/** Cho test: bật lại bộ chạy sau stopStockRunners. */
export function resumeStockRunners(): void {
  stopping = false;
}

// ---------- Lưới quét ----------

/**
 * Tìm gian có dòng tới hạn (hoặc dòng kẹt RUNNING quá hạn thuê) rồi gọi bộ chạy.
 * Tới được đây: dòng tới giờ thử lại; dòng ghi lúc hàng đợi chưa sẵn sàng; tín
 * hiệu qua hàng đợi bị trễ; dòng của tiến trình chết giữa lô. Nhiều worker cùng
 * quét không sao: việc nhận lô có khóa theo gian. Trả số gian đã gọi.
 */
export async function sweepStockChannels(): Promise<number> {
  // SQL viết thẳng: `distinct` của Prisma lọc trùng trong bộ nhớ sau khi kéo MỌI
  // dòng khớp về. Mốc giờ truyền dạng chữ có múi giờ rồi đổi về UTC trong câu
  // lệnh (cột là TIMESTAMP không múi giờ, Prisma ghi UTC) để không phụ thuộc múi
  // giờ của phiên kết nối.
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STOCK_PUSH_LEASE_SECONDS * 1000).toISOString();
  const rows = await prisma.$queryRaw<{ channelId: string }[]>`
    SELECT DISTINCT "channelId" FROM "stock_push_jobs"
    WHERE ("status" = 'PENDING' AND "nextRetryAt" <= (${now}::timestamptz AT TIME ZONE 'UTC'))
       OR ("status" = 'RUNNING' AND "updatedAt" < (${staleBefore}::timestamptz AT TIME ZONE 'UTC'))
    ORDER BY "channelId"`;
  for (const row of rows) requestChannelPush(row.channelId);
  return rows.length;
}

let sweeping = false;
let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Bật đường hàng đợi bền của việc đẩy tồn ở tiến trình worker: lưới quét + bộ
 * chạy theo gian. Gọi 1 lần lúc khởi động. KHÔNG phụ thuộc pg-boss đã lên hay chưa.
 */
export function startStockPushScheduler(): void {
  if (sweepTimer) return;
  stopping = false;
  const seconds = stockSweepSeconds();
  const tick = async (): Promise<void> => {
    if (sweeping || stopping) return;
    sweeping = true;
    try {
      await sweepStockChannels();
    } catch (err) {
      console.error("[Stock-queue] Lỗi lưới quét:", (err as Error).message);
    } finally {
      sweeping = false;
    }
  };
  // unref: timer không giữ process sống khi server tắt.
  sweepTimer = setInterval(() => void tick(), seconds * 1000);
  sweepTimer.unref();
  console.log(
    `[Stock-queue] BẬT — đẩy tồn theo gian: tối đa ${stockChannelConcurrency()} gian cùng lúc, lưới quét mỗi ${seconds} giây`
  );
}

// ---------- Việc của hàng đợi pg-boss ----------

/**
 * Xử lý một việc stock.channel: chỉ là tín hiệu "gian này có dòng mới" → gọi bộ
 * chạy rồi trả về ngay (xem đầu tệp: việc phải ngắn).
 */
export async function runStockChannelJob(job: StockChannelJob): Promise<void> {
  requestChannelPush(job.channelId);
}

/**
 * Đăng ký worker cho các hàng đợi đẩy tồn. Gọi SAU khi startQueue() báo sẵn
 * sàng; ở vai web hàm đăng ký tự bỏ qua (web chỉ gửi việc). Đăng ký ở MỌI chế
 * độ: worker bản này nhận tín hiệu dù web chưa gửi (quy tắc đưa lên hai lần).
 */
export async function registerStockQueueWorkers(): Promise<void> {
  await registerWorker<StockChannelJob>(
    QUEUES.stockChannel,
    { concurrency: stockChannelConcurrency(), pollSeconds: 0.5 },
    (job) => runStockChannelJob(job.data)
  );
  // Đối soát: 1 việc một lúc như hàng đợi cũ (mỗi việc là một lệnh đọc tồn Shopee,
  // chưa có giãn nhịp theo shop — chạy song song là tăng tốc độ gọi sàn). Việc
  // chạy sau lượt đẩy 3 phút, không gấp tới từng giây: hỏi 2 giây một lần.
  await registerWorker<StockVerifyJob>(QUEUES.stockVerify, { concurrency: 1, pollSeconds: 2 }, (job) =>
    runStockVerifyJob(job.data)
  );
}
