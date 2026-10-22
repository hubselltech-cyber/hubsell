// ============================================================
// NHU CẦU ADS TỰ CO THEO SỨC CHỨA — thiết kế 13.9 bước B (docs/ADS-NHIP-CANH-BAO.md
// mục 13.9.2, anh Trung chốt 21/10/2026).
//
// Bài toán: N gian nối Ads dùng chung vài khóa quota của sàn (app × endpoint, cổng
// gọi sàn services/marketplace-gateway.ts giữ trần). Nhu cầu D_e của khóa e =
// Σ_lớp N_p · lệnh_{e,p} / T_p + N · lệnh_lịch-sử_e / T_lịch-sử phải ≤ u · c_e
// (c_e = trần cấu hình × hệ số AIMD hiện tại). Không thỏa → giãn nhịp T_p theo
// thứ tự lớp 3 → 2 → 1, mỗi lớp tới trần của nó. Lớp 1 phải giãn = thiếu quota
// thật → HQ đỏ, mở ticket (hệ thống KHÔNG tạo thêm quota; nó bảo đảm không sập
// và báo trước khi thiếu).
//
// Lớp ưu tiên (adsPriorityOf, ghi Channel.adsPriority sau mỗi xung):
//   1 = đang tiêu tiền + Trợ lý tự thực thi bật   (cảnh báo tiền phải sớm nhất)
//   2 = có chiến dịch đang theo dõi (chạy / tạm dừng / hẹn giờ)
//   3 = nối Ads nhưng không chiến dịch nào (xung nhẹ 1 lệnh)
//
// Phần THUẦN (computeCadence, adsPriorityOf, pulsePastDeadline) không chạm DB —
// test I9 chạy trên sàn giả với N = 1.000 / 10.000 gian. Phần nạp (refresh)
// đếm gian theo lớp + đọc hệ số AIMD từ api_rate_keys, cache DEMAND_REFRESH_MIN.
// Mọi worker tính từ cùng số đếm DB → cùng kết quả, không cần đồng bộ.
// ============================================================

import { ChannelAppKind, ChannelName } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ADS_CADENCE } from "../config/ads-cadence";
import { GATEWAY } from "../config/marketplace-read";
import { currentFactor, FRESH_KEY } from "../lib/rate-gate";
import { endpointLimit, shopEndpointLimit } from "./marketplace-gateway";
import { isHubsellAdsConfigured } from "../integrations/hubsell-ads/config";

export type AdsPriority = 1 | 2 | 3;
export const ADS_PRIORITIES: readonly AdsPriority[] = [1, 2, 3];

/** Lớp ưu tiên của gian từ những gì xung đã đếm (hàm thuần). */
export function adsPriorityOf(i: {
  adsReady: boolean;
  /** Chiến dịch còn đáng theo dõi (ongoing / paused / scheduled). */
  watching: number;
  spentRecently: boolean;
  autoExecuteOn: boolean;
}): AdsPriority {
  if (!i.adsReady || i.watching === 0) return 3;
  if (i.spentRecently && i.autoExecuteOn) return 1;
  return 2;
}

// ---------- Hồ sơ lệnh Shopee (đếm theo mã, 21/10/2026) ----------

const EP = {
  idList: "/api/v2/ads/get_product_level_campaign_id_list",
  setting: "/api/v2/ads/get_product_level_campaign_setting_info",
  perf: "/api/v2/ads/get_product_campaign_daily_performance",
  allCpc: "/api/v2/ads/get_all_cpc_ads_daily_performance",
  balance: "/api/v2/ads/get_total_balance",
  toggle: "/api/v2/ads/get_shop_toggle_info",
  gms: "/api/v2/ads/check_create_gms_product_campaign_eligibility",
} as const;

/** Lệnh của MỘT xung Shopee theo lớp (gian ≤ 100 chiến dịch: setting + perf mỗi thứ 1 lô). Lớp 3 = xung nhẹ. */
export const SHOPEE_PULSE_CALLS: Record<AdsPriority, Record<string, number>> = {
  1: { [EP.idList]: 1, [EP.setting]: 1, [EP.perf]: 1, [EP.allCpc]: 1, [EP.balance]: 1 },
  2: { [EP.idList]: 1, [EP.setting]: 1, [EP.perf]: 1, [EP.allCpc]: 1, [EP.balance]: 1 },
  3: { [EP.idList]: 1 },
};
/**
 * Lệnh của MỘT lượt lịch sử Shopee theo lớp: chi 30 ngày + hiệu suất 30 ngày + cờ ví tự nạp + GMS đủ điều kiện.
 * Lớp 3 không có chiến dịch → không có lô hiệu suất (0 lệnh) và chạy mỗi FULL_HOURS_NO_CAMPAIGN thay vì FULL_HOURS.
 */
