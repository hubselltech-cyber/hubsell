// ============================================================
// PROBE CHỈ ĐỌC: TikTok orders/search trả gì cho một cửa sổ update_time?
// (Pha C lát 1, 19/10/2026 — bóng sót 2 đơn MỚI ở Siêu Thị 8686 dù update_time
// nằm trong cửa sổ; đo xem chỉ mục tìm kiếm của sàn trễ bao lâu / có bỏ đơn mới)
//
//   npx tsx scripts/tiktok-search-probe.ts "<shopName>" <fromIso> <toIso> [id1,id2,...]
//   vd: npx tsx scripts/tiktok-search-probe.ts "Siêu Thị 8686" 2026-10-19T05:42:05Z 2026-10-19T06:10:06Z 586668806171100213,586668898158872299
//
// In: tổng sàn báo, số trang, số đơn, min/max update_time, mỗi id hỏi có trong
// kết quả không (+ update_time/status nếu có), và đọc chi tiết id đó qua GET
// /orders để so update_time thật. Không ghi DB. Chạy trên Render shell worker.
// ============================================================

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { fetchOrders, getOrderDetail, type TikTokOrder } from "../src/integrations/tiktok/client";
import { getValidAccessToken } from "../src/integrations/tiktok/service";

const iso = (s?: number) => (s ? new Date(s * 1000).toISOString() : "-");

async function main() {
  const [shopName, fromIso, toIso, idsArg] = process.argv.slice(2);
  if (!shopName || !fromIso || !toIso) throw new Error("cách dùng: <shopName> <fromIso> <toIso> [ids]");
  const ids = (idsArg ?? "").split(",").filter(Boolean);
  const channel = await prisma.channel.findFirst({ where: { shopName, channelName: "TIKTOK", status: "ACTIVE" } });
  if (!channel) throw new Error(`không thấy gian TikTok "${shopName}"`);
  const { accessToken, shopCipher } = await getValidAccessToken(channel);
  const from = Math.floor(Date.parse(fromIso) / 1000);
  const to = Math.ceil(Date.parse(toIso) / 1000);

  for (const sort of [true, false]) {
    const all: TikTokOrder[] = [];
    let token: string | undefined;
    let pages = 0;
    let total: number | undefined;
    do {
      const data = await fetchOrders({
        accessToken,
        shopCipher,
        updateTimeGe: from,
        updateTimeLt: to,
        pageSize: 50,
        pageToken: token,
        ...(sort ? { sortField: "update_time" as const, sortOrder: "DESC" as const } : {}),
      });
      pages++;
      total = data.total_count;
      all.push(...(data.orders ?? []));
      token = data.next_page_token || undefined;
    } while (token && pages < 60);
    const times = all.map((o) => o.update_time ?? 0).filter(Boolean);
    const created = all.filter((o) => (o.create_time ?? 0) >= from).length;
    console.log(
      `\n[${sort ? "sort update_time DESC" : "không sort"}] cửa sổ ${iso(from)} → ${iso(to)} (giờ gọi ${new Date().toISOString()}): ` +
        `total_count ${total ?? "-"}, ${pages} trang, ${all.length} đơn (${created} tạo trong cửa sổ), update_time ${iso(Math.min(...times))} → ${iso(Math.max(...times))}`
    );
    for (const id of ids) {
      const o = all.find((x) => x.id === id);
      console.log(`  ${id}: ${o ? `CÓ — update_time ${iso(o.update_time)} create ${iso(o.create_time)} status ${o.status}` : "KHÔNG có trong kết quả"}`);
    }
  }
  if (ids.length) {
    const detail = await getOrderDetail({ accessToken, shopCipher, orderIds: ids });
    for (const o of detail) {
      console.log(`  chi tiết ${o.id}: status ${o.status} create ${iso(o.create_time)} update ${iso(o.update_time)} paid ${iso((o as { paid_time?: number }).paid_time)}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("❌", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
