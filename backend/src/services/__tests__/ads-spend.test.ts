import { describe, expect, it } from "vitest";
import { adSpendDateRange, summarizeAdsSpend, type AdSpendRow } from "../ads-spend";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const key = (x: Date) => x.toISOString().slice(0, 10);

const rows: AdSpendRow[] = [
  { channelId: "sp", channelName: "SHOPEE", shopName: "DarkMan", date: d("2026-09-25"), amount: 100_000 },
  { channelId: "tt", channelName: "TIKTOK", shopName: "ANO", date: d("2026-09-25"), amount: 300_000 },
  { channelId: "tt", channelName: "TIKTOK", shopName: "ANO", date: d("2026-09-26"), amount: 543_529 },
];

describe("summarizeAdsSpend", () => {
  it("cộng ads TikTok như Shopee khi sàn KHÔNG trừ GMV Max trong đơn (ANO 26/09)", () => {
    const s = summarizeAdsSpend({
      rows,
      gmvMaxChargedByChannel: new Map([["tt", 0]]),
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: true }],
      dateKey: key,
    });
    expect(s.total).toBe(943_529);
    expect(s.byDay.get("2026-09-26")).toBe(543_529);
    expect(s.byChannel.get("TIKTOK")).toBe(843_529);
    expect(s.byChannel.get("SHOPEE")).toBe(100_000);
    expect(s.notes).toEqual([]);
  });

  it("gian bị sàn thu TRỌN ads theo đơn → không cộng lại (không trừ hai lần)", () => {
    const s = summarizeAdsSpend({
      rows,
      gmvMaxChargedByChannel: new Map([["tt", -843_529]]),
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: true }],
      dateKey: key,
    });
    expect(s.total).toBe(100_000);
    expect(s.byChannel.has("TIKTOK")).toBe(false);
    expect(s.byDay.get("2026-09-26")).toBeUndefined();
    expect(s.notes).toEqual(["TikTok đã trừ một phần tiền quảng cáo trong đơn, ở đây chỉ cộng phần còn lại"]);
  });

  it("gian trả ads bằng tài khoản quảng cáo nhưng có phí coupon GMV Max trong đơn → chỉ trừ đúng phần đã thu, không bỏ cả gian (69Minh Đương 20/10)", () => {
    const s = summarizeAdsSpend({
      rows,
      gmvMaxChargedByChannel: new Map([["tt", -120_000]]),
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: true }],
      dateKey: key,
    });
    // TikTok: 843.529 − 120.000 = 723.529, chia theo tỷ lệ lên hai ngày; Shopee cộng đủ.
    expect(s.total).toBeCloseTo(823_529, 6);
    expect(s.byChannel.get("TIKTOK")).toBeCloseTo(723_529, 6);
    expect(s.byChannel.get("SHOPEE")).toBe(100_000);
    const factor = 723_529 / 843_529;
    expect(s.byDay.get("2026-09-26")).toBeCloseTo(543_529 * factor, 6);
    expect(s.byDay.get("2026-09-25")).toBeCloseTo(100_000 + 300_000 * factor, 6);
    expect(s.notes).toEqual(["TikTok đã trừ một phần tiền quảng cáo trong đơn, ở đây chỉ cộng phần còn lại"]);
  });

  it("khoản thu trong đơn lớn hơn AdSpend (lệch kỳ quyết toán) → kẹp 0, không ra số âm", () => {
    const s = summarizeAdsSpend({
      rows,
      gmvMaxChargedByChannel: new Map([["tt", -2_000_000]]),
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: true }],
      dateKey: key,
    });
    expect(s.total).toBe(100_000);
    expect(s.byChannel.has("TIKTOK")).toBe(false);
  });

  it("gian TikTok chưa nối quảng cáo → ghi chú rõ, không im lặng", () => {
    const s = summarizeAdsSpend({
      rows: rows.filter((r) => r.channelId !== "tt"),
      gmvMaxChargedByChannel: new Map(),
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: false }],
      dateKey: key,
    });
    expect(s.total).toBe(100_000);
    expect(s.notes).toEqual(["TikTok cần kết nối tài khoản quảng cáo"]);
  });

  it("gian Shopee chưa ủy quyền Hubsell Ads → ghi chú rõ (30/10, khách phamgiathang); đã nối thì im", () => {
    const base = { rows, gmvMaxChargedByChannel: new Map(), tiktokChannels: [], dateKey: key };
    const chua = summarizeAdsSpend({
      ...base,
      shopeeChannels: [{ id: "sp", shopName: "QA giầy", adsLinked: false }],
    });
    expect(chua.notes).toEqual(["Shopee cần kết nối Hubsell Ads (ứng dụng quảng cáo riêng) để lấy tiền ads"]);
    const da = summarizeAdsSpend({ ...base, shopeeChannels: [{ id: "sp", shopName: "QA giầy", adsLinked: true }] });
    expect(da.notes).toEqual([]);
    // Caller cũ không truyền shopeeChannels → không ghi chú (không đổi hành vi).
    expect(summarizeAdsSpend(base).notes).toEqual([]);
  });
});

describe("adSpendDateRange — khoảng giờ VN → khoảng NGÀY cho cột @db.Date", () => {
  it("Hôm nay 26/09 (00:00 → 23:59:59 VN) chỉ lấy đúng ngày 26/09, không kéo 25/09", () => {
    // parseDateRange("2026-09-26") = 25/09 17:00Z → 26/09 16:59:59.999Z
    const r = adSpendDateRange({
      gte: new Date("2026-09-25T17:00:00.000Z"),
      lte: new Date("2026-09-26T16:59:59.999Z"),
    });
    expect(r.gte.toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(r.lte.toISOString()).toBe("2026-09-26T00:00:00.000Z");
  });

  it("30 ngày qua giữ đúng hai mốc đầu/cuối theo ngày VN", () => {
    const r = adSpendDateRange({
      gte: new Date("2026-08-27T17:00:00.000Z"),
      lte: new Date("2026-09-26T16:59:59.999Z"),
    });
    expect(r.gte.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(r.lte.toISOString()).toBe("2026-09-26T00:00:00.000Z");
  });
});
