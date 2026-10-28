// ============================================================
// TEST QUAY VỀ APP MOBILE SAU ỦY QUYỀN (lát 2, 28/10/2026) — logic thuần,
// KHÔNG DB, KHÔNG mạng. Bất biến:
//   1) state ký từ app mang client=app, verify đọc lại được, state thường thì
//      không có → callback web giữ nguyên hành vi cũ;
//   2) decodeOauthStateClient đọc dấu KHÔNG cần chữ ký (callback trên Render
//      vẫn nảy về app dù state ký bằng secret dev) nhưng chuỗi rác → null;
//   3) đích nảy là scheme cố định + route /channels + đúng bộ tham số FE web.
// ============================================================

import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import {
  signOauthState as signShopee,
  verifyOauthState as verifyShopee,
} from "../shopee/service";
import {
  signOauthState as signLazada,
  verifyOauthState as verifyLazada,
} from "../lazada/service";
import {
  APP_MOBILE_SCHEME,
  TIKTOK_APP_STATE_PREFIX,
  appChannelsUrl,
  decodeOauthStateClient,
} from "../app-return";

describe("state ủy quyền mang dấu client=app", () => {
  it("Shopee: ký từ app → verify trả client=app; ký thường → không có client", () => {
    const app = signShopee("owner1", undefined, "app");
    expect(verifyShopee(app)).toEqual({ ownerId: "owner1", targetChannelId: undefined, client: "app" });
    const web = signShopee("owner1", "ch1");
    expect(verifyShopee(web)).toEqual({ ownerId: "owner1", targetChannelId: "ch1" });
  });

  it("Lazada: cùng luật", () => {
    const app = signLazada("owner2", "ch9", "app");
    expect(verifyLazada(app)).toEqual({ ownerId: "owner2", targetChannelId: "ch9", client: "app" });
    expect(verifyLazada(signLazada("owner2"))).toEqual({ ownerId: "owner2", targetChannelId: undefined });
  });

  it("decodeOauthStateClient đọc được dấu dù ký bằng secret KHÁC (dev local → Render)", () => {
    const foreign = jwt.sign({ ownerId: "x", purpose: "shopee_oauth", client: "app" }, "secret-khac");
    expect(decodeOauthStateClient(foreign)).toBe("app");
    expect(decodeOauthStateClient(signShopee("owner1"))).toBeNull();
    expect(decodeOauthStateClient("khong-phai-jwt")).toBeNull();
    expect(decodeOauthStateClient(null)).toBeNull();
  });
});

describe("đích nảy về app", () => {
  it("scheme cố định + route channels + tham số giống FE web", () => {
    const url = appChannelsUrl({ shopee: "connected", shop: "Tiệm Nhà Bé", isNew: "1" });
    expect(url.startsWith(`${APP_MOBILE_SCHEME}://channels?`)).toBe(true);
    const qs = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(qs.get("shopee")).toBe("connected");
    expect(qs.get("shop")).toBe("Tiệm Nhà Bé");
    expect(qs.get("isNew")).toBe("1");
  });

  it("tiền tố state TikTok của app là app_", () => {
    expect(TIKTOK_APP_STATE_PREFIX).toBe("app_");
  });
});
