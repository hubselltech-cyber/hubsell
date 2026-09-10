// ============================================================
// HUBSELL ADS — app Ads Service riêng: điểm chốt cấp quyền + ủy quyền + token
//
// Kiểm:
//   1. Chưa cấu hình HUBSELL_ADS_* → fallback token app chính, gian nào cũng
//      "có quyền ads", trạng thái required=false (UI không hiện gì).
//   2. Đã cấu hình mà gian chưa nối → HubsellAdsNotLinkedError, worker bỏ qua.
//   3. Callback: shop_id lệch gian đích → chặn TRƯỚC khi đổi code; khớp → ghi
//      ChannelAppAuth, resolve trả cfg của Hubsell Ads (partner riêng).
//   4. access_token sắp hết hạn → refresh bằng cfg Hubsell Ads + rotate DB;
//      refresh_token chết → DISCONNECTED + lỗi "expired".
//   5. Gỡ liên kết xoá dòng.
// Tầng gọi Shopee (client) và token app chính được MOCK; DB local là đồ thật.
// ============================================================
import "./load-env";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ChannelAppKind } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createStockFixture, type StockFixture } from "./fixtures";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return {
    ...mod,
    getAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
  };
});
vi.mock("../shopee/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/service")>();
  return {
    ...mod,
    getValidShopeeAccessToken: vi
      .fn()
      .mockResolvedValue({ accessToken: "main-app-token", shopId: "999" }),
  };
});

import { getAccessToken, refreshAccessToken } from "../shopee/client";
import {
  HubsellAdsNotLinkedError,
  getHubsellAdsLinkStatus,
  getValidHubsellAdsAccessToken,
  handleHubsellAdsCallback,
  hasShopeeAdsAccess,
  resolveShopeeAdsAccess,
  unlinkHubsellAds,
} from "../hubsell-ads";

const ADS_PARTNER_ID = "7770001";

let fx: StockFixture;
const channel = () => prisma.channel.findUniqueOrThrow({ where: { id: fx.channelId } });
const authRow = () =>
  prisma.channelAppAuth.findUnique({
    where: { channelId_app: { channelId: fx.channelId, app: ChannelAppKind.HUBSELL_ADS } },
  });

function configureHubsellAds(on: boolean) {
  if (on) {
    process.env.HUBSELL_ADS_PARTNER_ID = ADS_PARTNER_ID;
    process.env.HUBSELL_ADS_PARTNER_KEY = "ads-secret";
  } else {
    delete process.env.HUBSELL_ADS_PARTNER_ID;
    delete process.env.HUBSELL_ADS_PARTNER_KEY;
  }
}

beforeAll(async () => {
  fx = await createStockFixture("hubsell-ads");
});
afterAll(async () => {
  configureHubsellAds(false);
  await fx.cleanup();
});
afterEach(() => {
  vi.mocked(getAccessToken).mockReset();
  vi.mocked(refreshAccessToken).mockReset();
});

describe("Hubsell Ads chưa cấu hình → fallback app chính", () => {
  it("resolve trả token app chính, gian luôn có quyền ads, UI không cần hiện gì", async () => {
    configureHubsellAds(false);
    const access = await resolveShopeeAdsAccess(await channel());
    expect(access.source).toBe("main-app");
    expect(access.accessToken).toBe("main-app-token");
    expect(access.cfg.partnerId).toBe(process.env.SHOPEE_PARTNER_ID);
    expect(await hasShopeeAdsAccess(fx.channelId)).toBe(true);
    const st = await getHubsellAdsLinkStatus(fx.channelId);
    expect(st.required).toBe(false);
    expect(st.status).toBe("NOT_LINKED");
  });
});

