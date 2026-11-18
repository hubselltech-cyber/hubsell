// Luật giữ / tự xóa video theo trạng thái đơn (lib/pack-video-retention.ts) — mỗi luật L1–L6, mỗi sàn
// (Shopee, TikTok, Lazada / LazMall), và MỌI dấu hiệu hoàn đều phải chặn xóa.
import { describe, expect, it } from "vitest";
import {
  addDays,
  decideRetention,
  hasReturnSignal,
  isDue,
  RETENTION_DAYS,
  vnDateKey,
  type RetentionOrder,
  type RetentionVideo,
} from "../pack-video-retention";

// 18/11/2026 10:00 giờ VN.
const NOW = new Date("2026-11-18T03:00:00.000Z");
const TODAY = "2026-11-18";

const video = (o: Partial<RetentionVideo> = {}): RetentionVideo => ({
  kind: "PACK",
  recordedDate: "2026-11-10",
  orderId: "ord-1",
  ...o,
});

const order = (o: Partial<RetentionOrder> = {}): RetentionOrder => ({
  platform: "SHOPEE",
  shippingStatus: "DELIVERED",
  deliveredAt: new Date("2026-11-13T05:00:00.000Z"), // 13/11 12:00 VN
  stockShippedAt: new Date("2026-11-11T02:00:00.000Z"),
  returnStatus: "NONE",
  returnRequestedAt: null,
  returnedAt: null,
  returnDeliveredAt: null,
  refundedAmount: 0,
  platformRefundAmount: 0,
  platformReturnStatus: null,
  returnSolution: null,
  ...o,
});

describe("tiện ích ngày", () => {
  it("vnDateKey đổi sang ngày lịch giờ VN (23:30 UTC = hôm sau ở VN)", () => {
    expect(vnDateKey(new Date("2026-11-17T17:30:00.000Z"))).toBe("2026-11-18");
    expect(vnDateKey(new Date("2026-11-17T16:59:00.000Z"))).toBe("2026-11-17");
  });
  it("addDays qua tháng, qua năm", () => {
    expect(addDays("2026-11-25", 10)).toBe("2026-12-05");
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });
  it("isDue: tới đúng ngày hạn là tới hạn, hôm trước chưa", () => {
    expect(isDue(TODAY, NOW)).toBe(true);
    expect(isDue("2026-11-19", NOW)).toBe(false);
  });
});

describe("L4 — đã giao, không hoàn: giao + 20 ngày (Lazada + 35)", () => {
  it.each([
    ["SHOPEE", RETENTION_DAYS.L4_AFTER_DELIVERY, "2026-12-03"],
    ["TIKTOK", RETENTION_DAYS.L4_AFTER_DELIVERY, "2026-12-03"],
    ["LAZADA", RETENTION_DAYS.L4_AFTER_DELIVERY_LAZADA, "2026-12-18"],
  ])("%s → giao 13/11 + %i ngày", (platform, days, expected) => {
    const d = decideRetention(video(), order({ platform }), NOW);
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: expected, rule: "L4" });
    expect(addDays("2026-11-13", days)).toBe(expected);
  });

  it("Lazada: sổ không phân biệt LazMall → mọi gian Lazada dùng mốc dài 35 ngày", () => {
    expect(RETENTION_DAYS.L4_AFTER_DELIVERY_LAZADA).toBeGreaterThanOrEqual(30 + 5);
  });

  it("đã giao nhưng thiếu mốc giao → CHỜ, không đoán", () => {
    expect(decideRetention(video(), order({ deliveredAt: null }), NOW)).toEqual({ kind: "WAIT" });
  });

  it("mốc giao tính theo NGÀY VN (giao 23:30 VN ngày 13 vẫn là ngày 13)", () => {
    const d = decideRetention(video(), order({ deliveredAt: new Date("2026-11-13T16:30:00.000Z") }), NOW);
    expect(d).toMatchObject({ deleteAfter: "2026-12-03" });
  });

  it("đã đối soát KHÔNG phải mốc xóa: luật không đọc cột đối soát nào", () => {
    // Kiểu RetentionOrder không có isSettled / settledAt — đổi kiểu mà thêm vào là phải sửa test này.
    const keys = Object.keys(order());
    expect(keys).not.toContain("isSettled");
    expect(keys).not.toContain("settledAt");
  });
});

describe("đơn chưa xong → CHỜ", () => {
  it.each(["PENDING", "PROCESSED", "SHIPPING"])("%s", (shippingStatus) => {
    expect(decideRetention(video(), order({ shippingStatus, deliveredAt: null }), NOW)).toEqual({ kind: "WAIT" });
  });
});

describe("L1 — video đóng hàng không khớp đơn: quay + 3 ngày", () => {
  it("xóa ở ngày quay + 3", () => {
    expect(decideRetention(video({ orderId: null }), null, NOW)).toEqual({
      kind: "DELETE_AFTER",
      deleteAfter: "2026-11-13",
      rule: "L1",
    });
  });
  it("video KHUI chưa khớp đơn → GIỮ (là bằng chứng hàng hoàn)", () => {
    expect(decideRetention(video({ kind: "UNBOX", orderId: null }), null, NOW)).toEqual({
      kind: "HOLD",
      reason: "UNBOX_UNMATCHED",
    });
  });
  it("có mã đơn mà không đọc được đơn → CHỜ, không áp L1", () => {
    expect(decideRetention(video(), null, NOW)).toEqual({ kind: "WAIT" });
  });
});

