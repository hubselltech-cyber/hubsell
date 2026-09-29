// ============================================================
// ĐỊNH NGHĨA TÀI CHÍNH DÙNG CHUNG — khóa bằng test để Tổng quan, Báo cáo dòng
// tiền, Trợ lý không bao giờ lệch định nghĩa nhau nữa (anh Trung chốt 30/09/2026:
// đơn ĐANG hoàn không tính vào doanh thu). Logic thuần, KHÔNG DB.
// ============================================================

import { describe, expect, it } from "vitest";
import { ReturnStatus, ShippingStatus } from "@prisma/client";
import { countsAsRevenue, isReturning } from "../../lib/finance-definitions";
import { deliveredAtFromPlatform } from "../../lib/delivered-at";

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
