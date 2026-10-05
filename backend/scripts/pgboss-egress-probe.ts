// ============================================================
// ĐO BĂNG THÔNG pg-boss GỬI LÊN DATABASE KHI HÀNG ĐỢI TRỐNG (05/10/2026)
//
// Render tính tiền byte worker gửi ra ngoài (database ở Supabase là "ra ngoài").
// Script đăng ký đúng các hàng đợi worker đang nhận, việc rỗng, rồi đếm byte ghi
// vào socket database trong N giây. Số chưa gồm phần bọc TLS + TCP/IP.
// Kết quả 05/10 trên database local: 15,5 KB/giây = 57 MB/giờ (PROGRESS 05/10).
// Đổi nhịp hỏi ở event-queue.ts / stock-queue.ts / invoice-lanes.ts thì sửa các
// dòng registerWorker dưới đây cho khớp rồi đo lại.
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
const SECONDS = Number(process.argv[2] ?? 60);
(async () => {
  const ok = await startQueue("worker");
  if (!ok) { console.log("queue không lên"); process.exit(1); }
  const noop = async () => {};
  // Đúng cấu hình đang chạy ở prod (event-queue.ts, stock-queue.ts, invoice-lanes.ts)
  await registerWorker(QUEUES.evtOrder, { concurrency: 4, pollSeconds: 0.5 }, noop);
  await registerWorker(QUEUES.evtAuth, { concurrency: 1, pollSeconds: 2 }, noop);
  await registerWorker(QUEUES.evtDead, { concurrency: 2, pollSeconds: 2 }, noop);
  await registerWorker(QUEUES.stockChannel, { concurrency: 4, pollSeconds: 0.5 }, noop);
  await registerWorker(QUEUES.stockVerify, { concurrency: 1, pollSeconds: 2 }, noop);
  await registerWorker(QUEUES.invoiceIssue, { concurrency: 2, pollSeconds: 0.5 }, noop);
  await new Promise((r) => setTimeout(r, 5000));
  const b0 = bytes, w0 = writes;
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  const b = bytes - b0, w = writes - w0;
  console.log(`${SECONDS}s: ${b} byte, ${w} lần ghi → ${(b / SECONDS / 1024).toFixed(1)} KB/s = ${((b / SECONDS) * 3600 / 1e6).toFixed(1)} MB/giờ (chưa tính TLS + TCP/IP)`);
  await stopQueue(3000);
  process.exit(0);
})();
