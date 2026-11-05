// ============================================================
// KÉO DANH MỤC TĂNG DẦN + CHỈ GHI DÒNG KHÁC BIỆT (lát 3.9 GĐ3, 05/11/2026) — chạy trên DB dev thật,
// sàn GIẢ qua registry (danh mục có thời điểm cập nhật từng sản phẩm cha, lọc theo `since` như sàn).
//
//   1. Không đổi gì → 0 lệnh ghi (so xmin từng dòng trước/sau: không dòng nào bị UPDATE).
//   2. Chỉ dòng khác được ghi; lượt tăng dần xin đúng từ (mốc − chồng lấn).
//   3. BẤT BIẾN: lượt tăng dần không đánh DELISTED / không tự Ngừng bán SKU vắng mặt — kể cả khi adapter
//      quên gắn cờ; chỉ lượt toàn bộ đọc đủ mới gỡ.
//   4. Sót mốc: đọc chưa đủ / lỗi → mốc đứng yên; sản phẩm đổi trong lúc lượt trước đang chạy, hoặc sàn
//      ghi giờ đổi sớm hơn tới 30 phút, lượt sau vẫn bắt được.
//   5. Sau nhiều vòng đổi ngẫu nhiên, gian chạy tăng dần ra đúng dữ liệu của gian kéo toàn bộ mỗi lần.
//   6. Trùng mã giữa hai sản phẩm ở lượt tăng dần: không chiếm dòng của sản phẩm khác, không đổi khóa bừa.
//   7. Đo đối chiếu (chạy bóng): dòng đổi mà sàn không báo đổi trong cửa sổ được đếm là "sót".
//   8. Đo tải: PRODUCT_SYNC_LOAD_ROWS=60000 npx vitest run src/marketplace/__tests__/product-sync-incremental-db.test.ts
// ============================================================
import "../../integrations/__tests__/load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelName, type Channel } from "@prisma/client";
import type { FetchedProducts, FetchProductsOptions, NormalizedChannelProduct } from "../types";

// ---------- Sàn giả ----------
interface FakeItem {
  id: string;
  /** Giây epoch sàn báo sản phẩm đổi lần cuối. */
  updatedAt: number;
  leaves: NormalizedChannelProduct[];
}
const platform = vi.hoisted(() => ({
  items: new Map<string, unknown>(),
  complete: true,
  /** true = adapter "quên" gắn cờ incremental dù đã lọc theo since. */
  forgetFlag: false,
  fail: null as string | null,
  /** Chạy ngay sau khi sàn chụp danh sách trả về — giả sản phẩm đổi giữa lượt. */
  afterSnapshot: null as null | (() => void),
  calls: [] as { channelId: string; since: Date | null; shadowSince: Date | null }[],
}));
const items = () => platform.items as Map<string, FakeItem>;

const fetchProducts = vi.fn(async (ch: Channel, opts?: FetchProductsOptions): Promise<FetchedProducts> => {
  platform.calls.push({ channelId: ch.id, since: opts?.since ?? null, shadowSince: opts?.shadowSince ?? null });
  if (platform.fail) throw new Error(platform.fail);
  const sinceSec = opts?.since ? Math.floor(opts.since.getTime() / 1000) : null;
  const products: NormalizedChannelProduct[] = [];
  for (const it of items().values()) {
    if (sinceSec !== null && it.updatedAt < sinceSec) continue;
    for (const l of it.leaves) products.push({ ...l, sourceUpdatedAt: it.updatedAt });
  }
  platform.afterSnapshot?.();
  platform.afterSnapshot = null;
  return {
    products,
    complete: platform.complete,
    apiCalls: 1,
    ...(opts?.since && !platform.forgetFlag ? { incremental: true } : {}),
  };
});
vi.mock("../registry", () => ({
  getProductAdapter: () => ({ name: "san-gia", supportsIncremental: true, fetchProducts }),
}));
vi.mock("../../lib/cost-mapping", () => ({ autoFillCostForNewSkus: async () => 0 }));

import { prisma } from "../../lib/prisma";
import { CATALOG_OVERLAP_MS } from "../catalog-sync-plan";
import { diffChannelProductRow, keepsSuffixedKey, parentIdOf, syncChannelProducts, type SyncRowData } from "../product-sync";
import { scheduleAfterProductSync } from "../../workers/product-catalog-sync";

const stamp = Date.now();
const sec = (d: Date) => Math.floor(d.getTime() / 1000);
let userId = "";
let seq = 0;

