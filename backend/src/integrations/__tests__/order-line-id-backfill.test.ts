// ============================================================
// BÙ ID LÁ CHO DÒNG ĐƠN CŨ (Lát 2, 18/10/2026 — docs/MO-HINH-CAY-SAN-PHAM-SAN.md mục 7):
//   1. planLineIds (thuần): 1↔1 ghi id + đổi khóa; gộp cùng SPU → ghi SPU; khác SPU / không khớp → bỏ; dòng đã có id không chạm.
//   2. runChannelBackfill trên DB dev, sàn Shopee mock: ưu tiên mồ côi, cursor, trigger sổ cái đánh dấu đơn (externalId đổi,
//      mã giữ nguyên vẫn tính lại), giữ nguyên giá vốn / productId, bộ đếm.
//   3. inferIdsByUniqueSku: gian không gọi được sàn — mã ↔ đúng một lá mới ghi.
// ============================================================

import "./load-env";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ShippingStatus } from "@prisma/client";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return { ...mod, getOrderDetail: vi.fn() };
});
vi.mock("../shopee/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/service")>();
  return { ...mod, getValidShopeeAccessToken: vi.fn(async () => ({ accessToken: "t", shopId: "s" })) };
});

import { prisma } from "../../lib/prisma";
import { ensureLedgerFresh } from "../../services/order-ledger";
import {
  inferIdsByUniqueSku,
  nextPendingOrders,
  planLineIds,
  runChannelBackfill,
  type ExistingLine,
  type PlatformLine,
} from "../../services/order-line-id-backfill";
import { getOrderDetail, type ShopeeOrderDetail } from "../shopee/client";
import { createStockFixture, type StockFixture } from "./fixtures";

describe("planLineIds — khớp dòng sàn với dòng đơn hiện có (thuần)", () => {
  const resolved = new Map<string, string>([
    ["100-1", "A"], // lá A, mã duy nhất
    ["200-1", "B (Đỏ)"], // hai lá cùng mã B → danh mục đã thêm đuôi
    ["200-2", "B (Xanh)"],
  ]);
  const keyOf = (k: string) => resolved.get(k);
  const line = (channelSku: string, externalId: string | null): PlatformLine => ({ channelSku, externalId });
  const item = (id: string, channelSku: string, externalId: string | null = null): ExistingLine => ({ id, channelSku, externalId });

  it("1 ↔ 1: ghi id lá, đổi mã sang khóa hiện hành của lá; danh mục chưa có lá thì giữ mã", () => {
    const p = planLineIds([item("i1", "A"), item("i2", "Z")], [line("A", "100-1"), line("Z", "900-9")], keyOf);
    expect(p.updates).toEqual([
      { id: "i1", externalId: "100-1", channelSku: "A" },
      { id: "i2", externalId: "900-9", channelSku: "Z" },
    ]);
    expect(p).toMatchObject({ linesSet: 2, linesSpu: 0, linesSkipped: 0 });
  });

  it("dòng tạo sau 15/10 ghi khóa có đuôi (không khớp id lúc tạo) cũng khớp được qua khóa hiện hành", () => {
    const p = planLineIds([item("i1", "B (Xanh)")], [line("B", "200-2")], keyOf);
    expect(p.updates).toEqual([{ id: "i1", externalId: "200-2", channelSku: "B (Xanh)" }]);
  });

  it("một dòng đơn ↔ hai lá cùng mã CÙNG SPU (gộp trước 15/10) → ghi SPU, giữ mã; khác SPU → bỏ, đếm", () => {
    const same = planLineIds([item("i1", "B")], [line("B", "200-1"), line("B", "200-2")], keyOf);
    expect(same.updates).toEqual([{ id: "i1", externalId: "200", channelSku: "B" }]);
    expect(same).toMatchObject({ linesSet: 0, linesSpu: 1, linesSkipped: 0 });
    const diff = planLineIds([item("i1", "B")], [line("B", "200-1"), line("B", "300")], keyOf);
    expect(diff.updates).toEqual([]);
    expect(diff.linesSkipped).toBe(1);
  });

  it("không khớp dòng sàn nào / dòng sàn không có id → bỏ, đếm; dòng đã có id không chạm", () => {
    const p = planLineIds([item("i1", "A"), item("i2", "A", "100-1")], [line("Q", "900-9"), line("A", null)], keyOf);
    expect(p.updates).toEqual([]);
    expect(p.linesSkipped).toBe(1);
    // Mã sàn trả khác mã dòng đơn nhưng id lá tra ra đúng khóa của dòng (seller đổi mã sau khi có đơn) → vẫn khớp qua id.
    expect(planLineIds([item("i1", "A")], [line("Q", "100-1")], keyOf).updates).toEqual([{ id: "i1", externalId: "100-1", channelSku: "A" }]);
  });
});

