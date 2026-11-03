// Áp một giá cho tất cả mã vừa tìm (03/11/2026). Chạy trên DB dev.
// Đo tải, ghi kết quả ra tệp: COST_SEARCH_LOAD=do.txt npx vitest run src/lib/__tests__/cost-search-apply-db.test.ts
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import {
  SearchApplyChangedError,
  SearchApplyInputError,
  applySearchCost,
  previewSearchApply,
  readSearchApplyFilters,
  summarizeSearchApply,
  type SearchApplyFilters,
} from "../cost-search-apply";

const stamp = Date.now();
const LOAD = process.env.COST_SEARCH_LOAD ?? "";
const fam = `FAM${stamp}`;
let userId = "";
let otherId = "";
let chA = "";
let chB = "";
let chOther = "";
let stock = "";

const filters = (over: Partial<SearchApplyFilters> = {}): SearchApplyFilters => ({
  ownerId: userId,
  channelName: null,
  channelId: null,
  q: fam,
  status: "all",
  listing: "active",
  ...over,
});
const costOf = async (channelId: string, channelSku: string) => {
  const r = await prisma.channelProduct.findFirstOrThrow({ where: { channelId, channelSku } });
  return r.costPrice === null ? null : Number(r.costPrice);
};

describe("áp giá cho tất cả mã vừa tìm", () => {
  beforeAll(async () => {
    const mkUser = (tag: string) =>
      prisma.user.create({
        data: { email: `test-search-apply-${tag}-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
        select: { id: true },
      });
    userId = (await mkUser("a")).id;
    otherId = (await mkUser("b")).id;
    const mk = (owner: string, name: ChannelName, ext: string) =>
      prisma.channel.create({
        data: { userId: owner, channelName: name, shopName: `TEST-${ext}`, externalShopId: ext, status: "ACTIVE" },
        select: { id: true },
      });
    chA = (await mk(userId, ChannelName.SHOPEE, `91${stamp}`)).id;
    chB = (await mk(userId, ChannelName.TIKTOK, `92${stamp}`)).id;
    chOther = (await mk(otherId, ChannelName.SHOPEE, `93${stamp}`)).id;
    if (LOAD) return;
    stock = (
      await prisma.product.create({
        data: { userId, skuCode: `KHO-${stamp}`, productName: "Kho", costPrice: 300, sellingPrice: 1 },
        select: { id: true },
      })
    ).id;
    await prisma.channelProduct.createMany({
      data: [
        { channelId: chA, channelSku: `${fam}-TRONG`, productName: "Trống", externalId: `1${stamp}-1` },
        { channelId: chA, channelSku: `${fam}-CO`, productName: "Có giá", costPrice: 100, externalId: `2${stamp}-1` },
        { channelId: chA, channelSku: `${fam}-DUNG`, productName: "Đúng giá sẵn", costPrice: 500, externalId: `3${stamp}-1` },
        { channelId: chA, channelSku: `X${fam}-GIUA`, productName: "Chứa ở giữa", externalId: `4${stamp}-1` },
        { channelId: chA, channelSku: `${fam}-GO`, productName: "Đã gỡ", status: "DELISTED", externalId: `5${stamp}-1` },
        { channelId: chA, channelSku: `CHI-TEN-${stamp}`, productName: `Tên có ${fam}`, externalId: `6${stamp}-1` },
        { channelId: chB, channelSku: `${fam}-TT`, productName: "Gian khác", externalId: `7${stamp}-1` },
        // Có giá nhờ kho: tính là đã có giá, không phải ô trống.
        { channelId: chB, channelSku: `${fam}-KHO`, productName: "Theo kho", productId: stock, externalId: `8${stamp}-1` },
        { channelId: chOther, channelSku: `${fam}-KHAC`, productName: "Chủ shop khác", externalId: `9${stamp}-1` },
      ],
    });
  });

  afterAll(async () => {
    const channels = [chA, chB, chOther];
    await prisma.orderItem.deleteMany({ where: { order: { channelId: { in: channels } } } });
    await prisma.order.deleteMany({ where: { channelId: { in: channels } } });
    await prisma.channelProduct.deleteMany({ where: { channelId: { in: channels } } });
    await prisma.product.deleteMany({ where: { userId } });
    await prisma.channel.deleteMany({ where: { id: { in: channels } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  }, 300_000);

  it.skipIf(Boolean(LOAD))("thiếu từ khóa thì không chạm gì, kể cả chỉ có khoảng trắng", async () => {
    await expect(summarizeSearchApply(filters({ q: "   " }))).rejects.toBeInstanceOf(SearchApplyInputError);
    await expect(applySearchCost(filters({ q: "" }), 500, true, 0)).rejects.toBeInstanceOf(SearchApplyInputError);
  });

  it.skipIf(Boolean(LOAD))("đếm đúng: chỉ khớp mã, chỉ chủ shop này, bộ lọc che thì everywhere lớn hơn", async () => {
    expect(await summarizeSearchApply(filters())).toEqual({ matched: 6, missing: 3, filled: 3, everywhere: 7 });
    expect(await summarizeSearchApply(filters({ channelId: chB }))).toEqual({ matched: 2, missing: 1, filled: 1, everywhere: 7 });
    expect(await summarizeSearchApply(filters({ channelName: ChannelName.TIKTOK, status: "missing" }))).toEqual({
      matched: 1,
      missing: 1,
      filled: 0,
      everywhere: 7,
    });
  });

  it.skipIf(Boolean(LOAD))("xem trước: mặc định chỉ ô trống; ghi đè bỏ dòng đúng giá sẵn, liệt kê giá cũ và mã ở giữa", async () => {
    const fill = await previewSearchApply(filters(), 500, false);
    expect(fill).toMatchObject({ rows: 3, fill: 3, overwrite: 0, levels: [], levelCount: 0, middleRows: 1 });
    expect(fill.middleSamples).toEqual([`X${fam}-GIUA`]);
    expect(fill.samples[0].startsWith(fam)).toBe(true);
    const over = await previewSearchApply(filters(), 500, true);
    expect(over).toMatchObject({ rows: 5, fill: 3, overwrite: 2, levelCount: 2 });
    expect(over.levels.map((l) => l.cost).sort((a, b) => a - b)).toEqual([100, 300]);
  });

  it.skipIf(Boolean(LOAD))("số lệch với lúc xác nhận thì không ghi gì", async () => {
    await expect(applySearchCost(filters(), 500, false, 99)).rejects.toBeInstanceOf(SearchApplyChangedError);
    expect(await costOf(chA, `${fam}-TRONG`)).toBeNull();
    await expect(applySearchCost(filters(), 0, false, 3)).rejects.toBeInstanceOf(SearchApplyInputError);
  });

  it.skipIf(Boolean(LOAD))("chỉ điền ô trống rồi mới ghi đè; đúng phạm vi, vá đơn cũ đang 0", async () => {
    const order = await prisma.order.create({
      data: {
        channelId: chA,
        orderCode: `T-${stamp}-1`,
        customerName: "Khách test",
        itemCount: 1,
        items: { create: { channelSku: `${fam}-TRONG`, externalId: `1${stamp}-1`, productName: "x", quantity: 1, price: 1 } },
      },
      select: { items: { select: { id: true } } },
    });
    const r = await applySearchCost(filters(), 500, false, 3);
    expect(r).toEqual({ updated: 3, backfilled: 1 });
    expect(await costOf(chA, `${fam}-TRONG`)).toBe(500);
    expect(await costOf(chA, `X${fam}-GIUA`)).toBe(500);
    expect(await costOf(chB, `${fam}-TT`)).toBe(500);
    expect(await costOf(chA, `${fam}-CO`)).toBe(100);
    expect(await costOf(chB, `${fam}-KHO`)).toBeNull();
    expect(await costOf(chA, `${fam}-GO`)).toBeNull();
    expect(await costOf(chA, `CHI-TEN-${stamp}`)).toBeNull();
    expect(await costOf(chOther, `${fam}-KHAC`)).toBeNull();
    const line = await prisma.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } });
    expect(Number(line.costPriceAtSale)).toBe(500);

    const o = await applySearchCost(filters(), 600, true, 6);
    expect(o.updated).toBe(6);
    expect(await costOf(chA, `${fam}-CO`)).toBe(600);
    expect(await costOf(chB, `${fam}-KHO`)).toBe(600);
    expect(await costOf(chA, `${fam}-GO`)).toBeNull();
    // Dòng đơn đã có giá không đổi khi ghi đè.
    const again = await prisma.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } });
    expect(Number(again.costPriceAtSale)).toBe(500);
  });

  it.skipIf(Boolean(LOAD))("đọc bộ lọc từ request", () => {
    const f = readSearchApplyFilters("u", { q: "  abc ", channel: "SHOPEE", shop: "s1", status: "missing", listing: "all" });
    expect(f).toEqual({ ownerId: "u", q: "abc", channelName: ChannelName.SHOPEE, channelId: "s1", status: "missing", listing: "all" });
    expect(readSearchApplyFilters("u", { q: "a", channel: "all", shop: "all" })).toEqual({
      ownerId: "u",
      q: "a",
      channelName: null,
      channelId: null,
      status: "all",
      listing: "active",
    });
  });

  it.runIf(Boolean(LOAD))(
    "đo: 57.877 dòng, từ khóa khớp 24.545 dòng",
    async () => {
      const ROWS = 57877;
      for (let i = 0; i < ROWS; i += 5000) {
        await prisma.channelProduct.createMany({
          data: Array.from({ length: Math.min(5000, ROWS - i) }, (_, k) => {
            const n = i + k;
            return {
              channelId: n < 18988 ? chB : chA,
              channelSku: n < 24545 ? `${fam}-${n}` : `R${stamp}-${n}`,
              externalId: `${900000 + Math.floor(n / 12)}-${n}`,
              productName: `Sản phẩm số ${Math.floor(n / 12)}`,
              costPrice: n % 5 === 0 ? null : 85000,
            };
          }),
        });
      }
      const rss = () => Math.round(process.memoryUsage().rss / 1048576);
      const run = async <T,>(name: string, fn: () => Promise<T>) => {
        const before = rss();
        let peak = before;
        const timer = setInterval(() => (peak = Math.max(peak, rss())), 25);
        const t = Date.now();
        const r = await fn();
        clearInterval(timer);
        appendFileSync(LOAD, `${name}: ${Date.now() - t} ms, RSS tăng ${Math.max(peak, rss()) - before} MB\n`);
        return r;
      };
      const sum = await run("số trên dải", () => summarizeSearchApply(filters({ listing: "all" })));
      expect(sum.matched).toBe(24545);
      const pv = await run("xem trước ghi đè", () => previewSearchApply(filters({ listing: "all" }), 90000, true));
      expect(pv.rows).toBe(24545);
      const a = await run("ghi đè 24.545 dòng", () => applySearchCost(filters({ listing: "all" }), 90000, true, 24545));
      expect(a.updated).toBe(24545);
    },
    590_000
  );
});
