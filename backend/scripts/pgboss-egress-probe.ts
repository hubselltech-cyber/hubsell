// ============================================================
// ĐO BĂNG THÔNG pg-boss GỬI LÊN DATABASE KHI HÀNG ĐỢI TRỐNG (05/10/2026, sửa 08/10)
//
// Render tính tiền byte worker gửi ra ngoài (database ở Supabase là "ra ngoài").
// Script khởi động hàng đợi ĐÚNG như worker prod (startQueue vai worker, kể cả
// LISTEN/NOTIFY), đăng ký đúng các hàng đợi worker đang nhận với đúng nhịp hỏi
// (đọc từ queue-config.ts nên không lệch mã), việc rỗng, rồi đếm byte ghi vào
// socket database trong N giây. Số chưa gồm phần bọc TLS + TCP/IP.
//
// Kết quả trên database local (PROGRESS 05/10 và 08/10):
//   · cấu hình cũ (0,5 / 2 giây, ba hàng đợi 2 vòng):            15,0 KB/giây = 55 MB/giờ
//   · nhịp 1 / 5 / 0,5 giây, invoice.issue 1 vòng, KHÔNG NOTIFY:  7,7 KB/giây = 28,5 MB/giờ
//   · như trên + LISTEN/NOTIFY (lưới đỡ 30 giây):                 1,7 KB/giây = 6,4 MB/giờ
// Để đo nhánh KHÔNG NOTIFY: QUEUE_LISTEN_NOTIFY=off. Cờ notify của hàng đợi do
// migration 20261008100000_queue_notify đặt — database local phải đã migrate.
//
// Chạy: npx tsx scripts/pgboss-egress-probe.ts [số giây, mặc định 60]
// ============================================================
import "dotenv/config";
import net from "net";
let bytes = 0, writes = 0;
const orig = net.Socket.prototype.write;
net.Socket.prototype.write = function (this: net.Socket, chunk: any, ...rest: any[]) {
  if (this.remotePort === 5432 || this.remotePort === 6543) {
    bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk?.length ?? 0;
    writes++;
  }
  return (orig as any).call(this, chunk, ...rest);
} as any;
import { startQueue, stopQueue, registerWorker, QUEUES } from "../src/lib/queue";
import {
  evtOrderConcurrency,
  POLL_FAST_SECONDS,
  POLL_MANUAL_SECONDS,
  POLL_SLOW_SECONDS,
  stockChannelConcurrency,
} from "../src/lib/queue-config";
const SECONDS = Number(process.argv[2] ?? 60);
(async () => {
  const ok = await startQueue("worker");
  if (!ok) { console.log("queue không lên"); process.exit(1); }
  const noop = async () => {};
  // Đúng cấu hình đang chạy ở prod (event-queue.ts, stock-queue.ts, invoice-lanes.ts)
  await registerWorker(QUEUES.evtOrder, { concurrency: evtOrderConcurrency(), pollSeconds: POLL_FAST_SECONDS }, noop);
  await registerWorker(QUEUES.evtAuth, { concurrency: 1, pollSeconds: POLL_SLOW_SECONDS }, noop);
  await registerWorker(QUEUES.evtDead, { concurrency: 2, pollSeconds: POLL_SLOW_SECONDS }, noop);
  await registerWorker(QUEUES.stockChannel, { concurrency: stockChannelConcurrency(), pollSeconds: POLL_FAST_SECONDS }, noop);
  await registerWorker(QUEUES.stockVerify, { concurrency: 1, pollSeconds: POLL_SLOW_SECONDS }, noop);
  await registerWorker(QUEUES.invoiceIssue, { concurrency: 1, pollSeconds: POLL_MANUAL_SECONDS }, noop);
  await new Promise((r) => setTimeout(r, 5000));
  const b0 = bytes, w0 = writes;
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  const b = bytes - b0, w = writes - w0;
  console.log(`${SECONDS}s: ${b} byte, ${w} lần ghi → ${(b / SECONDS / 1024).toFixed(1)} KB/s = ${((b / SECONDS) * 3600 / 1e6).toFixed(1)} MB/giờ (chưa tính TLS + TCP/IP)`);
  await stopQueue(3000);
  process.exit(0);
})();
