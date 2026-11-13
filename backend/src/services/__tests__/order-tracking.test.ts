import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import {
  hasLeftForCarrier,
  normalizeShopeeTracking,
  normalizeTikTokTracking,
  summarizeReturnLeg,
} from "../order-tracking";

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

describe("chặng hoàn của kiện giao thất bại — hãng đã trả kiện chưa (13/11/2026)", () => {
  it("Shopee: chỉ mốc RETURNED mới là đã trả xong; RETURN_INITIATED / RETURN_STARTED là đang hoàn về", () => {
    const going = normalizeShopeeTracking([
      { update_time: 100, description: "Giao không thành công", logistics_status: "FAILED_DELIVERED" },
      { update_time: 200, description: "Đơn hàng sẽ được hoàn trả", logistics_status: "RETURN_INITIATED" },
      { update_time: 300, description: "Đang hoàn về người gửi", logistics_status: "RETURN_STARTED" },
    ]);
    expect(summarizeReturnLeg(going)).toEqual({
      state: "RETURNING",
      at: null,
      latest: { at: new Date(300_000).toISOString(), description: "Đang hoàn về người gửi" },
    });

    const done = normalizeShopeeTracking([
      { update_time: 300, description: "Đang hoàn về người gửi", logistics_status: "RETURN_STARTED" },
      { update_time: 400, description: "Trả hàng thành công", logistics_status: "RETURNED" },
    ]);
    const sum = summarizeReturnLeg(done);
    expect(sum.state).toBe("RETURNED");
    expect(sum.at).toBe(new Date(400_000).toISOString());
  });

  it("hành trình chưa có mốc hoàn nào → NO_SIGNAL, vẫn trả mốc mới nhất; rỗng → latest null", () => {
    const out = summarizeReturnLeg(
      normalizeShopeeTracking([
        { update_time: 100, description: "Giao không thành công", logistics_status: "FAILED_DELIVERED" },
      ])
    );
    expect(out.state).toBe("NO_SIGNAL");
    expect(out.latest?.description).toBe("Giao không thành công");
    expect(summarizeReturnLeg([])).toEqual({ state: "NO_SIGNAL", at: null, latest: null });
  });

  it("TikTok: 'hoàn … thành công' là đã trả xong; 'hoàn về do giao không thành công' thì chưa", () => {
    const going = normalizeTikTokTracking([
      {
        update_time_millis: 1_000,
        description: "Đơn hàng đang được hoàn trả về người gửi do giao hàng không thành công",
      },
    ]);
    expect(going[0].returned).toBeUndefined();
    expect(summarizeReturnLeg(going).state).toBe("RETURNING");

    const done = normalizeTikTokTracking([
      { update_time_millis: 1_000, description: "Kiện hàng đang hoàn trả về người bán" },
      { update_time_millis: 2_000, description: "Đã hoàn hàng thành công cho người bán" },
    ]);
    expect(summarizeReturnLeg(done)).toMatchObject({ state: "RETURNED", at: new Date(2_000).toISOString() });
    expect(
      summarizeReturnLeg(
        normalizeTikTokTracking([{ update_time_millis: 3_000, description: "Package returned to seller" }])
      ).state
    ).toBe("RETURNED");
  });

  it("TikTok: 'Giao hàng thành công' không bị đọc thành đã trả kiện", () => {
    const out = normalizeTikTokTracking([{ update_time_millis: 1, description: "Giao hàng thành công" }]);
    expect(out[0].returned).toBeUndefined();
    expect(summarizeReturnLeg(out).state).toBe("NO_SIGNAL");
  });
});
