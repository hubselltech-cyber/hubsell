// Vitest phần THUẦN của Cứu đơn giao thất bại: đếm mốc thất bại, render
// template, luật bỏ qua auto-chat, cấu hình hiệu lực mặc định.

import { describe, expect, it } from "vitest";
import { DeliveryFailOutcome, ReturnStatus, ShippingStatus } from "@prisma/client";
import {
  chatSkipReason,
  classifyDeliveryFailOutcome,
  classifyOutcomeFromTracking,
  countFailedDeliveries,
  DEFAULT_CHAT_TEMPLATE,
  effectiveDeliveryFailConfig,
  mergeDeliveryFailOutcome,
  renderChatTemplate,
} from "../shopee/delivery-fail";
import { lazadaOrderDeliveryFailed } from "../lazada/delivery-fail";

describe("countFailedDeliveries", () => {
  it("đếm đúng số mốc FAILED_DELIVERED (enum docs), bỏ qua mốc thường", () => {
    expect(
      countFailedDeliveries([
        { logistics_status: "PICKED_UP", description: "Đang giao hàng" },
        { logistics_status: "DELIVERY_PENDING" },
        { logistics_status: "FAILED_DELIVERED", description: "Khách không nghe máy" },
        { logistics_status: "DELIVERY_PENDING" },
        { logistics_status: "FAILED_DELIVERED", description: "Sai địa chỉ" },
      ])
    ).toBe(2);
  });

  // Hành trình THẬT trên production VN (probe 25/08, đơn DarkMan hoàn sau 2
  // lượt): sàn KHÔNG phát enum FAILED_DELIVERED — lượt thất bại là câu tiếng
  // Việt trong description dưới status PICKED_UP; mốc RETURN_INITIATED nhắc
  // lại "vì giao hàng không thành công" là TỔNG KẾT, không phải lượt thứ ba.
  it("đếm lượt thất bại qua DESCRIPTION tiếng Việt như production VN", () => {
    expect(
      countFailedDeliveries([
        { logistics_status: "ORDER_CREATED", description: " Người bán đang chuẩn bị hàng" },
        { logistics_status: "PICKED_UP", description: "Đơn vị vận chuyển lấy hàng thành công" },
        { logistics_status: "PICKED_UP", description: "Đang giao hàng" },
        {
          logistics_status: "PICKED_UP",
          description: "Giao hàng không thành công vì không thể liên hệ người nhận",
        },
        { logistics_status: "PICKED_UP", description: "Đã sắp xếp tài xế giao hàng" },
        {
          logistics_status: "PICKED_UP",
          description: "Giao hàng không thành công vì người nhận từ chối nhận hàng",
        },
        {
          logistics_status: "RETURN_INITIATED",
          description: "Đơn hàng sẽ được hoàn trả vì giao hàng không thành công",
        },
      ])
    ).toBe(2);
  });

  it("chịu được status viết thường / thiếu status / mảng rỗng", () => {
    expect(countFailedDeliveries([{ logistics_status: "failed_delivered" }, {}])).toBe(1);
    expect(countFailedDeliveries([])).toBe(0);
  });

  it("KHÔNG đếm thất bại khâu LẤY hàng, mốc hoàn/hủy, câu tiếng Anh pickup", () => {
    expect(
      countFailedDeliveries([
        { logistics_status: "FAILED_PICKED_UP" },
        { logistics_status: "PICKUP_PENDING", description: "Lấy hàng không thành công" },
        { logistics_status: "RETURN_STARTED" },
        { logistics_status: "CANCELED", description: "Đơn vị vận chuyển thông báo đơn hàng đã bị hủy" },
        { logistics_status: "PICKUP_PENDING", description: "Pickup failed" },
      ])
    ).toBe(0);
  });

  it("bắt biến thể 'giao lại' + câu tiếng Anh delivery failed", () => {
    expect(
      countFailedDeliveries([
        { logistics_status: "PICKED_UP", description: "Giao lại không thành công" },
        { logistics_status: "PICKED_UP", description: "Delivery attempt failed" },
      ])
    ).toBe(2);
  });
});

