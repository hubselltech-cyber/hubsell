// ============================================================
// TEST DIFF "SÀN TRẢ THIẾU" THEO TỪNG THÀNH PHẦN — logic thuần, KHÔNG DB.
//
// Bối cảnh 01/09/2026: đơn thật 26082480K9AARJ (ANO Official Store) bị báo oan
// "sàn trả thiếu 7.491" — thực chất là phí hoa hồng Tiếp thị liên kết (AMS)
// chỉ chốt lúc quyết toán, không có trong số ước tính của chính Shopee. Luật
// mới (computePayoutShortfall): so từng thành phần, chỉ buộc tội phí CÓ mẫu
// số ước tính bị thu vượt / trợ giá hứa mà bù thiếu; khoản chốt-muộn, khoản
// shop tự chi và trường lạ ngoài danh mục KHÔNG thành cáo buộc.
// ============================================================

import { describe, expect, it } from "vitest";
import {
  computePayoutShortfall,
  snapshotIncome,
} from "../shopee/settlements";
import type { ShopeeOrderIncome } from "../shopee/client";

/** Bản ước tính mô phỏng đơn 26082480K9AARJ — Shopee CHƯA biết phí AMS. */
const EST_26082480: ShopeeOrderIncome = {
  order_selling_price: 289_000,
  commission_fee: 55_199,
  service_fee: 18_895,
  shipping_seller_protection_fee_amount: 2_700,
  seller_transaction_fee: 17_340,
  withholding_vat_tax: 2_890,
  withholding_pit_tax: 1_445,
  actual_shipping_fee: 32_200,
  shopee_shipping_rebate: 32_200,
  escrow_amount: 190_531,
};

/** Bản quyết toán thật: y hệt ước tính + phí AMS 7.491 mới xuất hiện. */
const FINAL_26082480: ShopeeOrderIncome = {
  ...EST_26082480,
  order_ams_commission_fee: 7_491,
  escrow_amount: 183_040,
};

describe("snapshotIncome", () => {
  it("chỉ giữ trường số hữu hạn", () => {
    const snap = snapshotIncome({
      escrow_amount: 100,
      commission_fee: undefined,
      // trường lạ ngoài interface — mô phỏng API trả thêm dữ liệu
      ...({ items: [{ x: 1 }], note: "abc", bad: NaN } as object),
    });
    expect(snap).toEqual({ escrow_amount: 100 });
  });
});

describe("computePayoutShortfall", () => {
  it("đơn 26082480K9AARJ: phí AMS chốt muộn KHÔNG thành cáo buộc", () => {
    const r = computePayoutShortfall(
      snapshotIncome(EST_26082480),
      snapshotIncome(FINAL_26082480)
    );
    expect(r.shortfall).toBe(0);
    // Vẫn ghi nhận đủ trong bảng diff để chủ shop hiểu tiền đi đâu.
    const ams = r.detail?.find((d) => d.key === "ams_fee");
    expect(ams).toMatchObject({ lost: 7_491, accused: false });
  });

  it("phí có mẫu số bị thu vượt → buộc tội đúng phần vượt", () => {
    const final: ShopeeOrderIncome = {
      ...EST_26082480,
      commission_fee: 60_199, // sàn thu vượt lời hứa 5.000
      escrow_amount: 185_531,
    };
    const r = computePayoutShortfall(
      snapshotIncome(EST_26082480),
      snapshotIncome(final)
    );
    expect(r.shortfall).toBe(5_000);
    expect(r.detail?.find((d) => d.key === "commission_fee")).toMatchObject({
      expected: 55_199,
      actual: 60_199,
      lost: 5_000,
      accused: true,
    });
  });

  it("trợ giá Shopee hứa mà bù thiếu → cũng là trả thiếu", () => {
    const est = snapshotIncome({ ...EST_26082480, shopee_discount: 8_750 });
    const final = snapshotIncome({
      ...EST_26082480,
      shopee_discount: 0,
      escrow_amount: 181_781,
    });
    const r = computePayoutShortfall(est, final);
    expect(r.shortfall).toBe(8_750);
  });

  it("phí vượt lẫn phí AMS trong CÙNG đơn: chỉ buộc tội phần có mẫu số", () => {
    const final: ShopeeOrderIncome = {
      ...FINAL_26082480, // đã có AMS 7.491
      service_fee: 21_895, // + thu vượt Phí Dịch Vụ 3.000
      escrow_amount: 180_040,
    };
    const r = computePayoutShortfall(
      snapshotIncome(EST_26082480),
      snapshotIncome(final)
    );
    expect(r.shortfall).toBe(3_000);
  });

  it("trường LẠ ngoài danh mục (sàn đẻ phí mới) → ghi nhận, không buộc tội", () => {
    const final = snapshotIncome({
      ...EST_26082480,
      escrow_amount: 180_531,
    });
    final["mystery_new_fee"] = 10_000; // loại phí tương lai chưa ai biết tên
    const r = computePayoutShortfall(snapshotIncome(EST_26082480), final);
    expect(r.shortfall).toBe(0);
    expect(r.detail?.find((d) => d.key === "unexplained")).toMatchObject({
      lost: 10_000,
      accused: false,
    });
  });

  it("cáo buộc bị chặn trần bằng mức tụt escrow thật (phí khác rẻ đi bù lại)", () => {
    const final: ShopeeOrderIncome = {
      ...EST_26082480,
      commission_fee: 60_199, // thu vượt 5.000
      service_fee: 14_895, // nhưng rẻ đi 4.000
      escrow_amount: 189_531, // tổng chỉ hụt 1.000
    };
    const r = computePayoutShortfall(
      snapshotIncome(EST_26082480),
      snapshotIncome(final)
    );
    expect(r.shortfall).toBe(1_000);
  });

  it("nhận đủ hoặc dư → không có gì để soi", () => {
    const r = computePayoutShortfall(
      snapshotIncome(EST_26082480),
      snapshotIncome({ ...EST_26082480, escrow_amount: 191_000 })
    );
    expect(r).toEqual({ shortfall: 0, detail: null });
  });

  it("không có snapshot ước tính → không buộc tội (thiếu mẫu số)", () => {
    expect(
      computePayoutShortfall(null, snapshotIncome(FINAL_26082480))
    ).toEqual({ shortfall: 0, detail: null });
  });
});
