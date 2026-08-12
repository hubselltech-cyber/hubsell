// ============================================================
// TEST TRỢ LÝ QUẢNG CÁO LAZADA — logic thuần, KHÔNG DB, KHÔNG gọi sàn.
//
// Ba lớp: (1) parser số liệu LSS (chuỗi "-" của sàn) + đọc envelope ghi,
// (2) deriveStatus map trạng thái Lazada → bộ từ vựng chung của AdsCampaign,
// (3) thẻ cảnh báo Trung tâm điều hành mang đúng nhãn/deep-link Lazada + thẻ
// ví hết tiền theo cờ adAccountBalanceStatus.
// ============================================================

import { describe, expect, it } from "vitest";
import { lazAdsNum, lazAdsWriteOk } from "../lazada/client";
import { deriveStatus } from "../lazada/ads-campaigns";
import { deriveLazadaItemSku } from "../shopee/ads-insights";
import {
  buildLazadaAdsWalletEmptyAlert,
  buildShopeeAdsAssistantAlerts,
  groupShopeeAdsScenarios,
  type ShopeeAdsCampaignSignal,
} from "../../ops-alerts";

describe("lazAdsNum — parser số liệu Sponsored Solutions", () => {
  it("đổi chuỗi '-' (metric trống của Lazada, thấy trong probe thật) về 0", () => {
    expect(lazAdsNum("-")).toBe(0);
    expect(lazAdsNum("")).toBe(0);
    expect(lazAdsNum(null)).toBe(0);
    expect(lazAdsNum(undefined)).toBe(0);
  });
  it("nhận cả number lẫn chuỗi số; rác về 0", () => {
    expect(lazAdsNum(204199)).toBe(204199);
    expect(lazAdsNum("66.68")).toBeCloseTo(66.68);
    expect(lazAdsNum("-1")).toBe(-1);
    expect(lazAdsNum("abc")).toBe(0);
  });
});

describe("lazAdsWriteOk — đọc envelope updateCampaign", () => {
  it("code 0 và success không-false là thành công (kể cả success dạng chuỗi)", () => {
    expect(lazAdsWriteOk({ code: "0", success: true })).toBe(true);
    expect(lazAdsWriteOk({ code: "0", success: "true" })).toBe(true);
    expect(lazAdsWriteOk({ code: "0" })).toBe(true);
  });
  it("code khác 0 hoặc success=false là thất bại", () => {
    expect(lazAdsWriteOk({ code: "500", success: true })).toBe(false);
    expect(lazAdsWriteOk({ code: "0", success: false })).toBe(false);
    expect(lazAdsWriteOk({ code: "0", success: "false" })).toBe(false);
  });
});

describe("deriveStatus — map trạng thái Lazada về bộ từ vựng chung", () => {
  const TODAY = "2026-08-12";
  it("status 9 là deleted, thắng mọi cờ khác", () => {
    expect(
      deriveStatus({ status: 9, campaignSwitchStatus: 1 }, TODAY)
    ).toBe("deleted");
  });
  it("switch 0 là paused (đúng 5 campaign thật của DarkMan trong probe)", () => {
    expect(
      deriveStatus(
        { status: 0, campaignSwitchStatus: 0, endDate: "3020-12-30" },
        TODAY
      )
    ).toBe("paused");
  });
  it("endDate đã qua là ended; endDate 3020 coi như không hẹn tắt", () => {
    expect(
      deriveStatus(
        { status: 1, campaignSwitchStatus: 1, endDate: "2026-08-01" },
        TODAY
      )
    ).toBe("ended");
    expect(
      deriveStatus(
        { status: 1, campaignSwitchStatus: 1, endDate: "3020-12-30" },
        TODAY
      )
    ).toBe("ongoing");
  });
  it("startDate tương lai là scheduled", () => {
    expect(
      deriveStatus(
        { status: 1, campaignSwitchStatus: 1, startDate: "2026-09-01" },
        TODAY
      )
    ).toBe("scheduled");
  });
});

describe("deriveLazadaItemSku — SKU tổng NGUYÊN VĂN, không suy đoán (chốt 12/08)", () => {
  it("1 phân loại → lấy trọn SKU seller đặt, dài bao nhiêu cũng giữ nguyên", () => {
    expect(deriveLazadaItemSku(["TC042"])).toBe("TC042");
    expect(
      deriveLazadaItemSku(["AO-THUN-COTTON-NAM-NU-FORM-RONG-2026-TRANG-XL"])
    ).toBe("AO-THUN-COTTON-NAM-NU-FORM-RONG-2026-TRANG-XL");
  });
  it("các phân loại trùng hệt một SKU → vẫn là 1 SKU duy nhất", () => {
    expect(deriveLazadaItemSku(["AOGIO01", "AOGIO01"])).toBe("AOGIO01");
  });
  it("nhiều SKU khác nhau → null (KHÔNG cắt tiền tố — FE hiện đủ danh sách)", () => {
    expect(deriveLazadaItemSku(["TC042-Đen", "TC042-Xám"])).toBeNull();
    expect(deriveLazadaItemSku(["TC042", "TUI01"])).toBeNull();
  });
  it("rỗng/toàn khoảng trắng → null", () => {
    expect(deriveLazadaItemSku([])).toBeNull();
    expect(deriveLazadaItemSku(["  ", ""])).toBeNull();
  });
});

function signal(p: Partial<ShopeeAdsCampaignSignal>): ShopeeAdsCampaignSignal {
  return {
    campaignId: "c1",
    name: "Campaign test",
    verdict: null,
    triggers: [],
    decisionActive: false,
    spendToday: 0,
    spend7d: 0,
    ...p,
  };
}

describe("thẻ cảnh báo điều hành mang nhãn Lazada", () => {
  const LAZADA = { label: "Lazada", path: "/ads/lazada" };

  it("deep-link và badge nguồn trỏ đúng /ads/lazada + 'Lazada'", () => {
    const groups = groupShopeeAdsScenarios([
      signal({ verdict: "spike", spendToday: 500_000, spend7d: 900_000 }),
    ]);
    const alerts = buildShopeeAdsAssistantAlerts(
      { channelId: "ch1", shopName: "Hi.Bé" },
      groups,
      null,
      LAZADA
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("ads-spend-spike");
    expect(alerts[0].title).toContain("Hi.Bé");
    const payload = alerts[0].payload as { href: string; source: string };
    expect(payload.href).toContain("/ads/lazada?channelId=ch1");
    expect(payload.source).toBe("Lazada");
  });

  it("mặc định (không truyền platform) vẫn là Shopee — không vỡ hành vi cũ", () => {
    const groups = groupShopeeAdsScenarios([
      signal({ verdict: "spike", spendToday: 500_000 }),
    ]);
    const alerts = buildShopeeAdsAssistantAlerts(
      { channelId: "ch2", shopName: "DarkMan" },
      groups,
      null
    );
    const payload = alerts[0].payload as { href: string; source: string };
    expect(payload.href).toContain("/ads/shopee?channelId=ch2");
    expect(payload.source).toBe("Shopee");
  });

  it("thẻ ví Lazada hết tiền: type ads-low-balance, severity high, link về /ads/lazada", () => {
    const alert = buildLazadaAdsWalletEmptyAlert({
      channelId: "ch3",
      shopName: "Hi.Bé",
    });
    expect(alert.type).toBe("ads-low-balance");
    expect(alert.severity).toBe("high");
    expect(alert.dedupeKey).toBe("ch3");
    const payload = alert.payload as { href: string; source: string };
    expect(payload.href).toBe("/ads/lazada?channelId=ch3");
    expect(payload.source).toBe("Lazada");
  });
});