function leaf(itemId: string, n: number, over: Partial<NormalizedChannelProduct> = {}): NormalizedChannelProduct {
  return {
    channelSku: `SP${itemId}-${n}`,
    productName: `Sản phẩm ${itemId}`,
    variantName: `Loại ${n}`,
    price: 100000 + n,
    imageUrl: `https://img/${itemId}.jpg`,
    externalId: `${itemId}-${n}`,
    itemSku: `SP${itemId}`,
    channelStock: 10,
    channelStockLocationId: null,
    status: "ACTIVE",
    ...over,
  };
}
function seedPlatform(count: number, leavesPer: number, updatedAt: number) {
  items().clear();
  for (let i = 1; i <= count; i++) {
    const id = String(1000 + i);
    items().set(id, { id, updatedAt, leaves: Array.from({ length: leavesPer }, (_, n) => leaf(id, n + 1)) });
  }
}
async function newChannel(): Promise<string> {
  const ch = await prisma.channel.create({
    data: { userId, channelName: ChannelName.SHOPEE, shopName: `TEST-INC-${++seq}`, externalShopId: `7${stamp}${seq}`, status: "ACTIVE" },
    select: { id: true },
  });
  return ch.id;
}
const load = (id: string) => prisma.channel.findUniqueOrThrow({ where: { id } });
/** Một lượt như worker: kéo rồi ghi mốc + lịch kế. */
async function run(channelId: string, opts: Parameters<typeof syncChannelProducts>[1] = {}) {
  const r = await syncChannelProducts(await load(channelId), { setting: "on", ...opts });
  await scheduleAfterProductSync(channelId, true, undefined, r.marks);
  return r;
}
/** Dấu vết ghi từng dòng: xmin đổi = dòng vừa bị INSERT/UPDATE. */
async function xmins(channelId: string): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<{ id: string; x: string }[]>`
    SELECT id, xmin::text AS x FROM "ChannelProduct" WHERE "channelId" = ${channelId}`;
  return new Map(rows.map((r) => [r.id, r.x]));
}
function changedIds(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after].filter(([id, x]) => before.get(id) !== x).map(([id]) => id);
}
async function snapshot(channelId: string) {
  const rows = await prisma.channelProduct.findMany({
    where: { channelId },
    orderBy: [{ externalId: "asc" }, { channelSku: "asc" }],
    select: { channelSku: true, externalId: true, productName: true, variantName: true, price: true, itemSku: true, channelStock: true, imageUrl: true, status: true },
  });
  return rows.map((r) => ({ ...r, price: Number(r.price) }));
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `test-psync-inc-${stamp}@hubsell.test`, passwordHash: "x", fullName: "TEST product sync inc", role: "ADMIN" },
  });
  userId = user.id;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
});
beforeEach(() => {
  platform.complete = true;
  platform.forgetFlag = false;
  platform.fail = null;
  platform.afterSnapshot = null;
  platform.calls = [];
});

describe("phần thuần: so dòng, giữ khóa", () => {
  const row = {
    channelSku: "A",
    externalId: "1-1",
    variantName: "Đỏ",
    status: "ACTIVE" as const,
    productName: "Áo",
    price: 100000,
    imageUrl: "u",
    itemSku: "A0",
    channelStock: 5,
    channelStockLocationId: null,
  };
  const same: SyncRowData = { ...row };
  it("giống hệt → null (không ghi)", () => {
    expect(diffChannelProductRow(row, same)).toBeNull();
    expect(diffChannelProductRow(row, { ...same, price: 100000.004 })).toBeNull();
  });
  it("chỉ trả cột khác; ảnh / tên phân loại / tồn null nghĩa là giữ nguyên", () => {
    expect(diffChannelProductRow(row, { ...same, channelStock: 4, price: 99000 })).toEqual({ channelStock: 4, price: 99000 });
    expect(diffChannelProductRow(row, { ...same, imageUrl: null, variantName: null, channelStock: null })).toBeNull();
    expect(diffChannelProductRow(row, { ...same, status: "DELISTED" })).toEqual({ status: "DELISTED" });
    expect(diffChannelProductRow(row, same, "A (Đỏ)")).toEqual({ channelSku: "A (Đỏ)" });
    expect(diffChannelProductRow(row, { ...same, itemSku: null })).toEqual({ itemSku: null });
  });
  it("khóa có đuôi của cùng mã được giữ ở lượt tăng dần; đổi mã thật thì không giữ", () => {
    expect(keepsSuffixedKey("ABC (Đỏ)", "ABC", "ABC")).toBe(true);
    expect(keepsSuffixedKey("ABC #123", "ABC", "ABC")).toBe(true);
    expect(keepsSuffixedKey("ABC (Đỏ)", "ABC", "ABC (Đỏ, L)")).toBe(false);
    expect(keepsSuffixedKey("OLD (Đỏ)", "NEW", "NEW")).toBe(false);
    expect(keepsSuffixedKey("ABC", "ABC", "ABC")).toBe(false);
    expect(parentIdOf("123-456")).toBe("123");
    expect(parentIdOf("123")).toBe("123");
  });
});

