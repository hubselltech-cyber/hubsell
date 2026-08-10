// ============================================================
// TEST EXECUTOR GĐ3 — phần LỌC + XẾP HÀNG thuần (không DB, không gọi sàn).
// Phần ghi sổ/idempotency dựa trên unique referenceId của Postgres (P2002) —
// đã có tiền lệ test idempotency webhook, ở đây chốt logic chọn ứng viên.
// ============================================================

import { describe, expect, it } from "vitest";
import { selectAutoActionCandidates } from "../shopee/ads-auto-execute";
import type { CampaignInsight } from "../shopee/ads-insights";
import {
  DEFAULT_SHOPEE_ASSISTANT_CONFIG,
  normalizeAssistantConfig,
} from "../shopee/ads-assistant-rules";

/** Dựng CampaignInsight tối thiểu cho phần lọc — các trường khác không dùng. */
function mkInsight(opts: {
  id: string;
  status?: string;
  verdict?: CampaignInsight["assessment"]["verdict"];
  spend7d?: number;
  decision?: string;
  decisionVerdict?: string;
}): CampaignInsight {
  return {
    row: {
      id: opts.id,
      status: opts.status ?? "ongoing",
      assistantDecision: opts.decision ?? "",
      assistantDecisionVerdict: opts.decisionVerdict ?? "",
    },
    windows: {
      today: { spend: 0, clicks: 0, broadOrder: 0, broadGmv: 0 },
      "3d": { spend: 0, clicks: 0, broadOrder: 0, broadGmv: 0 },
      "7d": { spend: opts.spend7d ?? 0, clicks: 0, broadOrder: 0, broadGmv: 0 },
      "30d": { spend: 0, clicks: 0, broadOrder: 0, broadGmv: 0 },
    },
    assessment: { verdict: opts.verdict ?? "healthy", reasons: [] },
  } as unknown as CampaignInsight;
}

describe("selectAutoActionCandidates — lọc ứng viên hành động", () => {
  it("chỉ lấy pause_now/spike đang chạy; bỏ review/grace/healthy/insufficient", () => {
    const out = selectAutoActionCandidates([
      mkInsight({ id: "a", verdict: "pause_now" }),
      mkInsight({ id: "b", verdict: "spike" }),
      mkInsight({ id: "c", verdict: "review" }),
      mkInsight({ id: "d", verdict: "grace" }),
      mkInsight({ id: "e", verdict: "healthy" }),
      mkInsight({ id: "f", verdict: "insufficient_data" }),
    ]);
    expect(out.map((x) => x.row.id).sort()).toEqual(["a", "b"]);
  });

  it("campaign không còn chạy (paused/ended) không bao giờ bị đụng", () => {
    const out = selectAutoActionCandidates([
      mkInsight({ id: "a", verdict: "pause_now", status: "paused" }),
      mkInsight({ id: "b", verdict: "pause_now", status: "ended" }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("người thắng máy: chủ shop đã quyết cảnh báo này → executor nhường", () => {
    const out = selectAutoActionCandidates([
      mkInsight({
        id: "a",
        verdict: "pause_now",
        decision: "IGNORED",
        decisionVerdict: "pause_now", // quyết đúng verdict đang hiển thị
      }),
      mkInsight({
        id: "b",
        verdict: "pause_now",
        decision: "IGNORED",
        decisionVerdict: "review", // verdict ĐÃ ĐỔI LOẠI → quyết định hết hiệu lực
      }),
    ]);
    expect(out.map((x) => x.row.id)).toEqual(["b"]);
  });

  it("xếp theo chi tiêu 7 ngày giảm dần — cắt chỗ chảy máu to trước", () => {
    const out = selectAutoActionCandidates([
      mkInsight({ id: "nho", verdict: "pause_now", spend7d: 100_000 }),
      mkInsight({ id: "to", verdict: "spike", spend7d: 900_000 }),
      mkInsight({ id: "vua", verdict: "pause_now", spend7d: 400_000 }),
    ]);
    expect(out.map((x) => x.row.id)).toEqual(["to", "vua", "nho"]);
  });
});

describe("normalizeAssistantConfig — khối autoExecute (GĐ3)", () => {
  it("mặc định OFF + trần 5 hành động/ngày", () => {
    expect(DEFAULT_SHOPEE_ASSISTANT_CONFIG.autoExecute).toEqual({
      mode: "off",
      maxActionsPerDay: 5,
    });
    expect(normalizeAssistantConfig(null).autoExecute.mode).toBe("off");
  });

  it("mode rác → về off; mode hợp lệ giữ nguyên; bản lưu GĐ2 (thiếu khối) không vỡ", () => {
    expect(
      normalizeAssistantConfig({ autoExecute: { mode: "yolo" } }).autoExecute.mode
    ).toBe("off");
    expect(
      normalizeAssistantConfig({ autoExecute: { mode: "dry_run" } }).autoExecute.mode
    ).toBe("dry_run");
    expect(
      normalizeAssistantConfig({ hard: { enabled: false } }).autoExecute
    ).toEqual({ mode: "off", maxActionsPerDay: 5 });
  });
});
