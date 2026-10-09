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
import {
  getIncomeDetail,
  getIncomeOverview,
} from "../src/integrations/shopee/client";
import { getValidShopeeAccessToken } from "../src/integrations/shopee/service";
import { LEDGER_FORMULA_VERSION } from "../src/lib/order-ledger";

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
    console.log(
      `\n===== ${channel.shopName} (${channel.externalShopId}) =====`,
    );
    try {
      const { accessToken, shopId } = await getValidShopeeAccessToken(channel);

      // 1) Tổng theo trạng thái — không gửi income_status để sàn trả đủ.
      const ov = await getIncomeOverview({ accessToken, shopId });
      console.log("get_income_overview (nguyên văn):", JSON.stringify(ov));
      const totals = ov.response?.total_income ?? ov.total_income;
      if (totals) {
        console.log(
          `  Chưa thanh toán (pending_amount): ${fmt(Number(totals.pending_amount ?? 0))}`,
        );
        console.log(
          `  Đã thanh toán  (released_amount): ${fmt(Number(totals.released_amount ?? 0))}`,
        );
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
        // Lượt chạy prod 09/10: mọi gian trả 0 dòng dù pending_amount > 0 → in
        // NGUYÊN VĂN trang đầu (cắt 800 ký tự) để thấy sàn đặt danh sách ở đâu.
        if (!shapeLogged) {
          shapeLogged = true;
          console.log(
            "  get_income_detail trang đầu (nguyên văn):",
            JSON.stringify(d).slice(0, 800),
          );
        }
        const block = d.response?.income_detail_list ?? d.income_detail_list;
        const list = block?.list ?? [];
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
        `  get_income_detail Pending: ${count} dòng / ${pages} trang, Σ estimated_escrow_amount = ${fmt(sum)}`,
      );
      for (const [k, n] of statuses) console.log(`    ${n} dòng: ${k}`);

      // 3) Số app đang có trong DB cho cùng gian — để thấy lệch ở đâu.
      // Tách theo trạng thái vận đơn + tuổi đơn: lượt 09/10 Σ expectedPayout DB
      // LỚN HƠN pending_amount sàn ở 3/5 gian → nghi đơn cũ sàn đã chi/hủy mà
      // app còn giữ isSettled=false, hoặc ước tính của đơn chưa bàn giao.
      const rows = await prisma.$queryRaw<
        {
          s: string;
          n: unknown;
          tot: unknown;
          est: unknown;
          nest: unknown;
          old: unknown;
        }[]
      >`
        SELECT "shippingStatus"::text AS s, count(*) AS n,
          COALESCE(sum("totalAmount"), 0) AS tot,
          COALESCE(sum("expectedPayout"), 0) AS est,
          count("expectedPayout") AS nest,
          count(*) FILTER (WHERE "createdAt" < now() - interval '30 days') AS old
        FROM "Order"
        WHERE "channelId" = ${channel.id} AND NOT "isSettled" AND "shippingStatus" <> 'CANCELLED'
        GROUP BY 1 ORDER BY 1
      `;
      for (const r of rows) {
        console.log(
          `  DB ${r.s}: ${Number(r.n)} đơn (${Number(r.old)} đơn >30 ngày), Tổng tiền ${fmt(Number(r.tot))}, Σ expectedPayout ${fmt(Number(r.est))} trên ${Number(r.nest)} đơn có ước tính`,
        );
      }

      // 4) SỔ CÁI (nguồn của bảng Phân bổ dòng tiền) so với bảng Order: ảnh anh
      // Trung 09/10 tối: ANO "chờ đối soát" 399,8tr trong khi Order chỉ 1,46tr.
      const led = await prisma.$queryRaw<
        { s: string; n: unknown; v: unknown; dirty: unknown; stale: unknown }[]
      >`
        SELECT "shippingStatus"::text AS s, count(*) AS n,
          COALESCE(sum("platformRevenue"), 0) AS v,
          count(*) FILTER (WHERE "dirtyAt" IS NOT NULL) AS dirty,
          count(*) FILTER (WHERE "formulaVersion" <> ${LEDGER_FORMULA_VERSION}::int) AS stale
        FROM "order_ledger"
        WHERE "channelId" = ${channel.id} AND NOT "isSettled" AND "shippingStatus" IN ('SHIPPING', 'DELIVERED')
        GROUP BY 1 ORDER BY 1
      `;
      for (const r of led) {
        console.log(
          `  SỔ CÁI ${r.s} chưa quyết toán: ${Number(r.n)} dòng, Σ platformRevenue ${fmt(Number(r.v))}, bẩn ${Number(r.dirty)}, công thức cũ ${Number(r.stale)}`,
        );
      }
      // Dòng sổ cái nói CHƯA quyết toán nhưng Order nói ĐÃ / đã hủy — mẫu 5 dòng.
      const mism = await prisma.$queryRaw<
        {
          code: string;
          ls: string;
          os: string;
          oset: boolean;
          lv: unknown;
          comp: Date | null;
          dirty: Date | null;
          upd: Date;
        }[]
      >`
        SELECT l."orderCode" AS code, l."shippingStatus"::text AS ls, o."shippingStatus"::text AS os,
          o."isSettled" AS oset, l."platformRevenue" AS lv, l."computedAt" AS comp, l."dirtyAt" AS dirty, o."updatedAt" AS upd
        FROM "order_ledger" l JOIN "Order" o ON o.id = l."orderId"
        WHERE l."channelId" = ${channel.id} AND NOT l."isSettled" AND l."shippingStatus" IN ('SHIPPING', 'DELIVERED')
          AND (o."isSettled" OR o."shippingStatus" <> l."shippingStatus")
        ORDER BY l."platformRevenue" DESC
        LIMIT 5
      `;
      const [mc] = await prisma.$queryRaw<{ n: unknown; v: unknown }[]>`
        SELECT count(*) AS n, COALESCE(sum(l."platformRevenue"), 0) AS v
        FROM "order_ledger" l JOIN "Order" o ON o.id = l."orderId"
        WHERE l."channelId" = ${channel.id} AND NOT l."isSettled" AND l."shippingStatus" IN ('SHIPPING', 'DELIVERED')
          AND (o."isSettled" OR o."shippingStatus" <> l."shippingStatus")
      `;
      console.log(
        `  SỔ CÁI lệch Order: ${Number(mc.n)} dòng, Σ ${fmt(Number(mc.v))}`,
      );
      // Dòng sổ MỒ CÔI (Order đã xóa) hoặc TRÙNG (một orderId nằm ở hai createdDate).
      const [orph] = await prisma.$queryRaw<
        { orphan: unknown; ov: unknown; dup: unknown; dv: unknown }[]
      >`
        SELECT
          (SELECT count(*) FROM "order_ledger" l LEFT JOIN "Order" o ON o.id = l."orderId"
             WHERE l."channelId" = ${channel.id} AND o.id IS NULL) AS orphan,
          (SELECT COALESCE(sum(l."platformRevenue"), 0) FROM "order_ledger" l LEFT JOIN "Order" o ON o.id = l."orderId"
             WHERE l."channelId" = ${channel.id} AND o.id IS NULL AND NOT l."isSettled") AS ov,
          (SELECT count(*) FROM (SELECT "orderId" FROM "order_ledger" WHERE "channelId" = ${channel.id}
             GROUP BY "orderId" HAVING count(*) > 1) d) AS dup,
          (SELECT COALESCE(sum(v), 0) FROM (SELECT sum("platformRevenue") - max("platformRevenue") AS v FROM "order_ledger"
             WHERE "channelId" = ${channel.id} AND NOT "isSettled" GROUP BY "orderId" HAVING count(*) > 1) d2) AS dv
      `;
      console.log(
        `  SỔ CÁI mồ côi: ${Number(orph.orphan)} dòng (chưa quyết toán Σ ${fmt(Number(orph.ov))}); trùng orderId: ${Number(orph.dup)} đơn (phần thừa chưa quyết toán Σ ${fmt(Number(orph.dv))})`,
      );

      for (const m of mism) {
        console.log(
          `    ${m.code}: sổ ${m.ls} / Order ${m.os}${m.oset ? " ĐÃ quyết toán" : ""}, ${fmt(Number(m.lv))}, sổ tính ${m.comp?.toISOString().slice(0, 16) ?? "-"}, bẩn ${m.dirty ? m.dirty.toISOString().slice(0, 16) : "không"}, Order sửa ${m.upd.toISOString().slice(0, 16)}`,
        );
      }
    } catch (e) {
      console.log("✗ Lỗi gọi API:", (e as Error).message);
    }
  }
  await prisma.$disconnect();
})();
