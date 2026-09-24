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
      cutBudgetFirst: true, // đợt B 24/09: hạ ngân sách trước, tắt sau
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
    ).toEqual({ mode: "off", maxActionsPerDay: 5, cutBudgetFirst: true });
  });
});

// ---------- 14/09/2026: cờ nguồn dừng + tự bật lại (máy trạng thái anh Trung chốt) ----------
import { shouldAutoResume } from "../shopee/ads-auto-execute";

function mkFlagged(opts: {
  id: string;
  status?: string;
  pausedAt?: Date | null;
  window?: string;
  todayRoas?: { spend: number; gmv: number };
  breakeven?: number | null;
  resumedOn?: string;
}): CampaignInsight {
  const base = mkInsight({ id: opts.id, status: opts.status ?? "paused" });
  (base.row as unknown as Record<string, unknown>).hubsellPausedAt =
    opts.pausedAt === undefined ? new Date() : opts.pausedAt;
  (base.row as unknown as Record<string, unknown>).hubsellPauseWindow = opts.window ?? "today";
  (base.row as unknown as Record<string, unknown>).hubsellPauseCycle = 0;
  (base.row as unknown as Record<string, unknown>).hubsellResumedOn = opts.resumedOn ?? "";
  if (opts.todayRoas) {
    base.windows.today = {
      spend: opts.todayRoas.spend,
      clicks: 10,
      broadOrder: 2,
      broadGmv: opts.todayRoas.gmv,
    };
  }
  (base as unknown as Record<string, unknown>).breakevenRoas =
    opts.breakeven === undefined ? 6.63 : opts.breakeven;
  return base;
}

describe("shouldAutoResume — máy chỉ bật lại campaign CHÍNH máy đã dừng", () => {
  const config = normalizeAssistantConfig(null); // dangerFactor 1.1

  it("TÁI HIỆN chiều 14/09: cờ Hubsell, ROAS hôm nay 8,98x > 6,63×1,1 = 7,29x → bật lại", () => {
    const r = shouldAutoResume(
      mkFlagged({ id: "a", todayRoas: { spend: 59_934, gmv: 538_000 } }),
      config
    );
    expect(r.ok).toBe(true);
    expect(r.window).toBe("today");
    expect(r.reason).toContain("bật lại");
  });

  it("ROAS mới 4,96x < 7,29x → giữ tạm dừng", () => {
    const r = shouldAutoResume(
      mkFlagged({ id: "a", todayRoas: { spend: 25_000, gmv: 124_000 } }),
      config
    );
    expect(r.ok).toBe(false);
  });

  it("NGƯỜI tắt (không cờ) → không bao giờ bật lại dù ROAS rất đẹp", () => {
    const r = shouldAutoResume(
      mkFlagged({ id: "a", pausedAt: null, todayRoas: { spend: 10_000, gmv: 900_000 } }),
      config
    );
    expect(r.ok).toBe(false);
  });

  it("campaign đã chạy lại (người bật) → không xét bật", () => {
    const r = shouldAutoResume(
      mkFlagged({ id: "a", status: "ongoing", todayRoas: { spend: 10_000, gmv: 900_000 } }),
      config
    );
    expect(r.ok).toBe(false);
  });

  it("chưa có hòa vốn → không bật (không đoán)", () => {
    const r = shouldAutoResume(
      mkFlagged({ id: "a", breakeven: null, todayRoas: { spend: 10_000, gmv: 900_000 } }),
      config
    );
    expect(r.ok).toBe(false);
  });

  it("xét đúng cửa sổ đã kích lệnh dừng (3d chứ không phải hôm nay)", () => {
    const it3 = mkFlagged({ id: "a", window: "3d", todayRoas: { spend: 10_000, gmv: 900_000 } });
    it3.windows["3d"] = { spend: 100_000, clicks: 40, broadOrder: 2, broadGmv: 200_000 }; // 2x
    const r = shouldAutoResume(it3, config);
    expect(r.window).toBe("3d");
    expect(r.ok).toBe(false);
  });
});

describe("selectAutoActionCandidates — một vòng dừng/bật mỗi ngày", () => {
  it("máy vừa tự bật lại hôm nay → hôm nay không tắt lại dù verdict pause_now", () => {
    const today = "2026-09-14";
    const it = mkFlagged({ id: "a", status: "ongoing", pausedAt: null, resumedOn: today });
    (it as unknown as { assessment: { verdict: string; reasons: string[] } }).assessment = {
      verdict: "pause_now",
      reasons: [],
    };
    expect(selectAutoActionCandidates([it], today)).toHaveLength(0);
    expect(selectAutoActionCandidates([it], "2026-09-15")).toHaveLength(1);
  });
});

// ---------- 14/09 tối: ghi sổ thao tác NGOÀI Hubsell ("Tắt/Bật trên sàn") ----------
import { marketplaceChangeKind } from "../shopee/ads-pause-flag";

describe("marketplaceChangeKind — sổ là dòng thời gian đầy đủ, kể cả thao tác trên sàn", () => {
  it("chạy → tạm dừng, không cờ Hubsell → 'Tắt trên sàn', ghi rõ Hubsell không can thiệp", () => {
    const k = marketplaceChangeKind("ongoing", "paused", false);
    expect(k?.action).toBe("pause");
    expect(k?.reasons).toContain("Tắt trên sàn");
    expect(k?.reasons).toContain("KHÔNG can thiệp");
  });
  it("chạy → tạm dừng mà Hubsell vừa cắm cờ → không ghi (đã có dòng lệnh dừng của máy)", () => {
    expect(marketplaceChangeKind("ongoing", "paused", true)).toBeNull();
  });
  it("tạm dừng → chạy: người bật trên sàn (có cờ = sau khi máy dừng, ván mới)", () => {
    expect(marketplaceChangeKind("paused", "ongoing", false)?.reasons).toContain("Bật trên sàn");
    expect(marketplaceChangeKind("paused", "ongoing", true)?.reasons).toContain("ván mới");
  });
  it("campaign mới thấy lần đầu / không đổi / đổi loại khác → không ghi", () => {
    expect(marketplaceChangeKind(undefined, "paused", false)).toBeNull();
    expect(marketplaceChangeKind("paused", "paused", false)).toBeNull();
    expect(marketplaceChangeKind("ongoing", "ended", false)).toBeNull();
  });
});
