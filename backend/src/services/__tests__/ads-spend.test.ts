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

  it("gian bị sàn thu theo đơn → AdSpend chỉ tham chiếu, không cộng (không trừ hai lần)", () => {
    const s = summarizeAdsSpend({
      rows,
      gmvMaxChargedByChannel: new Map([["tt", -120_000]]),
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: true }],
      dateKey: key,
    });
    expect(s.total).toBe(100_000);
    expect(s.byChannel.has("TIKTOK")).toBe(false);
    expect(s.byDay.get("2026-09-26")).toBeUndefined();
    expect(s.notes).toEqual(["TikTok đã trừ tiền quảng cáo trong đơn, không cộng lại ở đây"]);
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
