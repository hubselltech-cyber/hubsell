// Probe 2 — CHỈ ĐỌC: thử moi TIN CON bên trong bundle_message ("Lịch sử hỏi
// đáp"). Probe 1 cho thấy get_message phân trang thường KHÔNG trả các tin con
// (không có faq_question/faq_bot_response nào trong tally) — chỉ trả cái vỏ
// bundle chứa mảng content.messages là id tin con.
// Thử 2 hướng trên hội thoại có bundle:
//   A. Phân trang SÂU bằng offset xem tin con có bao giờ lộ ra không.
//   B. Gọi get_message với offset = đúng id tin con / id bundle xem trang trả
//      về có chứa tin con không.
import { prisma } from "../src/lib/prisma";
import { getValidShopeeAccessToken } from "../src/integrations/shopee/service";
import {
  getConversationList,
  getChatMessages,
} from "../src/integrations/shopee/client";

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
    const convData = await getConversationList({ accessToken, shopId, pageSize: 25 });
    const convs =
      convData.response?.conversations ??
      convData.response?.page_result?.conversations ??
      [];

    for (const c of convs) {
      if (c.conversation_id == null) continue;
      const convId = String(c.conversation_id);
      const first = await getChatMessages({
        accessToken,
        shopId,
        conversationId: convId,
        pageSize: 60,
      });
      const msgs = first.response?.messages ?? [];
      const bundle = msgs.find((m) => m.message_type === "bundle_message");
      if (!bundle) continue;

      const childIds: string[] =
        ((bundle.content as Record<string, unknown> | undefined)?.messages as
          | string[]
          | undefined) ?? [];
      console.log(
        `\n===== [${ch.shopName}] hội thoại ${convId} (khách ${c.to_name ?? "?"}) — bundle ${bundle.message_id} có ${childIds.length} tin con =====`
      );

      // Hướng A: phân trang sâu 5 trang xem tin con có lộ không
      const seen = new Set<string>();
      let offset: string | undefined;
      for (let page = 0; page < 5; page++) {
        const d = await getChatMessages({
          accessToken,
          shopId,
          conversationId: convId,
          pageSize: 60,
          offset,
        });
        const pageMsgs = d.response?.messages ?? [];
        if (pageMsgs.length === 0) break;
        for (const m of pageMsgs) if (m.message_id) seen.add(String(m.message_id));
        const last = pageMsgs[pageMsgs.length - 1];
        offset = last?.message_id ? String(last.message_id) : undefined;
        if (!offset) break;
      }
      const foundA = childIds.filter((id) => seen.has(id));
      console.log(
        `Hướng A (phân trang sâu ${seen.size} tin): thấy ${foundA.length}/${childIds.length} tin con${foundA.length ? " → " + foundA.join(", ") : ""}`
      );

      // Hướng B: offset = id tin con đầu — trang trả về có tin con không?
      for (const probeOffset of [childIds[0], bundle.message_id].filter(
        (x): x is string => Boolean(x)
      )) {
        try {
          const d = await getChatMessages({
            accessToken,
            shopId,
            conversationId: convId,
            pageSize: 10,
            offset: probeOffset,
          });
          const got = d.response?.messages ?? [];
          const hit = got.filter((m) => childIds.includes(String(m.message_id)));
          console.log(
            `Hướng B (offset=${probeOffset}): trang trả ${got.length} tin, trúng ${hit.length} tin con`
          );
          for (const m of hit) {
            console.log(`  >>> TIN CON LỘ RA:`);
            console.log(JSON.stringify(m, null, 2));
          }
          // In cả type của trang để hiểu offset semantics
          console.log(
            `  types trong trang: ${got.map((m) => m.message_type).join(", ")}`
          );
        } catch (e) {
          console.log(`Hướng B (offset=${probeOffset}) LỖI: ${(e as Error).message}`);
        }
      }
      break; // mỗi shop chỉ cần khảo sát 1 hội thoại có bundle
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