describe("renderChatTemplate", () => {
  const vars = {
    customerName: "Chị Hoa",
    orderCode: "2408ABC123",
    productNames: ["Áo thun nam", "Quần jean", "Nón lưỡi trai"],
  };

  it("điền đủ 3 biến, tên SP đầu + số SP còn lại", () => {
    const out = renderChatTemplate(
      "Chào {ten_khach}, đơn {ma_don} ({ten_san_pham}) giao chưa được.",
      vars
    );
    expect(out).toBe(
      "Chào Chị Hoa, đơn 2408ABC123 (Áo thun nam và 2 sản phẩm khác) giao chưa được."
    );
  });

  it("đơn 1 sản phẩm không có đuôi 'và N sản phẩm khác'", () => {
    const out = renderChatTemplate("{ten_san_pham}", { ...vars, productNames: ["Áo thun"] });
    expect(out).toBe("Áo thun");
  });

  it("template trống → dùng mặc định; thiếu tên khách → 'bạn'", () => {
    const out = renderChatTemplate("   ", { ...vars, customerName: "" });
    expect(out).toBe(DEFAULT_CHAT_TEMPLATE.replaceAll("{ma_don}", vars.orderCode));
    expect(renderChatTemplate("{ten_khach}", { ...vars, customerName: " " })).toBe("bạn");
  });

  it("đơn không có dòng hàng → nhãn chung, không vỡ câu", () => {
    expect(renderChatTemplate("{ten_san_pham}", { ...vars, productNames: [] })).toBe(
      "sản phẩm bạn đặt"
    );
  });
});

describe("classifyDeliveryFailOutcome (báo cáo Kết quả cứu đơn)", () => {
  it("giao thành công không hoàn = saved", () => {
    expect(
      classifyDeliveryFailOutcome({
        shippingStatus: ShippingStatus.DELIVERED,
        returnStatus: ReturnStatus.NONE,
      })
    ).toBe("saved");
  });

  it("hủy hoặc dính luồng hoàn = lost — KỂ CẢ đã giao rồi khách mở hoàn", () => {
    expect(
      classifyDeliveryFailOutcome({
        shippingStatus: ShippingStatus.CANCELLED,
        returnStatus: ReturnStatus.NONE,
      })
    ).toBe("lost");
    expect(
      classifyDeliveryFailOutcome({
        shippingStatus: ShippingStatus.DELIVERED,
        returnStatus: ReturnStatus.AWAITING,
      })
    ).toBe("lost");
  });

  it("còn trên đường = pending", () => {
    expect(
      classifyDeliveryFailOutcome({
        shippingStatus: ShippingStatus.SHIPPING,
        returnStatus: ReturnStatus.NONE,
      })
    ).toBe("pending");
  });
});

describe("classifyOutcomeFromTracking (chốt kết quả từ hành trình — probe 26/08)", () => {
  // Ca THẬT production 26/08: đơn giao xong nhưng Order còn SHIPPING vì
  // TO_CONFIRM_RECEIVE — sàn nói LOGISTICS_DELIVERY_DONE ở tầng đơn.
  it("orderLevel LOGISTICS_DELIVERY_DONE hoặc mốc DELIVERED = saved", () => {
    expect(
      classifyOutcomeFromTracking("LOGISTICS_DELIVERY_DONE", [
        { logistics_status: "PICKED_UP", description: "Đang giao hàng" },
      ])
    ).toBe("saved");
    expect(
      classifyOutcomeFromTracking("LOGISTICS_PICKUP_DONE", [
        { logistics_status: "DELIVERED", description: "Giao hàng thành công" },
      ])
    ).toBe("saved");
  });

  it("mốc RETURN*/CANCEL* trong hành trình = lost — kể cả khi ĐÃ có DELIVERED trước đó", () => {
    expect(
      classifyOutcomeFromTracking("LOGISTICS_PICKUP_DONE", [
        {
          logistics_status: "PICKED_UP",
          description: "Giao hàng không thành công vì không thể liên hệ người nhận",
        },
        { logistics_status: "RETURN_INITIATED", description: "Đơn hàng sẽ được hoàn trả" },
      ])
    ).toBe("lost");
    expect(
      classifyOutcomeFromTracking(null, [
        { logistics_status: "DELIVERED" },
        { logistics_status: "RETURN_STARTED" },
      ])
    ).toBe("lost");
    expect(classifyOutcomeFromTracking("LOGISTICS_CANCELLED", [])).toBe("lost");
  });

  it("còn trên đường (chỉ PICKED_UP, kể cả có lượt thất bại) = pending", () => {
    expect(
      classifyOutcomeFromTracking("LOGISTICS_PICKUP_DONE", [
        { logistics_status: "PICKED_UP", description: "Đã sắp xếp tài xế giao hàng" },
        {
          logistics_status: "PICKED_UP",
          description: "Giao hàng không thành công vì người nhận từ chối nhận hàng",
        },
      ])
    ).toBe("pending");
    expect(classifyOutcomeFromTracking(undefined, [])).toBe("pending");
  });
});