export const SHOPEE_HISTORY_CALLS: Record<AdsPriority, Record<string, number>> = {
  1: { [EP.allCpc]: 1, [EP.perf]: 1, [EP.toggle]: 1, [EP.gms]: 1 },
  2: { [EP.allCpc]: 1, [EP.perf]: 1, [EP.toggle]: 1, [EP.gms]: 1 },
  3: { [EP.allCpc]: 1, [EP.toggle]: 1, [EP.gms]: 1 },
};

/** Nhịp tầng lịch sử (giờ) theo lớp. */
export function historyHoursFor(p: AdsPriority): number {
  return p === 3 ? ADS_CADENCE.FULL_HOURS_NO_CAMPAIGN : ADS_CADENCE.FULL_HOURS;
}

// ---------- Phần thuần ----------

export interface CadenceInput {
  /** Số gian mỗi lớp. */
  shops: Record<AdsPriority, number>;
  /** Lệnh mỗi xung theo lớp: endpoint → số lệnh. */
  pulseCalls: Record<AdsPriority, Record<string, number>>;
  /** Lệnh mỗi lượt lịch sử theo lớp + nhịp lịch sử (phút) theo lớp. */
  historyCalls: Record<AdsPriority, Record<string, number>>;
  historyMin: Record<AdsPriority, number>;
  /** Sức chứa từng endpoint (lượt/giây, ĐÃ nhân hệ số AIMD). Endpoint thiếu = không trần = không ràng buộc. */
  capacityPerSec: Record<string, number>;
  /** Nhịp gốc (phút) + trần nhịp từng lớp (phút) + tỷ lệ dùng tối đa. */
  baseMin: number;
  capMin: Record<AdsPriority, number>;
  utilization: number;
  /**
   * 13.9 A2: trần theo GIAN × endpoint (lượt/phút cho MỘT gian) — ràng buộc riêng từng lớp, không cộng dồn theo số
   * gian: lệnh/xung ÷ T_p + lệnh/lịch-sử ÷ T^hist_p ≤ u × trần gian. Thiếu = không ràng buộc. Chỉ chặn nhịp ngắn hơn
   * trần gian (vd xung 30' với get_all_cpc 1 lệnh/5' ≈ 23 % — không ảnh hưởng hôm nay).
   */
  shopEndpointPerMin?: Record<string, number>;
}

export interface CadenceResult {
  /** Nhịp xung (phút) từng lớp sau khi co. */
  pulseMin: Record<AdsPriority, number>;
  /** Lớp nào đã phải giãn so với nhịp gốc. */
  stretched: Record<AdsPriority, boolean>;
  /** Tỷ lệ dùng từng endpoint = nhu cầu / (u × sức chứa), với nhịp đã co. 1 = chạm mức cho phép. */
  utilization: Record<string, number>;
  /** Endpoint chặt nhất (tỷ lệ dùng cao nhất). */
  binding: string | null;
  /** Thiếu quota thật: lớp 1 phải giãn, hoặc đã giãn hết trần mà vẫn vượt. */
  red: boolean;
  /** 13.9 A2: tỷ lệ dùng trần GIAN × endpoint chặt nhất của từng lớp (một gian của lớp ấy) với nhịp đã co. */
  shopUtilization: Record<AdsPriority, number>;
}

/** 13.9 A2: tỷ lệ dùng trần gian × endpoint của MỘT gian lớp p với nhịp xung T (phút). Hàm thuần. */
function shopUtilizationOf(input: CadenceInput, p: AdsPriority, T: number): number {
  const caps = input.shopEndpointPerMin;
  if (!caps) return 0;
  let worst = 0;
  const eps = new Set([...Object.keys(input.pulseCalls[p]), ...Object.keys(input.historyCalls[p])]);
  for (const e of eps) {
    const cap = caps[e];
    if (cap == null || cap <= 0) continue;
    const need = (input.pulseCalls[p][e] ?? 0) / T + (input.historyCalls[p][e] ?? 0) / input.historyMin[p];
    worst = Math.max(worst, need / (input.utilization * cap));
  }
  return worst;
}

