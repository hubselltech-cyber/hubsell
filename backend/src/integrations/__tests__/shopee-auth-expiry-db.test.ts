// ============================================================
// NGÀY HẾT HẠN ỦY QUYỀN SHOPEE (03/10/2026). Chạy trên database dev (cần migration
// 20261003230000_shopee_auth_expire); lệnh gọi Shopee được thay bằng hàm giả.
//   1. Đọc expire_time của get_shop_info: có số → ngày; thiếu / sai → null.
//   2. Lượt hỏi hằng ngày: ghi ngày + mốc đã hỏi; chưa quá 24 giờ thì không hỏi lại.
//   3. Hỏi không được → giữ ngày cũ, vẫn ghi mốc đã hỏi (hôm sau mới hỏi lại).
//   4. Gian đã ngắt không được hỏi.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return { ...mod, getShopInfo: vi.fn(), refreshAccessToken: vi.fn() };
});

import { prisma } from "../../lib/prisma";
import { AUTH_EXPIRY_RECHECK_MS, refreshShopeeAuthExpiry } from "../shopee/auth-expiry";
import { getShopInfo, shopAuthExpireAt } from "../shopee/client";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;
const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });
const run = (now: Date) => refreshShopeeAuthExpiry(now, { channelIds: [fx.channelId], staggerMs: 0 });
const EXPIRE_SEC = 1_800_000_000; // 15/01/2027

async function resetChannel(over: object = {}) {
  await prisma.channel.update({
    where: { id: fx.channelId },
    data: {
      status: "ACTIVE",
      externalShopId: `8${Date.now()}`.slice(0, 12),
      apiToken: "access",
      refreshToken: "refresh",
      accessTokenExpireAt: new Date(Date.now() + 3 * 60 * 60_000),
      refreshTokenExpireAt: new Date(Date.now() + 29 * 24 * 60 * 60_000),
      authExpireAt: null,
      authExpireCheckedAt: null,
      ...over,
    },
  });
}

beforeAll(async () => {
  fx = await createStockFixture("shpauthexp");
});
beforeEach(async () => {
  vi.mocked(getShopInfo).mockReset();
  await resetChannel();
});
afterAll(async () => {
  await fx.cleanup();
});

describe("shopAuthExpireAt", () => {
  it("giây Unix → ngày; thiếu, 0 hoặc không phải số → null", () => {
    expect(shopAuthExpireAt({ expire_time: EXPIRE_SEC })?.toISOString()).toBe(new Date(EXPIRE_SEC * 1000).toISOString());
    expect(shopAuthExpireAt({})).toBeNull();
    expect(shopAuthExpireAt({ expire_time: 0 })).toBeNull();
    expect(shopAuthExpireAt({ expire_time: "abc" as unknown as number })).toBeNull();
  });
});

describe("Lượt hỏi ngày hết hạn ủy quyền", () => {
  it("gian chưa hỏi lần nào → ghi ngày Shopee trả + mốc đã hỏi; trong 24 giờ không hỏi lại; quá 24 giờ hỏi lại", async () => {
    vi.mocked(getShopInfo).mockResolvedValue({ shop_name: "x", expire_time: EXPIRE_SEC });
    const now = new Date();
    const stats = await run(now);
    expect(stats).toMatchObject({ mainChecked: 1, mainWithDate: 1, failed: 0 });
    const c = await channel();
    expect(c.authExpireAt?.getTime()).toBe(EXPIRE_SEC * 1000);
    expect(c.authExpireCheckedAt?.getTime()).toBe(now.getTime());

    expect((await run(new Date(now.getTime() + 60 * 60_000))).mainChecked).toBe(0);
    expect(getShopInfo).toHaveBeenCalledTimes(1);

    // Chủ shop gia hạn trên Shopee → hôm sau thấy ngày mới.
    vi.mocked(getShopInfo).mockResolvedValue({ shop_name: "x", expire_time: EXPIRE_SEC + 86_400 });
    expect((await run(new Date(now.getTime() + AUTH_EXPIRY_RECHECK_MS + 1000))).mainChecked).toBe(1);
    expect((await channel()).authExpireAt?.getTime()).toBe((EXPIRE_SEC + 86_400) * 1000);
  });

  it("Shopee không trả expire_time → ngày để trống, vẫn ghi mốc đã hỏi", async () => {
    await resetChannel({ authExpireAt: new Date(EXPIRE_SEC * 1000) });
    vi.mocked(getShopInfo).mockResolvedValue({ shop_name: "x" });
    const stats = await run(new Date());
    expect(stats).toMatchObject({ mainChecked: 1, mainWithDate: 0 });
    const c = await channel();
    expect(c.authExpireAt).toBeNull();
    expect(c.authExpireCheckedAt).not.toBeNull();
  });

  it("hỏi không được → giữ ngày cũ, ghi mốc đã hỏi để hôm sau mới hỏi lại", async () => {
    await resetChannel({ authExpireAt: new Date(EXPIRE_SEC * 1000) });
    vi.mocked(getShopInfo).mockRejectedValue(new Error("Shopee get_shop_info lỗi: error_server — bận"));
    const now = new Date();
    const stats = await run(now);
    expect(stats).toMatchObject({ mainChecked: 1, mainWithDate: 0, failed: 1 });
    const c = await channel();
    expect(c.authExpireAt?.getTime()).toBe(EXPIRE_SEC * 1000);
    expect(c.authExpireCheckedAt?.getTime()).toBe(now.getTime());
    expect((await run(new Date(now.getTime() + 60_000))).mainChecked).toBe(0);
  });

  it("gian đã ngắt kết nối không được hỏi", async () => {
    await resetChannel({ status: "DISCONNECTED" });
    expect((await run(new Date())).mainChecked).toBe(0);
    expect(getShopInfo).not.toHaveBeenCalled();
  });
});