describe("1–2. chỉ ghi dòng khác biệt; tăng dần đọc từ (mốc − chồng lấn)", () => {
  let chId = "";
  const T0 = new Date("2026-11-01T00:00:00Z");

  it("lượt đầu (gian chưa có mốc) kéo toàn bộ và đặt cả hai mốc về giờ bắt đầu lượt", async () => {
    chId = await newChannel();
    seedPlatform(100, 3, sec(T0) - 86_400);
    const r = await run(chId, { now: T0 });
    expect(r).toMatchObject({ mode: "full", fullReason: "gian chưa có mốc", scanned: 300, created: 300, updated: 0, unchanged: 0, complete: true });
    expect(platform.calls[0]).toMatchObject({ since: null, shadowSince: null });
    const ch = await load(chId);
    expect(ch.productSyncWatermark).toEqual(T0);
    expect(ch.productFullSyncAt).toEqual(T0);
  });

  it("kéo toàn bộ lại, sàn không đổi gì → 0 lệnh ghi (xmin mọi dòng giữ nguyên)", async () => {
    const before = await xmins(chId);
    const r = await run(chId, { setting: "off", now: new Date(T0.getTime() + 3600_000) });
    expect(r).toMatchObject({ mode: "full", scanned: 300, created: 0, updated: 0, unchanged: 300, delisted: 0 });
    expect(changedIds(before, await xmins(chId))).toEqual([]);
  });

  it("tăng dần, sàn không đổi gì → sàn trả 0 dòng, 0 lệnh ghi, mốc vẫn tiến", async () => {
    const before = await xmins(chId);
    const prev = (await load(chId)).productSyncWatermark!;
    const at = new Date(T0.getTime() + 2 * 3600_000);
    const r = await run(chId, { now: at });
    expect(r).toMatchObject({ mode: "incremental", scanned: 0, created: 0, updated: 0, unchanged: 0, delisted: 0 });
    expect(platform.calls[0].since).toEqual(new Date(prev.getTime() - CATALOG_OVERLAP_MS));
    expect(changedIds(before, await xmins(chId))).toEqual([]);
    const ch = await load(chId);
    expect(ch.productSyncWatermark).toEqual(at);
    // Lượt toàn bộ gần nhất là lượt ở ca trên (T0 + 1 giờ); lượt tăng dần không được tính là lượt toàn bộ.
    expect(ch.productFullSyncAt).toEqual(new Date(T0.getTime() + 3600_000));
  });

  it("3 dòng đổi (tồn, giá) → đúng 3 lệnh ghi, các dòng cùng sản phẩm không đổi thì không ghi", async () => {
    const at = new Date(T0.getTime() + 3 * 3600_000);
    const a = items().get("1005")!;
    a.leaves[0] = { ...a.leaves[0], channelStock: 3 };
    a.leaves[1] = { ...a.leaves[1], price: 123000 };
    a.updatedAt = sec(at) - 60;
    const b = items().get("1050")!;
    b.leaves[2] = { ...b.leaves[2], channelStock: 0 };
    b.updatedAt = sec(at) - 30;

    const before = await xmins(chId);
    const r = await run(chId, { now: at });
    expect(r).toMatchObject({ mode: "incremental", scanned: 6, created: 0, updated: 3, unchanged: 3, delisted: 0 });
    const touched = await prisma.channelProduct.findMany({
      where: { id: { in: changedIds(before, await xmins(chId)) } },
      select: { externalId: true, channelStock: true, price: true, lastSyncedAt: true },
      orderBy: { externalId: "asc" },
    });
    expect(touched.map((t) => t.externalId)).toEqual(["1005-1", "1005-2", "1050-3"]);
    expect(touched.map((t) => t.channelStock)).toEqual([3, 10, 0]);
    expect(Number(touched[1].price)).toBe(123000);
  });
});