/** 13.9 A2: nhịp xung nhỏ nhất (phút) để một gian lớp p không vượt u × trần gian × endpoint; null = không ràng buộc. */
function shopFloorMin(input: CadenceInput, p: AdsPriority): number | null {
  const caps = input.shopEndpointPerMin;
  if (!caps) return null;
  let floor = 0;
  for (const [e, n] of Object.entries(input.pulseCalls[p])) {
    const cap = caps[e];
    if (cap == null || cap <= 0 || n === 0) continue;
    const room = input.utilization * cap - (input.historyCalls[p][e] ?? 0) / input.historyMin[p];
    floor = Math.max(floor, room > 0 ? n / room : Number.POSITIVE_INFINITY);
  }
  return floor > 0 ? floor : null;
}

/** Nhu cầu từng endpoint (lệnh/phút) với bộ nhịp T (phút). */
function demandPerMin(input: CadenceInput, T: Record<AdsPriority, number>): Record<string, number> {
  const d: Record<string, number> = {};
  const add = (e: string, v: number) => (d[e] = (d[e] ?? 0) + v);
  for (const p of ADS_PRIORITIES) {
    for (const [e, n] of Object.entries(input.pulseCalls[p])) add(e, (input.shops[p] * n) / T[p]);
    for (const [e, n] of Object.entries(input.historyCalls[p])) add(e, (input.shops[p] * n) / input.historyMin[p]);
  }
  return d;
}

function allowedPerMin(input: CadenceInput, e: string): number | null {
  const c = input.capacityPerSec[e];
  return c != null && c > 0 ? input.utilization * c * 60 : null;
}

/**
 * Tính nhịp xung từng lớp sao cho nhu cầu mọi endpoint ≤ u × sức chứa. Giãn lớp 3 → 2 → 1, mỗi lớp tới trần.
 * Hàm thuần, tất định; nhịp làm tròn lên phút.
 */
export function computeCadence(input: CadenceInput): CadenceResult {
  const T: Record<AdsPriority, number> = { 1: input.baseMin, 2: input.baseMin, 3: input.baseMin };
  const stretched: Record<AdsPriority, boolean> = { 1: false, 2: false, 3: false };
  // 13.9 A2: trần GIAN × endpoint là sàn nhịp của từng lớp (độc lập số gian) — áp trước ràng buộc app.
  for (const p of ADS_PRIORITIES) {
    const floor = shopFloorMin(input, p);
    if (floor == null) continue;
    const next = Math.min(input.capMin[p], Math.ceil(floor));
    if (next > T[p]) {
      T[p] = next;
      stretched[p] = true;
    }
  }
  const over = (d: Record<string, number>) => {
    let worst = 0;
    for (const [e, v] of Object.entries(d)) {
      const a = allowedPerMin(input, e);
      if (a != null) worst = Math.max(worst, v / a);
    }
    return worst;
  };
  for (const p of [3, 2, 1] as const) {
    let d = demandPerMin(input, T);
    if (over(d) <= 1) break;
    if (input.shops[p] === 0) continue;
    let need = T[p];
    for (const [e, n] of Object.entries(input.pulseCalls[p])) {
      const a = allowedPerMin(input, e);
      if (a == null || n === 0) continue;
      const own = (input.shops[p] * n) / T[p];
      const others = d[e] - own;
      const room = a - others;
      need = Math.max(need, room > 0 ? (input.shops[p] * n) / room : Number.POSITIVE_INFINITY);
    }
    const next = Math.min(input.capMin[p], Math.ceil(need));
    if (next > T[p]) {
      T[p] = next;
      stretched[p] = true;
    }
    d = demandPerMin(input, T);
  }
  const d = demandPerMin(input, T);
  const utilization: Record<string, number> = {};
  let binding: string | null = null;
  for (const [e, v] of Object.entries(d)) {
    const a = allowedPerMin(input, e);
    if (a == null) continue;
    utilization[e] = v / a;
    if (binding == null || utilization[e] > utilization[binding]) binding = e;
  }
  const stillOver = binding != null && utilization[binding] > 1;
  const shopUtilization: Record<AdsPriority, number> = { 1: shopUtilizationOf(input, 1, T[1]), 2: shopUtilizationOf(input, 2, T[2]), 3: shopUtilizationOf(input, 3, T[3]) };
  return { pulseMin: T, stretched, utilization, binding, red: stretched[1] || stillOver, shopUtilization };
}

