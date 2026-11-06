// ============================================================
// LUẬT MẤT ỦY QUYỀN PHÍA SÀN CHUNG (27/10/2026, integrations/auth-loss.ts).
//
// Sự cố gốc: HPGear VN (Shopee) — chủ shop gỡ app, Shopee trả `shop_no_linked` khi làm mới
// token; mã cũ chỉ biết `shop_access_expired` → gian ACTIVE 25 giờ, 158 lượt thử vô ích,
// chủ shop không có nút Kết nối lại. Luật mới không phụ thuộc danh sách mã:
//   1. Mã chắc chắn (shop_access_expired / shop_no_linked) → hạ ngay.
//   2. Sàn từ chối bằng MÃ LẠ → đếm; đủ 3 lần trải ≥ 30′ với cùng refresh_token → hạ.
//   3. Lỗi mạng / trần gọi / lỗi Hubsell tự ném → không đếm, không hạ.
//   4. Token trong DB đã đổi (tiến trình khác làm mới xong / chủ shop ủy quyền lại) → không đếm.
//   5. Làm mới thành công → xóa dấu đếm.
//   6. TikTok cũng theo luật này (mã lạ đếm, không hạ ở lần đầu).
// Chạy trên database dev; lệnh gọi sàn thay bằng hàm giả.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return { ...mod, refreshAccessToken: vi.fn() };
});
vi.mock("../tiktok/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../tiktok/client")>();
  return { ...mod, refreshAccessToken: vi.fn() };
});

import { ChannelName } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { refreshAccessToken as shopeeRefresh } from "../shopee/client";
import { refreshAccessToken as tiktokRefresh } from "../tiktok/client";
import { getValidShopeeAccessToken } from "../shopee/service";
import { disconnectExpiredTiktokAuths, getValidAccessToken as getValidTiktokAccessToken } from "../tiktok/service";
import {
  AUTH_REJECT_MAX,
  SCAN_FAIL_FORCE_AT,
  authRejectReason,
  classifyRefreshFailure,
  forceTokenRefresh,
  isAuthClassError,
  recordRefreshFailure,
  shouldForceRefreshAfterScanFailure,
} from "../auth-loss";
import { createStockFixture, type StockFixture } from "./fixtures";

let fx: StockFixture;

const NO_LINKED = "Shopee refresh token lỗi: shop_no_linked — Partner and shop has no linked.";
const ODD_SHOPEE = "Shopee refresh token lỗi: error_shop_frozen — Shop is frozen.";
const ODD_TIKTOK = "TikTok auth lỗi (code 105099): refresh token revoked";

const row = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });

/** Gian Shopee đang nối, access_token đã hết hạn, refresh_token còn hạn, chưa có dấu từ chối. */
async function resetShopee() {
  await prisma.channel.update({
    where: { id: fx.channelId },
    data: {
      channelName: ChannelName.SHOPEE,
      status: "ACTIVE",
      disconnectedAt: null,
      externalShopId: `9${Date.now()}`.slice(0, 12),
      apiToken: "access-cu",
      refreshToken: "refresh-cu",
      shopCipher: null,
      accessTokenExpireAt: new Date(Date.now() - 60_000),
      refreshTokenExpireAt: new Date(Date.now() + 29 * 24 * 60 * 60_000),
      authRejectCount: 0,
      authRejectSince: null,
      authLostReason: null,
    },
  });
  return row();
}

/** Lùi mốc lần từ chối đầu tiên để giả lập đã trải `minutes` phút. */
async function ageRejects(minutes: number) {
  await prisma.$executeRaw`
    UPDATE "Channel" SET "authRejectSince" = (now() AT TIME ZONE 'UTC') - make_interval(mins => ${minutes}::int)
    WHERE "id" = ${fx.channelId}`;
}

beforeAll(async () => {
  fx = await createStockFixture("authloss");
});

beforeEach(() => {
  vi.mocked(shopeeRefresh).mockReset();
  vi.mocked(tiktokRefresh).mockReset();
});

afterAll(async () => {
  await fx.cleanup();
});