describe("L2 / L3 — đơn hủy", () => {
  it("L2 hủy ngang (kiện chưa rời kho) → hôm nay + 1 ngày", () => {
    const d = decideRetention(
      video(),
      order({ shippingStatus: "CANCELLED", deliveredAt: null, stockShippedAt: null }),
      NOW
    );
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-19", rule: "L2" });
  });

  it("L3 hủy khi kiện đã rời kho, chưa có dấu hiệu hoàn → GIỮ chờ kiện quay về", () => {
    const d = decideRetention(video(), order({ shippingStatus: "CANCELLED", deliveredAt: null }), NOW);
    expect(d).toEqual({ kind: "HOLD", reason: "PARCEL_RETURNING" });
  });

  it("L3 kiện quay đầu đã về kho nguyên vẹn → ngày nhận + 7", () => {
    const d = decideRetention(
      video(),
      order({
        shippingStatus: "CANCELLED",
        deliveredAt: null,
        returnStatus: "RECEIVED_INTACT",
        returnedAt: new Date("2026-11-20T03:00:00.000Z"),
      }),
      NOW
    );
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-27", rule: "L3" });
  });

  it("L3 kiện quay đầu về kho HỎNG → GIỮ (khiếu nại hãng vận chuyển)", () => {
    const d = decideRetention(
      video(),
      order({ shippingStatus: "CANCELLED", deliveredAt: null, returnStatus: "DAMAGED", returnedAt: NOW }),
      NOW
    );
    expect(d).toEqual({ kind: "HOLD", reason: "RETURN_DAMAGED" });
  });
});

describe("L5 — MỌI dấu hiệu hoàn đều chặn xóa", () => {
  const signals: [string, Partial<RetentionOrder>][] = [
    ["returnStatus AWAITING", { returnStatus: "AWAITING" }],
    ["returnStatus RECEIVED (chưa nhập kho)", { returnStatus: "RECEIVED" }],
    ["có mốc xin hoàn", { returnRequestedAt: NOW }],
    ["kho đã cầm kiện (returnedAt) dù trạng thái chưa đổi", { returnedAt: NOW }],
    ["sàn báo kiện hoàn đã về", { returnDeliveredAt: NOW }],
    ["đã hoàn tiền thật", { refundedAmount: 1 }],
    ["sàn báo số tiền hoàn", { platformRefundAmount: 50_000 }],
    ["sàn có trạng thái hoàn", { platformReturnStatus: "REQUESTED" }],
    ["có giải pháp hoàn (chỉ hoàn tiền)", { returnSolution: "REFUND_ONLY" }],
  ];

  it.each(signals)("%s → GIỮ, không có hạn xóa", (_label, patch) => {
    const o = order(patch);
    expect(hasReturnSignal(o)).toBe(true);
    for (const platform of ["SHOPEE", "TIKTOK", "LAZADA"]) {
      const d = decideRetention(video(), { ...o, platform }, NOW);
      expect(d.kind).toBe("HOLD");
    }
  });

  it("đơn sạch không có dấu hiệu nào", () => {
    expect(hasReturnSignal(order())).toBe(false);
  });

  it("video KHUI của đơn đã giao không hoàn → vẫn GIỮ", () => {
    expect(decideRetention(video({ kind: "UNBOX" }), order(), NOW)).toEqual({ kind: "HOLD", reason: "RETURN_OPEN" });
  });

  it("kho báo hỏng → GIỮ lý do RETURN_DAMAGED", () => {
    expect(decideRetention(video(), order({ returnStatus: "DAMAGED" }), NOW)).toEqual({
      kind: "HOLD",
      reason: "RETURN_DAMAGED",
    });
  });

  it.each(["RECEIVED_INTACT", "CLAIM_SETTLED", "WRITTEN_OFF"])(
    "ca đóng (%s) → hôm nay + 10 ngày (không sớm hơn lúc thấy ca đóng)",
    (returnStatus) => {
      const d = decideRetention(
        video(),
        order({ returnStatus, returnRequestedAt: new Date("2026-11-14T00:00:00Z"), returnedAt: new Date("2026-11-16T00:00:00Z") }),
        NOW
      );
      expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-28", rule: "L5" });
    }
  );

  it("ca đóng có ngày kho nhận ở TƯƠNG LAI so với lúc xét → tính từ ngày nhận", () => {
    const d = decideRetention(
      video(),
      order({ returnStatus: "RECEIVED_INTACT", returnRequestedAt: NOW, returnedAt: new Date("2026-11-25T03:00:00Z") }),
      NOW
    );
    expect(d).toMatchObject({ deleteAfter: "2026-12-05", rule: "L5" });
  });
});

describe("L6 — trần 90 ngày từ ngày quay", () => {
  it("L4 vượt trần thì lấy trần", () => {
    const d = decideRetention(
      video({ recordedDate: "2026-08-01" }),
      order({ platform: "LAZADA", deliveredAt: new Date("2026-10-20T03:00:00Z") }),
      NOW
    );
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-10-30", rule: "L6" });
  });

  it("ca hoàn ĐANG MỞ quá 90 ngày vẫn GIỮ (chặn xóa — chờ anh quyết, mục 19.9)", () => {
    const d = decideRetention(video({ recordedDate: "2026-07-01" }), order({ returnStatus: "AWAITING" }), NOW);
    expect(d.kind).toBe("HOLD");
  });
});
