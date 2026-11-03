// Tab Mapping giá vốn tính trong DB, không chặn theo cỡ danh mục (03/11/2026). Chạy trên DB dev.
// Đo tải, ghi kết quả ra tệp: COST_MAPPING_LOAD=do.txt npx vitest run src/lib/__tests__/cost-mapping-catalog-db.test.ts
import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName } from "@prisma/client";
import { prisma } from "../prisma";
import {
  applyRules,
  fillSuggested,
  listRulesWithCoverage,
  listSkuGroups,
  previewRules,
  setConflictDismissed,
} from "../cost-mapping";

const stamp = Date.now();
const LOAD = process.env.COST_MAPPING_LOAD ?? "";
let userId = "";
let chA = "";
let chB = "";
let chC = "";
let chOff = "";
let linkedProduct = "";
const code = (c: string) => `${c}${stamp}`;

const cp = (channelId: string, sku: string, over: { cost?: number; name?: string; variant?: string; ext?: string; productId?: string } = {}) =>
  prisma.channelProduct.create({
    data: {
      channelId,
      channelSku: sku,
      productName: over.name ?? `Sản phẩm ${sku}`,
      variantName: over.variant,
      externalId: over.ext,
      costPrice: over.cost,
      productId: over.productId,
    },
    select: { id: true },
  });

const page = async (q: { q?: string; status?: "all" | "suggest" | "conflict" | "missing" | "complete"; limit?: number } = {}) => {
  process.env.SKU_PRODUCTS_MAX_ROWS = "1";
  try {
    const r = await listSkuGroups(userId, undefined, q);
    if (!("serverPaged" in r) || !r.serverPaged) throw new Error("phải đi đường DB");
    return r as typeof r & { serverPaged: NonNullable<typeof r.serverPaged> };
  } finally {
    delete process.env.SKU_PRODUCTS_MAX_ROWS;
  }
};

