// Ánh xạ order_status Shopee → vòng đời Hubsell. Sự cố 17/09: RETRY_SHIP (đã sắp
// xếp vận chuyển, sàn xếp lại lượt lấy hàng) rơi vào default thành Chờ xử lý.
import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import { mapShopeeStatus } from "../shopee/service";

describe("mapShopeeStatus", () => {
  it("RETRY_SHIP là đơn ĐÃ xử lý — không quay về Chờ xử lý", () => {
    expect(mapShopeeStatus("RETRY_SHIP")).toBe(ShippingStatus.PROCESSED);
  });

  it("giữ nguyên các trạng thái còn lại", () => {
    expect(mapShopeeStatus("UNPAID")).toBe(ShippingStatus.PENDING);
    expect(mapShopeeStatus("READY_TO_SHIP")).toBe(ShippingStatus.PENDING);
    expect(mapShopeeStatus("PROCESSED")).toBe(ShippingStatus.PROCESSED);
    expect(mapShopeeStatus("SHIPPED")).toBe(ShippingStatus.SHIPPING);
    expect(mapShopeeStatus("TO_CONFIRM_RECEIVE")).toBe(ShippingStatus.SHIPPING);
    expect(mapShopeeStatus("COMPLETED")).toBe(ShippingStatus.DELIVERED);
    expect(mapShopeeStatus("IN_CANCEL")).toBe(ShippingStatus.CANCELLED);
    expect(mapShopeeStatus("CANCELLED")).toBe(ShippingStatus.CANCELLED);
  });
});