describe("3. BẤT BIẾN: lượt tăng dần không gỡ SKU vắng mặt", () => {
  let chId = "";
  let productId = "";
  const T0 = new Date("2026-11-01T00:00:00Z");
  const T1 = new Date("2026-11-02T00:00:00Z");

  it("sàn xóa hẳn một sản phẩm, bỏ một phân loại, ẩn một sản phẩm → tăng dần chỉ ghi trạng thái sàn TRẢ VỀ", async () => {
    chId = await newChannel();
    seedPlatform(20, 2, sec(T0) - 86_400);
    await run(chId, { now: T0 });
    const prod = await prisma.product.create({
      data: { userId, skuCode: `INC-KHO-${stamp}`, productName: "Kho nối sản phẩm sẽ bị xóa", costPrice: 50000, sellingPrice: 100000 },
    });
    productId = prod.id;
    await prisma.channelProduct.updateMany({ where: { channelId: chId, externalId: { startsWith: "1001-" } }, data: { productId } });

    items().delete("1001"); // xóa hẳn: vắng mặt
    const y = items().get("1002")!;
    y.leaves = [y.leaves[0]]; // bỏ phân loại 2: vắng mặt trong sản phẩm vừa đổi
    y.updatedAt = sec(T1) - 100;
    const z = items().get("1003")!;
    z.leaves = z.leaves.map((l) => ({ ...l, status: "DELISTED" as const })); // sàn trả về kèm trạng thái ẩn
    z.updatedAt = sec(T1) - 100;

    const r = await run(chId, { now: T1 });
    expect(r).toMatchObject({ mode: "incremental", scanned: 3, updated: 2, unchanged: 1, delisted: 0, deactivated: 0 });
    const status = async (ext: string) =>
      (await prisma.channelProduct.findFirstOrThrow({ where: { channelId: chId, externalId: ext }, select: { status: true } })).status;
    expect(await status("1001-1")).toBe("ACTIVE");
    expect(await status("1001-2")).toBe("ACTIVE");
    expect(await status("1002-2")).toBe("ACTIVE");
    expect(await status("1003-1")).toBe("DELISTED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).isActive).toBe(true);
  });

  it("sàn không trả dòng nào ở lượt tăng dần → vẫn không gỡ gì", async () => {
    await run(chId, { now: new Date(T1.getTime() + 2 * 3600_000) });
    const r = await run(chId, { now: new Date(T1.getTime() + 3 * 3600_000) });
    expect(r).toMatchObject({ mode: "incremental", scanned: 0, delisted: 0, deactivated: 0 });
    expect(await prisma.channelProduct.count({ where: { channelId: chId, status: "ACTIVE" } })).toBe(38);
  });

  it("adapter quên gắn cờ incremental mà lượt được xin là tăng dần → vẫn không gỡ, không tính là lượt toàn bộ", async () => {
    platform.forgetFlag = true;
    const r = await run(chId, { now: new Date(T1.getTime() + 4 * 3600_000) });
    expect(r).toMatchObject({ mode: "incremental", delisted: 0, deactivated: 0 });
    expect(r.marks.productFullSyncAt).toBeUndefined();
    expect(await prisma.channelProduct.count({ where: { channelId: chId, status: "ACTIVE" } })).toBe(38);
  });

  it("lượt toàn bộ đọc CHƯA đủ cũng không gỡ; đọc đủ mới gỡ và tự Ngừng bán SKU kho", async () => {
    await prisma.channel.update({ where: { id: chId }, data: { productFullSyncAt: new Date(T1.getTime() - 30 * 86_400_000) } });
    platform.complete = false;
    const cut = await run(chId, { now: new Date(T1.getTime() + 6 * 3600_000) });
    expect(cut).toMatchObject({ mode: "full", fullReason: "đến hạn kéo toàn bộ", complete: false, delisted: 0, deactivated: 0 });
    expect(cut.marks).toEqual({});

    platform.complete = true;
    const at = new Date(T1.getTime() + 8 * 3600_000);
    const full = await run(chId, { now: at });
    expect(full).toMatchObject({ mode: "full", complete: true, delisted: 3, deactivated: 1 });
    expect(await prisma.channelProduct.count({ where: { channelId: chId, status: "ACTIVE" } })).toBe(35);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).isActive).toBe(false);
    expect((await load(chId)).productFullSyncAt).toEqual(at);
  });
});

