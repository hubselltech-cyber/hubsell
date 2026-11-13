import { describe, expect, it } from "vitest";
import { ChannelName, ReturnStatus, ShippingStatus } from "@prisma/client";

import {
  classifyShippingDiff,
  isClaimableReason,
  SHIPPING_DIFF_REASONS,
  shippingDiffReasonMatcher,
  type TiktokShipCols,
} from "../shipping-diff-reason";

// Số thật prod 31/10/2026 (docs DOI-SOAT-PHI-SHIP-NGUYEN-NHAN-KHAO-SAT-31-10.md mục 2c)
const tk = (over: Partial<TiktokShipCols> = {}): TiktokShipCols => ({
  estimated: false,
  shipCustomerPaid: 0,
  shipPlatformDiscount: 0,
  shipSubsidy: 0,
  shipSellerDiscount: 0,
  shipReturn: 0,
  shipOther: 0,
  ...over,
});

const base = {
  channelName: ChannelName.TIKTOK,
  shippingStatus: ShippingStatus.DELIVERED,
  returnStatus: ReturnStatus.NONE,
  isSettled: true,
  everDelivered: true,
};

describe("classifyShippingDiff — TikTok theo bản kê chi tiết", () => {
  it("chưa quyết toán / số ước tính → Chờ sao kê (đòi được, vẫn cần đối soát)", () => {
    expect(classifyShippingDiff({ ...base, isSettled: false, tiktok: null })).toBe(
      "AWAITING_STATEMENT"
    );
    expect(classifyShippingDiff({ ...base, tiktok: tk({ estimated: true }) })).toBe(
      "AWAITING_STATEMENT"
    );
    expect(isClaimableReason("AWAITING_STATEMENT")).toBe(true);
    // đã quyết toán mà thiếu dòng bản kê (dữ liệu cũ) → theo trạng thái đơn, không báo "chờ"
    expect(
      classifyShippingDiff({ ...base, shippingStatus: ShippingStatus.CANCELLED, tiktok: null })
    ).toBe("CANCELLED_AFTER_SHIP");
    expect(classifyShippingDiff({ ...base, tiktok: null })).toBe("OTHER");
  });

  it("586570309098309429: hủy sau khi gửi, không trục hoàn → CANCELLED_AFTER_SHIP", () => {
    expect(
      classifyShippingDiff({
        ...base,
        shippingStatus: ShippingStatus.CANCELLED,
        tiktok: tk(),
      })
    ).toBe("CANCELLED_AFTER_SHIP");
  });

  it("586684327050839210: đã giao, trả hàng, ship chiều hoàn −15.100 → CUSTOMER_RETURN", () => {
    expect(
      classifyShippingDiff({
        ...base,
        returnStatus: ReturnStatus.AWAITING,
        tiktok: tk({ shipReturn: -15100 }),
      })
    ).toBe("CUSTOMER_RETURN");
    // đơn ĐÃ GIAO rồi khách trả, bị ghi CANCELLED: có trục hoàn vẫn là khách trả hàng
    expect(
      classifyShippingDiff({
        ...base,
        shippingStatus: ShippingStatus.CANCELLED,
        returnStatus: ReturnStatus.RECEIVED,
        tiktok: tk(),
      })
    ).toBe("CUSTOMER_RETURN");
  });

  it("giao không thành công, kho đã quét nhận kiện quay đầu → CANCELLED_AFTER_SHIP, không phải khách trả hàng", () => {
    // prod 13/11/2026: 35/67 đơn nhãn "Khách trả hàng" của một tài khoản là dạng này
    const failed = { ...base, shippingStatus: ShippingStatus.CANCELLED, everDelivered: false };
    expect(classifyShippingDiff({ ...failed, returnStatus: ReturnStatus.RECEIVED, tiktok: tk() })).toBe("CANCELLED_AFTER_SHIP");
    expect(classifyShippingDiff({ ...failed, returnStatus: ReturnStatus.AWAITING, tiktok: tk() })).toBe("CANCELLED_AFTER_SHIP");
    expect(classifyShippingDiff({ ...failed, returnStatus: ReturnStatus.RECEIVED, tiktok: null })).toBe("CANCELLED_AFTER_SHIP");
    // có cước chiều về = sàn tính như đơn trả hàng → giữ nhãn khách trả hàng dù thiếu mốc đã giao
    expect(classifyShippingDiff({ ...failed, returnStatus: ReturnStatus.RECEIVED, tiktok: tk({ shipReturn: -15100 }) })).toBe("CUSTOMER_RETURN");
    // chưa hủy (đang giao / đang hoàn) thì chưa kết luận giao thất bại
    expect(
      classifyShippingDiff({ ...base, everDelivered: false, returnStatus: ReturnStatus.AWAITING, tiktok: tk() })
    ).toBe("CUSTOMER_RETURN");
  });

  it("phụ phí logistics (bảo hiểm, ký nhận…) → LOGISTICS_SURCHARGE, đòi được", () => {
    const r = classifyShippingDiff({ ...base, tiktok: tk({ shipOther: -3000 }) });
    expect(r).toBe("LOGISTICS_SURCHARGE");
    expect(isClaimableReason(r)).toBe(true);
  });

  it("586443174431851769: sàn trợ 20.000, shop voucher −7.000 → SHOP_FREESHIP", () => {
    expect(
      classifyShippingDiff({
        ...base,
        tiktok: tk({ shipPlatformDiscount: 20000, shipSellerDiscount: -7000 }),
      })
    ).toBe("SHOP_FREESHIP");
  });

  it("586760074401318566: khách 0, sàn 0, cước −40.000 → SHOP_BEARS_SHIPPING, không đòi", () => {
    const r = classifyShippingDiff({ ...base, tiktok: tk() });
    expect(r).toBe("SHOP_BEARS_SHIPPING");
    expect(isClaimableReason(r)).toBe(false);
  });

  it("586393620169328061: khách 13.800 + sàn 255.000, cước 272.170 → OVER_PLATFORM_SUBSIDY", () => {
    expect(
      classifyShippingDiff({
        ...base,
        tiktok: tk({ shipCustomerPaid: 13800, shipPlatformDiscount: 255000 }),
      })
    ).toBe("OVER_PLATFORM_SUBSIDY");
  });

  it("khách trả một phần, sàn không trợ, không voucher → OTHER", () => {
    expect(classifyShippingDiff({ ...base, tiktok: tk({ shipCustomerPaid: 5000 }) })).toBe(
      "OTHER"
    );
  });
});

