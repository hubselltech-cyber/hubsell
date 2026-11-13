import { describe, expect, it } from "vitest";

import { shipGuaranteeGap, splitShippingDiff, type ShipDiffParts, type TiktokShipPartCols } from "../shipping-diff-parts";

const tk = (over: Partial<TiktokShipPartCols> = {}): TiktokShipPartCols => ({
  estimated: false,
  shipActual: 0,
  shipCustomerPaid: 0,
  shipPlatformDiscount: 0,
  shipSubsidy: 0,
  shipSellerDiscount: 0,
  shipReturn: 0,
  shipOther: 0,
  shipReimbursement: 0,
  feeShipGuarantee: 0,
  ...over,
});

const sum = (p: ShipDiffParts) => p.outbound + p.returnLeg + p.surcharge - p.reimbursed + p.other;

describe("splitShippingDiff — tách tiền lệch ship của một đơn TikTok", () => {
  it("586684327050839210: trả hàng, cước đi 30.200 + chiều về 15.100 = 45.300", () => {
    const p = splitShippingDiff(45300, tk({ shipActual: -30200, shipReturn: -15100 }))!;
    expect(p).toEqual({ outbound: 30200, returnLeg: 15100, surcharge: 0, reimbursed: 0, other: 0 });
    expect(sum(p)).toBe(45300);
  });

  it("trả hàng có sàn bồi một phần: 30.200 + 15.100 − 14.800 = 30.500", () => {
    const p = splitShippingDiff(30500, tk({ shipActual: -30200, shipReturn: -15100, shipReimbursement: 14800 }))!;
    expect(p).toEqual({ outbound: 30200, returnLeg: 15100, surcharge: 0, reimbursed: 14800, other: 0 });
    expect(sum(p)).toBe(30500);
  });

  it("586393620169328061: hàng cồng kềnh, khách 13.800 + sàn 255.000, shop chịu 3.370", () => {
    const p = splitShippingDiff(3370, tk({ shipActual: -272170, shipCustomerPaid: 13800, shipPlatformDiscount: 255000 }))!;
    expect(p).toEqual({ outbound: 3370, returnLeg: 0, surcharge: 0, reimbursed: 0, other: 0 });
  });

  it("đơn giao bình thường có phụ phí: chiều đi được phủ đủ, shop chịu đúng phụ phí", () => {
    const p = splitShippingDiff(65000, tk({ shipActual: -90000, shipCustomerPaid: 20000, shipSubsidy: 70000, shipOther: -65000 }))!;
    expect(p).toEqual({ outbound: 0, returnLeg: 0, surcharge: 65000, reimbursed: 0, other: 0 });
  });

  it("voucher ship của shop nằm trong chiều đi", () => {
    // khách trả 7.000 rồi shop giảm lại 7.000: 27.000 − 7.000 − 20.000 + 7.000 = 7.000
    const p = splitShippingDiff(7000, tk({ shipActual: -27000, shipCustomerPaid: 7000, shipPlatformDiscount: 20000, shipSellerDiscount: -7000 }))!;
    expect(p.outbound).toBe(7000);
    expect(sum(p)).toBe(7000);
  });

  it("phần chưa đặt tên / điều chỉnh phí ship dồn vào `other` để tổng luôn khớp", () => {
    const p = splitShippingDiff(42000, tk({ shipActual: -30000, shipReturn: -10000 }))!;
    expect(p.other).toBe(2000);
    expect(sum(p)).toBe(42000);
  });

  it("phần phủ dư ở chiều đi cho ra số âm, tổng vẫn khớp", () => {
    const p = splitShippingDiff(15000, tk({ shipActual: -30000, shipCustomerPaid: 35000, shipReturn: -20000 }))!;
    expect(p).toEqual({ outbound: -5000, returnLeg: 20000, surcharge: 0, reimbursed: 0, other: 0 });
  });

  it("số lẻ xu không làm lệch tổng", () => {
    const p = splitShippingDiff(10.3, tk({ shipActual: -30.1, shipCustomerPaid: 20.2, shipReturn: -0.4 }))!;
    expect(Math.round(sum(p) * 100)).toBe(1030);
  });

  it("không có bản kê, hoặc bản kê không có cột ship nào → null (giữ một dòng như cũ)", () => {
    expect(splitShippingDiff(40000, null)).toBeNull();
    expect(splitShippingDiff(40000, undefined)).toBeNull();
    expect(splitShippingDiff(40000, tk())).toBeNull();
  });
});

describe("shipGuaranteeGap — đã trả phí Bảo đảm phí vận chuyển mà vẫn lệch", () => {
  const paid = { feeShipGuarantee: -1620 };

  it("đơn hủy sau gửi / trả hàng có trả phí: chưa bồi đồng nào → NOT_REIMBURSED, có bồi → PARTIAL", () => {
    expect(shipGuaranteeGap("CUSTOMER_RETURN", { ...paid, shipReimbursement: 0 })).toBe("NOT_REIMBURSED");
    expect(shipGuaranteeGap("CANCELLED_AFTER_SHIP", { ...paid, shipReimbursement: 0 })).toBe("NOT_REIMBURSED");
    expect(shipGuaranteeGap("CUSTOMER_RETURN", { ...paid, shipReimbursement: 14800 })).toBe("PARTIAL");
  });

  it("không trả phí bảo đảm → không cảnh báo, kể cả khi sàn có bồi", () => {
    expect(shipGuaranteeGap("CUSTOMER_RETURN", { feeShipGuarantee: 0, shipReimbursement: 0 })).toBeNull();
    expect(shipGuaranteeGap("CANCELLED_AFTER_SHIP", { feeShipGuarantee: 0, shipReimbursement: 5000 })).toBeNull();
    expect(shipGuaranteeGap("CUSTOMER_RETURN", null)).toBeNull();
  });

  it("đơn giao bình thường (phụ phí, vượt mức sàn trợ, chờ sao kê…) nằm ngoài phạm vi bồi hoàn", () => {
    for (const reason of ["LOGISTICS_SURCHARGE", "OVER_PLATFORM_SUBSIDY", "SHOP_BEARS_SHIPPING", "SHOP_FREESHIP", "AWAITING_STATEMENT", "FEE_MISMATCH", "OTHER"] as const) {
      expect(shipGuaranteeGap(reason, { ...paid, shipReimbursement: 0 }), reason).toBeNull();
    }
  });
});