/** 13.9 A2: trần gian × endpoint (lượt/phút cho một gian) từ cấu hình cổng cho các endpoint Ads Shopee. Hàm thuần. */
export function shopeeShopEndpointPerMin(endpoints: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of endpoints) {
    const rl = shopEndpointLimit("SHOPEE", e);
    if (rl) out[e] = rl.perSec * 60;
  }
  return out;
}

/** Xung trễ quá hạn chót (nhịp lớp × DEADLINE_X) chưa? Hàm thuần — đo cho HQ, không bỏ xung (13.9.6). */
export function pulsePastDeadline(nextPulseAt: Date | null, now: number, pulseMin: number, deadlineX = ADS_CADENCE.DEADLINE_X): boolean {
  if (!nextPulseAt) return false;
  return now - nextPulseAt.getTime() > pulseMin * 60_000 * deadlineX;
}

/** Sức chứa (lượt/giây) từng endpoint Ads Shopee = trần cấu hình × hệ số AIMD thấp nhất đang có trên khóa đó. Hàm thuần. */
export function shopeeAdsCapacity(
  keys: Array<{ key: string; factor: number; decreasedAtMs: number }>,
  now: number,
  endpoints: string[]
): Record<string, number> {
  const minFactor = new Map<string, number>();
  for (const k of keys) {
    const m = /^SHOPEE:[^|]+\|ep:(.+)$/.exec(k.key);
    if (!m) continue;
    const f = currentFactor({ ...FRESH_KEY, factor: k.factor, decreasedAtMs: k.decreasedAtMs }, now, GATEWAY.AIMD_RECOVER_MS);
    minFactor.set(m[1], Math.min(minFactor.get(m[1]) ?? 1, f));
  }
  const out: Record<string, number> = {};
  for (const e of endpoints) {
    const rl = endpointLimit("SHOPEE", e);
    if (rl) out[e] = rl.perSec * (minFactor.get(e) ?? 1);
  }
  return out;
}

// ---------- Phần nạp (DB) + cache ----------

export interface AdsDemandSnapshot {
  at: number;
  shops: Record<AdsPriority, number>;
  cadence: CadenceResult;
  /** Gian mỗi lớp có xung trễ quá hạn chót (đo). */
  overdue: Record<AdsPriority, number>;
}

let snapshot: AdsDemandSnapshot | null = null;
let refreshing: Promise<AdsDemandSnapshot> | null = null;

const ALL_ENDPOINTS = [
  ...new Set([...Object.values(SHOPEE_PULSE_CALLS), ...Object.values(SHOPEE_HISTORY_CALLS)].flatMap((c) => Object.keys(c))),
];

function shopeeAdsShopsWhere() {
  return {
    channelName: ChannelName.SHOPEE,
    status: "ACTIVE" as const,
    refreshToken: { not: null },
    hibernatedAt: null,
    ...(isHubsellAdsConfigured() ? { appAuths: { some: { app: ChannelAppKind.HUBSELL_ADS, status: "ACTIVE" } } } : {}),
  };
}