describe("4. sót mốc", () => {
  let chId = "";
  const T0 = new Date("2026-11-01T00:00:00Z");
  const H = 3600_000;
  const stockOf = async (ext: string) =>
    (await prisma.channelProduct.findFirstOrThrow({ where: { channelId: chId, externalId: ext }, select: { channelStock: true } })).channelStock;
  const bump = (id: string, stock: number, at: number) => {
    const it = items().get(id)!;
    it.leaves = it.leaves.map((l) => ({ ...l, channelStock: stock }));
    it.updatedAt = at;
  };

  it("lượt đọc chưa đủ → mốc đứng yên, lượt sau đọc lại đúng từ mốc cũ", async () => {
    chId = await newChannel();
    seedPlatform(10, 1, sec(T0) - 86_400);
    await run(chId, { now: T0 });
    platform.complete = false;
    const r = await run(chId, { now: new Date(T0.getTime() + 2 * H) });
    expect(r).toMatchObject({ mode: "incremental", complete: false });
    expect(r.marks).toEqual({});
    expect((await load(chId)).productSyncWatermark).toEqual(T0);

    platform.complete = true;
    platform.calls = [];
    await run(chId, { now: new Date(T0.getTime() + 3 * H) });
    expect(platform.calls[0].since).toEqual(new Date(T0.getTime() - CATALOG_OVERLAP_MS));
    expect((await load(chId)).productSyncWatermark).toEqual(new Date(T0.getTime() + 3 * H));
  });

  it("lượt lỗi (sàn từ chối) → mốc đứng yên, ghi lỗi + hẹn thử lại", async () => {
    const before = await load(chId);
    platform.fail = "sàn bận";
    await expect(syncChannelProducts(before, { setting: "on" })).rejects.toThrow("sàn bận");
    await scheduleAfterProductSync(chId, false, "sàn bận");
    const after = await load(chId);
    expect(after.productSyncWatermark).toEqual(before.productSyncWatermark);
    expect(after.productFullSyncAt).toEqual(before.productFullSyncAt);
    expect(after.productSyncError).toBe("sàn bận");
  });

  it("sản phẩm đổi TRONG LÚC lượt trước đang chạy → lượt sau bắt được (mốc = giờ bắt đầu, không phải giờ xong)", async () => {
    const start = new Date(T0.getTime() + 5 * H);
    // Lượt chạy 10 phút; phút thứ 4 sàn đổi tồn sản phẩm 1004 — sau khi danh sách đã chụp.
    platform.afterSnapshot = () => bump("1004", 77, sec(start) + 240);
    const first = await run(chId, { now: start });
    expect(first.scanned).toBe(0);
    expect(await stockOf("1004-1")).toBe(10);

    const next = await run(chId, { now: new Date(start.getTime() + H) });
    expect(next).toMatchObject({ mode: "incremental", updated: 1 });
    expect(await stockOf("1004-1")).toBe(77);
  });

  it("sàn ghi giờ đổi SỚM hơn giờ bắt đầu lượt trước tới 30 phút (lệch đồng hồ / chỉ mục trễ) → vẫn bắt được nhờ chồng lấn", async () => {
    const prev = (await load(chId)).productSyncWatermark!;
    bump("1007", 55, sec(prev) - 30 * 60);
    const r = await run(chId, { now: new Date(prev.getTime() + H) });
    expect(r.updated).toBe(1);
    expect(await stockOf("1007-1")).toBe(55);
  });

  it("đọc lại phần chồng lấn không gây lệnh ghi thừa", async () => {
    const before = await xmins(chId);
    const prev = (await load(chId)).productSyncWatermark!;
    // Sàn báo 1007 "đổi" lần nữa trong cửa sổ chồng lấn nhưng dữ liệu y hệt DB → sàn trả lại, không ghi.
    items().get("1007")!.updatedAt = sec(prev) - 20 * 60;
    const r = await run(chId, { now: new Date(prev.getTime() + 10 * 60_000) });
    expect(r.scanned).toBeGreaterThan(0);
    expect(r).toMatchObject({ updated: 0, created: 0 });
    expect(changedIds(before, await xmins(chId))).toEqual([]);
  });
});

