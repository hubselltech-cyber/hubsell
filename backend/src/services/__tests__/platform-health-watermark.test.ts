// ============================================================
// Dấu hiệu "Mốc nước quét đơn" trên trang Sức khỏe (lát 3.6 giai đoạn 3, 15/10/2026).
// Ngưỡng 60' / 360' là mặc định tự chọn (config/capacity-plan.ts).
// ============================================================

import { describe, expect, it } from "vitest";
import { watermarkSignal, watermarkWorstHint, type WatermarkHealth, type WatermarkWorstShop } from "../platform-health";

const base: WatermarkHealth = {
  channels: 20,
  withMark: 20,
  catchingUp: 0,
  lagOver60: 0,
  lagOver6h: 0,
  maxLagMin: 12,
  maxLagShop: "SHOPEE · ANO Official",
};

describe("watermarkSignal", () => {
  it("mọi gian có mốc tươi → xanh, nêu gian trễ nhất", () => {
    const [value, level] = watermarkSignal(base);
    expect(level).toBe("ok");
    expect(value).toContain("20/20 gian có mốc");
    expect(value).toContain("trễ nhất 12' (SHOPEE · ANO Official)");
  });

  it("không đọc được → vàng", () => {
    const [value, level] = watermarkSignal(null);
    expect(level).toBe("warn");
    expect(value).toContain("không đọc được");
  });

  it("có gian đang vét dở → vàng, hint nói lọc log", () => {
    const [value, level, hint] = watermarkSignal({ ...base, catchingUp: 2 });
    expect(level).toBe("warn");
    expect(value).toContain("2 đang vét dở");
    expect(hint).toContain("vét tiếp");
  });

  it("gian trễ quá ngưỡng vàng (90') → vàng; quá 6 giờ → đỏ", () => {
    expect(watermarkSignal({ ...base, lagOver60: 1, maxLagMin: 95 })[1]).toBe("warn");
    expect(watermarkSignal({ ...base, lagOver60: 3, lagOver6h: 1, maxLagMin: 400 })[1]).toBe("crit");
  });

  it("chưa gian nào có mốc (vừa deploy / chưa chạy lượt nào) → xanh nhưng nói rõ", () => {
    const [value, level] = watermarkSignal({ ...base, withMark: 0, maxLagMin: null, maxLagShop: null });
    expect(level).toBe("ok");
    expect(value).toContain("0/20 gian có mốc");
    expect(value).toContain("chưa có mốc nào");
  });

  it("không có gian nào để quét → xanh, không chia cho 0", () => {
    const [value, level] = watermarkSignal({ ...base, channels: 0, withMark: 0, maxLagMin: null, maxLagShop: null });
    expect(level).toBe("ok");
    expect(value).toContain("0/0 gian");
  });

  it("gian ngủ đông chỉ được nêu số, không làm vàng (16/10/2026: RUXI ngủ đông bị báo trễ 233')", () => {
    const [value, level] = watermarkSignal({ ...base, hibernated: 4 });
    expect(level).toBe("ok");
    expect(value).toContain("4 ngủ đông (không tính)");
    // Ảnh chụp cũ không có trường này → không in gì thêm.
    expect(watermarkSignal(base)[0]).not.toContain("ngủ đông");
  });

  it("gian đang nạp lịch sử chỉ được nêu số, không làm đỏ (21/10/2026: Bella Look bật lại cờ backfill → '824'' oan)", () => {
    const [value, level] = watermarkSignal({ ...base, backfilling: 1 });
    expect(level).toBe("ok");
    expect(value).toContain("1 đang nạp lịch sử (không tính)");
    expect(watermarkSignal(base)[0]).not.toContain("nạp lịch sử");
  });

  it("có gian trễ + chẩn đoán gian trễ nhất → hint nói thẳng vì sao, không còn câu chung chung", () => {
    const worst: WatermarkWorstShop = {
      shop: "TIKTOK · Bella Look",
      lagMin: 824,
      lastSyncAgoMin: 6,
      lastSyncError: null,
      syncFailCount: 0,
      lockedMin: null,
      nextFastInMin: 4,
      catchingUp: false,
    };
    const [, level, hint] = watermarkSignal({ ...base, lagOver60: 1, lagOver6h: 1, maxLagMin: 824, maxLagShop: worst.shop, worst });
    expect(level).toBe("crit");
    expect(hint).toContain("Bella Look");
    expect(hint).toContain("mốc không ghi");
    expect(hint).not.toContain("xem lastSyncError");
    // Ảnh chụp cũ không có worst → câu chung chung như trước.
    expect(watermarkSignal({ ...base, lagOver60: 1, maxLagMin: 95 })[2]).toContain("xem lastSyncError");
  });
});

describe("watermarkWorstHint", () => {
  const w: WatermarkWorstShop = {
    shop: "TIKTOK · Bella Look",
    lagMin: 824,
    lastSyncAgoMin: null,
    lastSyncError: null,
    syncFailCount: 0,
    lockedMin: null,
    nextFastInMin: null,
    catchingUp: false,
  };

  it("lỗi đồng bộ đơn → nêu lỗi + số lần, cắt lỗi dài", () => {
    const hint = watermarkWorstHint({ ...w, lastSyncError: "x".repeat(300), syncFailCount: 7, lastSyncAgoMin: 900 });
    expect(hint).toContain("LỖI 7 lần liên tiếp");
    expect(hint).toContain("lần OK cuối 900' trước");
    expect(hint.length).toBeLessThan(400);
    expect(hint).toContain("…");
  });

  it("đơn vừa OK mà mốc cũ → lượt bị cắt sau tầng đơn", () => {
    expect(watermarkWorstHint({ ...w, lastSyncAgoMin: 6 })).toContain("lượt bị cắt sau tầng đơn");
    expect(watermarkWorstHint({ ...w, lastSyncAgoMin: 6, lockedMin: 3 })).toContain("đang cầm khóa 3'");
  });

  it("đang cầm khóa → vé mồ côi khi quá 15'", () => {
    expect(watermarkWorstHint({ ...w, lastSyncAgoMin: 820, lockedMin: 20 })).toContain("vé mồ côi");
    expect(watermarkWorstHint({ ...w, lastSyncAgoMin: 820, lockedMin: 2 })).toContain("lượt đang chạy");
  });

  it("quá hạn quét mà chưa được nhặt → worker quá tải", () => {
    expect(watermarkWorstHint({ ...w, lastSyncAgoMin: 820, nextFastInMin: -30 })).toContain("quá hạn quét nhanh 30'");
  });

  it("không lỗi, chưa đến hạn → bậc giãn nhịp / vừa nối", () => {
    const hint = watermarkWorstHint({ ...w, lastSyncAgoMin: 820, nextFastInMin: 12 });
    expect(hint).toContain("hạn quét kế 12'");
    expect(hint).toContain("bậc giãn nhịp");
  });
});