describe("mergeDeliveryFailOutcome (Order chốt thắng, tracking lấp chỗ mù)", () => {
  it("Order còn pending → lấy kết quả worker chốt từ tracking", () => {
    expect(mergeDeliveryFailOutcome("pending", DeliveryFailOutcome.SAVED)).toBe("saved");
    expect(mergeDeliveryFailOutcome("pending", DeliveryFailOutcome.LOST)).toBe("lost");
    expect(mergeDeliveryFailOutcome("pending", DeliveryFailOutcome.PENDING)).toBe("pending");
  });

  it("Order đã chốt → thắng notice, kể cả SAVED bị lật thành lost khi khách mở hoàn sau giao", () => {
    expect(mergeDeliveryFailOutcome("lost", DeliveryFailOutcome.SAVED)).toBe("lost");
    expect(mergeDeliveryFailOutcome("saved", DeliveryFailOutcome.PENDING)).toBe("saved");
  });
});

describe("lazadaOrderDeliveryFailed", () => {
  it("bắt đủ 3 trạng thái thất bại, kể cả đơn nhiều kiện lệch trạng thái", () => {
    expect(lazadaOrderDeliveryFailed(["delivered", "failed_delivery"])).toBe(true);
    expect(lazadaOrderDeliveryFailed(["shipped_back"])).toBe(true);
    expect(lazadaOrderDeliveryFailed(["shipped_back_success"])).toBe(true);
    expect(lazadaOrderDeliveryFailed(["FAILED_DELIVERY "])).toBe(true);
  });

  it("đơn thường / hủy chủ động / thiếu statuses → không báo", () => {
    expect(lazadaOrderDeliveryFailed(["shipping", "delivered"])).toBe(false);
    expect(lazadaOrderDeliveryFailed(["canceled"])).toBe(false);
    expect(lazadaOrderDeliveryFailed([])).toBe(false);
    expect(lazadaOrderDeliveryFailed(undefined)).toBe(false);
  });
});

describe("chatSkipReason", () => {
  it("đơn đang giao bình thường → không bỏ qua", () => {
    expect(
      chatSkipReason({
        shippingStatus: ShippingStatus.SHIPPING,
        returnStatus: ReturnStatus.NONE,
      })
    ).toBeNull();
  });

  it("đơn đã hủy hoặc đang hoàn → bỏ qua kèm lý do", () => {
    expect(
      chatSkipReason({
        shippingStatus: ShippingStatus.CANCELLED,
        returnStatus: ReturnStatus.NONE,
      })
    ).toBe("Đơn đã hủy");
    expect(
      chatSkipReason({
        shippingStatus: ShippingStatus.SHIPPING,
        returnStatus: ReturnStatus.AWAITING,
      })
    ).toBe("Đơn đang trong luồng hoàn");
  });
});

describe("effectiveDeliveryFailConfig", () => {
  it("chưa có dòng DB → cảnh báo BẬT, auto-chat TẮT, template mặc định", () => {
    expect(effectiveDeliveryFailConfig(null)).toEqual({
      alertEnabled: true,
      autoChatEnabled: false,
      chatTemplate: DEFAULT_CHAT_TEMPLATE,
    });
  });

  it("template chủ shop xoá trắng → rơi về mặc định, cờ giữ nguyên", () => {
    expect(
      effectiveDeliveryFailConfig({
        alertEnabled: false,
        autoChatEnabled: true,
        chatTemplate: "  ",
      })
    ).toEqual({
      alertEnabled: false,
      autoChatEnabled: true,
      chatTemplate: DEFAULT_CHAT_TEMPLATE,
    });
  });
});
