// Tính tiền mua giờ quay (lib/pack-video-hour-pricing.ts): 1.500 đ / giờ tính thẳng, tối thiểu 20 giờ.
import { describe, expect, it } from "vitest";
import { PACK_VIDEO_HOUR_PRESETS, PACK_VIDEO_HOUR_PRICE_VND } from "../../config/pack-video";
import { amountMatchesHours, quoteHours } from "../pack-video-hour-pricing";

describe("quoteHours", () => {
  it("đơn giá chốt 1.500 đ / giờ", () => {
    expect(PACK_VIDEO_HOUR_PRICE_VND).toBe(1500);
  });

  it("ba gói sẵn 50 / 200 / 500 giờ = 75.000 / 300.000 / 750.000 đ — không giảm giá", () => {
    expect(PACK_VIDEO_HOUR_PRESETS.map((h) => quoteHours(h))).toEqual([
      { ok: true, hours: 50, amountVnd: 75_000 },
      { ok: true, hours: 200, amountVnd: 300_000 },
      { ok: true, hours: 500, amountVnd: 750_000 },
    ]);
  });

  it("tính thẳng: 499 giờ rẻ hơn 500 giờ, không có bậc", () => {
    const a = quoteHours(499);
    const b = quoteHours(500);
    expect(a.ok && b.ok && a.amountVnd < b.amountVnd).toBe(true);
  });

  it("tối thiểu 20 giờ = 30.000 đ; 19 giờ bị từ chối", () => {
    expect(quoteHours(20)).toEqual({ ok: true, hours: 20, amountVnd: 30_000 });
    expect(quoteHours(19)).toEqual({ ok: false, error: "Mua tối thiểu 20 giờ" });
  });

  it("nhận chuỗi số từ ô nhập", () => {
    expect(quoteHours(" 120 ")).toEqual({ ok: true, hours: 120, amountVnd: 180_000 });
  });

  it.each([[12.5], ["abc"], [""], [null], [undefined], [Number.NaN], [-50], [Infinity]])("từ chối %p", (raw) => {
    expect(quoteHours(raw).ok).toBe(false);
  });

  it("chặn gõ nhầm quá tối đa", () => {
    expect(quoteHours(10_001).ok).toBe(false);
    expect(quoteHours(10_000).ok).toBe(true);
  });
});

describe("amountMatchesHours — kiểm lúc tiền về", () => {
  it("đúng tiền thì khớp", () => {
    expect(amountMatchesHours(300_000, 200)).toBe(true);
  });
  it("thiếu / thừa một đồng, hay số giờ sai luật → không khớp, không cộng giờ", () => {
    expect(amountMatchesHours(299_999, 200)).toBe(false);
    expect(amountMatchesHours(300_001, 200)).toBe(false);
    expect(amountMatchesHours(15_000, 10)).toBe(false);
    expect(amountMatchesHours(300_000.5, 200)).toBe(false);
  });
});
