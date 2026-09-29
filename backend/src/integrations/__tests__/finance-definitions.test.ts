// ============================================================
// ĐỊNH NGHĨA TÀI CHÍNH DÙNG CHUNG — khóa bằng test để Tổng quan, Báo cáo dòng
// tiền, Trợ lý không bao giờ lệch định nghĩa nhau nữa (anh Trung chốt 30/09/2026:
// đơn ĐANG hoàn không tính vào doanh thu). Logic thuần, KHÔNG DB.
// ============================================================

import { describe, expect, it } from "vitest";
import { ReturnStatus, ShippingStatus } from "@prisma/client";
import {
  countsAsRevenue,
  isLossOrder,
  isReturning,
  summarizeMissingCost,
} from "../../lib/finance-definitions";

describe("isLossOrder — đơn lỗ là đơn có lãi < 0 (anh Trung chốt 30/09/2026)", () => {
  it("lãi âm → lỗ; lãi bằng 0 và lãi dương → không lỗ", () => {
    expect(isLossOrder({ profitAfterTax: -1 })).toBe(true);
    expect(isLossOrder({ profitAfterTax: 0 })).toBe(false);
    expect(isLossOrder({ profitAfterTax: 45000 })).toBe(false);
  });
});

describe("summarizeMissingCost — đơn chưa có giá vốn bị loại khỏi lợi nhuận", () => {
  it("đếm đúng số đơn và cộng đúng phần lợi nhuận bị loại", () => {
    const s = summarizeMissingCost([
      { missingCostPrice: false, profitAfterTax: 45000 },
      { missingCostPrice: true, profitAfterTax: 176081 },
      { missingCostPrice: true, profitAfterTax: -2700 },
    ]);
    expect(s).toEqual({ orderCount: 2, excludedProfit: 176081 - 2700 });
  });

  it("kỳ không có đơn thiếu giá vốn → 0 đơn, 0 đồng", () => {
    expect(summarizeMissingCost([{ missingCostPrice: false, profitAfterTax: 1 }])).toEqual({
      orderCount: 0,
      excludedProfit: 0,
    });
  });
});
import { correctedDeliveredAt, deliveredAtFromPlatform } from "../../lib/delivered-at";

describe("correctedDeliveredAt — đồng bộ lại là đơn cũ tự sửa mốc giao", () => {
  const now = new Date("2026-09-30T10:00:00+07:00");
  const platform = new Date("2026-06-20T14:00:00+07:00");

  it("chưa có mốc → ghi mốc của sàn", () => {
    expect(correctedDeliveredAt(null, platform, now)).toEqual(platform);
  });

  it("mốc cũ ghi bằng giờ nạp lịch sử (muộn hơn sàn báo) → kéo về mốc sàn", () => {
    const syncedAt = new Date("2026-08-15T09:00:00+07:00");
    expect(correctedDeliveredAt(syncedAt, platform, now)).toEqual(platform);
  });

  it("mốc cũ đã SỚM hơn hoặc bằng mốc sàn vừa báo → giữ nguyên (sàn cập nhật đơn sau khi giao)", () => {
    const earlier = new Date("2026-06-18T08:00:00+07:00");
    expect(correctedDeliveredAt(earlier, platform, now)).toBeNull();
    expect(correctedDeliveredAt(platform, platform, now)).toBeNull();
  });

  it("sàn không trả thời điểm → không kéo mốc cũ về giờ hiện tại", () => {
    const stored = new Date("2026-08-15T09:00:00+07:00");
    expect(correctedDeliveredAt(stored, null, now)).toBeNull();
  });
});

describe("deliveredAtFromPlatform — mốc giao theo số của sàn", () => {
  const now = new Date("2026-09-30T10:00:00+07:00");

  it("đơn nạp lịch sử: lấy thời điểm sàn cập nhật, KHÔNG lấy giờ nạp", () => {
    const platform = new Date("2026-07-02T09:15:00+07:00");
    expect(deliveredAtFromPlatform(platform, now)).toEqual(platform);
  });

  it("sàn không trả / trả rác / trả giờ tương lai → rơi về giờ đồng bộ", () => {
    expect(deliveredAtFromPlatform(null, now)).toEqual(now);
    expect(deliveredAtFromPlatform(undefined, now)).toEqual(now);
    expect(deliveredAtFromPlatform(new Date("không-phải-ngày"), now)).toEqual(now);
    expect(deliveredAtFromPlatform(new Date(0), now)).toEqual(now);
    expect(deliveredAtFromPlatform(new Date("2026-10-05T00:00:00+07:00"), now)).toEqual(now);
  });
});

const row = (shippingStatus: ShippingStatus, returnStatus: ReturnStatus) => ({
  shippingStatus,
  returnStatus,
});

describe("countsAsRevenue — đơn tính doanh thu", () => {
  it("đơn giao / đang giao / chờ xử lý, không hoàn → TÍNH", () => {
    for (const s of [
      ShippingStatus.PENDING,
      ShippingStatus.PROCESSED,
      ShippingStatus.SHIPPING,
      ShippingStatus.DELIVERED,
    ]) {
      expect(countsAsRevenue(row(s, ReturnStatus.NONE))).toBe(true);
    }
  });

  it("đơn hủy → KHÔNG tính, bất kể trục hoàn", () => {
    for (const r of Object.values(ReturnStatus)) {
      expect(countsAsRevenue(row(ShippingStatus.CANCELLED, r))).toBe(false);
    }
  });

  it("đơn ĐANG hoàn (chờ về / đã quét nhận / hỏng chờ khiếu nại) → KHÔNG tính", () => {
    for (const r of [ReturnStatus.AWAITING, ReturnStatus.RECEIVED, ReturnStatus.DAMAGED]) {
      expect(isReturning({ returnStatus: r })).toBe(true);
      expect(countsAsRevenue(row(ShippingStatus.DELIVERED, r))).toBe(false);
    }
  });

  it("hoàn ĐÃ XONG (nhập kho / khiếu nại thắng / thua) → TÍNH lại, tiền hoàn nằm ở dòng khấu trừ", () => {
    for (const r of [
      ReturnStatus.RECEIVED_INTACT,
      ReturnStatus.CLAIM_SETTLED,
      ReturnStatus.WRITTEN_OFF,
    ]) {
      expect(isReturning({ returnStatus: r })).toBe(false);
      expect(countsAsRevenue(row(ShippingStatus.DELIVERED, r))).toBe(true);
    }
  });
});
