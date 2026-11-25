// ============================================================
// DANH SÁCH ĐƠN — câu lấy trang theo từng gian (services/order-list.ts) phải ra ĐÚNG các đơn, ĐÚNG thứ tự
// như đường Prisma cũ, trên Postgres thật (25/11/2026, docs/DONG-BO-GIAI-DOAN-3.md mục 8.10).
// So id hai đường trên mọi bộ lọc × phạm vi gian × vị trí trang. Bộ lọc viết hai lần (where Prisma + SQL) nên
// test này là rào chống lệch: thêm bộ lọc mới mà quên một bên thì đỏ ở đây.
// Tự tạo một chủ shop thử 3 gian + một chủ shop "nhiễu", xong tự xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Carrier, ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";
import type { ChannelScope } from "../../lib/channel-filter";
import { prisma } from "../../lib/prisma";
import {
  type OrderListFilters,
  orderListWhere,
  parseOrderListFilters,
  restOrderIdsPage,
  restOrderWhere,
} from "../order-list";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT "itemCount", "packingDoneAt", "cancelRequestedAt" FROM "Order" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `olist-${Date.now()}`;
const BASE = Date.parse("2026-11-01T00:00:00.000Z");

/** Đường đối chứng: đúng mảnh where cũ của route, thêm luật trùng giây theo id để so được từng vị trí. */
async function legacyIds(scope: ChannelScope, f: OrderListFilters, skip: number, take: number): Promise<string[]> {
  const rows = await prisma.order.findMany({
    where: restOrderWhere(orderListWhere(scope, f)),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

describe.skipIf(!dbReady)("Danh sách đơn — lấy trang theo từng gian khớp đường Prisma cũ", () => {
  let owner = "";
  let noise = "";
  const ch: string[] = [];
  let chNoise = "";

  beforeAll(async () => {
    const mkUser = async (suffix: string) =>
      (
        await prisma.user.create({
          data: { email: `${TAG}-${suffix}@test.local`, passwordHash: "x", fullName: `${TAG}-${suffix}` },
          select: { id: true },
        })
      ).id;
    owner = await mkUser("a");
    noise = await mkUser("b");
    const mkCh = async (userId: string, channelName: ChannelName, n: string) =>
      (await prisma.channel.create({ data: { userId, channelName, shopName: `${TAG}-${n}` }, select: { id: true } })).id;
    ch.push(await mkCh(owner, ChannelName.SHOPEE, "sp1"));
    ch.push(await mkCh(owner, ChannelName.SHOPEE, "sp2"));
    ch.push(await mkCh(owner, ChannelName.TIKTOK, "tt"));
    chNoise = await mkCh(noise, ChannelName.SHOPEE, "noise");

    const statuses = Object.values(ShippingStatus);
    const carrierNames = [null, "SPX Express", "Hỏa Tốc - Ahamove", "GrabExpress", "J&T Express", "SPX Instant", "Giao Hàng Nhanh"];
    const carriers = [null, Carrier.SPX, Carrier.GHN, Carrier.JT];
    const returns = Object.values(ReturnStatus);
    const names = ["Nguyễn Văn A", "trần thị b", "Lê 100% OK", "Phạm_C", "Khách \\ lạ"];
    const data = [];
    for (let i = 0; i < 180; i++) {
      const channelId = i % 9 === 0 ? chNoise : ch[i % 3];
      data.push({
        channelId,
        orderCode: `${TAG}-${String(i).padStart(4, "0")}${i % 11 === 0 ? "_X" : ""}`,
        customerName: names[i % names.length],
        customerPhone: i % 4 === 0 ? null : `09${String(10000000 + i * 7919).slice(0, 8)}`,
        totalAmount: 100000 + i,
        shippingStatus: statuses[i % statuses.length],
        shippingCarrierName: carrierNames[i % carrierNames.length],
        carrier: carriers[i % carriers.length],
        trackingCode: i % 3 === 0 ? null : `${TAG}VD${i}`,
        returnTrackingCode: i % 10 === 0 ? `${TAG}HOAN${i}` : null,
        returnStatus: i % 13 === 0 ? returns[1] : returns[0],
        itemCount: i % 5 === 0 ? 0 : i % 2 === 0 ? 1 : 3,
        labelPrintedAt: i % 3 === 1 ? new Date(BASE) : null,
        packingDoneAt: i % 6 === 1 ? new Date(BASE) : null,
        cancelRequestedAt: i % 17 === 0 ? new Date(BASE) : null,
        // Cứ 4 đơn liền nhau trùng giây tạo → kiểm luật trùng giây qua ranh giới trang.
        createdAt: new Date(BASE + Math.floor(i / 4) * 60_000),
      });
    }
    await prisma.order.createMany({ data });
  });

  afterAll(async () => {
    const channelIds = [...ch, chNoise].filter(Boolean);
    if (channelIds.length) {
      await prisma.order.deleteMany({ where: { channelId: { in: channelIds } } });
      await prisma.channel.deleteMany({ where: { id: { in: channelIds } } });
    }
    const users = [owner, noise].filter(Boolean);
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const filterCases: Record<string, Record<string, unknown>> = {
    "không lọc (tab Tất cả)": {},
    "tab Chờ xử lý": { shippingStatus: "PENDING" },
    "tab Đã xử lý": { shippingStatus: "PROCESSED" },
    "tab Đã giao": { shippingStatus: "DELIVERED" },
    "Đã xử lý · chưa in": { shippingStatus: "PROCESSED", printed: "no" },
    "Đã xử lý · đã in chưa gói": { shippingStatus: "PROCESSED", printed: "yes" },
    "đã đóng gói": { printed: "packed" },
    "hỏa tốc": { carrier: "EXPRESS" },
    "hãng SPX": { carrier: "SPX" },
    "hãng lạ (bỏ qua)": { carrier: "KHONG_CO" },
    "đơn 1 dòng": { orderType: "single" },
    "đơn nhiều dòng": { orderType: "multi" },
    "đơn hoàn": { returnStatus: Object.values(ReturnStatus)[1] },
    "khách xin hủy (nhóm thường phải rỗng)": { cancelRequested: "1" },
    "tìm mã đơn": { search: `${TAG}-001` },
    "tìm tên không phân biệt hoa thường": { search: "TRẦN THỊ" },
    "tìm số điện thoại có dấu cách": { search: "09 10" },
    "tìm mã vận đơn": { search: `${TAG}vd1` },
    "tìm mã vận đơn hoàn": { search: `${TAG}HOAN` },
    "tìm ký tự %": { search: "100%" },
    "tìm ký tự _": { search: "_" },
    "tìm ký tự \\": { search: "\\" },
    "gộp nhiều bộ lọc": { shippingStatus: "DELIVERED", orderType: "multi", search: "nguyễn" },
  };

  it("mọi bộ lọc × phạm vi gian × vị trí trang: cùng id, cùng thứ tự", async () => {
    const scopes: Record<string, ChannelScope> = {
      "cả shop": { userId: owner },
      "một gian": { userId: owner, id: ch[1] },
      "nhân viên 2 gian": { userId: owner, id: { in: [ch[0], ch[2]] } },
      "nhân viên chưa được phân gian": { userId: owner, id: { in: [] } },
      "lọc theo sàn": { userId: owner, channelName: ChannelName.SHOPEE },
      "gian của shop khác (phải rỗng)": { userId: owner, id: chNoise },
    };
    const pages: [number, number][] = [
      [0, 20],
      [0, 7],
      [7, 7],
      [14, 7],
      [3, 50],
      [150, 20],
    ];
    let compared = 0;
    let nonEmpty = 0;
    for (const [fname, query] of Object.entries(filterCases)) {
      const f = parseOrderListFilters(query);
      for (const [sname, scope] of Object.entries(scopes)) {
        for (const [skip, take] of pages) {
          const [want, got] = await Promise.all([legacyIds(scope, f, skip, take), restOrderIdsPage(scope, f, skip, take)]);
          expect(got, `${fname} · ${sname} · skip ${skip} take ${take}`).toEqual(want);
          compared++;
          if (want.length) nonEmpty++;
        }
      }
    }
    expect(compared).toBe(Object.keys(filterCases).length * Object.keys(scopes).length * pages.length);
    // Chống test "xanh vì rỗng": phải có nhiều ca thật sự có dòng.
    expect(nonEmpty).toBeGreaterThan(compared / 4);
  }, 180_000);

  it("không bao giờ lọt đơn của shop khác, kể cả khi shop mình không còn dòng nào khớp", async () => {
    const mine = new Set(
      (await prisma.order.findMany({ where: { channelId: { in: ch } }, select: { id: true } })).map((o) => o.id)
    );
    const all = await restOrderIdsPage({ userId: owner }, parseOrderListFilters({}), 0, 500);
    expect(all.length).toBeGreaterThan(100);
    expect(all.every((id) => mine.has(id))).toBe(true);
    expect(
      await restOrderIdsPage({ userId: owner }, parseOrderListFilters({ search: "khong-co-don-nao-nhu-the" }), 0, 20)
    ).toEqual([]);
  });

  it("take = 0 không chạm database; trang vượt cuối trả rỗng", async () => {
    expect(await restOrderIdsPage({ userId: owner }, parseOrderListFilters({}), 0, 0)).toEqual([]);
    expect(await restOrderIdsPage({ userId: owner }, parseOrderListFilters({}), 10_000, 20)).toEqual([]);
  });
});
