// Thiết kế 13.9 bước B — nhu cầu Ads tự co theo sức chứa (phần thuần).
import { describe, expect, it } from "vitest";
import {
  adsPriorityOf,
  computeCadence,
  pulsePastDeadline,
  shopeeAdsCapacity,
  SHOPEE_HISTORY_CALLS,
  SHOPEE_PULSE_CALLS,
  type CadenceInput,
} from "../ads-demand";

const ALL_CPC = "/api/v2/ads/get_all_cpc_ads_daily_performance";
const ID_LIST = "/api/v2/ads/get_product_level_campaign_id_list";

/** Sức chứa như cấu hình 21/10: get_all_cpc 1/s, endpoint Ads khác 2/s. */
const capacity = (factorAllCpc = 1): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const e of new Set([...Object.values(SHOPEE_PULSE_CALLS), ...Object.values(SHOPEE_HISTORY_CALLS)].flatMap((c) => Object.keys(c)))) {
    out[e] = e === ALL_CPC ? 1 * factorAllCpc : 2;
  }
  return out;
};

const input = (shops: Record<1 | 2 | 3, number>, cap = capacity()): CadenceInput => ({
  shops,
  pulseCalls: SHOPEE_PULSE_CALLS,
  historyCalls: SHOPEE_HISTORY_CALLS,
  historyMin: { 1: 360, 2: 360, 3: 1440 },
  capacityPerSec: cap,
  baseMin: 30,
  capMin: { 1: 120, 2: 360, 3: 1440 },
  utilization: 0.8,
});

describe("adsPriorityOf — lớp ưu tiên từ những gì xung đã đếm", () => {
  it("1 = đang tiêu tiền + Trợ lý bật; 2 = có chiến dịch theo dõi; 3 = chưa ủy quyền / không chiến dịch", () => {
    expect(adsPriorityOf({ adsReady: true, watching: 3, spentRecently: true, autoExecuteOn: true })).toBe(1);
    expect(adsPriorityOf({ adsReady: true, watching: 3, spentRecently: true, autoExecuteOn: false })).toBe(2);
    expect(adsPriorityOf({ adsReady: true, watching: 2, spentRecently: false, autoExecuteOn: true })).toBe(2);
    expect(adsPriorityOf({ adsReady: true, watching: 0, spentRecently: false, autoExecuteOn: true })).toBe(3);
    expect(adsPriorityOf({ adsReady: false, watching: 5, spentRecently: true, autoExecuteOn: true })).toBe(3);
  });
});