describe("5. tăng dần ra đúng dữ liệu của kéo toàn bộ", () => {
  it("12 vòng đổi ngẫu nhiên (tồn, giá, tên, ẩn/hiện, thêm sản phẩm, thêm phân loại, đổi tên phân loại, đổi mã)", async () => {
    const inc = await newChannel();
    const full = await newChannel();
    let clock = new Date("2026-11-01T00:00:00Z").getTime();
    seedPlatform(60, 3, Math.floor(clock / 1000) - 86_400);
    // Một sản phẩm có 3 phân loại CHUNG mã (đuôi tên phân loại) — đi cùng nhau trong mọi lượt.
    const dup = items().get("1001")!;
    dup.leaves = dup.leaves.map((l) => ({ ...l, channelSku: "CHUNG-MA" }));
    await run(inc, { now: new Date(clock) });
    await run(full, { now: new Date(clock), setting: "off" });

    let s = 12345;
    const rnd = (n: number) => (s = (s * 1103515245 + 12345) % 2147483648) % n;
    let incWrites = 0;
    let fullScanned = 0;
    let incScanned = 0;
    for (let round = 1; round <= 12; round++) {
      clock += 6 * 3600_000;
      const at = Math.floor(clock / 1000) - 600;
      const ids = [...items().keys()];
      for (let k = 0; k < 6; k++) {
        const it = items().get(ids[rnd(ids.length)])!;
        const i = rnd(it.leaves.length);
        const l = it.leaves[i];
        switch (rnd(7)) {
          case 0: it.leaves[i] = { ...l, channelStock: rnd(50) }; break;
          case 1: it.leaves[i] = { ...l, price: 90000 + rnd(50) * 1000 }; break;
          case 2: it.leaves = it.leaves.map((x) => ({ ...x, productName: `${x.productName.split(" v")[0]} v${round}` })); break;
          case 3: it.leaves = it.leaves.map((x) => ({ ...x, status: x.status === "ACTIVE" ? "DELISTED" as const : "ACTIVE" as const })); break;
          case 4: it.leaves.push(leaf(it.id, 50 + round * 10 + k, it.id === "1001" ? { channelSku: "CHUNG-MA" } : {})); break;
          case 5: it.leaves[i] = { ...l, variantName: `${l.variantName} r${round}` }; break;
          default: if (it.id !== "1001") it.leaves[i] = { ...l, channelSku: `${l.channelSku.split("~")[0]}~${round}` };
        }
        it.updatedAt = at;
      }
      const fresh = String(5000 + round);
      items().set(fresh, { id: fresh, updatedAt: at, leaves: [leaf(fresh, 1), leaf(fresh, 2)] });

      const a = await run(inc, { now: new Date(clock) });
      const b = await run(full, { now: new Date(clock), setting: "off" });
      expect(a.mode).toBe("incremental");
      expect(b.mode).toBe("full");
      expect({ created: a.created, updated: a.updated }).toEqual({ created: b.created, updated: b.updated });
      incWrites += a.created + a.updated;
      incScanned += a.scanned;
      fullScanned += b.scanned;
    }
    expect(await snapshot(inc)).toEqual(await snapshot(full));
    expect(incWrites).toBeGreaterThan(40);
    expect(incScanned).toBeLessThan(fullScanned / 4);
  });
});

