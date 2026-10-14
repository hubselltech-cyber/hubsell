// ============================================================
// MỐC NƯỚC QUÉT ĐƠN — luật thuần (lát 3.2 giai đoạn 3, docs/DONG-BO-GIAI-DOAN-3.md mục 2).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  WATERMARK_DEFAULT_DAYS,
  WATERMARK_FLOOR_DAYS,
  WATERMARK_OVERLAP_SEC,
  nextWatermark,
  planOrderWindow,
  watermarkLogLine,
} from "../order-watermark";

const NOW_MS = Date.parse("2026-10-14T10:00:00.000Z");
const NOW = NOW_MS / 1000;
const DAY = 86_400;
const at = (sec: number) => new Date(sec * 1000);

describe("planOrderWindow — cửa sổ đọc của lượt", () => {
  it("chưa có mốc → 2 ngày như cũ, chế độ fresh", () => {
    const p = planOrderWindow({ ordersWatermarkAt: null, ordersCatchupBeforeAt: null }, NOW_MS, undefined);
    expect(p).toEqual({ mode: "fresh", fromSec: NOW - WATERMARK_DEFAULT_DAYS * DAY, toSec: NOW });
  });

  it("có mốc → từ mốc − OVERLAP tới now0", () => {
    const wm = NOW - 600; // lượt trước 10 phút
    const p = planOrderWindow({ ordersWatermarkAt: at(wm), ordersCatchupBeforeAt: null }, NOW_MS, undefined);
    expect(p).toEqual({ mode: "advance", fromSec: wm - WATERMARK_OVERLAP_SEC, toSec: NOW });
  });

  it("mốc quá cũ → không đọc xa hơn sàn 90 ngày", () => {
    const wm = NOW - 400 * DAY;
    const p = planOrderWindow({ ordersWatermarkAt: at(wm), ordersCatchupBeforeAt: null }, NOW_MS, undefined);
    expect(p.fromSec).toBe(NOW - WATERMARK_FLOOR_DAYS * DAY);
    expect(p.mode).toBe("advance");
  });

  it("đang vét dở → tới mốc vét, không tới now0", () => {
    const wm = NOW - 3 * DAY;
    const catchup = NOW - DAY;
    const p = planOrderWindow({ ordersWatermarkAt: at(wm), ordersCatchupBeforeAt: at(catchup) }, NOW_MS, undefined);
    expect(p).toEqual({ mode: "catchup", fromSec: wm - WATERMARK_OVERLAP_SEC, toSec: catchup });
  });

  it("mốc vét nằm ngoài cửa sổ (cũ hơn sàn dưới / ở tương lai) → bỏ, quét thường", () => {
    const wm = NOW - 600;
    const tooOld = planOrderWindow({ ordersWatermarkAt: at(wm), ordersCatchupBeforeAt: at(wm - DAY) }, NOW_MS, undefined);
    expect(tooOld.mode).toBe("advance");
    expect(tooOld.toSec).toBe(NOW);
    const future = planOrderWindow({ ordersWatermarkAt: at(wm), ordersCatchupBeforeAt: at(NOW + 60) }, NOW_MS, undefined);
    expect(future.mode).toBe("advance");
  });

  it("chưa có mốc nhưng lượt đầu đã bị cắt → vét tới mốc vét trong cửa sổ 2 ngày", () => {
    const catchup = NOW - DAY;
    const p = planOrderWindow({ ordersWatermarkAt: null, ordersCatchupBeforeAt: at(catchup) }, NOW_MS, undefined);
    expect(p).toEqual({ mode: "catchup", fromSec: NOW - 2 * DAY, toSec: catchup });
  });

  it("đường lui ORDER_SYNC_WINDOW=fixed → 2 ngày, bỏ qua mọi mốc", () => {
    const p = planOrderWindow({ ordersWatermarkAt: at(NOW - 60), ordersCatchupBeforeAt: at(NOW - 30) }, NOW_MS, " FIXED ");
    expect(p).toEqual({ mode: "fixed", fromSec: NOW - 2 * DAY, toSec: NOW });
  });
});

