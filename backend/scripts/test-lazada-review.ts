// Test tay Review API Lazada — chạy: npx tsx scripts/test-lazada-review.ts
// Gọi ĐÚNG MỘT lượt /review/seller/list cho 1 item của shop Hi.Bé để xem
// response thô (phân biệt rate limit thật với thiếu quyền đội lốt).
import { prisma } from "../src/prisma";
import { getValidLazadaAccessToken } from "../src/integrations/lazada/service";
import { getLazadaConfig, LAZADA_ENDPOINTS, LAZADA_PATHS } from "../src/integrations/lazada/config";
import { signLazada } from "../src/integrations/lazada/client";

async function main() {
  const ch = await prisma.channel.findFirst({
    where: { channelName: "LAZADA", apiToken: { not: null } },
  });
  if (!ch) throw new Error("Không có gian Lazada nào");
  const cp = await prisma.channelProduct.findFirst({
    where: { channelId: ch.id, externalId: { not: null } },
    orderBy: { lastSyncedAt: "desc" },
  });
  console.log("Shop:", ch.shopName, "| item:", cp?.externalId, cp?.productName);
  const accessToken = await getValidLazadaAccessToken(ch);
  const cfg = getLazadaConfig();

  const params: Record<string, string> = {
    access_token: accessToken,
    // externalId Lazada lưu dạng "itemId-skuId" — Review API chỉ nhận itemId
    item_id: String(cp?.externalId).split("-")[0],
    page_size: "10",
    current: "1",
    app_key: cfg.appKey,
    sign_method: "sha256",
    timestamp: String(Date.now()),
  };
  const sign = signLazada(cfg.appSecret, LAZADA_PATHS.reviewList, params);
  const qs = new URLSearchParams({ ...params, sign }).toString();
  const res = await fetch(`${LAZADA_ENDPOINTS.api}${LAZADA_PATHS.reviewList}?${qs}`);
  console.log("HTTP", res.status);
  console.log(await res.text());
}

main().finally(() => prisma.$disconnect());