describe("6. trùng mã giữa hai sản phẩm ở lượt tăng dần", () => {
  it("không chiếm dòng của sản phẩm khác; khóa có đuôi được giữ; lượt toàn bộ sau đó chuẩn hóa lại", async () => {
    const chId = await newChannel();
    const T0 = new Date("2026-11-01T00:00:00Z");
    const H = 3600_000;
    items().clear();
    items().set("100", { id: "100", updatedAt: sec(T0) - 86_400, leaves: [leaf("100", 11, { channelSku: "ABC", variantName: null })] });
    await run(chId, { now: T0 });
    const prod = await prisma.product.create({
      data: { userId, skuCode: `INC-ABC-${stamp}`, productName: "Kho ABC", costPrice: 40000, sellingPrice: 90000 },
    });
    await prisma.channelProduct.updateMany({ where: { channelId: chId, externalId: "100-11" }, data: { productId: prod.id, costPrice: 41000 } });

    // Sản phẩm MỚI 200 dùng lại đúng mã "ABC" — lượt tăng dần chỉ thấy 200.
    items().set("200", { id: "200", updatedAt: sec(T0) + H, leaves: [leaf("200", 22, { channelSku: "ABC", variantName: null })] });
    const a = await run(chId, { now: new Date(T0.getTime() + 2 * H) });
    expect(a).toMatchObject({ mode: "incremental", scanned: 1, created: 1, updated: 0 });
    const rows = async () =>
      prisma.channelProduct.findMany({
        where: { channelId: chId },
        orderBy: { externalId: "asc" },
        select: { channelSku: true, externalId: true, productId: true, costPrice: true },
      });
    let all = await rows();
    expect(all.map((r) => [r.externalId, r.channelSku])).toEqual([
      ["100-11", "ABC"],
      ["200-22", "ABC #22"],
    ]);
    expect(all[0].productId).toBe(prod.id); // dòng cũ còn nguyên danh tính + liên kết kho + giá vốn
    expect(Number(all[0].costPrice)).toBe(41000);
    expect(all[1].productId).toBeNull();

    // Lượt toàn bộ thấy cả hai → cả hai mang khóa có đuôi id lá, dòng cũ đổi khóa theo id sàn.
    await prisma.channel.update({ where: { id: chId }, data: { productFullSyncAt: new Date(T0.getTime() - 30 * 86_400_000) } });
    const full = await run(chId, { now: new Date(T0.getTime() + 4 * H) });
    expect(full).toMatchObject({ mode: "full", created: 0, updated: 1, renamed: 1, delisted: 0 });
    all = await rows();
    expect(all.map((r) => r.channelSku)).toEqual(["ABC #11", "ABC #22"]);
    expect(all[0].productId).toBe(prod.id);

    // Tăng dần chỉ thấy sản phẩm 100 (đổi tồn): khóa có đuôi GIỮ NGUYÊN, không nhảy về "ABC".
    const keyBefore = all[0].channelSku;
    const it = items().get("100")!;
    it.leaves = [{ ...it.leaves[0], channelStock: 1 }];
    it.updatedAt = sec(T0) + 5 * H;
    const b = await run(chId, { now: new Date(T0.getTime() + 6 * H) });
    expect(b).toMatchObject({ mode: "incremental", updated: 1, renamed: 0 });
    expect((await rows())[0].channelSku).toBe(keyBefore);
  });

  it("người bán xóa phân loại rồi tạo lại cùng mã (id mới) → dùng lại dòng cũ, giữ liên kết kho, như lượt toàn bộ", async () => {
    const chId = await newChannel();
    const T0 = new Date("2026-11-01T00:00:00Z");
    items().clear();
    items().set("300", { id: "300", updatedAt: sec(T0) - 86_400, leaves: [leaf("300", 1, { channelSku: "TAO-LAI" }), leaf("300", 2)] });
    await run(chId, { now: T0 });
    const prod = await prisma.product.create({
      data: { userId, skuCode: `INC-TAOLAI-${stamp}`, productName: "Kho tạo lại", costPrice: 1, sellingPrice: 2 },
    });
    await prisma.channelProduct.updateMany({ where: { channelId: chId, externalId: "300-1" }, data: { productId: prod.id } });
    items().set("300", { id: "300", updatedAt: sec(T0) + 3600, leaves: [leaf("300", 9, { channelSku: "TAO-LAI" }), leaf("300", 2)] });
    const r = await run(chId, { now: new Date(T0.getTime() + 2 * 3600_000) });
    expect(r).toMatchObject({ mode: "incremental", created: 0, updated: 1 });
    const row = await prisma.channelProduct.findFirstOrThrow({ where: { channelId: chId, channelSku: "TAO-LAI" } });
    expect(row.externalId).toBe("300-9");
    expect(row.productId).toBe(prod.id);
  });
});

describe("7. chạy bóng: đo dòng đổi mà lượt tăng dần sẽ sót", () => {
  it("cờ shadow → vẫn kéo toàn bộ, vẫn gỡ như cũ, kèm báo cáo trong / ngoài cửa sổ", async () => {
    const chId = await newChannel();
    const T0 = new Date("2026-11-01T00:00:00Z");
    const T1 = new Date("2026-11-02T00:00:00Z");
    seedPlatform(10, 2, sec(T0) - 86_400);
    const first = await run(chId, { now: T0, setting: "shadow" });
    expect(first).toMatchObject({ mode: "full", fullReason: "gian chưa có mốc", shadow: null });

    // 1001: sàn báo đổi (giờ mới) + đổi giá. 1002: tồn đổi nhưng sàn KHÔNG đổi giờ cập nhật. 1003: bị xóa hẳn.
    const a = items().get("1001")!;
    a.leaves[0] = { ...a.leaves[0], price: 150000 };
    a.updatedAt = sec(T1) - 60;
    const b = items().get("1002")!;
    b.leaves[1] = { ...b.leaves[1], channelStock: 2 };
    items().delete("1003");

    const r = await run(chId, { now: T1, setting: "shadow" });
    expect(r).toMatchObject({ mode: "full", fullReason: "chạy bóng", updated: 2, unchanged: 16, delisted: 2 });
    expect(platform.calls.at(-1)).toMatchObject({ since: null, shadowSince: new Date(T0.getTime() - CATALOG_OVERLAP_MS) });
    expect(r.shadow).toMatchObject({
      changedRows: 2,
      covered: 1,
      missed: 1,
      unknown: 0,
      missedBy: { created: 0, stock: 1, price: 0, status: 0, other: 0 },
    });
    expect((await load(chId)).productFullSyncAt).toEqual(T1);
  });
});

