// ============================================================
// SHOPEE BÁO QUYỀN CỦA SHOP ĐÃ HẾT HẠN KHI LÀM MỚI TOKEN (03/10/2026, anh Trung duyệt).
//
// Sự cố gốc: gian 1758390206 trên prod — Shopee trả `shop_access_expired` từ 14:09
// ngày 03/10, gian vẫn ACTIVE, worker thử lại mỗi ~9 phút, chủ shop không có nút
// Kết nối lại (nút chỉ hiện khi gian DISCONNECTED).
//
// Chạy trên database dev; lệnh gọi Shopee được thay bằng hàm giả.
//   1. shop_access_expired → gian hạ DISCONNECTED ngay, lỗi vẫn ném ra cho nơi gọi.
//   2. Lỗi khác (invalid_refresh_token, mạng) → gian GIỮ ACTIVE.
//   3. Chủ shop vừa ủy quyền lại (token trong database đã khác) → không bị hạ oan.
//   4. Token còn hạn → không gọi Shopee, không đụng trạng thái.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return { ...mod, refreshAccessToken: vi.fn() };
});

import { prisma } from "../../lib/prisma";
import { refreshAccessToken } from "../shopee/client";
import { getValidShopeeAccessToken, isShopeeAccessExpiredError } from "../shopee/service";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;

const EXPIRED_MSG = "Shopee refresh token lỗi: shop_access_expired — Your access to shop has expired.";
const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });

/** Đặt gian về: đang nối, access_token đã hết hạn, refresh_token còn hạn theo ước tính của Hubsell. */
async function resetChannel(over: { accessTokenExpireAt?: Date } = {}) {
  await prisma.channel.update({
    where: { id: fx.channelId },
    data: {
      status: "ACTIVE",
      disconnectedAt: null,
      externalShopId: `9${Date.now()}`.slice(0, 12),
      apiToken: "access-cu",
      refreshToken: "refresh-cu",
      accessTokenExpireAt: over.accessTokenExpireAt ?? new Date(Date.now() - 60_000),
      refreshTokenExpireAt: new Date(Date.now() + 29 * 24 * 60 * 60_000),
    },
  });
  return channel();
}

beforeAll(async () => {
  fx = await createStockFixture("shpexp");
});

beforeEach(() => {
  vi.mocked(refreshAccessToken).mockReset();
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Nhận diện lỗi", () => {
  it("chỉ nhận đúng mã shop_access_expired", () => {
    expect(isShopeeAccessExpiredError(new Error(EXPIRED_MSG))).toBe(true);
    expect(isShopeeAccessExpiredError(new Error("Shopee refresh token lỗi: invalid_refresh_token — Invalid refresh_token."))).toBe(false);
    expect(isShopeeAccessExpiredError(new Error("Shopee get_order_list lỗi: error_kyc_auth — No permission."))).toBe(false);
    expect(isShopeeAccessExpiredError(new Error("fetch failed"))).toBe(false);
    expect(isShopeeAccessExpiredError(undefined)).toBe(false);
  });
});

describe("Làm mới token gian Shopee", () => {
  it("Shopee báo shop_access_expired → gian hạ DISCONNECTED ngay, token giữ nguyên, lỗi vẫn ném ra", async () => {
    const c = await resetChannel();
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error(EXPIRED_MSG));
    await expect(getValidShopeeAccessToken(c)).rejects.toThrow("shop_access_expired");
    const after = await channel();
    expect(after.status).toBe("DISCONNECTED");
    expect(after.disconnectedAt).not.toBeNull();
    expect(after.refreshToken).toBe("refresh-cu");
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("lỗi invalid_refresh_token hoặc lỗi mạng → gian GIỮ ACTIVE", async () => {
    const c = await resetChannel();
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(
      new Error("Shopee refresh token lỗi: invalid_refresh_token — Invalid refresh_token.")
    );
    await expect(getValidShopeeAccessToken(c)).rejects.toThrow("invalid_refresh_token");
    expect((await channel()).status).toBe("ACTIVE");

    vi.mocked(refreshAccessToken).mockRejectedValueOnce(new Error("fetch failed"));
    await expect(getValidShopeeAccessToken(c)).rejects.toThrow("fetch failed");
    expect((await channel()).status).toBe("ACTIVE");
  });

  it("chủ shop vừa ủy quyền lại trong lúc lượt cũ bị từ chối → không bị hạ oan", async () => {
    const stale = await resetChannel();
    vi.mocked(refreshAccessToken).mockImplementation(async () => {
      // Giữa lúc Shopee đang trả lời lượt cũ, callback ủy quyền lại đã ghi token mới.
      await prisma.channel.update({ where: { id: fx.channelId }, data: { refreshToken: "refresh-moi" } });
      throw new Error(EXPIRED_MSG);
    });
    await expect(getValidShopeeAccessToken(stale)).rejects.toThrow("shop_access_expired");
    const after = await channel();
    expect(after.status).toBe("ACTIVE");
    expect(after.refreshToken).toBe("refresh-moi");
  });

  it("làm mới thành công → ghi token mới, gian vẫn ACTIVE", async () => {
    const c = await resetChannel();
    vi.mocked(refreshAccessToken).mockResolvedValue({ access_token: "access-moi", refresh_token: "refresh-moi", expire_in: 14400 });
    const ctx = await getValidShopeeAccessToken(c);
    expect(ctx.accessToken).toBe("access-moi");
    const after = await channel();
    expect(after).toMatchObject({ status: "ACTIVE", apiToken: "access-moi", refreshToken: "refresh-moi" });
  });

  it("token còn hạn → không gọi Shopee, không đụng trạng thái", async () => {
    const c = await resetChannel({ accessTokenExpireAt: new Date(Date.now() + 2 * 60 * 60_000) });
    const ctx = await getValidShopeeAccessToken(c);
    expect(ctx.accessToken).toBe("access-cu");
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect((await channel()).status).toBe("ACTIVE");
  });
});
