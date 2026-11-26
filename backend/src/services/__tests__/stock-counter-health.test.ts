// ============================================================
// ĐÈN BÁO "Bộ đếm kho" của HQ Sức khỏe + CÔNG TẮC cách hiển thị tồn (26/11/2026,
// docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 20.2 + 21). Hàm thuần — không đụng database.
// ============================================================
import { afterEach, describe, expect, it } from "vitest";
import { CHECK_STALE_HOURS, stockCounterSignal, SWEEP_FAIL_WARN, type StockCounterHealth } from "../stock-committed";
import { DEFAULT_STOCK_MODEL, forcedStockModel, resolveStockSettings } from "../stock-ledger";

const healthy: StockCounterHealth = {
  off: false,
  checkAt: "2026-11-25T14:12:54.000Z",
  checkAgeHours: 11,
  hard: 0,
  streak: 7,
  lastMismatchAt: null,
  committedOrders: 348,
  counterTotal: 371,
  sweepAt: "2026-11-26T01:08:00.000Z",
  sweepMs: 48,
  sweepFailStreak: 0,
  sweepLastError: null,
  sweepCaught: 0,
};

describe("stockCounterSignal — dấu hiệu Bộ đếm kho", () => {
  it("mọi thứ bình thường → xanh, câu nêu đủ lệch cứng / đơn giữ / chuỗi", () => {
    const [value, level] = stockCounterSignal(healthy);
    expect(level).toBe("ok");
    expect(value).toContain("lệch cứng 0");
    expect(value).toContain("348 đơn giữ");
    expect(value).toContain("chuỗi lệch 0 liên tiếp 7");
  });

  it("lần đối chiếu gần nhất có lệch cứng → ĐỎ", () => {
    expect(stockCounterSignal({ ...healthy, hard: 2, streak: 0 })[1]).toBe("crit");
  });

  it(`đối chiếu quá ${CHECK_STALE_HOURS} giờ chưa chạy → ĐỎ; đúng ${CHECK_STALE_HOURS} giờ thì chưa`, () => {
    expect(stockCounterSignal({ ...healthy, checkAgeHours: CHECK_STALE_HOURS })[1]).toBe("ok");
    expect(stockCounterSignal({ ...healthy, checkAgeHours: CHECK_STALE_HOURS + 0.1 })[1]).toBe("crit");
  });

  it("chưa từng đối chiếu → ĐỎ (không ai kiểm bộ đếm)", () => {
    expect(stockCounterSignal({ ...healthy, checkAt: null, checkAgeHours: null })[1]).toBe("crit");
  });

  it(`quét bù lỗi ${SWEEP_FAIL_WARN} nhịp liền → VÀNG, kèm lỗi; ít hơn thì chưa`, () => {
    expect(stockCounterSignal({ ...healthy, sweepFailStreak: SWEEP_FAIL_WARN - 1, sweepLastError: "quét bù: timeout" })[1]).toBe("ok");
    const [value, level] = stockCounterSignal({ ...healthy, sweepFailStreak: SWEEP_FAIL_WARN, sweepLastError: "quét bù: timeout" });
    expect(level).toBe("warn");
    expect(value).toContain("quét bù: timeout");
  });

  it("lệch cứng thắng lỗi quét bù (đỏ chứ không vàng)", () => {
    expect(stockCounterSignal({ ...healthy, hard: 1, sweepFailStreak: 9 })[1]).toBe("crit");
  });

  it("công tắc khẩn đang tắt bộ đếm → ĐỎ; không đọc được sổ → VÀNG", () => {
    expect(stockCounterSignal({ ...healthy, off: true })[1]).toBe("crit");
    expect(stockCounterSignal(null)[1]).toBe("warn");
  });
});

describe("resolveStockSettings — cách hiển thị tồn đang áp cho một shop", () => {
  afterEach(() => {
    delete process.env.STOCK_MODEL_FORCE;
  });

  it("shop chưa có dòng cài đặt → mặc định; có dòng thì theo dòng; giá trị lạ → cách cũ", () => {
    expect(resolveStockSettings(null)).toEqual({ stockModel: DEFAULT_STOCK_MODEL, restockOnReturn: "ON_CANCEL" });
    expect(resolveStockSettings({ stockModel: "ON_HAND", restockOnReturn: "ON_RECEIVE" })).toEqual({
      stockModel: "ON_HAND",
      restockOnReturn: "ON_RECEIVE",
    });
    expect(resolveStockSettings({ stockModel: "LEGACY" }).stockModel).toBe("LEGACY");
    expect(resolveStockSettings({ stockModel: "gì-đó", restockOnReturn: "gì-đó" })).toEqual({
      stockModel: "LEGACY",
      restockOnReturn: "ON_CANCEL",
    });
  });

  it("STOCK_MODEL_FORCE=LEGACY ép MỌI shop về cách cũ kể cả shop đã bật; không đụng cách cộng tồn hàng hoàn", () => {
    process.env.STOCK_MODEL_FORCE = "LEGACY";
    expect(forcedStockModel()).toBe("LEGACY");
    expect(resolveStockSettings({ stockModel: "ON_HAND", restockOnReturn: "ON_RECEIVE" })).toEqual({
      stockModel: "LEGACY",
      restockOnReturn: "ON_RECEIVE",
    });
    expect(resolveStockSettings(null).stockModel).toBe("LEGACY");
  });

  it("giá trị lạ của STOCK_MODEL_FORCE coi như không đặt", () => {
    process.env.STOCK_MODEL_FORCE = "1";
    expect(forcedStockModel()).toBeNull();
    expect(resolveStockSettings({ stockModel: "ON_HAND" }).stockModel).toBe("ON_HAND");
  });
});
