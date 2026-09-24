// ============================================================
// TEST ĐỢT C — TỪ KHÓA SHOPEE (24/09/2026). Thuần, KHÔNG DB, KHÔNG gọi sàn.
//
// parseManualBidding: JSON info_type 2 → khối gọn (bỏ từ khóa trống, trống hẳn → null).
// mergeKeywordSignals: gợi ý ∩ đang chọn → inCampaign; bid đang đặt > gợi ý × 1,3 → overpaid;
// xếp hớ trước, rồi gợi ý chưa có theo lượt tìm; từ khóa đã xóa/blacklist không tính.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  KEYWORD_OVERPAY_FACTOR,
  inputKeywordFromName,
  mergeKeywordSignals,
  parseManualBidding,
} from "../shopee/ads-keywords";

describe("parseManualBidding — info_type 2 của sàn", () => {
  it("đọc từ khóa + vị trí Khám phá, bỏ từ khóa trống", () => {
    const out = parseManualBidding({
      enhanced_cpc: true,
      selected_keywords: [
        { keyword: "túi đeo chéo nam", status: "normal", match_type: "broad", bid_price_per_click: 1200 },
        { keyword: "  ", status: "normal", match_type: "exact", bid_price_per_click: 900 },
      ],
      discovery_ads_locations: [{ location: "daily_discover", status: "active", bid_price: 800 }],
    });
    expect(out?.enhancedCpc).toBe(true);
    expect(out?.selected).toEqual([{ keyword: "túi đeo chéo nam", matchType: "broad", bid: 1200, status: "normal" }]);
    expect(out?.discovery).toEqual([{ location: "daily_discover", active: true, bid: 800 }]);
  });

  it("null / rỗng / không phải object → null", () => {
    expect(parseManualBidding(null)).toBeNull();
    expect(parseManualBidding({})).toBeNull();
    expect(parseManualBidding({ selected_keywords: [], discovery_ads_locations: [] })).toBeNull();
    expect(parseManualBidding("x")).toBeNull();
  });
});

const SEL = [
  { keyword: "Túi đeo chéo nam", matchType: "broad", bid: 2000, status: "normal" },
  { keyword: "túi chéo", matchType: "exact", bid: 1000, status: "normal" },
  { keyword: "túi cũ", matchType: "exact", bid: 5000, status: "deleted" },
  { keyword: "túi riêng", matchType: "exact", bid: 700, status: "normal" },
];

describe("mergeKeywordSignals — đối chiếu gợi ý với từ khóa đang chọn", () => {
  it("trả giá hớ khi bid > gợi ý × 1,3; không phân biệt hoa thường", () => {
    const { rows } = mergeKeywordSignals(SEL, [
      { keyword: "túi đeo chéo nam", quality_score: 8, search_volume: 5000, suggested_bid: 1400 },
      { keyword: "túi chéo", quality_score: 6, search_volume: 3000, suggested_bid: 900 },
    ]);
    const a = rows.find((r) => r.keyword === "túi đeo chéo nam")!;
    expect(a.inCampaign).toBe(true);
    expect(a.currentBid).toBe(2000);
    expect(a.overpaid).toBe(true); // 2000 > 1400 × 1,3 = 1820
    const b = rows.find((r) => r.keyword === "túi chéo")!;
    expect(b.overpaid).toBe(false); // 1000 < 900 × 1,3 = 1170
    expect(KEYWORD_OVERPAY_FACTOR).toBe(1.3);
  });

  it("gợi ý chưa có trong campaign → inCampaign false; từ khóa đã xóa không tính là đang chạy", () => {
    const { rows } = mergeKeywordSignals(SEL, [
      { keyword: "túi cũ", search_volume: 100, suggested_bid: 500 },
      { keyword: "balo nam", search_volume: 9000, suggested_bid: 1100 },
    ]);
    expect(rows.find((r) => r.keyword === "túi cũ")?.inCampaign).toBe(false);
    expect(rows.find((r) => r.keyword === "balo nam")?.inCampaign).toBe(false);
  });

  it("xếp: hớ trước → gợi ý chưa có theo lượt tìm giảm dần → đang có; trùng lặp bỏ", () => {
    const { rows, selectedWithoutSuggestion } = mergeKeywordSignals(SEL, [
      { keyword: "balo nam", search_volume: 9000, suggested_bid: 1100 },
      { keyword: "túi chéo", search_volume: 3000, suggested_bid: 900 },
      { keyword: "túi đeo chéo nam", search_volume: 5000, suggested_bid: 1400 },
      { keyword: "ví da", search_volume: 12000, suggested_bid: 700 },
      { keyword: "Balo Nam", search_volume: 1, suggested_bid: 1 },
    ]);
    expect(rows.map((r) => r.keyword)).toEqual(["túi đeo chéo nam", "ví da", "balo nam", "túi chéo"]);
    // "túi riêng" đang chạy nhưng Shopee không gợi ý → không có số để so, liệt kê riêng.
    expect(selectedWithoutSuggestion.map((k) => k.keyword)).toEqual(["túi riêng"]);
  });

  it("không có gợi ý → rows rỗng, mọi từ khóa đang chạy vào nhóm không có số", () => {
    const out = mergeKeywordSignals(SEL, []);
    expect(out.rows).toEqual([]);
    expect(out.selectedWithoutSuggestion).toHaveLength(3);
  });
});

describe("inputKeywordFromName — chữ đầu tên SP làm input_keyword", () => {
  it("lấy 3 chữ đầu, bỏ ký tự ngoặc/dấu, chữ thường", () => {
    expect(inputKeywordFromName("Túi Đeo Chéo Nam ANO [KT: 22x15] - Da PU")).toBe("túi đeo chéo");
    expect(inputKeywordFromName("  Áo  gió ")).toBe("áo gió");
    expect(inputKeywordFromName(null)).toBe("");
  });
});
