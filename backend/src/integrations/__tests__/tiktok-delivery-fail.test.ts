// ============================================================
// CỨU ĐƠN TIKTOK — TEST PHẦN THUẦN (16/09/2026): đếm lượt giao hỏng từ mô tả
// tracking (VN/EN), phân loại cứu/mất, nhịp hỏi lại theo pha giao.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  classifyTiktokOutcomeFromTracking,
  countTiktokFailedDeliveries,
  nextTiktokDetectDelayMs,
} from "../tiktok/delivery-fail";
import {
  DETECT_ACTIVE_INTERVAL_MS,
  DETECT_IDLE_INTERVAL_MS,
} from "../shopee/delivery-fail";

const ev = (description: string, minsAgo = 0, type?: string) => ({
  description,
  update_time_millis: Date.now() - minsAgo * 60_000,
  ...(type ? { tracking_event_type: type } : {}),
});

describe("countTiktokFailedDeliveries", () => {
  it("đếm mô tả giao không thành công (VN + EN), bỏ lấy hàng/hoàn trả", () => {
    expect(
      countTiktokFailedDeliveries([
        ev("Đơn hàng đã được lấy"),
        ev("Giao hàng không thành công vì không liên hệ được người nhận"),
        ev("Lấy hàng không thành công"),
        ev("Delivery attempt failed"),
        ev("Đơn hàng sẽ được hoàn trả vì giao hàng không thành công"),
      ])
    ).toBe(2);
  });
  it("đếm theo tracking_event_type có chữ FAIL", () => {
    expect(countTiktokFailedDeliveries([ev("x", 0, "DELIVERY_FAILED"), ev("y", 0, "DELIVERED")])).toBe(1);
  });
});

describe("classifyTiktokOutcomeFromTracking", () => {
  it("mốc hoàn/quay đầu → lost, kể cả sau DELIVERED", () => {
    expect(
      classifyTiktokOutcomeFromTracking([ev("Delivered"), ev("Package returned to seller")])
    ).toBe("lost");
    expect(classifyTiktokOutcomeFromTracking([ev("Kiện hàng đang quay về shop")])).toBe("lost");
  });
  it("đã giao → saved; giao KHÔNG thành công không tính là saved", () => {
    expect(classifyTiktokOutcomeFromTracking([ev("Giao hàng thành công")])).toBe("saved");
    expect(classifyTiktokOutcomeFromTracking([ev("Giao hàng không thành công")])).toBe("pending");
    expect(classifyTiktokOutcomeFromTracking([ev("Đang giao hàng")])).toBe("pending");
  });
});

describe("nextTiktokDetectDelayMs", () => {
  it("đang giao + còn nhúc nhích → 20'; chưa tới pha giao hoặc đứng im → 2h", () => {
    const now = Date.now();
    expect(nextTiktokDetectDelayMs([ev("Đang giao hàng", 10)], now)).toBe(DETECT_ACTIVE_INTERVAL_MS);
    expect(nextTiktokDetectDelayMs([ev("Out for delivery", 60 * 72)], now)).toBe(DETECT_IDLE_INTERVAL_MS);
    expect(nextTiktokDetectDelayMs([ev("Đã tạo đơn", 5)], now)).toBe(DETECT_IDLE_INTERVAL_MS);
  });
});