const LOAD_ROWS = Number(process.env.PRODUCT_SYNC_LOAD_ROWS) || 0;
describe.skipIf(LOAD_ROWS <= 0)(`8. đo tải ${LOAD_ROWS} dòng (DB dev trên máy)`, () => {
  it("toàn bộ không đổi → 0 lệnh ghi; tăng dần 0 và 60 dòng đổi", { timeout: 600_000 }, async () => {
    const chId = await newChannel();
    const T0 = new Date("2026-11-01T00:00:00Z");
    const perItem = 5;
    const itemCount = Math.ceil(LOAD_ROWS / perItem);
    seedPlatform(itemCount, perItem, sec(T0) - 86_400);
    // Dựng thẳng bằng SQL đúng dữ liệu sàn giả (kéo lần đầu từng dòng một không phải thứ cần đo).
    await prisma.$executeRaw`
      INSERT INTO "ChannelProduct" (id, "channelId", "channelSku", "productName", "variantName", price, "imageUrl", "externalId", "itemSku", "channelStock", status)
      SELECT 'tl' || ${stamp}::text || '-' || i || '-' || n, ${chId}, 'SP' || (1000 + i) || '-' || n, 'Sản phẩm ' || (1000 + i), 'Loại ' || n,
             100000 + n, 'https://img/' || (1000 + i) || '.jpg', (1000 + i) || '-' || n, 'SP' || (1000 + i), 10, 'ACTIVE'
      FROM generate_series(1, ${itemCount}::int) i, generate_series(1, ${perItem}::int) n`;
    await prisma.channel.update({ where: { id: chId }, data: { productSyncWatermark: T0, productFullSyncAt: T0 } });
    const total = itemCount * perItem;
    const xminKinds = async () =>
      Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT xmin::text) AS n FROM "ChannelProduct" WHERE "channelId" = ${chId}`)[0].n);
    expect(await xminKinds()).toBe(1);
    const timed = async <T,>(fn: () => Promise<T>) => {
      const t = Date.now();
      const r = await fn();
      return { r, ms: Date.now() - t };
    };
    const rss = () => Math.round(process.memoryUsage().rss / 1048576);

    // Cách cũ để so: mỗi dòng một lệnh UPDATE lastSyncedAt — đo 2.000 dòng rồi nhân lên.
    const sample = await prisma.channelProduct.findMany({ where: { channelId: chId }, select: { id: true }, take: 2000 });
    const old = await timed(async () => {
      for (const s of sample) await prisma.channelProduct.update({ where: { id: s.id }, data: { lastSyncedAt: null } });
    });
    await prisma.$executeRaw`VACUUM "ChannelProduct"`;
    const kindsAfterOld = await xminKinds();

    const rss0 = rss();
    const full = await timed(() => run(chId, { setting: "off", now: new Date(T0.getTime() + 3600_000) }));
    expect(full.r).toMatchObject({ mode: "full", scanned: total, created: 0, updated: 0, unchanged: total, delisted: 0 });
    expect(await xminKinds()).toBe(kindsAfterOld);
    const rss1 = rss();

    const none = await timed(() => run(chId, { now: new Date(T0.getTime() + 2 * 3600_000) }));
    expect(none.r).toMatchObject({ mode: "incremental", scanned: 0, updated: 0 });

    const at = new Date(T0.getTime() + 4 * 3600_000);
    for (let i = 1; i <= 12; i++) {
      const it = items().get(String(1000 + i * 7))!;
      it.leaves = it.leaves.map((l) => ({ ...l, channelStock: 99 }));
      it.updatedAt = sec(at) - 60;
    }
    const some = await timed(() => run(chId, { now: at }));
    expect(some.r).toMatchObject({ mode: "incremental", scanned: 60, updated: 60, unchanged: 0, delisted: 0 });

    console.info(
      `[ĐO ${total} dòng] cách cũ: ${old.ms} ms / 2.000 lệnh UPDATE → ước ${Math.round((old.ms / 2000) * total / 1000)} giây cho ${total} lệnh; ` +
        `toàn bộ không đổi: ${full.ms} ms, 0 lệnh ghi, RSS ${rss0} → ${rss1} MB; ` +
        `tăng dần 0 dòng đổi: ${none.ms} ms; tăng dần 60 dòng đổi: ${some.ms} ms (60 lệnh ghi)`
    );
    await prisma.channelProduct.deleteMany({ where: { channelId: chId } });
  });
});