describe("Phân loại lỗi làm mới token", () => {
  it("mã chắc chắn → lost_now; mã lạ của sàn → rejected; mạng / trần gọi / lỗi Hubsell → transient", () => {
    expect(classifyRefreshFailure(new Error(NO_LINKED))).toBe("lost_now");
    expect(classifyRefreshFailure(new Error("Shopee refresh token lỗi: shop_access_expired — expired"))).toBe("lost_now");
    expect(classifyRefreshFailure(new Error(ODD_SHOPEE))).toBe("rejected");
    expect(classifyRefreshFailure(new Error(ODD_TIKTOK))).toBe("rejected");
    expect(classifyRefreshFailure(new Error("Lazada refresh token lỗi: IllegalRefreshToken — invalid"))).toBe("rejected");
    expect(classifyRefreshFailure(new Error("Shopee refresh token lỗi: invalid_refresh_token — Invalid"))).toBe("rejected");
    expect(classifyRefreshFailure(new Error("fetch failed"))).toBe("transient");
    expect(classifyRefreshFailure(new Error("Shopee refresh token lỗi: error_rate_limit — too many"))).toBe("transient");
    expect(classifyRefreshFailure(new Error("Shopee refresh token lỗi: error_server — busy"))).toBe("transient");
    expect(classifyRefreshFailure(new Error("Shopee không trả token khi refresh"))).toBe("transient");
    expect(classifyRefreshFailure(new Error("Gian hàng chưa uỷ quyền Shopee (thiếu token/shop_id)"))).toBe("transient");
    expect(classifyRefreshFailure(undefined)).toBe("transient");
  });

  it("rút mã ngắn để lưu lý do", () => {
    expect(authRejectReason(new Error(NO_LINKED))).toBe("shop_no_linked");
    expect(authRejectReason(new Error(ODD_TIKTOK))).toBe("TikTok code 105099");
  });

  it("lỗi lớp quyền khi quét (lưới thứ hai) nhận theo bảng của cổng gọi sàn", () => {
    expect(isAuthClassError("SHOPEE", new Error("Shopee get_order_list lỗi: invalid_access_token — x"))).toBe(true);
    expect(isAuthClassError("TIKTOK", new Error("TikTok API lỗi (code 105002): Expired credentials"))).toBe(true);
    expect(isAuthClassError("SHOPEE", new Error("fetch failed"))).toBe(false);
  });
});

describe("Shopee: luật hạ gian khi sàn từ chối làm mới", () => {
  it("HPGear VN: shop_no_linked → DISCONNECTED ngay ở lần đầu, lưu lý do, lỗi vẫn ném ra", async () => {
    const ch = await resetShopee();
    vi.mocked(shopeeRefresh).mockRejectedValueOnce(new Error(NO_LINKED));
    await expect(getValidShopeeAccessToken(ch)).rejects.toThrow("shop_no_linked");
    const after = await row();
    expect(after.status).toBe("DISCONNECTED");
    expect(after.disconnectedAt).not.toBeNull();
    expect(after.authLostReason).toBe("shop_no_linked");
    expect(after.refreshToken).toBe("refresh-cu"); // không xóa token
  });

  it("mã lạ: 3 lần trong < 30′ vẫn ACTIVE; lần thứ 3 khi đã trải ≥ 30′ → DISCONNECTED", async () => {
    let ch = await resetShopee();
    for (let i = 1; i <= AUTH_REJECT_MAX; i++) {
      vi.mocked(shopeeRefresh).mockRejectedValueOnce(new Error(ODD_SHOPEE));
      await expect(getValidShopeeAccessToken(ch)).rejects.toThrow("error_shop_frozen");
      ch = await row();
      expect(ch.status).toBe("ACTIVE");
      expect(ch.authRejectCount).toBe(i);
    }
    expect(ch.authLostReason).toBe("error_shop_frozen");

    await ageRejects(31);
    ch = await row();
    vi.mocked(shopeeRefresh).mockRejectedValueOnce(new Error(ODD_SHOPEE));
    await expect(getValidShopeeAccessToken(ch)).rejects.toThrow();
    const after = await row();
    expect(after.status).toBe("DISCONNECTED");
    expect(after.authRejectCount).toBe(AUTH_REJECT_MAX + 1);
  });

  it("lỗi mạng / trần gọi → không đếm, không hạ", async () => {
    const ch = await resetShopee();
    vi.mocked(shopeeRefresh).mockRejectedValueOnce(new Error("fetch failed"));
    await expect(getValidShopeeAccessToken(ch)).rejects.toThrow();
    vi.mocked(shopeeRefresh).mockRejectedValueOnce(new Error("Shopee refresh token lỗi: error_rate_limit — x"));
    await expect(getValidShopeeAccessToken(await row())).rejects.toThrow();
    const after = await row();
    expect(after.status).toBe("ACTIVE");
    expect(after.authRejectCount).toBe(0);
  });

  it("token trong DB đã đổi (tiến trình khác vừa làm mới / chủ shop vừa ủy quyền lại) → không đếm, không hạ", async () => {
    const stale = await resetShopee();
    await prisma.channel.update({ where: { id: fx.channelId }, data: { refreshToken: "refresh-moi" } });
    const r = await recordRefreshFailure(
      { kind: "channel", id: stale.id, refreshToken: stale.refreshToken, label: "test" },
      new Error(NO_LINKED)
    );
    expect(r.disconnected).toBe(false);
    const after = await row();
    expect(after.status).toBe("ACTIVE");
    expect(after.authRejectCount).toBe(0);
  });

  it("làm mới thành công → xóa dấu đếm và lý do", async () => {
    let ch = await resetShopee();
    vi.mocked(shopeeRefresh).mockRejectedValueOnce(new Error(ODD_SHOPEE));
    await expect(getValidShopeeAccessToken(ch)).rejects.toThrow();
    ch = await row();
    expect(ch.authRejectCount).toBe(1);

    vi.mocked(shopeeRefresh).mockResolvedValueOnce({
      access_token: "access-moi",
      refresh_token: "refresh-moi",
      expire_in: 14_400,
    } as Awaited<ReturnType<typeof shopeeRefresh>>);
    await getValidShopeeAccessToken(ch);
    const after = await row();
    expect(after.status).toBe("ACTIVE");
    expect(after.authRejectCount).toBe(0);
    expect(after.authRejectSince).toBeNull();
    expect(after.authLostReason).toBeNull();
  });
});

