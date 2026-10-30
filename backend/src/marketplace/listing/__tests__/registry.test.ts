// Gian nào dùng adapter thật, gian nào giả lập (docs/SAO-CHEP-SAN-PHAM.md mục 2).
import type { Channel } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { channelHasRealApi, getListingAdapter } from "../registry";

const ch = (o: Partial<Channel>): Channel => ({ channelName: "SHOPEE", refreshToken: "rt", shopCipher: null, ...o }) as Channel;

describe("registry", () => {
  it("Shopee / Lazada có refreshToken → adapter thật; TikTok cần thêm shopCipher", () => {
    expect(getListingAdapter(ch({ channelName: "SHOPEE" })).name).toBe("shopee");
    expect(getListingAdapter(ch({ channelName: "LAZADA" })).name).toBe("lazada");
    expect(getListingAdapter(ch({ channelName: "TIKTOK" })).name).toBe("mock");
    expect(getListingAdapter(ch({ channelName: "TIKTOK", shopCipher: "c" })).name).toBe("tiktok");
  });
  it("không token (seed dev, demo người duyệt) hoặc OFFLINE → giả lập", () => {
    expect(channelHasRealApi(ch({ refreshToken: null }))).toBe(false);
    expect(getListingAdapter(ch({ refreshToken: null })).name).toBe("mock");
    expect(getListingAdapter(ch({ channelName: "OFFLINE" })).name).toBe("mock");
  });
});
