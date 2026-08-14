// Thăm dò "Lịch sử hỏi đáp" (FAQ Assistant) trong chat Shopee — CHỈ ĐỌC.
// Câu hỏi cần trả lời: get_message có trả các tin message_type faq_* (khách
// hỏi bot trong webchat) không, và content của chúng nằm ở field nào?
// Cách làm: quét hội thoại mới nhất của từng gian, tally message_type, in
// NGUYÊN VĂN JSON mọi tin có type lạ (ngoài danh sách app đã render được).
import { prisma } from "../src/prisma";
import { getValidShopeeAccessToken } from "../src/integrations/shopee/service";
import {
  getConversationList,
  getChatMessages,
} from "../src/integrations/shopee/client";

// Các type app ĐÃ hiển thị tử tế (text + nhãn trong SHOPEE_TYPE_LABEL của
// routes/operations.ts) — mọi type ngoài danh sách này in raw để khảo sát.
const KNOWN = new Set([
  "text",
  "image",
  "image_with_text",
  "sticker",
  "item",
  "product",
  "item_list",
  "order",
  "voucher",
  "video",
  "bundle_deal_info",
]);

const CONVERSATIONS_PER_SHOP = 15;
const MESSAGES_PER_CONVERSATION = 60;

async function main() {
  const channels = await prisma.channel.findMany({
    where: { channelName: "SHOPEE", refreshToken: { not: null } },
  });
  console.log(`Có ${channels.length} gian Shopee còn token.\n`);

  const tally = new Map<string, number>();
  for (const ch of channels) {
    try {
      const { accessToken, shopId } = await getValidShopeeAccessToken(ch);
      const convData = await getConversationList({
        accessToken,
        shopId,
        pageSize: CONVERSATIONS_PER_SHOP,
      });
      const convs =
        convData.response?.conversations ??
        convData.response?.page_result?.conversations ??
        [];
      console.log(`[${ch.shopName}] ${convs.length} hội thoại gần nhất`);

      for (const c of convs) {
        if (c.conversation_id == null) continue;
        const data = await getChatMessages({
          accessToken,
          shopId,
          conversationId: String(c.conversation_id),
          pageSize: MESSAGES_PER_CONVERSATION,
        });
        const msgs = data.response?.messages ?? [];
        for (const m of msgs) {
          const t = m.message_type ?? "(không có message_type)";
          tally.set(t, (tally.get(t) ?? 0) + 1);
          if (!KNOWN.has(t)) {
            console.log(
              `\n--- TYPE LẠ "${t}" (hội thoại ${c.conversation_id}, khách ${c.to_name ?? "?"}) ---`
            );
            console.log(JSON.stringify(m, null, 2));
          }
        }
      }
    } catch (e) {
      console.log(`[${ch.shopName}] LỖI: ${(e as Error).message}`);
    }
  }

  console.log("\n===== TALLY message_type toàn bộ tin đã quét =====");
  for (const [t, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${KNOWN.has(t) ? "  " : "⚠️"} ${t}: ${n}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