describe("classifyShippingDiff — Shopee / Lazada", () => {
  it("Shopee 2610201W5QAPND: đã giao, không hoàn, 31.500 → 37.500 → FEE_MISMATCH (đòi được)", () => {
    const r = classifyShippingDiff({ ...base, channelName: ChannelName.SHOPEE });
    expect(r).toBe("FEE_MISMATCH");
    expect(isClaimableReason(r)).toBe(true);
  });

  it("Shopee chưa giải ngân → Chờ sao kê; có trục hoàn → khách trả hàng", () => {
    expect(
      classifyShippingDiff({ ...base, channelName: ChannelName.SHOPEE, isSettled: false })
    ).toBe("AWAITING_STATEMENT");
    expect(
      classifyShippingDiff({
        ...base,
        channelName: ChannelName.SHOPEE,
        returnStatus: ReturnStatus.RECEIVED_INTACT,
      })
    ).toBe("CUSTOMER_RETURN");
  });

  it("Lazada: ship hoàn → khách trả hàng; phí VC người bán → shop chịu; còn lại lệch cước", () => {
    const lz = { shipFeeReturn: 0, feeShipSeller: 0, shipFeeAdjustment: 0, shipDiscountSeller: 0 };
    const lazada = { ...base, channelName: ChannelName.LAZADA };
    expect(classifyShippingDiff({ ...lazada, lazada: { ...lz, shipFeeReturn: -20000 } })).toBe(
      "CUSTOMER_RETURN"
    );
    expect(classifyShippingDiff({ ...lazada, lazada: { ...lz, feeShipSeller: -15000 } })).toBe(
      "SHOP_BEARS_SHIPPING"
    );
    expect(classifyShippingDiff({ ...lazada, lazada: { ...lz, shipFeeAdjustment: -6500 } })).toBe(
      "FEE_MISMATCH"
    );
    expect(classifyShippingDiff({ ...lazada, isSettled: false, lazada: null })).toBe(
      "AWAITING_STATEMENT"
    );
    // seed/dữ liệu cũ: đã quyết toán nhưng chưa có sao kê chi tiết → vẫn là lệch cước
    expect(classifyShippingDiff({ ...lazada, lazada: null })).toBe("FEE_MISMATCH");
  });

  it("đơn offline không có sàn → OTHER", () => {
    expect(classifyShippingDiff({ ...base, channelName: ChannelName.OFFLINE })).toBe("OTHER");
  });
});

describe("shippingDiffReasonMatcher — bộ lọc ?reason= dùng chung", () => {
  it("CLAIMABLE / POLICY chia đôi 9 mã, không phân biệt hoa thường", () => {
    const claimable = shippingDiffReasonMatcher("claimable");
    const policy = shippingDiffReasonMatcher("POLICY");
    for (const r of SHIPPING_DIFF_REASONS) {
      expect(claimable(r)).toBe(isClaimableReason(r));
      expect(policy(r)).toBe(!isClaimableReason(r));
    }
  });

  it("một mã → đúng mã đó; rỗng / giá trị lạ → tất cả", () => {
    const one = shippingDiffReasonMatcher("customer_return");
    expect(one("CUSTOMER_RETURN")).toBe(true);
    expect(one("LOGISTICS_SURCHARGE")).toBe(false);
    expect(SHIPPING_DIFF_REASONS.every(shippingDiffReasonMatcher(""))).toBe(true);
    expect(SHIPPING_DIFF_REASONS.every(shippingDiffReasonMatcher("khong-co"))).toBe(true);
  });
});