describe("Mapping giá vốn tính trong DB", () => {
  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { email: `test-map-cat-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST", role: "ADMIN" },
        select: { id: true },
      })
    ).id;
    const mk = (name: ChannelName, ext: string) =>
      prisma.channel.create({
        data: { userId, channelName: name, shopName: `TEST-${ext}`, externalShopId: ext, status: "ACTIVE" },
        select: { id: true },
      });
    chA = (await mk(ChannelName.SHOPEE, `81${stamp}`)).id;
    chB = (await mk(ChannelName.TIKTOK, `82${stamp}`)).id;
    chC = (await mk(ChannelName.LAZADA, `84${stamp}`)).id;
    chOff = (await mk(ChannelName.OFFLINE, `83${stamp}`)).id;
    if (LOAD) return;

    linkedProduct = (
      await prisma.product.create({
        data: { userId, skuCode: code("KHO"), productName: "Kho", costPrice: 300, sellingPrice: 1 },
        select: { id: true },
      })
    ).id;

    // suggest: một gian có giá, gian kia trống; hoa thường và khoảng trắng khác nhau vẫn một mã.
    await cp(chA, code("sug"), { cost: 100, name: "Áo thun cotton size M" });
    await cp(chB, ` ${code("SUG")} `, { name: "Áo thun cotton size M", variant: "Đỏ tươi", ext: `555${stamp}-1` });
    // conflict + conflict đã giữ nguyên + complete + missing
    await cp(chA, code("LECH"), { cost: 100 });
    await cp(chB, code("LECH"), { cost: 200 });
    await cp(chA, code("GIU"), { cost: 100 });
    await cp(chB, code("GIU"), { cost: 200 });
    await setConflictDismissed(userId, code("GIU"), true);
    // Đã giữ lệch giá mà còn gian trống: thành thiếu giá, không đề xuất.
    await cp(chA, code("GIUTRONG"), { cost: 100 });
    await cp(chB, code("GIUTRONG"), { cost: 200 });
    await cp(chC, code("GIUTRONG"));
    await setConflictDismissed(userId, code("GIUTRONG"), true);
    await cp(chA, code("DU"), { cost: 100 });
    await cp(chB, code("DU"), { cost: 100 });
    await cp(chA, code("THIEU"));
    // Giá kho tính là giá hiệu lực.
    await cp(chA, code("NOI"), { productId: linkedProduct });
    await cp(chB, code("NOI"));
    // Gian OFFLINE không vào tab.
    await cp(chOff, code("OFF"));
  });

  afterAll(async () => {
    const channels = [chA, chB, chC, chOff];
    await prisma.orderItem.deleteMany({ where: { order: { channelId: { in: channels } } } });
    await prisma.order.deleteMany({ where: { channelId: { in: channels } } });
    await prisma.channelProduct.deleteMany({ where: { channelId: { in: channels } } });
    await prisma.product.deleteMany({ where: { userId } });
    await prisma.costPriceRule.deleteMany({ where: { userId } });
    await prisma.costConflictDismissal.deleteMany({ where: { userId } });
    await prisma.channel.deleteMany({ where: { id: { in: channels } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    delete process.env.SKU_PRODUCTS_MAX_ROWS;
  }, 300_000);

  it.skipIf(Boolean(LOAD))("đường DB ra đúng số và đúng trạng thái như đường gộp trong RAM", async () => {
    const ram = await listSkuGroups(userId);
    expect("serverPaged" in ram).toBe(false);
    const db = await page({ limit: 5000 });
    expect(db.totals).toEqual(ram.totals);
    const shape = (gs: typeof ram.groups) =>
      Object.fromEntries(gs.map((g) => [g.code, [g.status, g.suggestedCost, g.entries.length]]));
    expect(shape(db.groups)).toEqual(shape(ram.groups));
    expect(db.serverPaged.shops.map((s) => s.channelId).sort()).toEqual([chA, chB, chC].sort());
    expect(JSON.stringify(db.groups)).not.toContain("OFF");
  });

  it.skipIf(Boolean(LOAD))("lọc theo nhóm, tìm bỏ dấu, tìm mã sàn, chia trang", async () => {
    const conflict = await page({ status: "conflict" });
    expect(conflict.groups.every((g) => g.status === "conflict")).toBe(true);
    expect(conflict.groups.length).toBe(conflict.serverPaged.matchedCodes);
    expect(conflict.totals.codes).toBeGreaterThan(conflict.groups.length); // chip vẫn đếm cả phạm vi

    const byName = await page({ q: "ao thun" });
    expect(byName.groups.map((g) => g.code)).toEqual([code("SUG")]);
    expect(byName.groups[0].entries).toHaveLength(2); // đủ mọi gian của mã, không chỉ dòng khớp
    expect((await page({ q: "do tuoi" })).groups.map((g) => g.code)).toEqual([code("SUG")]);
    expect((await page({ q: `555${stamp}-1` })).groups.map((g) => g.code)).toEqual([code("SUG")]);
    expect((await page({ q: "khong-co-ma-nay" })).groups).toEqual([]);

    const first = await page({ limit: 2 });
    expect(first.groups).toHaveLength(2);
    expect(first.serverPaged.canLoadMore).toBe(true);
    const all = await page({ limit: 5000 });
    expect(all.serverPaged.canLoadMore).toBe(false);
    expect(all.groups.slice(0, 2).map((g) => g.code)).toEqual(first.groups.map((g) => g.code));
  });

  it.skipIf(Boolean(LOAD))("bảng giá theo mã mẫu đọc theo lô, đếm đủ, ghi đúng; Điền tất cả chỉ điền ô trống", async () => {
    await prisma.costPriceRule.create({ data: { userId, code: code("THIEU"), costPrice: 42 } });
    const cov = await listRulesWithCoverage(userId);
    expect(cov.coveredSkus).toBe(1);
    const pv = await previewRules(userId);
    expect(pv.counts.fill).toBe(1);
    expect(pv.rows.map((r) => r.status)).toEqual(["fill"]);
    expect((await applyRules(userId, [])).filled).toBe(1);
    const thieu = await prisma.channelProduct.findFirstOrThrow({ where: { channelId: chA, channelSku: code("THIEU") } });
    expect(Number(thieu.costPrice)).toBe(42);

    const f = await fillSuggested(userId);
    expect(f.codes).toBe(2); // SUG + NOI
    const sug = await prisma.channelProduct.findFirstOrThrow({ where: { channelId: chB, channelSku: ` ${code("SUG")} ` } });
    expect(Number(sug.costPrice)).toBe(100);
    const noi = await prisma.channelProduct.findFirstOrThrow({ where: { channelId: chB, channelSku: code("NOI") } });
    expect(Number(noi.costPrice)).toBe(300);
    const lech = await prisma.channelProduct.findFirstOrThrow({ where: { channelId: chB, channelSku: code("LECH") } });
    expect(Number(lech.costPrice)).toBe(200);
  });

  it.runIf(Boolean(LOAD))(
    "đo: 57.877 dòng trên 2 gian",
    async () => {
      const ROWS = 57877;
      for (let i = 0; i < ROWS; i += 5000) {
        await prisma.channelProduct.createMany({
          data: Array.from({ length: Math.min(5000, ROWS - i) }, (_, k) => {
            const n = i + k;
            return {
              channelId: n < 18988 ? chB : chA,
              channelSku: `R${stamp}-${n % 45000}`,
              externalId: `${900000 + Math.floor(n / 4)}-${n}`,
              productName: `Sản phẩm thử nghiệm số ${Math.floor(n / 4)} váy đầm mùa hè`,
              variantName: `Phân loại ${n % 7}`,
              costPrice: n % 3 === 0 ? 5000 + (n % 40) : null,
            };
          }),
        });
      }
      const rss = () => Math.round(process.memoryUsage().rss / 1048576);
      const run = async (name: string, fn: () => Promise<unknown>) => {
        const before = rss();
        let peak = before;
        const timer = setInterval(() => (peak = Math.max(peak, rss())), 25);
        const t = Date.now();
        await fn();
        clearInterval(timer);
        appendFileSync(LOAD, `${name}: ${Date.now() - t} ms, RSS tăng ${Math.max(peak, rss()) - before} MB\n`);
      };
      await run("mở tab", () => page());
      await run("mở tab lần 2", () => page());
      await run("lọc đề xuất", () => page({ status: "suggest" }));
      await run("tìm tên", () => page({ q: "vay dam so 1234" }));
      await run("xem cả 2.000 mã", () => page({ limit: 2000 }));
      await run("xem trước bảng giá, chưa có mã", () => listRulesWithCoverage(userId));
      await prisma.costPriceRule.create({ data: { userId, code: `R${stamp}-1`, costPrice: 42 } });
      await run("độ phủ bảng giá, đọc theo lô", () => listRulesWithCoverage(userId));
      await run("xem trước bảng giá, đọc theo lô", () => previewRules(userId));
      await run("Điền tất cả", () => fillSuggested(userId));
    },
    590_000
  );
});