describe("Hubsell Ads đã cấu hình", () => {
  it("gian chưa nối → chặn có mã riêng, worker bỏ qua, UI mời kết nối", async () => {
    configureHubsellAds(true);
    await expect(resolveShopeeAdsAccess(await channel())).rejects.toBeInstanceOf(
      HubsellAdsNotLinkedError
    );
    expect(await hasShopeeAdsAccess(fx.channelId)).toBe(false);
    const st = await getHubsellAdsLinkStatus(fx.channelId);
    expect(st.required).toBe(true);
    expect(st.status).toBe("NOT_LINKED");
  });

  it("callback: shop_id lệch gian đích → chặn TRƯỚC khi đốt code", async () => {
    configureHubsellAds(true);
    await expect(
      handleHubsellAdsCallback(fx.userId, "code-1", "123456", fx.channelId)
    ).rejects.toThrow(/không trùng/);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(await authRow()).toBeNull();
  });

  it("callback khớp shop_id → ghi ChannelAppAuth bằng cfg Hubsell Ads, resolve dùng partner riêng", async () => {
    configureHubsellAds(true);
    vi.mocked(getAccessToken).mockResolvedValue({
      access_token: "ads-access-1",
      refresh_token: "ads-refresh-1",
      expire_in: 14400,
    });
    const ch = await channel();
    const r = await handleHubsellAdsCallback(fx.userId, "code-ok", ch.externalShopId!, ch.id);
    expect(r.externalShopId).toBe(ch.externalShopId);
    // Đổi code bằng partner của Hubsell Ads, không phải app chính.
    const cfgUsed = vi.mocked(getAccessToken).mock.calls[0][2];
    expect(cfgUsed?.partnerId).toBe(ADS_PARTNER_ID);

    const row = await authRow();
    expect(row?.status).toBe("ACTIVE");
    expect(row?.accessToken).toBe("ads-access-1");

    const access = await resolveShopeeAdsAccess(ch);
    expect(access.source).toBe("hubsell-ads");
    expect(access.accessToken).toBe("ads-access-1");
    expect(access.cfg.partnerId).toBe(ADS_PARTNER_ID);
    expect(await hasShopeeAdsAccess(ch.id)).toBe(true);
    expect((await getHubsellAdsLinkStatus(ch.id)).status).toBe("ACTIVE");
  });

  it("access_token sắp hết hạn → refresh bằng cfg Hubsell Ads và rotate refresh_token", async () => {
    configureHubsellAds(true);
    await prisma.channelAppAuth.update({
      where: { channelId_app: { channelId: fx.channelId, app: ChannelAppKind.HUBSELL_ADS } },
      data: { accessTokenExpireAt: new Date(Date.now() + 60 * 1000) }, // còn 1 phút
    });
    vi.mocked(refreshAccessToken).mockResolvedValue({
      access_token: "ads-access-2",
      refresh_token: "ads-refresh-2",
      expire_in: 14400,
    });
    const t = await getValidHubsellAdsAccessToken(fx.channelId);
    expect(t.accessToken).toBe("ads-access-2");
    const [refreshTokenSent, , cfgUsed] = vi.mocked(refreshAccessToken).mock.calls[0];
    expect(refreshTokenSent).toBe("ads-refresh-1");
    expect(cfgUsed?.partnerId).toBe(ADS_PARTNER_ID);
    const row = await authRow();
    expect(row?.refreshToken).toBe("ads-refresh-2");
    expect(row?.accessTokenExpireAt.getTime()).toBeGreaterThan(Date.now() + 3 * 3600 * 1000);
  });

  it("refresh_token hết hạn 30 ngày → DISCONNECTED, lỗi expired, worker bỏ qua", async () => {
    configureHubsellAds(true);
    await prisma.channelAppAuth.update({
      where: { channelId_app: { channelId: fx.channelId, app: ChannelAppKind.HUBSELL_ADS } },
      data: {
        accessTokenExpireAt: new Date(Date.now() - 1000),
        refreshTokenExpireAt: new Date(Date.now() - 1000),
      },
    });
    await expect(getValidHubsellAdsAccessToken(fx.channelId)).rejects.toMatchObject({
      code: "HUBSELL_ADS_NOT_LINKED",
      reason: "expired",
    });
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect((await authRow())?.status).toBe("DISCONNECTED");
    expect(await hasShopeeAdsAccess(fx.channelId)).toBe(false);
    expect((await getHubsellAdsLinkStatus(fx.channelId)).status).toBe("DISCONNECTED");
  });

  it("gỡ liên kết xoá dòng; gian không thuộc chủ shop thì không gỡ được", async () => {
    configureHubsellAds(true);
    expect(await unlinkHubsellAds("nguoi-khac", fx.channelId)).toBe(false);
    expect(await unlinkHubsellAds(fx.userId, fx.channelId)).toBe(true);
    expect(await authRow()).toBeNull();
    expect(await unlinkHubsellAds(fx.userId, fx.channelId)).toBe(false);
  });
});
