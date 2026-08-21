// ============================================================
// TEST DỰNG LINK UỶ QUYỀN SHOPEE — logic thuần, KHÔNG DB, KHÔNG mạng.
//
// Bối cảnh 08/2026: trang /auth luồng mới bug phía sàn (đá seller sang cổng
// developer) nên mặc định chuyển về luồng CŨ auth_partner ký sign
// (announcement 902 xác nhận luồng cũ vẫn hợp lệ). Bất biến sống còn:
//   1) state phải SỐNG SÓT qua chuyến đi — luồng cũ không có tham số state
//      chuẩn nên nhét trong query của redirect, mất nó là callback mù ownerId.
//   2) sign phải đúng công thức public API (partner_id + path + timestamp) —
//      sai là trang uỷ quyền báo lỗi ngay.
// ============================================================

import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  buildAuthorizeUrl,
  buildLegacyAuthorizeUrl,
} from "../shopee/client";
import type { ShopeeConfig } from "../shopee/config";

const cfg: ShopeeConfig = {
  partnerId: "2040029",
  partnerKey: "test_partner_key",
  redirectUri: "https://backend.example.com/api/auth/shopee/callback",
  apiBase: "https://partner.shopeemobile.com",
  env: "production",
};

// state thật là JWT — dùng chuỗi có ký tự cần escape để test encode.
const STATE = "eyJhbGciOi.abc+def/ghi=";

describe("buildLegacyAuthorizeUrl (luồng cũ auth_partner)", () => {
  const url = new URL(buildLegacyAuthorizeUrl(cfg.redirectUri, STATE, cfg));

  it("trỏ đúng host + path auth_partner", () => {
    expect(url.origin).toBe("https://partner.shopeemobile.com");
    expect(url.pathname).toBe("/api/v2/shop/auth_partner");
  });

  it("sign đúng HMAC-SHA256(partner_id + path + timestamp)", () => {
    const timestamp = url.searchParams.get("timestamp")!;
    const expected = crypto
      .createHmac("sha256", cfg.partnerKey)
      .update(`${cfg.partnerId}/api/v2/shop/auth_partner${timestamp}`)
      .digest("hex");
    expect(url.searchParams.get("sign")).toBe(expected);
    expect(url.searchParams.get("partner_id")).toBe(cfg.partnerId);
  });

  it("state nằm TRONG query của redirect và giải mã lại nguyên vẹn", () => {
    const redirect = new URL(url.searchParams.get("redirect")!);
    expect(redirect.origin + redirect.pathname).toBe(cfg.redirectUri);
    expect(redirect.searchParams.get("state")).toBe(STATE);
  });

  it("redirect đã có query sẵn thì nối bằng & (không đẻ ra 2 dấu ?)", () => {
    const u = new URL(
      buildLegacyAuthorizeUrl(`${cfg.redirectUri}?env=dev`, STATE, cfg)
    );
    const redirect = new URL(u.searchParams.get("redirect")!);
    expect(redirect.searchParams.get("env")).toBe("dev");
    expect(redirect.searchParams.get("state")).toBe(STATE);
  });
});

describe("buildAuthorizeUrl (luồng mới, giữ để quay lại khi sàn sửa bug)", () => {
  it("URL cố định + auth_type=seller + state tham số chuẩn, KHÔNG ký sign", () => {
    const url = new URL(buildAuthorizeUrl(cfg.redirectUri, STATE, cfg));
    expect(url.origin).toBe("https://open.shopee.com");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("auth_type")).toBe("seller");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("sign")).toBeNull();
  });
});