describe("TikTok cũng theo luật chung", () => {
  it("mã lạ → đếm, giữ ACTIVE ở lần đầu; đủ ngưỡng → DISCONNECTED", async () => {
    await resetShopee();
    let ch = await prisma.channel.update({
      where: { id: fx.channelId },
      data: { channelName: ChannelName.TIKTOK, shopCipher: "cipher-test" },
    });
    vi.mocked(tiktokRefresh).mockRejectedValueOnce(new Error(ODD_TIKTOK));
    await expect(getValidTiktokAccessToken(ch)).rejects.toThrow("105099");
    ch = await row();
    expect(ch.status).toBe("ACTIVE");
    expect(ch.authRejectCount).toBe(1);
    expect(ch.authLostReason).toBe("TikTok code 105099");

    await prisma.channel.update({ where: { id: fx.channelId }, data: { authRejectCount: AUTH_REJECT_MAX - 1 } });
    await ageRejects(31);
    vi.mocked(tiktokRefresh).mockRejectedValueOnce(new Error(ODD_TIKTOK));
    await expect(getValidTiktokAccessToken(await row())).rejects.toThrow();
    expect((await row()).status).toBe("DISCONNECTED");
  });
});

// ============================================================
// 06/11/2026 — TORANO MENSWEAR (TikTok): chủ shop thu hồi ủy quyền 05/11, sàn trả
// `36009005 Invalid credentials` ở mọi lượt quét; mã không có trong bảng lớp quyền nên lưới
// thứ hai không ép làm mới, access_token còn "hạn" tới 12/11 nên luật đếm không được hỏi;
// ủy quyền hết hạn 06/11 nhưng cron chỉ xét gian có access_token sắp hết → 152 lượt lỗi,
// gian vẫn ACTIVE, HQ đỏ mục mốc nước.
// ============================================================
const TORANO_ERR =
  "TikTok API lỗi (code 36009005): Invalid credentials. The 'access_token' header is invalid. For more details: https://m.tiktok.shop/s/AIu6dbF";