describe("computeCadence — nhịp từng lớp là HÀM của (số gian, lệnh/xung, sức chứa), không ngưỡng tay", () => {
  it("40 gian hôm nay: không lớp nào giãn, khóa chặt nhất là get_all_cpc ở vài % mức cho phép", () => {
    const r = computeCadence(input({ 1: 10, 2: 25, 3: 5 }));
    expect(r.pulseMin).toEqual({ 1: 30, 2: 30, 3: 30 });
    expect(r.stretched).toEqual({ 1: false, 2: false, 3: false });
    expect(r.binding).toBe(ALL_CPC);
    // 35 gian × 1 lệnh / 30' + 35 × 1 / 360' + 5 × 1 / 1440' ≈ 1,27 lệnh/phút trên mức cho phép 0,8 × 60 = 48 → ~2,6 %.
    expect(r.utilization[ALL_CPC]).toBeGreaterThan(0.02);
    expect(r.utilization[ALL_CPC]).toBeLessThan(0.04);
    expect(r.red).toBe(false);
  });

  it("sức chứa get_all_cpc 1/s → ~1.300 gian lớp 2 ở nhịp 30' vừa chạm mức 80 %; thêm gian thì lớp 2 giãn, lớp 1 giữ 30'", () => {
    const ok = computeCadence(input({ 1: 100, 2: 1_200, 3: 0 }));
    expect(ok.stretched[2]).toBe(false);
    expect(ok.utilization[ALL_CPC]).toBeLessThanOrEqual(1);
    const more = computeCadence(input({ 1: 100, 2: 2_000, 3: 0 }));
    expect(more.pulseMin[1]).toBe(30);
    expect(more.stretched[2]).toBe(true);
    expect(more.pulseMin[2]).toBeGreaterThan(30);
    expect(more.pulseMin[2]).toBeLessThanOrEqual(360);
    expect(more.utilization[ALL_CPC]).toBeLessThanOrEqual(1.0001);
    expect(more.red).toBe(false);
  });

  it("20.000 gian lớp 3: id_list 670 lệnh/phút > 96 cho phép → CHỈ lớp 3 giãn (~216'), lớp 1–2 giữ 30'; lịch sử lớp 3 ở 24 h không nghẽn get_all_cpc", () => {
    const r = computeCadence(input({ 1: 50, 2: 50, 3: 20_000 }));
    // Bản đầu của test này (lịch sử 6 h cho mọi gian) ĐỎ: 20.100 × 1 / 360' = 56 lệnh/phút get_all_cpc > 48 → đó là lý do lớp 3 lịch sử 24 h.
    expect(r.stretched[3]).toBe(true);
    expect(r.pulseMin[1]).toBe(30);
    expect(r.pulseMin[2]).toBe(30);
    expect(r.binding).toBe(ID_LIST);
    expect(r.utilization[ID_LIST]).toBeLessThanOrEqual(1.0001);
    expect(r.red).toBe(false);
  });

  it("10.000 gian lớp 1: giãn hết trần 120' vẫn vượt → ĐỎ (thiếu quota thật — việc của ticket Shopee, không phải của mã)", () => {
    const r = computeCadence(input({ 1: 10_000, 2: 0, 3: 0 }));
    expect(r.stretched[1]).toBe(true);
    expect(r.pulseMin[1]).toBe(120);
    expect(r.red).toBe(true);
    expect(r.utilization[ALL_CPC]).toBeGreaterThan(1);
  });

  it("hệ số AIMD hạ sức chứa (factor 0,5) → nhịp giãn sớm hơn với cùng số gian", () => {
    const full = computeCadence(input({ 1: 0, 2: 1_000, 3: 0 }));
    const half = computeCadence(input({ 1: 0, 2: 1_000, 3: 0 }, capacity(0.5)));
    expect(full.stretched[2]).toBe(false);
    expect(half.stretched[2]).toBe(true);
    expect(half.pulseMin[2]).toBeGreaterThan(full.pulseMin[2]);
  });

  it("tất định: cùng đầu vào → cùng kết quả; không gian nào → nhịp gốc, không khóa nào có trần → không ràng buộc", () => {
    const a = computeCadence(input({ 1: 7, 2: 900, 3: 3_000 }));
    const b = computeCadence(input({ 1: 7, 2: 900, 3: 3_000 }));
    expect(a).toEqual(b);
    const none = computeCadence(input({ 1: 0, 2: 0, 3: 0 }));
    expect(none.pulseMin).toEqual({ 1: 30, 2: 30, 3: 30 });
    const free = computeCadence(input({ 1: 50_000, 2: 0, 3: 0 }, {}));
    expect(free.stretched[1]).toBe(false);
    expect(free.binding).toBeNull();
    expect(free.red).toBe(false);
  });
});

describe("shopeeAdsCapacity — sức chứa = trần cấu hình × hệ số AIMD thấp nhất trên khóa (hồi tuyến tính 60')", () => {
  it("không khóa nào bị hạ → đúng trần cấu hình; khóa get_all_cpc hạ 0,5 vừa xong → 0,5/s; sau 15' hồi 0,75/s, sau 30' về 1", () => {
    const now = 1_000_000_000;
    const eps = [ALL_CPC, ID_LIST, "/api/v2/order/get_order_list"];
    expect(shopeeAdsCapacity([], now, eps)).toEqual({ [ALL_CPC]: 1, [ID_LIST]: 2 });
    const keys = [{ key: `SHOPEE:2044679|ep:${ALL_CPC}`, factor: 0.5, decreasedAtMs: now }];
    expect(shopeeAdsCapacity(keys, now, eps)[ALL_CPC]).toBeCloseTo(0.5, 5);
    // Hồi tuyến tính +1 mỗi AIMD_RECOVER_MS (60'): sau 15' = 0,75; sau 30' đã về 1.
    expect(shopeeAdsCapacity(keys, now + 15 * 60_000, eps)[ALL_CPC]).toBeCloseTo(0.75, 5);
    expect(shopeeAdsCapacity(keys, now + 30 * 60_000, eps)[ALL_CPC]).toBe(1);
    // Khóa của app khác / khóa gian không ảnh hưởng.
    expect(shopeeAdsCapacity([{ key: "SHOPEE:2044679|shop:1", factor: 0.1, decreasedAtMs: now }], now, eps)[ALL_CPC]).toBe(1);
  });
});

describe("pulsePastDeadline — đo xung trễ quá hạn chót (nhịp × 2), không bỏ xung", () => {
  it("trễ 61' với nhịp 30' = quá hạn; trễ 59' chưa; chưa có hạn (null) không tính", () => {
    const now = 10_000_000_000;
    expect(pulsePastDeadline(new Date(now - 61 * 60_000), now, 30, 2)).toBe(true);
    expect(pulsePastDeadline(new Date(now - 59 * 60_000), now, 30, 2)).toBe(false);
    expect(pulsePastDeadline(null, now, 30, 2)).toBe(false);
  });
});
