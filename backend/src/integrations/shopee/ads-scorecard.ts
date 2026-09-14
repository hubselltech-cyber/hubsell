// ============================================================
// BẢNG ĐIỂM TRỢ LÝ QUẢNG CÁO — "máy phán đúng hay sai trong chính shop của bạn"
//
// Bước 6 sự cố 14/09/2026: seller chỉ dám gạt chế độ Thật khi tự thấy máy phán
// đúng trên số của mình. Với mỗi lần máy ĐỊNH tạm dừng (diễn tập) trong N ngày,
// nhìn tiếp những ngày SAU đó: campaign tiêu thêm bao nhiêu, ROAS ra sao so với
// hòa vốn → máy đúng (vẫn lỗ, lẽ ra tiết kiệm được số tiền đó) hay sai (sau đó
// ROAS đạt — nếu chạy thật máy cũng đã tự bật lại). Số ngày là số của sàn (VN),
// chỉ tính NGÀY SAU ngày máy phán vì perf theo ngày không tách được trong ngày.
//
// THUẦN — vitest đánh thẳng; route chỉ nạp log + insights rồi gọi vào đây.
// ============================================================

import type { CampaignInsight } from "./ads-insights";
import type { ShopeeAssistantConfig } from "./ads-assistant-rules";

/** Dưới mức chi này (sau ngày phán) chưa đủ để nói máy đúng hay sai. */
export const SCORECARD_MIN_SPEND_AFTER = 20_000;

export interface ScorecardLog {
  id: string;
  adsCampaignId: string;
  action: string; // pause | resume
  mode: string; // dry_run | live | manual
  status: string; // PLANNED | SUCCESS | FAILED | OVERRIDDEN | PENDING
  reasons: string;
  createdAt: Date;
}

export interface ScorecardPlannedRow {
  campaignRowId: string;
  campaignId: string;
  name: string;
  at: string; // ISO
  reasons: string[];
  spendAfter: number;
  gmvAfter: number;
  ordersAfter: number;
  roasAfter: number | null;
  breakevenRoas: number | null;
  /** right = vẫn lỗ sau đó (máy đúng); wrong = sau đó ROAS đạt (máy sai, máy thật sẽ tự bật lại); pending = chưa đủ số. */
  outcome: "right" | "wrong" | "pending";
}

export interface AssistantScorecard {
  days: number;
  planned: {
    count: number;
    right: number;
    wrong: number;
    pending: number;
    /** Tiền các campaign máy phán ĐÚNG đã tiêu tiếp sau ngày phán — lẽ ra tiết kiệm được. */
    savingsIfLive: number;
    rows: ScorecardPlannedRow[];
  };
  live: {
    paused: number;
    resumed: number;
    resumedByOwner: number;
    failed: number;
    overridden: number;
  };
}

