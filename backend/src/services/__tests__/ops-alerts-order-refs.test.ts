// ============================================================
// MÃ ĐƠN ĐÍNH KÈM CẢNH BÁO (09/10/2026) — luật thuần, KHÔNG DB.
//
// (1) pickTopOrderRefs: nhiều tiền nhất trước, cắt theo trần.
// (2) alertRefsMeta: một hàm dựng {refs, refTotal, href, label} cho cả payload
//     thẻ lẫn meta nhật ký; không có đơn → null (dòng chỉ in chữ).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  ALERT_REF_LIMIT,
  alertRefsMeta,
  pickTopOrderRefs,
  type AlertOrderRef,
  type DetectedAlert,
} from "../ops-alerts";

function ref(code: string, amount: number): AlertOrderRef {
  return { code, channelName: "SHOPEE", shopName: "Gian A", amount };
}

describe("pickTopOrderRefs", () => {
  it("xếp đơn nhiều tiền nhất lên đầu và cắt theo trần mặc định", () => {
    const refs = [1, 7, 3, 9, 2, 8, 5].map((n) => ref(`D${n}`, n * 1000));
    const top = pickTopOrderRefs(refs);
    expect(ALERT_REF_LIMIT).toBe(3);
    expect(top).toHaveLength(ALERT_REF_LIMIT);
    expect(top.map((r) => r.code)).toEqual(["D9", "D8", "D7"]);
  });

  it("không đổi mảng gốc, trần 0 trả rỗng", () => {
    const refs = [ref("A", 1), ref("B", 2)];
    const copy = [...refs];
    expect(pickTopOrderRefs(refs, 0)).toEqual([]);
    expect(refs).toEqual(copy);
  });
});

describe("alertRefsMeta", () => {
  const base: DetectedAlert = {
    type: "shipping-fee-diff",
    dedupeKey: "rolling-30d",
    tag: "finance",
    severity: "medium",
    title: "3 đơn bị sàn trừ THÊM phí ship",
    summary: "…",
    payload: { kind: "navigate", href: "/warehouse/shipping-alerts", label: "Mở Đối soát phí ship" },
  };

  it("không có đơn → null (cảnh báo gian/ads/kho giữ nguyên như cũ)", () => {
    expect(alertRefsMeta(base)).toBeNull();
    expect(alertRefsMeta({ ...base, refs: [] })).toBeNull();
  });

  it("có đơn → mang mã + tổng số thật + đích xử lý của chính cảnh báo", () => {
    const refs = [ref("X1", 50_000), ref("X2", 5_950)];
    expect(alertRefsMeta({ ...base, refs, refTotal: 3 })).toEqual({
      refs,
      refTotal: 3,
      href: "/warehouse/shipping-alerts",
      label: "Mở Đối soát phí ship",
    });
  });

  it("thiếu refTotal thì lấy số mã đính kèm", () => {
    const refs = [ref("X1", 1)];
    expect(alertRefsMeta({ ...base, refs })?.refTotal).toBe(1);
  });
});