describe("Lưới thứ hai không theo danh sách mã", () => {
  it("mã lạ của sàn: ép làm mới đúng một lần khi chuỗi lỗi chạm 3 lượt", () => {
    expect(SCAN_FAIL_FORCE_AT).toBe(3);
    expect(isAuthClassError("TIKTOK", new Error(TORANO_ERR))).toBe(false); // đúng lỗ hổng cũ
    expect(shouldForceRefreshAfterScanFailure("TIKTOK", new Error(TORANO_ERR), 1)).toBe(false);
    expect(shouldForceRefreshAfterScanFailure("TIKTOK", new Error(TORANO_ERR), 2)).toBe(false);
    expect(shouldForceRefreshAfterScanFailure("TIKTOK", new Error(TORANO_ERR), 3)).toBe(true);
    expect(shouldForceRefreshAfterScanFailure("TIKTOK", new Error(TORANO_ERR), 4)).toBe(false);
    expect(shouldForceRefreshAfterScanFailure("TIKTOK", new Error(TORANO_ERR), 152)).toBe(false);
  });

  it("mã lớp quyền đã biết: ép ngay từ lượt đầu, như cũ", () => {
    expect(shouldForceRefreshAfterScanFailure("TIKTOK", new Error("TikTok API lỗi (code 105002): Expired credentials"), 1)).toBe(true);
    expect(shouldForceRefreshAfterScanFailure("SHOPEE", new Error("Shopee get_order_list lỗi: invalid_access_token — x"), 7)).toBe(true);
  });

  it("lỗi tạm thời / trần gọi: không bao giờ ép, kể cả đúng lượt thứ 3", () => {
    expect(shouldForceRefreshAfterScanFailure("SHOPEE", new Error("fetch failed"), 3)).toBe(false);
    expect(shouldForceRefreshAfterScanFailure("LAZADA", new Error("Lazada /orders/get lỗi: ServiceTimeout"), 3)).toBe(false);
    expect(shouldForceRefreshAfterScanFailure("TIKTOK", new Error("TikTok API lỗi (code 36009002): Too many requests"), 3)).toBe(false);
    expect(shouldForceRefreshAfterScanFailure("SHOPEE", new Error("Shopee get_order_list lỗi: error_rate_limit"), 3)).toBe(false);
  });
});

describe("TikTok: ủy quyền quá hạn → hạ gian, không chờ access_token hết", () => {
  /** Gian TikTok đang nối, access_token vừa làm mới (còn 6 ngày), hạn ủy quyền đặt theo `authEndMs`. */
  async function resetTiktok(authEndMs: number) {
    await resetShopee();
    return prisma.channel.update({
      where: { id: fx.channelId },
      data: {
        channelName: ChannelName.TIKTOK,
        shopCipher: "cipher-test",
        accessTokenExpireAt: new Date(Date.now() + 6 * 24 * 60 * 60_000),
        refreshTokenExpireAt: new Date(authEndMs),
      },
    });
  }

  it("TORANO: hạn ủy quyền đã qua, access_token còn 6 ngày → DISCONNECTED, giữ token, không gọi sàn", async () => {
    await resetTiktok(Date.now() - 60_000);
    const dropped = await disconnectExpiredTiktokAuths({ onlyChannelId: fx.channelId });
    expect(dropped).toBe(1);
    const after = await row();
    expect(after.status).toBe("DISCONNECTED");
    expect(after.disconnectedAt).not.toBeNull();
    // Thẻ gian nhận ra "hết hạn ủy quyền" khi hạn ≤ lúc ngắt (frontend lib/channel-auth.ts).
    expect(after.refreshTokenExpireAt!.getTime()).toBeLessThanOrEqual(after.disconnectedAt!.getTime());
    expect(after.refreshToken).toBe("refresh-cu");
    expect(tiktokRefresh).not.toHaveBeenCalled();
  });

  it("hạn ủy quyền còn → không đụng tới gian", async () => {
    await resetTiktok(Date.now() + 7 * 24 * 60 * 60_000);
    expect(await disconnectExpiredTiktokAuths({ onlyChannelId: fx.channelId })).toBe(0);
    expect((await row()).status).toBe("ACTIVE");
  });

  it("gian đã ngắt từ trước → không ghi đè mốc ngắt", async () => {
    await resetTiktok(Date.now() - 60_000);
    const cut = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    await prisma.channel.update({ where: { id: fx.channelId }, data: { status: "DISCONNECTED", disconnectedAt: cut } });
    expect(await disconnectExpiredTiktokAuths({ onlyChannelId: fx.channelId })).toBe(0);
    expect((await row()).disconnectedAt!.getTime()).toBe(cut.getTime());
  });

  it("bị ép làm mới khi ủy quyền đã quá hạn → hạ gian ngay trong lượt gọi, lỗi vẫn ném ra", async () => {
    const ch = await resetTiktok(Date.now() - 60_000);
    await forceTokenRefresh(ch.id, "test", new Error(TORANO_ERR));
    await expect(getValidTiktokAccessToken(await row())).rejects.toThrow("hết hạn");
    expect((await row()).status).toBe("DISCONNECTED");
    expect(tiktokRefresh).not.toHaveBeenCalled();
  });
});
