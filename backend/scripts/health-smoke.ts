// Chạy thử collector Sức khỏe HQ trên DB đang nối (không gọi sàn, không ghi gì):
// in lớp tăng trưởng + vài số worker + mốc quota Ads. Dùng sau khi đổi câu đếm
// trong services/platform-health.ts (19/10/2026: gian Shopee nối Hubsell Ads, vé ads).
//   npx tsx scripts/health-smoke.ts
import { buildTimeline, collectHealth } from "../src/services/platform-health";
import { prisma } from "../src/lib/prisma";

async function main() {
  const m = await collectHealth();
  const t = await buildTimeline(m);
  console.log("growth:", {
    channelsActive: m.growth.channelsActive,
    channelsAds: m.growth.channelsAds,
    channelsHubsellAds: m.growth.channelsHubsellAds,
  });
  console.log("worker:", { overduePulse: m.worker.overduePulse, lockedStale: m.worker.lockedStale });
  console.log("timeline:", t.current.key, "→", t.next?.key ?? null);
  console.log(
    "ads quota:",
    t.adsMilestones.map((x) => `${x.milestone.key} ${x.progress.map((p) => `${p.current}/${p.target}`).join(",")} reached=${x.reached}`).join(" | "),
    "next", t.adsNext?.key ?? null, "eta", t.adsNextEta?.days ?? null
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
