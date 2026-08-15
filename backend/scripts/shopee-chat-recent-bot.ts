// Probe 3 — CHỈ ĐỌC: tìm hội thoại GẦN ĐÂY có tin bot (bundle_message /
// faq_liveagent) để nghiệm thu hiển thị mới trên UI. Probe 1/2 gọi
// get_conversation_list trần nên dính bẫy Shopee trả trang CŨ nhất (2024);
// bản này lấy trang MỚI nhất theo đúng mẹo smart của routes/operations.ts:
// gọi 2 biến thể (latest | older + next_timestamp_nano=now) rồi chọn biến
// thể có mốc thời gian mới hơn.
import { prisma } from "../src/prisma";
import { getValidShopeeAccessToken } from "../src/integrations/shopee/service";
import {
  getConversationList,
  getChatMessages,
  type ShopeeConversation,
} from "../src/integrations/shopee/client";

const BOT_TYPES = new Set(["bundle_message", "faq_liveagent"]);

function readList(
  d: Awaited<ReturnType<typeof getConversationList>>
): ShopeeConversation[] {
  return (
    d.response?.conversations ?? d.response?.page_result?.conversations ?? []
  );
}

/** Mốc mới nhất của một trang hội thoại — thang thời gian nào cũng quy về ms. */
function newestAt(list: ShopeeConversation[]): number {
  let max = 0;
  for (const c of list) {
    let n = Number(c.last_message_timestamp ?? 0);
    if (!Number.isFinite(n) || n <= 0) continue;
    while (n > 1e14) n = n / 1000;
    if (n < 1e11) n = n * 1000;
    if (n > max) max = n;
  }
  return max;
}

async function main() {
  const channels = await prisma.channel.findMany({
    where: { channelName: "SHOPEE", refreshToken: { not: null } },
  });

  for (const ch of channels) {
    let ctx;
    try {
      ctx = await getValidShopeeAccessToken(ch);
    } catch (e) {
      console.log(`[${ch.shopName}] BỎ QUA: ${(e as Error).message}`);
      continue;
    }
    const { accessToken, shopId } = ctx;

    const [latest, viaNow] = await Promise.allSettled([
      getConversationList({ accessToken, shopId, pageSize: 25 }),
      getConversationList({
        accessToken,
        shopId,
        pageSize: 25,
        nextTimestampNano: String(Date.now() * 1e6),
      }),
    ]);
    const candidates = [latest, viaNow]
      .filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof getConversationList>>> =>
          r.status === "fulfilled"
      )
      .map((r) => readList(r.value));
    const convs =
      candidates.sort((a, b) => newestAt(b) - newestAt(a))[0] ?? [];
    console.log(
      `\n[${ch.shopName}] quét ${convs.length} hội thoại mới nhất (mốc mới nhất: ${new Date(newestAt(convs)).toLocaleString("vi-VN")})`
    );

    for (const c of convs) {
      if (c.conversation_id == null) continue;
      const data = await getChatMessages({
        accessToken,
        shopId,
        conversationId: String(c.conversation_id),
        pageSize: 60,
      });
      const hits = (data.response?.messages ?? []).filter((m) =>
        BOT_TYPES.has(m.message_type ?? "")
      );
      if (hits.length === 0) continue;
      const latestHit = hits[0];
      const atMs = (() => {
        let n = Number(latestHit?.created_timestamp ?? 0);
        if (n > 0 && n < 1e11) n = n * 1000;
        return n;
      })();
      console.log(
        `  ✅ khách "${c.to_name ?? "?"}" — ${hits.length} tin bot (${hits
          .map((m) => m.message_type)
          .join(", ")}), tin bot gần nhất: ${atMs ? new Date(atMs).toLocaleString("vi-VN") : "?"}`
      );
    }
  }
  console.log(
    "\nMở Trợ lý chat, chọn đúng GIAN và tìm tên khách có dấu ✅ ở trên để nghiệm thu."
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
