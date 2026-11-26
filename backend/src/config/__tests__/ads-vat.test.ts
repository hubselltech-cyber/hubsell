import { describe, expect, it } from "vitest";
import { adsChargedInOrderIncludesVat, adsVatRate } from "../ads-vat";

describe("adsVatRate — thuế suất GTGT quảng cáo theo sàn + ngày", () => {
  it("TikTok: 5 % trước 01/07/2025, 10 % từ đó", () => {
    expect(adsVatRate("TIKTOK", "2025-06-30")).toBe(0.05);
    expect(adsVatRate("TIKTOK", "2025-07-01")).toBe(0.1);
    expect(adsVatRate("TIKTOK", "2027-03-01")).toBe(0.1);
  });

  it("Shopee: 10 % → 8 % (01/07/2025 – 31/12/2026) → 10 %", () => {
    expect(adsVatRate("SHOPEE", "2025-06-30")).toBe(0.1);
    expect(adsVatRate("SHOPEE", "2025-07-01")).toBe(0.08);
    expect(adsVatRate("SHOPEE", "2026-12-31")).toBe(0.08);
    expect(adsVatRate("SHOPEE", "2027-01-01")).toBe(0.1);
  });

  it("Lazada / Offline / sàn lạ: 0 (chưa có nguồn)", () => {
    expect(adsVatRate("LAZADA", "2026-11-26")).toBe(0);
    expect(adsVatRate("OFFLINE", "2026-11-26")).toBe(0);
    expect(adsVatRate("KHAC", "2026-11-26")).toBe(0);
  });

  it("khoản trừ trong đơn đã gồm thuế: chỉ Shopee", () => {
    expect(adsChargedInOrderIncludesVat("SHOPEE")).toBe(true);
    expect(adsChargedInOrderIncludesVat("TIKTOK")).toBe(false);
  });
});
