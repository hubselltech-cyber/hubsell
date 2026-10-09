// ============================================================
// PROBE (READ-ONLY): gọi thật get_income_overview + get_income_detail (Pending)
// trên gian Shopee đã nối để đối chiếu với ô "Chưa thanh toán" màn Doanh thu
// Seller Center (anh Trung 09/10/2026: cột "Doanh thu đang giao" trong Phân bổ
// dòng tiền không khớp sàn). Không ghi DB. Docs 10/2025 còn mâu thuẫn chỗ đặt
// total_income (trong hay ngoài `response`) — in NGUYÊN VĂN để chốt.
// Chạy:  cd backend && npx tsx scripts/shopee-income-probe.ts [external_shop_id]
// ============================================================

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getIncomeDetail, getIncomeOverview } from "../src/integrations/shopee/client";
import { getValidShopeeAccessToken } from "../src/integrations/shopee/service";

const fmt = (n: number) => Math.round(n).toLocaleString("vi-VN") + " ₫";

(async () => {
  const wantShopId = process.argv[2]?.trim();
  const channels = await prisma.channel.findMany({
    where: {
      channelName: "SHOPEE",
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(wantShopId ? { externalShopId: wantShopId } : {}),
    },
  });
  if (channels.length === 0) {
    console.log("❌ Không thấy gian Shopee đã nối API trong DB.");
    await prisma.$disconnect();
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const channel of channels) {
    console.log(`\n===== ${channel.shopName} (${channel.externalShopId}) =====`);
    try {
      const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

      // 1) Tổng theo trạng thái — không gửi income_status để sàn trả đủ.
      const ov = await getIncomeOverview({ accessToken, shopId });
      console.log("get_income_overview (nguyên văn):", JSON.stringify(ov));
      const totals = ov.response?.total_income ?? ov.total_income;
      if (totals) {
        console.log(`  Chưa thanh toán (pending_amount): ${fmt(Number(totals.pending_amount ?? 0))}`);
        console.log(`  Đã thanh toán  (released_amount): ${fmt(Number(totals.released_amount ?? 0))}`);
      }

      // 2) Từng đơn Pending — cộng lại để so với pending_amount và đếm đơn.
      let cursor = "";
      let pages = 0;
      let count = 0;
      let sum = 0;
      const statuses = new Map<string, number>();
      let shapeLogged = false;
      do {
        const d = await getIncomeDetail({
          accessToken,
          shopId,
          incomeStatus: 2,
          dateFrom: today,
          dateTo: today,
          cursor,
          pageSize: 50,
        });
        const block = d.response?.income_detail_list ?? d.income_detail_list;
        const list = block?.list ?? [];
        if (!shapeLogged && list[0]) {
          shapeLogged = true;
          console.log("  Mẫu dòng Pending (nguyên văn):", JSON.stringify(list[0]));
        }
        for (const it of list) {
          count++;
          sum += Number(it.estimated_escrow_amount ?? 0);
          const k = `${it.description ?? "?"} | ${it.status ?? "?"}`;
          statuses.set(k, (statuses.get(k) ?? 0) + 1);
        }
        cursor = block?.next_page?.cursor ?? "";
        pages++;
      } while (cursor && pages < 200);
      console.log(
        `  get_income_detail Pending: ${count} dòng / ${pages} trang, Σ estimated_escrow_amount = ${fmt(sum)}`
      );
      for (const [k, n] of statuses) console.log(`    ${n} dòng: ${k}`);

      // 3) Số app đang có trong DB cho cùng gian — để thấy lệch ở đâu.
      const [open] = await prisma.$queryRaw<{ ship: unknown; deliv: unknown; est: unknown; n: unknown }[]>`
        SELECT
          COALESCE(sum(CASE WHEN "shippingStatus" = 'SHIPPING'  THEN "totalAmount" END), 0) AS ship,
          COALESCE(sum(CASE WHEN "shippingStatus" = 'DELIVERED' THEN "totalAmount" END), 0) AS deliv,
          COALESCE(sum("expectedPayout"), 0) AS est,
          count(*) AS n
        FROM "Order"
        WHERE "channelId" = ${channel.id} AND NOT "isSettled" AND "shippingStatus" <> 'CANCELLED'
      `;
      console.log(
        `  DB app: ${Number(open.n)} đơn chưa quyết toán; Tổng tiền đang giao ${fmt(Number(open.ship))}, đã giao ${fmt(Number(open.deliv))}, Σ expectedPayout ${fmt(Number(open.est))}`
      );
    } catch (e) {
      console.log("✗ Lỗi gọi API:", (e as Error).message);
    }
  }
  await prisma.$disconnect();
})();