describe("runChannelBackfill — DB dev, Shopee mock", () => {
  let fx: StockFixture;
  const sku = (name: string) => `TEST-${fx.suffix}-${name}`;
  const mocked = vi.mocked(getOrderDetail);
  const ids: Record<string, string> = {};
  const codes: Record<string, string> = {};

  async function order(code: string, items: { channelSku: string; externalId?: string | null; qty?: number }[], daysAgo: number, cost = 40_000) {
    const o = await prisma.order.create({
      data: {
        channelId: fx.channelId,
        orderCode: `TEST-${fx.suffix}-${code}`,
        customerName: "Khách test",
        itemCount: items.length,
        createdAt: new Date(Date.now() - daysAgo * 86_400_000),
        shippingStatus: ShippingStatus.DELIVERED,
        items: {
          create: items.map((it) => ({
            channelSku: sku(it.channelSku),
            externalId: it.externalId ?? null,
            productName: it.channelSku,
            quantity: it.qty ?? 1,
            price: 100_000,
            costPriceAtSale: cost,
          })),
        },
      },
      include: { items: true },
    });
    codes[code] = o.orderCode;
    ids[code] = o.items[0].id;
    return o;
  }
  const model = (item_id: number, model_id: number, model_sku: string, qty = 1) => ({
    item_id,
    model_id,
    item_name: "SP",
    model_sku: sku(model_sku),
    model_quantity_purchased: qty,
    model_discounted_price: 100_000,
  });
  const detail = (code: string, item_list: ReturnType<typeof model>[]): ShopeeOrderDetail =>
    ({ order_sn: codes[code], order_status: "COMPLETED", item_list }) as unknown as ShopeeOrderDetail;

  beforeAll(async () => {
    fx = await createStockFixture("lineid");
    // Danh mục sau 15/10: A (lá duy nhất), B hai lá cùng mã đã thêm đuôi, C sản phẩm đơn.
    await prisma.channelProduct.createMany({
      data: [
        { channelId: fx.channelId, channelSku: sku("A"), productName: "A", externalId: "100-1" },
        { channelId: fx.channelId, channelSku: sku("B (Đỏ)"), productName: "B", externalId: "200-1" },
        { channelId: fx.channelId, channelSku: sku("B (Xanh)"), productName: "B", externalId: "200-2" },
        { channelId: fx.channelId, channelSku: sku("C"), productName: "C", externalId: "300" },
      ],
    });
    await order("O1", [{ channelSku: "A" }], 5); // không mồ côi (mã A còn trong danh mục)
    await order("O2", [{ channelSku: "B", qty: 2 }], 10); // mồ côi: hai lá cùng mã gộp
    await order("O3", [{ channelSku: "B" }], 20); // mồ côi: một lá
    await order("O4", [{ channelSku: "A", externalId: "100-1" }], 2); // đã có id — không chạm
    await order("OLD", [{ channelSku: "B" }], 120); // ngoài cửa sổ 90 ngày
    await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 1000 });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("phase orphan chỉ lấy đơn có dòng mã không còn trong danh mục, mới trước, trong 90 ngày", async () => {
    const orphan = await nextPendingOrders(fx.channelId, "orphan", null);
    expect(orphan.map((o) => o.orderCode)).toEqual([codes.O2, codes.O3]);
    const all = await nextPendingOrders(fx.channelId, "all", null);
    expect(all.map((o) => o.orderCode)).toEqual([codes.O1, codes.O2, codes.O3]);
    const after = await nextPendingOrders(fx.channelId, "all", orphan[0].createdAt);
    // Cursor so bằng mốc hằng UTC (timestampConst) — so Date tham số thẳng với cột timestamp(3) lệch theo TimeZone phiên.
    expect(after.map((o) => o.orderCode)).toEqual([codes.O3]);
  });

  it("hỏi sàn, ghi id / SPU, đổi khóa, giữ giá vốn; trigger sổ cái tính lại dòng chỉ đổi id; bộ đếm + cursor", async () => {
    mocked.mockImplementation(async (_t, _s, sns) => {
      const map: Record<string, ShopeeOrderDetail> = {
        [codes.O1]: detail("O1", [model(100, 1, "A")]),
        [codes.O2]: detail("O2", [model(200, 1, "B"), model(200, 2, "B")]),
        [codes.O3]: detail("O3", [model(200, 2, "B")]),
      };
      return sns.map((sn) => map[sn]).filter(Boolean);
    });
    const sleeps: number[] = [];
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });
    const r = await runChannelBackfill(channel, { phase: "orphan", cursorAt: null }, { sleep: async (ms) => void sleeps.push(ms), maxCalls: 10 });
    expect(r).toMatchObject({ phase: "done", ordersDone: 3, linesSet: 2, linesSpu: 1, linesSkipped: 0, apiCalls: 2 });
    expect(sleeps).toEqual([2_000]); // nghỉ giữa lượt orphan và lượt all

    const by = async (code: string) => prisma.orderItem.findUniqueOrThrow({ where: { id: ids[code] } });
    expect(await by("O1")).toMatchObject({ externalId: "100-1", channelSku: sku("A"), costPriceAtSale: expect.anything() });
    expect(Number((await by("O1")).costPriceAtSale)).toBe(40_000);
    expect(await by("O2")).toMatchObject({ externalId: "200", channelSku: sku("B"), quantity: 2 }); // gộp cùng SPU → SPU, mã giữ
    expect(await by("O3")).toMatchObject({ externalId: "200-2", channelSku: sku("B (Xanh)") }); // 1↔1 → id lá + khóa hiện hành
    expect(await by("O4")).toMatchObject({ externalId: "100-1" });
    expect((await by("OLD")).externalId).toBeNull(); // ngoài cửa sổ

    // O1 chỉ đổi externalId (mã giữ nguyên) → trigger mới vẫn đánh dấu → sổ dòng hàng có itemId sau khi tính lại.
    const fresh = await ensureLedgerFresh({ userId: fx.userId }, undefined, { maxInline: 1000 });
    expect(fresh.dirty).toBe(0);
    const lines = await prisma.$queryRaw<{ orderItemId: string; itemId: string | null }[]>`
      SELECT "orderItemId", "itemId" FROM "order_line_ledger" WHERE "orderItemId" IN (${ids.O1}, ${ids.O2}, ${ids.O3})`;
    const itemIdOf = new Map(lines.map((l) => [l.orderItemId, l.itemId]));
    expect(itemIdOf.get(ids.O1)).toBe("100");
    expect(itemIdOf.get(ids.O2)).toBe("200");
    expect(itemIdOf.get(ids.O3)).toBe("200");
  });

  it("chạm trần lượt gọi → trả phase + cursor để chạy tiếp; lượt sau không gọi lại đơn đã xong", async () => {
    await prisma.orderItem.updateMany({ where: { id: { in: [ids.O2, ids.O3] } }, data: { externalId: null, channelSku: sku("B") } });
    const channel = await prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });
    mocked.mockImplementation(async (_t, _s, sns) =>
      sns.map((sn) => (sn === codes.O2 ? detail("O2", [model(200, 1, "B"), model(200, 2, "B")]) : detail("O3", [model(200, 2, "B")])))
    );
    const r1 = await runChannelBackfill(channel, { phase: "orphan", cursorAt: null }, { sleep: async () => {}, maxCalls: 1 });
    expect(r1).toMatchObject({ phase: "orphan", apiCalls: 1, ordersDone: 2 });
    expect(r1.cursorAt).not.toBeNull();
    const r2 = await runChannelBackfill(channel, { phase: r1.phase as "orphan", cursorAt: r1.cursorAt }, { sleep: async () => {}, maxCalls: 10 });
    expect(r2).toMatchObject({ phase: "done", ordersDone: 0, apiCalls: 0 });
  });

  it("inferIdsByUniqueSku: mã ↔ đúng một lá mới ghi; mã ứng hai lá (B) không đoán", async () => {
    await prisma.orderItem.updateMany({ where: { id: { in: [ids.O1, ids.O3] } }, data: { externalId: null } });
    await prisma.orderItem.update({ where: { id: ids.O3 }, data: { channelSku: sku("B") } });
    const n = await inferIdsByUniqueSku(fx.channelId);
    expect(n).toBe(1);
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: ids.O1 } })).externalId).toBe("100-1");
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: ids.O3 } })).externalId).toBeNull();
  });
});