async function loadSnapshot(now: number): Promise<AdsDemandSnapshot> {
  const where = shopeeAdsShopsWhere();
  const [groups, keys] = await Promise.all([
    prisma.channel.groupBy({ by: ["adsPriority"], where, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ key: string; factor: number; decreasedAtMs: bigint }>>`
      SELECT "key", "factor", "decreasedAtMs" FROM "api_rate_keys" WHERE "key" LIKE 'SHOPEE:%|ep:/api/v2/ads/%'`,
  ]);
  const shops: Record<AdsPriority, number> = { 1: 0, 2: 0, 3: 0 };
  for (const g of groups) {
    const p = (g.adsPriority >= 1 && g.adsPriority <= 3 ? g.adsPriority : 2) as AdsPriority;
    shops[p] += g._count._all;
  }
  const cadence = computeCadence({
    shops,
    pulseCalls: SHOPEE_PULSE_CALLS,
    historyCalls: SHOPEE_HISTORY_CALLS,
    historyMin: { 1: historyHoursFor(1) * 60, 2: historyHoursFor(2) * 60, 3: historyHoursFor(3) * 60 },
    capacityPerSec: shopeeAdsCapacity(
      keys.map((k) => ({ key: k.key, factor: Number(k.factor), decreasedAtMs: Number(k.decreasedAtMs) })),
      now,
      ALL_ENDPOINTS
    ),
    baseMin: ADS_CADENCE.PULSE_MIN,
    capMin: ADS_CADENCE.DEMAND_CAP_MIN,
    utilization: ADS_CADENCE.DEMAND_UTILIZATION,
    // A2: trần gian × endpoint theo cấu hình (hệ số AIMD của từng gian là của riêng gian ấy, không kéo nhịp cả lớp).
    shopEndpointPerMin: shopeeShopEndpointPerMin(ALL_ENDPOINTS),
  });
  const overdue: Record<AdsPriority, number> = { 1: 0, 2: 0, 3: 0 };
  await Promise.all(
    ADS_PRIORITIES.map(async (p) => {
      overdue[p] = await prisma.channel.count({
        where: { ...where, adsPriority: p, nextAdsPulseAt: { lt: new Date(now - cadence.pulseMin[p] * 60_000 * ADS_CADENCE.DEADLINE_X) } },
      });
    })
  );
  return { at: now, shops, cadence, overdue };
}

/** Nạp lại nếu cache cũ hơn DEMAND_REFRESH_MIN; lỗi DB thì giữ snapshot cũ (hoặc null → nhịp gốc). */
export async function refreshAdsDemand(now: number = Date.now()): Promise<AdsDemandSnapshot | null> {
  if (snapshot && now - snapshot.at < ADS_CADENCE.DEMAND_REFRESH_MIN * 60_000) return snapshot;
  if (!refreshing) {
    refreshing = loadSnapshot(now)
      .then((s) => {
        const changed =
          !snapshot ||
          ADS_PRIORITIES.some((p) => snapshot!.cadence.pulseMin[p] !== s.cadence.pulseMin[p]) ||
          snapshot.cadence.red !== s.cadence.red;
        snapshot = s;
        if (changed) console.log(`[Ads-demand] ${describeAdsDemand(s)}`);
        return s;
      })
      .catch((err) => {
        console.error("[Ads-demand] Không tính được nhịp theo sức chứa, giữ nhịp cũ:", (err as Error).message);
        return snapshot ?? { at: now, shops: { 1: 0, 2: 0, 3: 0 }, cadence: baseCadence(), overdue: { 1: 0, 2: 0, 3: 0 } };
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

function baseCadence(): CadenceResult {
  const b = ADS_CADENCE.PULSE_MIN;
  return { pulseMin: { 1: b, 2: b, 3: b }, stretched: { 1: false, 2: false, 3: false }, utilization: {}, binding: null, red: false, shopUtilization: { 1: 0, 2: 0, 3: 0 } };
}

/** Nhịp xung (phút) của lớp `p` theo snapshot hiện có; chưa có snapshot → nhịp gốc. Đồng bộ (xung gọi trong lượt). */
export function pulseMinFor(p: AdsPriority): number {
  return snapshot?.cadence.pulseMin[p] ?? ADS_CADENCE.PULSE_MIN;
}

export function adsDemandSnapshot(): AdsDemandSnapshot | null {
  return snapshot;
}

/** Một dòng cho log / HQ. */
export function describeAdsDemand(s: AdsDemandSnapshot): string {
  const c = s.cadence;
  const ep = (e: string) => e.replace("/api/v2/ads/", "");
  const util = c.binding ? `${Math.round((c.utilization[c.binding] ?? 0) * 100)} % của mức cho phép trên ${ep(c.binding)}` : "không khóa nào có trần";
  const cls = ADS_PRIORITIES.map((p) => `lớp ${p}: ${s.shops[p]} gian, xung ${c.pulseMin[p]}'${c.stretched[p] ? " (GIÃN)" : ""}${s.overdue[p] ? `, ${s.overdue[p]} trễ hạn chót` : ""}`).join(" · ");
  const shopMax = Math.max(c.shopUtilization[1], c.shopUtilization[2], c.shopUtilization[3]);
  return `${c.red ? "ĐỎ thiếu quota — " : ""}${cls} · chặt nhất ${util} · mỗi gian dùng ${Math.round(shopMax * 100)} % trần gian×endpoint`;
}

/** Chỉ dùng trong test: xóa cache. */
export function _resetAdsDemandForTest(): void {
  snapshot = null;
  refreshing = null;
}
