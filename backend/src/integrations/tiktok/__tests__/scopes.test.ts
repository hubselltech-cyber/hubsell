import { describe, expect, it } from "vitest";

import { TIKTOK_PRODUCT_WRITE_SCOPE_AT, tiktokNeedsReauthForStockPush } from "../scopes";

describe("tiktokNeedsReauthForStockPush", () => {
  it("gian TikTok chưa ghi mốc ủy quyền = cũ → cần kết nối lại", () => {
    expect(tiktokNeedsReauthForStockPush({ channelName: "TIKTOK", authorizedAt: null })).toBe(
      true
    );
  });

  it("gian TikTok ủy quyền trước mốc bật Product Modify → cần kết nối lại", () => {
    const before = new Date(TIKTOK_PRODUCT_WRITE_SCOPE_AT.getTime() - 60_000);
    expect(tiktokNeedsReauthForStockPush({ channelName: "TIKTOK", authorizedAt: before })).toBe(
      true
    );
  });

  it("gian TikTok ủy quyền sau mốc → không cần", () => {
    const after = new Date(TIKTOK_PRODUCT_WRITE_SCOPE_AT.getTime() + 60_000);
    expect(tiktokNeedsReauthForStockPush({ channelName: "TIKTOK", authorizedAt: after })).toBe(
      false
    );
  });

  it("Shopee/Lazada không bao giờ cần, kể cả chưa có mốc", () => {
    expect(tiktokNeedsReauthForStockPush({ channelName: "SHOPEE", authorizedAt: null })).toBe(
      false
    );
    expect(tiktokNeedsReauthForStockPush({ channelName: "LAZADA", authorizedAt: null })).toBe(
      false
    );
  });
});
