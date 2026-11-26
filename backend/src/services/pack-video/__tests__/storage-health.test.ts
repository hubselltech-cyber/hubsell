// ============================================================
// VIDEO ĐÓNG HÀNG — đèn "Kho video R2" của HQ Sức khỏe: phép ước tiền + luật xếp mức (hàm thuần).
// ============================================================

import { describe, expect, it } from "vitest";
import { PACK_STORAGE_SLOW_MS, PACK_STORAGE_STALE_HOURS } from "../../../config/pack-video";
import {
  estimateR2MonthlyUsd,
  fmtStorage,
  packStorageSignal,
  toPackStorageHealth,
  type PackStorageRecord,
} from "../storage-health";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function record(over: Partial<PackStorageRecord> = {}): PackStorageRecord {
  return {
    at: hoursAgo(2),
    ms: 12,
    windowDays: 100,
    stored: { count: 340, mb: 1_200, owners: 12 },
    held: { count: 3, mb: 14 },
    overdue: { count: 0, mb: 0 },
    pastCap: { count: 0, mb: 0 },
    pending: 1,
    uploaded7d: { count: 90, mb: 300 },
    uploaded30d: 340,
    deleted7d: { count: 20, mb: 80 },
    revenue30dVnd: 400_000,
    purchases30d: 2,
    janitor: { shadow: false, deleted: 3, wouldDelete: 0, errors: 0, staleFound: 0, staleCleared: 0 },
    ...over,
  };
}
const signal = (r: PackStorageRecord | null, gate: "all" | "pilot" | "off" = "all") =>
  packStorageSignal(toPackStorageHealth(r, NOW, gate));

describe("Ước tiền R2 một tháng", () => {
  it("trong 10 GB miễn phí và dưới 1 triệu lượt ghi → 0", () => {
    expect(estimateR2MonthlyUsd(9.9, 500_000)).toBe(0);
    expect(estimateR2MonthlyUsd(10, 1_000_000)).toBe(0);
  });
  it("phần vượt 10 GB × 0,015 USD", () => {
    expect(estimateR2MonthlyUsd(110, 0)).toBe(1.5);
    expect(estimateR2MonthlyUsd(1_010, 0)).toBe(15);
  });
  it("lượt ghi vượt 1 triệu × 4,50 USD / triệu, cộng với tiền kho", () => {
    expect(estimateR2MonthlyUsd(0, 3_000_000)).toBe(9);
    expect(estimateR2MonthlyUsd(110, 3_000_000)).toBe(10.5);
  });
});

describe("Chữ dung lượng", () => {
  it("dưới 1 GB hiện MB, từ 1 GB hiện GB một số lẻ", () => {
    expect(fmtStorage(850)).toBe("850 MB");
    expect(fmtStorage(12_400)).toBe("12,4 GB");
  });
});

describe("Đèn Kho video R2", () => {
  it("bình thường → xanh, chữ có đủ số chính", () => {
    const [value, level] = signal(record());
    expect(level).toBe("ok");
    expect(value).toContain("đang lưu 1,2 GB");
    expect(value).toContain("340 video");
    expect(value).toContain("12 chủ shop");
    expect(value).toContain("trong 10 GB miễn phí");
    expect(value).toContain("xóa thật 3");
  });

  it("không đọc được / chưa có số → vàng", () => {
    expect(packStorageSignal(null)[1]).toBe("warn");
    const [value, level] = signal(null);
    expect(level).toBe("warn");
    expect(value).toBe("chưa có số");
  });

  it("vượt 10 GB miễn phí chỉ hiện tiền, KHÔNG tự vàng", () => {
    const [value, level] = signal(record({ stored: { count: 9_000, mb: 110_000, owners: 80 }, revenue30dVnd: 5_000_000 }));
    expect(level).toBe("ok");
    expect(value).toContain("≈ 1,5 USD / tháng");
  });

  it(`số cũ quá ${PACK_STORAGE_STALE_HOURS} giờ → đỏ (worker dọn không chạy)`, () => {
    expect(signal(record({ at: hoursAgo(PACK_STORAGE_STALE_HOURS - 1) }))[1]).toBe("ok");
    const [, level, hint] = signal(record({ at: hoursAgo(PACK_STORAGE_STALE_HOURS + 1) }));
    expect(level).toBe("crit");
    expect(hint).toContain("worker dọn video không chạy");
  });

  it("cổng mở mà lượt dọn chạy bóng → đỏ; cổng tắt hoặc kho trống thì không", () => {
    const shadow = { shadow: true, deleted: 0, wouldDelete: 13, errors: 0, staleFound: 0, staleCleared: 0 };
    const [value, level] = signal(record({ janitor: shadow }));
    expect(level).toBe("crit");
    expect(value).toContain("CHẠY BÓNG (sẽ xóa 13)");
    expect(signal(record({ janitor: shadow }), "pilot")[1]).toBe("crit");
    expect(signal(record({ janitor: shadow }), "off")[1]).toBe("ok");
    expect(signal(record({ janitor: shadow, stored: { count: 0, mb: 0, owners: 0 } }))[1]).toBe("ok");
  });

  it("có video quá hạn xóa hơn 1 ngày / quá trần vẫn còn → đỏ", () => {
    const [value, level] = signal(record({ overdue: { count: 4, mb: 20 } }));
    expect(level).toBe("crit");
    expect(value).toContain("4 video QUÁ HẠN chưa xóa (20 MB)");
    const cap = signal(record({ pastCap: { count: 2, mb: 9 } }));
    expect(cap[1]).toBe("crit");
    expect(cap[0]).toContain("2 video quá trần 60 ngày");
  });

  it("lượt dọn có lỗi xóa → vàng", () => {
    const j = { shadow: false, deleted: 5, wouldDelete: 0, errors: 2, staleFound: 0, staleCleared: 0 };
    const [value, level] = signal(record({ janitor: j }));
    expect(level).toBe("warn");
    expect(value).toContain("LỖI 2");
  });

  it("câu đếm kho chậm → vàng", () => {
    expect(signal(record({ ms: PACK_STORAGE_SLOW_MS }))[1]).toBe("ok");
    expect(signal(record({ ms: PACK_STORAGE_SLOW_MS + 1 }))[1]).toBe("warn");
  });

  it("tiền kho vượt 20 % tiền bán giờ → vàng, nhưng chỉ khi tiền kho đã từ 5 USD", () => {
    // 410 GB → 6 USD ≈ 156.000 đ; 20 % của 700.000 đ = 140.000 đ → vượt.
    const big = { count: 60_000, mb: 410_000, owners: 300 };
    expect(signal(record({ stored: big, revenue30dVnd: 700_000 }))[1]).toBe("warn");
    expect(signal(record({ stored: big, revenue30dVnd: 800_000 }))[1]).toBe("ok");
    // 110 GB → 1,5 USD < 5 USD: không báo dù chưa bán được giờ nào.
    expect(signal(record({ stored: { count: 9_000, mb: 110_000, owners: 80 }, revenue30dVnd: 0 }))[1]).toBe("ok");
  });

  it("đỏ thắng vàng: số cũ + lỗi xóa → đỏ", () => {
    const j = { shadow: false, deleted: 0, wouldDelete: 0, errors: 3, staleFound: 0, staleCleared: 0 };
    expect(signal(record({ at: hoursAgo(30), janitor: j }))[1]).toBe("crit");
  });
});