describe("nextWatermark — ghi gì sau lượt đọc không lỗi", () => {
  const advance = planOrderWindow({ ordersWatermarkAt: at(NOW - 600), ordersCatchupBeforeAt: null }, NOW_MS, undefined);

  it("đủ → mốc = now0, xóa mốc vét", () => {
    expect(nextWatermark(advance, { truncated: false, oldestUpdateTime: NOW - 500 })).toEqual({
      ordersWatermarkAt: at(NOW),
      ordersCatchupBeforeAt: null,
    });
  });

  it("cắt → giữ mốc, mốc vét = update_time cũ nhất đã đọc", () => {
    const w = nextWatermark(advance, { truncated: true, oldestUpdateTime: NOW - 120 });
    expect(w).toEqual({ ordersCatchupBeforeAt: at(NOW - 120) });
    expect(w).not.toHaveProperty("ordersWatermarkAt");
  });

  it("cắt mà sàn trả dòng ngoài cửa sổ hoặc không có update_time → bỏ mốc vét, không tiến mốc", () => {
    expect(nextWatermark(advance, { truncated: true, oldestUpdateTime: advance.fromSec - 1 })).toEqual({ ordersCatchupBeforeAt: null });
    expect(nextWatermark(advance, { truncated: true })).toEqual({ ordersCatchupBeforeAt: null });
  });

  it("vét xong → mốc = mốc vét (phần sau lượt kế đọc lại qua OVERLAP)", () => {
    const catchup = planOrderWindow({ ordersWatermarkAt: at(NOW - 3 * DAY), ordersCatchupBeforeAt: at(NOW - DAY) }, NOW_MS, undefined);
    expect(nextWatermark(catchup, { truncated: false })).toEqual({ ordersWatermarkAt: at(NOW - DAY), ordersCatchupBeforeAt: null });
  });

  it("vét lại bị cắt → mốc vét lùi tiếp", () => {
    const catchup = planOrderWindow({ ordersWatermarkAt: at(NOW - 3 * DAY), ordersCatchupBeforeAt: at(NOW - DAY) }, NOW_MS, undefined);
    expect(nextWatermark(catchup, { truncated: true, oldestUpdateTime: NOW - 2 * DAY })).toEqual({
      ordersCatchupBeforeAt: at(NOW - 2 * DAY),
    });
  });

  it("đường lui fixed → không ghi gì", () => {
    const fixed = planOrderWindow({ ordersWatermarkAt: null, ordersCatchupBeforeAt: null }, NOW_MS, "fixed");
    expect(nextWatermark(fixed, { truncated: false })).toBeNull();
  });

  it("chuỗi ba lượt: cắt → vét xong → lượt thường tiến tới now", () => {
    let state = { ordersWatermarkAt: at(NOW - 5 * DAY), ordersCatchupBeforeAt: null as Date | null };
    const p1 = planOrderWindow(state, NOW_MS, undefined);
    state = { ...state, ...nextWatermark(p1, { truncated: true, oldestUpdateTime: NOW - 2 * DAY }) };
    expect(state.ordersWatermarkAt).toEqual(at(NOW - 5 * DAY));
    expect(state.ordersCatchupBeforeAt).toEqual(at(NOW - 2 * DAY));

    const p2 = planOrderWindow(state, NOW_MS + 600_000, undefined);
    expect(p2.mode).toBe("catchup");
    state = { ...state, ...nextWatermark(p2, { truncated: false }) };
    expect(state).toEqual({ ordersWatermarkAt: at(NOW - 2 * DAY), ordersCatchupBeforeAt: null });

    const p3 = planOrderWindow(state, NOW_MS + 1_200_000, undefined);
    expect(p3).toEqual({ mode: "advance", fromSec: NOW - 2 * DAY - WATERMARK_OVERLAP_SEC, toSec: NOW + 1200 });
    state = { ...state, ...nextWatermark(p3, { truncated: false }) };
    expect(state.ordersWatermarkAt).toEqual(at(NOW + 1200));
  });
});

describe("watermarkLogLine — lượt thường im lặng", () => {
  const ch = { channelName: "SHOPEE", shopName: "Gian thử" };
  it("tiến mốc bình thường → không log", () => {
    const p = planOrderWindow({ ordersWatermarkAt: at(NOW - 600), ordersCatchupBeforeAt: null }, NOW_MS, undefined);
    expect(watermarkLogLine(ch, p, nextWatermark(p, { truncated: false }))).toBeNull();
  });
  it("bị cắt → báo vét tiếp; vét xong → báo mốc mới", () => {
    const p = planOrderWindow({ ordersWatermarkAt: at(NOW - 600), ordersCatchupBeforeAt: null }, NOW_MS, undefined);
    expect(watermarkLogLine(ch, p, nextWatermark(p, { truncated: true, oldestUpdateTime: NOW - 100 }))).toContain("vét tiếp");
    const c = planOrderWindow({ ordersWatermarkAt: at(NOW - 3 * DAY), ordersCatchupBeforeAt: at(NOW - DAY) }, NOW_MS, undefined);
    expect(watermarkLogLine(ch, c, nextWatermark(c, { truncated: false }))).toContain("vét xong");
  });
});
