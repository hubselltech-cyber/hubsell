// Chiến dịch Nhóm nhiều SP (docs ADS-SHOPEE-KHAI-THAC-API mục 15.7) — logic thuần:
// chia lô perf (id nhóm mỗi id một lô riêng) + Trợ lý không chọn dòng nhóm làm ứng viên hành động.
import { describe, expect, it } from "vitest";
import { ADS_AD_TYPE_GROUP, splitPerfBatches } from "../shopee/ads-campaigns";
import { selectAutoActionCandidates } from "../shopee/ads-auto-execute";
import type { CampaignInsight } from "../shopee/ads-insights";

describe("splitPerfBatches — id nhóm tách lô riêng", () => {
  it("không có id nhóm → gom ≤100 như cũ", () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(1000 + i));
    const out = splitPerfBatches(ids, new Set());
    expect(out.map((b) => b.ids.length)).toEqual([100, 100, 50]);
    expect(out.every((b) => !b.group)).toBe(true);
  });

  it("id nhóm mỗi id một lô, không lẫn vào lô thường (sàn từ chối cả lô khi có id lạ)", () => {
    const out = splitPerfBatches(["1", "2", "202942166", "3", "202942167"], new Set(["202942166", "202942167"]));
    expect(out).toEqual([
      { ids: ["1", "2", "3"], group: false },
      { ids: ["202942166"], group: true },
      { ids: ["202942167"], group: true },
    ]);
  });

  it("chỉ có id nhóm → không có lô thường rỗng", () => {
    const out = splitPerfBatches(["202942166"], new Set(["202942166"]));
    expect(out).toEqual([{ ids: ["202942166"], group: true }]);
  });
});

describe("selectAutoActionCandidates — bỏ qua chiến dịch Nhóm", () => {
  const base = {
    assessment: { verdict: "pause_now", reasons: [], triggers: [], window: "today" },
    windows: { today: { spend: 0 }, "3d": { spend: 0 }, "7d": { spend: 500 }, "30d": { spend: 0 } },
  } as unknown as CampaignInsight;
  const row = (adType: string) =>
    ({
      ...base,
      row: {
        ...(base as unknown as { row?: Record<string, unknown> }).row,
        id: adType,
        status: "ongoing",
        adType,
        assistantDecision: "",
        assistantDecisionVerdict: "",
        hubsellResumedOn: "",
      },
    }) as unknown as CampaignInsight;

  it("dòng thường được chọn, dòng group bị loại dù verdict đáng hành động", () => {
    const out = selectAutoActionCandidates([row("manual"), row(ADS_AD_TYPE_GROUP)], "2026-10-19");
    expect(out.map((it) => it.row.id)).toEqual(["manual"]);
  });
});
