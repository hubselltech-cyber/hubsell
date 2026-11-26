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
      chargedInOrderByChannel: new Map([["tt", 0]]),
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
      chargedInOrderByChannel: new Map([["tt", -843_529]]),
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
      chargedInOrderByChannel: new Map([["tt", -120_000]]),
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
      chargedInOrderByChannel: new Map([["tt", -2_000_000]]),
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: true }],
      dateKey: key,
    });
    expect(s.total).toBe(100_000);
    expect(s.byChannel.has("TIKTOK")).toBe(false);
  });

  it("gian TikTok chưa nối quảng cáo → ghi chú rõ, không im lặng", () => {
    const s = summarizeAdsSpend({
      rows: rows.filter((r) => r.channelId !== "tt"),
      chargedInOrderByChannel: new Map(),
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: false }],
      dateKey: key,
    });
    expect(s.total).toBe(100_000);
    expect(s.notes).toEqual(["TikTok cần kết nối tài khoản quảng cáo"]);
  });

  it("gian Shopee chưa ủy quyền Hubsell Ads → ghi chú rõ (30/10, khách phamgiathang); đã nối thì im", () => {
    const base = { rows, chargedInOrderByChannel: new Map(), tiktokChannels: [], dateKey: key };
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

  it("Shopee trích tiền đơn nạp ví quảng cáo → dòng Ads chỉ cộng phần tiêu VƯỢT số đã trích, có ghi chú (10/11, gian Mẹ mua đi)", () => {
    const base = {
      rows,
      tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: true }],
      shopeeChannels: [{ id: "sp", shopName: "DarkMan", adsLinked: true }],
      dateKey: key,
    };
    // Trích 60.000 trong đơn, tiêu 100.000 → cộng thêm 40.000; TikTok không bị ảnh hưởng.
    const motPhan = summarizeAdsSpend({ ...base, chargedInOrderByChannel: new Map([["sp", -60_000]]) });
    expect(motPhan.byChannel.get("SHOPEE")).toBeCloseTo(40_000, 6);
    expect(motPhan.total).toBeCloseTo(883_529, 6);
    expect(motPhan.notes).toEqual(["Shopee đã trích một phần tiền đơn để nạp ví quảng cáo, ở đây chỉ cộng phần còn lại"]);
    // Kỳ nạp nhiều hơn tiêu → kẹp 0, không ra số âm.
    const nhieuHon = summarizeAdsSpend({ ...base, chargedInOrderByChannel: new Map([["sp", -250_000]]) });
    expect(nhieuHon.byChannel.has("SHOPEE")).toBe(false);
    expect(nhieuHon.total).toBe(843_529);
    // Gian không bật nạp ví từ đơn → cộng đủ như cũ, không ghi chú.
    const khong = summarizeAdsSpend({ ...base, chargedInOrderByChannel: new Map() });
    expect(khong.total).toBe(943_529);
    expect(khong.notes).toEqual([]);
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

// ============================================================
// THUẾ GTGT QUẢNG CÁO (26/11/2026, docs/TAI-CHINH-VAT-QUANG-CAO.md): sàn cộng thuế thêm lúc
// nạp tiền quảng cáo → phần quảng cáo NGOÀI ĐƠN cộng thêm thuế theo thuế suất của ngày tiêu.
// ============================================================
describe("summarizeAdsSpend — thuế GTGT quảng cáo", () => {
  const base = {
    tiktokChannels: [{ id: "tt", shopName: "ANO", adsLinked: true }],
    shopeeChannels: [{ id: "sp", shopName: "DarkMan", adsLinked: true }],
    dateKey: key,
  };

  it("không truyền vatAsCost (hoặc false) → y như trước: vat = 0, total không đổi", () => {
    for (const vatAsCost of [undefined, false]) {
      const s = summarizeAdsSpend({ ...base, rows, chargedInOrderByChannel: new Map(), vatAsCost });
      expect(s.total).toBe(943_529);
      expect(s.vat).toBe(0);
      expect(s.vatByDay.size).toBe(0);
    }
  });

  it("tự nạp hết: TikTok 10 %, Shopee 8 % trên số sàn báo; total vẫn là số CHƯA thuế", () => {
    const s = summarizeAdsSpend({ ...base, rows, chargedInOrderByChannel: new Map(), vatAsCost: true });
    expect(s.total).toBe(943_529);
    expect(s.vatByChannel.get("TIKTOK")).toBeCloseTo(84_352.9, 6);
    expect(s.vatByChannel.get("SHOPEE")).toBeCloseTo(8_000, 6);
    expect(s.vat).toBeCloseTo(92_352.9, 6);
    // Theo ngày: 25/09 = 100.000 × 8 % + 300.000 × 10 %; 26/09 = 543.529 × 10 %.
    expect(s.vatByDay.get("2026-09-25")).toBeCloseTo(38_000, 6);
    expect(s.vatByDay.get("2026-09-26")).toBeCloseTo(54_352.9, 6);
  });

  it("Shopee trích từ đơn ĐÃ gồm thuế → bóc thuế trước khi trừ; tổng tiền quảng cáo = tiền thật rời túi", () => {
    // Tháng tiêu 10.000.000 (sàn báo, chưa thuế); 5.400.000 trích từ đơn (= 5.000.000 + thuế 8 %).
    const sp: AdSpendRow[] = [
      { channelId: "sp", channelName: "SHOPEE", shopName: "DarkMan", date: d("2026-10-10"), amount: 4_000_000 },
      { channelId: "sp", channelName: "SHOPEE", shopName: "DarkMan", date: d("2026-10-20"), amount: 6_000_000 },
    ];
    const s = summarizeAdsSpend({
      ...base,
      rows: sp,
      chargedInOrderByChannel: new Map([["sp", -5_400_000]]),
      vatAsCost: true,
    });
    expect(s.total).toBeCloseTo(5_000_000, 4); // ngoài đơn, chưa thuế
    expect(s.vat).toBeCloseTo(400_000, 4); // 8 % của phần ngoài đơn
    // Trong đơn 5.400.000 + ngoài đơn 5.000.000 + thuế 400.000 = 10.800.000 = 10.000.000 × 1,08.
    expect(5_400_000 + s.total + s.vat).toBeCloseTo(10_800_000, 4);
    // Tắt thuế → phép trừ cũ (không bóc thuế): 10.000.000 − 5.400.000.
    const off = summarizeAdsSpend({
      ...base,
      rows: sp,
      chargedInOrderByChannel: new Map([["sp", -5_400_000]]),
      vatAsCost: false,
    });
    expect(off.total).toBeCloseTo(4_600_000, 4);
    expect(off.vat).toBe(0);
  });

  it("Shopee trích trọn từ đơn (nạp ví = chi tiêu × 1,08) → không còn phần ngoài đơn, không cộng thuế", () => {
    const sp: AdSpendRow[] = [
      { channelId: "sp", channelName: "SHOPEE", shopName: "DarkMan", date: d("2026-10-10"), amount: 1_000_000 },
    ];
    const s = summarizeAdsSpend({
      ...base,
      rows: sp,
      chargedInOrderByChannel: new Map([["sp", -1_080_000]]),
      vatAsCost: true,
    });
    expect(s.total).toBeCloseTo(0, 4);
    expect(s.vat).toBeCloseTo(0, 4);
  });

  it("TikTok trừ trong đơn: CHƯA biết đã gồm thuế chưa → giữ phép trừ cũ, thuế chỉ trên phần vượt", () => {
    const s = summarizeAdsSpend({
      ...base,
      rows,
      chargedInOrderByChannel: new Map([["tt", -120_000]]),
      vatAsCost: true,
    });
    expect(s.byChannel.get("TIKTOK")).toBeCloseTo(723_529, 6);
    expect(s.vatByChannel.get("TIKTOK")).toBeCloseTo(72_352.9, 6);
  });

  it("kỳ vắt qua 31/12/2026: Shopee 8 % tới hết năm, 10 % từ 01/01/2027", () => {
    const sp: AdSpendRow[] = [
      { channelId: "sp", channelName: "SHOPEE", shopName: "DarkMan", date: d("2026-12-31"), amount: 1_000_000 },
      { channelId: "sp", channelName: "SHOPEE", shopName: "DarkMan", date: d("2027-01-01"), amount: 1_000_000 },
    ];
    const s = summarizeAdsSpend({ ...base, rows: sp, chargedInOrderByChannel: new Map(), vatAsCost: true });
    expect(s.vatByDay.get("2026-12-31")).toBeCloseTo(80_000, 6);
    expect(s.vatByDay.get("2027-01-01")).toBeCloseTo(100_000, 6);
    expect(s.vat).toBeCloseTo(180_000, 6);
  });

  it("Lazada: chưa có nguồn nêu thuế suất → 0", () => {
    const lz: AdSpendRow[] = [
      { channelId: "lz", channelName: "LAZADA", shopName: "L", date: d("2026-10-10"), amount: 1_000_000 },
    ];
    const s = summarizeAdsSpend({ ...base, rows: lz, chargedInOrderByChannel: new Map(), vatAsCost: true });
    expect(s.total).toBe(1_000_000);
    expect(s.vat).toBe(0);
  });

  it("ADS_VAT_OFF=1 (đường lui toàn hệ thống) → như tắt, kể cả khi shop bật", () => {
    process.env.ADS_VAT_OFF = "1";
    try {
      const s = summarizeAdsSpend({ ...base, rows, chargedInOrderByChannel: new Map(), vatAsCost: true });
      expect(s.vat).toBe(0);
      expect(s.total).toBe(943_529);
    } finally {
      delete process.env.ADS_VAT_OFF;
    }
  });
});
