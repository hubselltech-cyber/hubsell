// ============================================================
// TEST GMS = GMV MAX CẤP SHOP (24/09/2026) — phần thuần, KHÔNG DB, KHÔNG gọi sàn.
// gmsStatusFrom: eligibility → trạng thái (active_campaign = đang chạy; probe ANO 24/09: is_eligible
// true + reason null = "eligible", chưa chạy). gmsReportNumbers: báo cáo sàn → số sạch + ROAS.
// gmsWindowKeys: cửa sổ N ngày TRỌN kết thúc hôm qua (sàn đòi start ≠ end, bỏ hôm nay).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  appendGmsHistory,
  buildGmsCreatePayload,
  buildGmsEditPlan,
  gmsReportNumbers,
  gmsStatusFrom,
  gmsWindowKeys,
  normalizeGmsBudget,
  normalizeGmsRoasTarget,
} from "../shopee/ads-gms";

// ---- LỆNH GHI (25/09/2026) — luật payload theo docs create/edit_gms_product_campaign ----
describe("normalizeGmsRoasTarget — sàn lấy 1 số lẻ, CẮT không làm tròn; rỗng/0/âm = Auto Bidding", () => {
  it("10.199999 → 10.1 (docs), 10.123456 → 10.1", () => {
    expect(normalizeGmsRoasTarget(10.199999)).toBe(10.1);
    expect(normalizeGmsRoasTarget(10.123456)).toBe(10.1);
  });
  it("6.9 giữ nguyên 6.9 (không lệch số thực)", () => {
    expect(normalizeGmsRoasTarget(6.9)).toBe(6.9);
    expect(normalizeGmsRoasTarget("7.5")).toBe(7.5);
  });
  it("undefined / 0 / âm / chữ → 0 = Auto Bidding", () => {
    expect(normalizeGmsRoasTarget(undefined)).toBe(0);
    expect(normalizeGmsRoasTarget(0)).toBe(0);
    expect(normalizeGmsRoasTarget(-3)).toBe(0);
    expect(normalizeGmsRoasTarget("abc")).toBe(0);
  });
});

describe("normalizeGmsBudget", () => {
  it("làm tròn đồng, > 0", () => {
    expect(normalizeGmsBudget("100000")).toBe(100_000);
    expect(normalizeGmsBudget(100000.4)).toBe(100_000);
  });
  it("0 / âm / rỗng → null", () => {
    expect(normalizeGmsBudget(0)).toBeNull();
    expect(normalizeGmsBudget(-1)).toBeNull();
    expect(normalizeGmsBudget("")).toBeNull();
  });
});

describe("buildGmsCreatePayload", () => {
  it("không hẹn ngày tắt → start_date = hôm nay (DD-MM-YYYY), roas > 0 gửi roas_target", () => {
    const r = buildGmsCreatePayload({ dailyBudget: 100_000, roasTarget: 6.95 }, "2026-09-25");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toEqual({ start_date: "25-09-2026", daily_budget: 100_000, roas_target: 6.9 });
  });
  it("Auto Bidding: KHÔNG gửi trường roas_target (docs: no input = Auto)", () => {
    const r = buildGmsCreatePayload({ dailyBudget: 50_000 }, "2026-09-25");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).toEqual({ start_date: "25-09-2026", daily_budget: 50_000 });
      expect(r.roasTarget).toBe(0);
    }
  });
  it("ngân sách sai → lỗi, không tạo payload", () => {
    const r = buildGmsCreatePayload({ dailyBudget: 0 }, "2026-09-25");
    expect(r.ok).toBe(false);
  });
});

describe("buildGmsEditPlan", () => {
  it("pause/resume không cần trường kèm", () => {
    expect(buildGmsEditPlan("pause", {})).toEqual({ ok: true, editAction: "pause" });
    expect(buildGmsEditPlan("resume", {})).toEqual({ ok: true, editAction: "resume" });
  });
  it("change_budget đòi ngân sách dương", () => {
    expect(buildGmsEditPlan("change_budget", { dailyBudget: 120_000 })).toEqual({ ok: true, editAction: "change_budget", dailyBudget: 120_000 });
    expect(buildGmsEditPlan("change_budget", { dailyBudget: 0 }).ok).toBe(false);
  });
  it("change_roas_target: 0 = về Auto Bidding (docs cho phép gửi 0 ở edit)", () => {
    expect(buildGmsEditPlan("change_roas_target", { roasTarget: 0 })).toEqual({ ok: true, editAction: "change_roas_target", roasTarget: 0 });
    expect(buildGmsEditPlan("change_roas_target", { roasTarget: 8.27 })).toEqual({ ok: true, editAction: "change_roas_target", roasTarget: 8.2 });
  });
  it("hành động lạ (start/delete/stop) → từ chối — Hubsell chỉ mở 4 lệnh", () => {
    expect(buildGmsEditPlan("delete", {}).ok).toBe(false);
    expect(buildGmsEditPlan("start", {}).ok).toBe(false);
  });
});

describe("appendGmsHistory", () => {
  it("nối cuối, giữ ≤ 50 dòng mới nhất, sổ rác → coi như rỗng", () => {
    const entry = { at: "2026-09-25T00:00:00.000Z", action: "pause", payload: {}, status: "SUCCESS" as const };
    expect(appendGmsHistory(null, entry)).toEqual([entry]);
    const many = Array.from({ length: 60 }, (_, i) => ({ ...entry, action: `a${i}` }));
    const out = appendGmsHistory(many, entry);
    expect(out).toHaveLength(50);
    expect(out[49]).toEqual(entry);
    expect(out[0].action).toBe("a11");
  });
});

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
