import { describe, expect, it } from "vitest";
import { summarizeAdsSpend, type AdSpendRow } from "../ads-spend";

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
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0]).toContain("120.000 ₫");
    expect(s.notes[0]).toContain("843.529 ₫");
    expect(s.notes[0]).toContain("không cộng");
  });

  it("gian TikTok chưa nối quảng cáo → ghi chú rõ, không im lặng", () => {
    const s = summarizeAdsSpend({
      rows: rows.filter((r) => r.channelId !== "tt"),
      gmvMaxChargedByChannel: new Map(),
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: false }],
      dateKey: key,
    });
    expect(s.total).toBe(100_000);
    expect(s.notes).toEqual(["TikTok ANO: chưa nối quảng cáo TikTok nên chưa có tiền ads."]);
  });
});
