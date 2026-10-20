// ============================================================
// DỰNG LẠI AdSpend TIKTOK TỪ AdsCampaignDailyPerf (một lần, 20/10/2026)
//
// Trước 20/10 lượt sync ghi AdSpend = Σ dòng báo cáo của lượt → chiến dịch khách
// XÓA (sàn bỏ hẳn lịch sử) bị dòng 0₫ của chiến dịch còn sống đè ngày về 0
// (khách 69Minh Đương: dòng tiền 3,75tr vs màn quảng cáo 9,75tr). Code mới tính
// từ DB nhưng lượt thường chỉ quét 7 ngày → script này sửa phần cũ hơn.
//
// Chỉ đụng gian TIKTOK, chỉ những ngày DB có số chiến dịch mà AdSpend lệch.
// Mặc định CHỈ IN (before → after); thêm --apply mới ghi.
//
// Chạy (cd backend, DATABASE_URL prod):
//   npx tsx scripts/tiktok-adspend-rebuild-from-perf.ts            ← xem trước
//   npx tsx scripts/tiktok-adspend-rebuild-from-perf.ts --apply    ← ghi
//   tùy chọn: --days=30 (mặc định 30)
// ============================================================
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { dateKeyToDbDate, vnDateKey } from "../src/lib/ads-dates";

const apply = process.argv.includes("--apply");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const days = Math.min(90, Math.max(1, Number(daysArg?.split("=")[1] ?? 30) || 30));
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/[/?].*$/, "");
  const from = dateKeyToDbDate(vnDateKey(days - 1));
  const to = dateKeyToDbDate(vnDateKey(0));
  console.log(`DB ${host} · ${vnDateKey(days - 1)} → ${vnDateKey(0)} · ${apply ? "GHI" : "CHỈ XEM (thêm --apply để ghi)"}\n`);

  const perf = await prisma.$queryRaw<{ channelId: string; shopName: string; date: Date; total: unknown }[]>`
    SELECT c."channelId", ch."shopName", p."date", SUM(p."expense") AS total
    FROM "AdsCampaignDailyPerf" p
    JOIN "AdsCampaign" c ON c."id" = p."adsCampaignId"
    JOIN "Channel" ch ON ch."id" = c."channelId"
    WHERE ch."channelName" = 'TIKTOK' AND p."date" >= ${from} AND p."date" <= ${to}
    GROUP BY c."channelId", ch."shopName", p."date"`;
  const channelIds = [...new Set(perf.map((p) => p.channelId))];
  const spend = await prisma.adSpend.findMany({
    where: { channelId: { in: channelIds }, date: { gte: from, lte: to } },
    select: { channelId: true, date: true, amount: true },
  });
  const spendOf = new Map(spend.map((s) => [`${s.channelId}|${s.date.toISOString().slice(0, 10)}`, Number(s.amount)]));

  const fixes = perf
    .map((p) => {
      const date = p.date.toISOString().slice(0, 10);
      const after = Number(p.total ?? 0);
      const before = spendOf.get(`${p.channelId}|${date}`) ?? null;
      return { ...p, date, before, after };
    })
    .filter((f) => f.before === null || Math.abs(f.before - f.after) >= 1)
    .sort((a, b) => a.shopName.localeCompare(b.shopName) || a.date.localeCompare(b.date));

  const byShop = new Map<string, { shopName: string; delta: number; n: number }>();
  for (const f of fixes) {
    const s = byShop.get(f.channelId) ?? { shopName: f.shopName, delta: 0, n: 0 };
    s.delta += f.after - (f.before ?? 0);
    s.n++;
    byShop.set(f.channelId, s);
    console.log(`  ${f.shopName} · ${f.date} · ${f.before === null ? "(chưa có)" : vnd(f.before)} → ${vnd(f.after)}`);
  }
  console.log(`\nTổng: ${fixes.length} ngày lệch ở ${byShop.size}/${channelIds.length} gian TikTok có số chiến dịch.`);
  for (const s of [...byShop.values()].sort((a, b) => b.delta - a.delta)) {
    console.log(`  ${s.shopName}: ${s.n} ngày, chênh ${s.delta >= 0 ? "+" : ""}${vnd(s.delta)}₫`);
  }

  if (!apply || fixes.length === 0) return;
  for (const f of fixes) {
    const date = dateKeyToDbDate(f.date);
    await prisma.adSpend.upsert({
      where: { channelId_date: { channelId: f.channelId, date } },
      update: { amount: f.after },
      create: { channelId: f.channelId, date, amount: f.after },
    });
  }
  console.log(`\n✅ Đã ghi ${fixes.length} ngày.`);
}

main()
  .catch((err) => {
    console.error("❌", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
