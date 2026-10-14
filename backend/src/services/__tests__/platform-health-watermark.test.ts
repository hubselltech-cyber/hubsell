// ============================================================
// Dấu hiệu "Mốc nước quét đơn" trên trang Sức khỏe (lát 3.6 giai đoạn 3, 15/10/2026).
// Ngưỡng 60' / 360' là mặc định tự chọn (config/capacity-plan.ts).
// ============================================================

import { describe, expect, it } from "vitest";
import { watermarkSignal, type WatermarkHealth } from "../platform-health";

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
});
