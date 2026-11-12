import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import { hasLeftForCarrier, normalizeShopeeTracking, normalizeTikTokTracking } from "../order-tracking";

describe("hành trình vận chuyển — chuẩn hóa mốc của sàn", () => {
  it("Shopee: đổi giây → ISO, mới nhất trước, phân loại theo logistics_status", () => {
    const out = normalizeShopeeTracking([
      { update_time: 1_700_000_000, description: "Đã lấy hàng", logistics_status: "PICKED_UP" },
      { update_time: 1_700_090_000, description: "Giao hàng thành công", logistics_status: "DELIVERED" },
      { update_time: 1_700_050_000, description: "Giao không thành công", logistics_status: "FAILED_DELIVERED" },
      { update_time: 1_700_095_000, description: "Đang hoàn về người gửi", logistics_status: "RETURN_STARTED" },
    ]);
    expect(out.map((e) => e.kind)).toEqual(["returning", "delivered", "failed", "normal"]);
    expect(out[3].at).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("Shopee: bỏ mốc không có chữ, mốc thiếu giờ xếp cuối, rỗng / thiếu không vỡ", () => {
    const out = normalizeShopeeTracking([
      { description: "Mốc không giờ" },
      { update_time: 1_700_000_000, description: "   " },
      { update_time: 1_700_000_100, description: "Có giờ" },
    ]);
    expect(out.map((e) => e.description)).toEqual(["Có giờ", "Mốc không giờ"]);
    expect(out[1].at).toBeNull();
    expect(normalizeShopeeTracking(undefined)).toEqual([]);
  });

  it("TikTok: mili giây → ISO, nhận ra giao thất bại / đã giao / hoàn theo câu chữ", () => {
    const out = normalizeTikTokTracking([
      { update_time_millis: 1_700_000_000_000, description: "Đơn vị vận chuyển đã lấy hàng" },
      { update_time_millis: 1_700_000_500_000, description: "Giao hàng không thành công" },
      { update_time_millis: 1_700_000_900_000, description: "Giao hàng thành công" },
      { update_time_millis: 1_700_000_950_000, description: "Kiện hàng đang hoàn trả về người bán" },
    ]);
    expect(out.map((e) => e.kind)).toEqual(["returning", "delivered", "failed", "normal"]);
    expect(out[0].at).toBe(new Date(1_700_000_950_000).toISOString());
  });

  it("'giao không thành công' không bị đọc nhầm thành đã giao", () => {
    const [e] = normalizeTikTokTracking([{ update_time_millis: 1, description: "Giao hàng không thành công, sẽ giao lại" }]);
    expect(e.kind).toBe("failed");
  });
});

describe("hành trình vận chuyển — khi nào mới hỏi sàn", () => {
  it("Chờ xử lý hoặc chưa có mã vận đơn → không gọi", () => {
    expect(hasLeftForCarrier({ shippingStatus: ShippingStatus.PENDING, trackingCode: "SPX1" })).toBe(false);
    expect(hasLeftForCarrier({ shippingStatus: ShippingStatus.PROCESSED, trackingCode: null })).toBe(false);
    expect(hasLeftForCarrier({ shippingStatus: ShippingStatus.PROCESSED, trackingCode: "" })).toBe(false);
  });
  it("đã có mã vận đơn và qua bước chuẩn bị → gọi", () => {
    expect(hasLeftForCarrier({ shippingStatus: ShippingStatus.PROCESSED, trackingCode: "SPX1" })).toBe(true);
    expect(hasLeftForCarrier({ shippingStatus: ShippingStatus.DELIVERED, trackingCode: "SPX1" })).toBe(true);
    expect(hasLeftForCarrier({ shippingStatus: ShippingStatus.CANCELLED, trackingCode: "SPX1" })).toBe(true);
  });
});
