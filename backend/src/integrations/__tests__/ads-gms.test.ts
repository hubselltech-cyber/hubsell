// ============================================================
// TEST GMS = GMV MAX CẤP SHOP (24/09/2026) — phần thuần, KHÔNG DB, KHÔNG gọi sàn.
// gmsStatusFrom: eligibility → trạng thái (active_campaign = đang chạy; probe ANO 24/09: is_eligible
// true + reason null = "eligible", chưa chạy). gmsReportNumbers: báo cáo sàn → số sạch + ROAS.
// gmsWindowKeys: cửa sổ N ngày TRỌN kết thúc hôm qua (sàn đòi start ≠ end, bỏ hôm nay).
// ============================================================

import { describe, expect, it } from "vitest";
import { gmsReportNumbers, gmsStatusFrom, gmsWindowKeys } from "../shopee/ads-gms";

describe("gmsStatusFrom", () => {
  it("reason active_campaign → active (dù is_eligible false)", () => {
    expect(gmsStatusFrom({ is_eligible: false, reason: "active_campaign" })).toBe("active");
  });
  it("ANO 24/09: is_eligible true, reason null → eligible", () => {
    expect(gmsStatusFrom({ is_eligible: true, reason: undefined })).toBe("eligible");
  });
  it("không đủ điều kiện → giữ nguyên reason của sàn; rỗng → error:empty", () => {
    expect(gmsStatusFrom({ is_eligible: false, reason: "not_whitelisted" })).toBe("not_whitelisted");
    expect(gmsStatusFrom(undefined)).toBe("error:empty");
  });
});

describe("gmsReportNumbers", () => {
  it("đọc đủ trường, ROAS = broad_gmv / expense", () => {
    const n = gmsReportNumbers({ expense: 200_000, broad_gmv: 1_400_000, broad_order: 7, clicks: 150, impression: 9000, direct_gmv: 900_000, direct_order: 4 });
    expect(n.expense).toBe(200_000);
    expect(n.broadOrder).toBe(7);
    expect(n.roasBroad).toBeCloseTo(7, 5);
    expect(n.directGmv).toBe(900_000);
  });
  it("thiếu trường / null → 0, không chi tiêu → ROAS null", () => {
    const n = gmsReportNumbers(undefined);
    expect(n.expense).toBe(0);
    expect(n.roasBroad).toBeNull();
  });
});

describe("gmsWindowKeys", () => {
  it("7 ngày trọn kết thúc hôm qua", () => {
    expect(gmsWindowKeys(7, "2026-09-24")).toEqual({ startKey: "2026-09-17", endKey: "2026-09-23" });
  });
  it("30 ngày qua ranh giới tháng", () => {
    expect(gmsWindowKeys(30, "2026-09-24")).toEqual({ startKey: "2026-08-25", endKey: "2026-09-23" });
  });
});
