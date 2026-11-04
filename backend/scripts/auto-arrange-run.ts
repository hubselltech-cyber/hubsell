// Chạy TAY một lượt tự chuẩn bị hàng cho một gian — kiểm local không cần worker
// (preview backend-http là vai web, làn không chạy).
//   npx tsx scripts/auto-arrange-run.ts <channelId>            # luồng thật (gọi sàn!)
//   npx tsx scripts/auto-arrange-run.ts <channelId> --shadow   # chỉ log, không gọi sàn
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { AUTO_ARRANGE_LANE, AUTO_ARRANGE_SHADOW_STREAM, AUTO_ARRANGE_STREAM } from "../src/lib/auto-arrange";
import { handleAutoArrangeItem } from "../src/workers/auto-arrange-lane";

async function main() {
  const [channelId, flag] = process.argv.slice(2);
  if (!channelId) throw new Error("Thiếu channelId");
  const shadow = flag === "--shadow";
  const stream = shadow ? AUTO_ARRANGE_SHADOW_STREAM : AUTO_ARRANGE_STREAM;
  const t = Date.now();
  const nextMs = await handleAutoArrangeItem({ channelId, stream, lane: AUTO_ARRANGE_LANE }, new AbortController().signal);
  console.log(`xong sau ${Date.now() - t} ms, hẹn lượt kế sau ${Math.round(nextMs / 1000)} s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
