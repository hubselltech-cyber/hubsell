/**
 * Chạy MỘT lượt bồi đơn cho tài khoản reviewer ISV (không chờ worker theo nhịp)
 * — dùng ngay sau khi seed, hoặc khi muốn xem trước kết quả trên production.
 * Lõi dùng chung với worker: src/workers/reviewer-demo-topup.ts.
 *
 *   # Local
 *   npx tsx scripts/reviewer-demo-topup-once.ts
 *   # Production (PowerShell) — bắt buộc --production như seed-isv-reviewer.ts
 *   $env:DATABASE_URL='postgresql://...'; npx tsx scripts/reviewer-demo-topup-once.ts --production
 *
 * Tùy chọn: --email=reviewer@hubsell.vn
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { DEFAULT_REVIEWER_EMAIL, runReviewerDemoTopup } from "../src/workers/reviewer-demo-topup";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) throw new Error("Thiếu DATABASE_URL.");
  if (!/localhost|127\.0\.0\.1/.test(dbUrl) && !process.argv.includes("--production")) {
    throw new Error("TỪ CHỐI CHẠY: DATABASE_URL không phải localhost. Muốn chạy trên production phải thêm cờ --production.");
  }
  const email = (arg("email") ?? DEFAULT_REVIEWER_EMAIL).toLowerCase();
  console.log(`DB: ${dbUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@")} · tài khoản ${email}`);

  const s = await runReviewerDemoTopup({ email });
  if (!s) {
    console.log("Bỏ qua: không có tài khoản này, hoặc gian đã nối sàn thật (worker chỉ đụng gian demo không token).");
    return;
  }
  console.log(
    `✅ +${s.created} đơn (hôm nay ${s.todayCount}/${s.dailyTarget}) · xử lý ${s.processed} · giao ${s.shipped} · hủy ${s.cancelled}` +
      ` · đã giao ${s.delivered} · đối soát ${s.settled} · hoàn mở ${s.returnsOpened}/đóng ${s.returnsClosed}`
  );

  const u = await prisma.user.findUnique({ where: { email }, select: { channels: { select: { id: true } } } });
  const ids = (u?.channels ?? []).map((c) => c.id);
  const rows = await prisma.$queryRaw<{ d: string; n: bigint }[]>`
    SELECT to_char("createdAt" + interval '7 hour', 'YYYY-MM-DD') AS d, count(*) AS n
    FROM "Order" WHERE "channelId" = ANY(${ids}) GROUP BY 1 ORDER BY 1 DESC LIMIT 5`;
  console.log("Đơn 5 ngày gần nhất: " + rows.map((r) => `${r.d}=${r.n}`).join(" · "));
  const st = await prisma.order.groupBy({ by: ["shippingStatus"], where: { channelId: { in: ids } }, _count: true });
  console.log("Trạng thái: " + st.map((r) => `${r.shippingStatus}=${r._count}`).join(" · "));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("❌", e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
