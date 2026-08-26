// ============================================================
// DUMP SẢN PHẨM + PHÂN LOẠI (raw) của một shop Shopee để soi vì sao gộp phân loại.
// In item_sku (cấp SP) và từng model: model_id / model_name / model_sku,
// rồi tính khoá channelSku hiện tại để thấy dòng nào trùng khoá → bị gộp.
//
// Chạy:  cd backend && npx tsx scripts/shopee-dump-models.ts [shop_id]
// ============================================================

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import {
  getItemBaseInfo,
  getItemList,
  getModelList,
  shopeeChannelSku,
} from "../src/integrations/shopee/client";
import { getValidShopeeAccessToken } from "../src/integrations/shopee/service";

(async () => {
  const wantShopId = process.argv[2]?.trim();
  const channel = await prisma.channel.findFirst({
    where: {
      channelName: "SHOPEE",
      refreshToken: { not: null },
      status: "ACTIVE",
      ...(wantShopId ? { externalShopId: wantShopId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!channel) {
    console.log("❌ Không thấy gian Shopee phù hợp trong DB.");
    await prisma.$disconnect();
    return;
  }
  console.log(`SHOP: ${channel.shopName} | shop_id=${channel.externalShopId}`);
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

  const list = await getItemList({ accessToken, shopId, offset: 0, pageSize: 100 });
  const ids = (list.response?.item ?? []).map((i) => i.item_id);
  console.log(`Tổng item: ${ids.length} →`, ids);
  if (ids.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const infos = await getItemBaseInfo(accessToken, shopId, ids);
  for (const info of infos) {
    console.log("\n" + "=".repeat(64));
    console.log(`ITEM ${info.item_id} | "${info.item_name}"`);
    console.log(`  item_sku = ${JSON.stringify(info.item_sku)} | has_model=${info.has_model}`);
    if (!info.has_model) {
      const sku = shopeeChannelSku({ itemId: info.item_id, itemSku: info.item_sku });
      console.log(`  → (SP đơn) channelSku = ${sku}`);
      continue;
    }
    const models = await getModelList(accessToken, shopId, info.item_id);
    console.log(`  models: ${models.length}`);
    const keys = new Map<string, number>();
    for (const m of models) {
      const sku = shopeeChannelSku({
        itemId: info.item_id,
        modelId: m.model_id,
        itemSku: info.item_sku,
        modelSku: m.model_sku,
      });
      keys.set(sku, (keys.get(sku) ?? 0) + 1);
      console.log(
        `    - model_id=${m.model_id} | name="${m.model_name}" | model_sku=${JSON.stringify(
          m.model_sku
        )}  ⇒ channelSku=${sku}`
      );
    }
    const dup = [...keys.entries()].filter(([, n]) => n > 1);
    console.log(
      dup.length
        ? `  ⚠️  ${dup.length} khoá bị TRÙNG (sẽ gộp): ${dup.map(([k, n]) => `${k}×${n}`).join(", ")}`
        : `  ✅ ${keys.size} khoá phân biệt — KHÔNG gộp.`
    );
  }

  await prisma.$disconnect();
})();