/** "YYYY-MM-DD" theo giờ VN của một mốc thời gian. */
function vnDayOf(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function buildAssistantScorecard(
  logs: ScorecardLog[],
  items: CampaignInsight[],
  config: ShopeeAssistantConfig,
  days: number
): AssistantScorecard {
  const byRow = new Map(items.map((it) => [it.row.id, it]));

  // Diễn tập: mỗi campaign lấy lần ĐỊNH DỪNG SỚM NHẤT trong cửa sổ — "nếu bật
  // thật thì đã dừng từ lúc đó", các lần sau chỉ là lặp lại khi chưa ai dừng.
  const firstPlanned = new Map<string, ScorecardLog>();
  for (const l of [...logs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (l.action === "pause" && l.status === "PLANNED" && !firstPlanned.has(l.adsCampaignId)) {
      firstPlanned.set(l.adsCampaignId, l);
    }
  }

  const rows: ScorecardPlannedRow[] = [];
  for (const [rowId, l] of firstPlanned) {
    const it = byRow.get(rowId);
    if (!it) continue;
    const dayKey = vnDayOf(l.createdAt);
    let spendAfter = 0;
    let gmvAfter = 0;
    let ordersAfter = 0;
    for (const p of it.row.dailyPerf) {
      if (p.date.toISOString().slice(0, 10) <= dayKey) continue;
      spendAfter += Number(p.expense);
      gmvAfter += Number(p.broadGmv);
      ordersAfter += p.broadOrder;
    }
    const roasAfter = spendAfter > 0 ? gmvAfter / spendAfter : null;
    const breakevenRoas = it.breakevenRoas;
    let outcome: ScorecardPlannedRow["outcome"] = "pending";
    if (spendAfter >= SCORECARD_MIN_SPEND_AFTER) {
      if (ordersAfter === 0) outcome = "right";
      else if (breakevenRoas != null && roasAfter != null) {
        outcome = roasAfter < breakevenRoas * config.hard.breakevenFactor ? "right" : "wrong";
      }
    }
    rows.push({
      campaignRowId: rowId,
      campaignId: it.row.campaignId,
      name: it.row.name,
      at: l.createdAt.toISOString(),
      reasons: l.reasons ? l.reasons.split("\n").filter(Boolean) : [],
      spendAfter,
      gmvAfter,
      ordersAfter,
      roasAfter,
      breakevenRoas,
      outcome,
    });
  }
  rows.sort((a, b) => b.spendAfter - a.spendAfter);

  const live = { paused: 0, resumed: 0, resumedByOwner: 0, failed: 0, overridden: 0 };
  for (const l of logs) {
    if (l.mode === "dry_run") continue;
    if (l.status === "FAILED") live.failed++;
    else if (l.status === "OVERRIDDEN") live.overridden++;
    else if (l.status === "SUCCESS" && l.action === "pause") live.paused++;
    else if (l.status === "SUCCESS" && l.action === "resume") {
      if (l.mode === "manual") live.resumedByOwner++;
      else live.resumed++;
    }
  }
  // Lệnh dừng thật rồi bị người bật lại vẫn là một lần máy đã dừng.
  live.paused += live.overridden;

  return {
    days,
    planned: {
      count: rows.length,
      right: rows.filter((r) => r.outcome === "right").length,
      wrong: rows.filter((r) => r.outcome === "wrong").length,
      pending: rows.filter((r) => r.outcome === "pending").length,
      savingsIfLive: rows.filter((r) => r.outcome === "right").reduce((s, r) => s + r.spendAfter, 0),
      rows,
    },
    live,
  };
}

/** Một dòng tóm tắt hành động trong ngày cho chuông cuối ngày — THUẦN. */
export interface DailyActionDigest {
  paused: string[]; // tên campaign máy đã dừng thật
  resumed: string[]; // máy tự bật lại
  planned: string[]; // diễn tập
  failed: string[]; // sàn từ chối
}

export function buildDailyDigest(
  logs: (ScorecardLog & { campaignName: string })[]
): DailyActionDigest {
  const d: DailyActionDigest = { paused: [], resumed: [], planned: [], failed: [] };
  const push = (arr: string[], name: string) => {
    if (!arr.includes(name)) arr.push(name);
  };
  for (const l of logs) {
    const name = l.campaignName || `#${l.adsCampaignId}`;
    if (l.status === "FAILED" && l.mode !== "manual") push(d.failed, name);
    else if (l.status === "PLANNED" && l.action === "pause") push(d.planned, name);
    else if ((l.status === "SUCCESS" || l.status === "OVERRIDDEN") && l.action === "pause" && l.mode === "live")
      push(d.paused, name);
    else if (l.status === "SUCCESS" && l.action === "resume" && l.mode === "live") push(d.resumed, name);
  }
  return d;
}

/** Tiêu đề + nội dung chuông cuối ngày; null = hôm nay máy không làm gì. */
export function formatDailyDigest(d: DailyActionDigest): { title: string; body: string } | null {
  const total = d.paused.length + d.resumed.length + d.planned.length + d.failed.length;
  if (total === 0) return null;
  const parts: string[] = [];
  if (d.paused.length) parts.push(`dừng ${d.paused.length}`);
  if (d.resumed.length) parts.push(`bật lại ${d.resumed.length}`);
  if (d.planned.length) parts.push(`diễn tập ${d.planned.length}`);
  if (d.failed.length) parts.push(`${d.failed.length} lệnh sàn từ chối`);
  const list = (names: string[]) =>
    names.slice(0, 3).map((n) => `"${n}"`).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
  const lines: string[] = [];
  if (d.paused.length) lines.push(`Đã tạm dừng: ${list(d.paused)}.`);
  if (d.resumed.length) lines.push(`Đã bật lại khi ROAS đạt: ${list(d.resumed)}.`);
  if (d.planned.length) lines.push(`Diễn tập (chưa gọi sàn): ${list(d.planned)}.`);
  if (d.failed.length) lines.push(`Sàn từ chối: ${list(d.failed)} — kiểm tra trên Seller Center.`);
  lines.push("Mọi lệnh có căn cứ trong Sổ hành động; chiến dịch máy dừng có thể bật lại một cú bấm.");
  return {
    title: `🤖 Trợ lý quảng cáo hôm nay: ${parts.join(", ")}`,
    body: lines.join(" "),
  };
}
