// Luật giữ / tự xóa video theo trạng thái đơn (lib/pack-video-retention.ts) — bản anh Trung chốt 25/11/2026:
// xóa sau khi HẾT HẠN 3 ngày, sàn ngày quay + 7, trần ngày quay + 60. Mỗi luật L1–L7, mỗi sàn.
import { describe, expect, it } from "vitest";
import {
  addDays,
  decideRetention,
  hardCapOf,
  hasReturnSignal,
  isDue,
  isSeenAnchoredRule,
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
  complaintDue: { state: "NOT_NEEDED" },
  ...o,
});

describe("số anh Trung chốt 25/11/2026", () => {
  it("hết hạn + 3 ngày, trần 60 ngày", () => {
    expect(RETENTION_DAYS.AFTER_DEADLINE).toBe(3);
    expect(RETENTION_DAYS.HARD_CAP).toBe(60);
    expect(hardCapOf("2026-11-10")).toBe("2027-01-09");
  });
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

describe("L4 — đã giao, không hoàn: hết hạn người mua trả hàng (giao + 15, Lazada + 30) + 3 ngày", () => {
  it.each([
    ["SHOPEE", RETENTION_DAYS.BUYER_RETURN_WINDOW, "2026-12-01"],
    ["TIKTOK", RETENTION_DAYS.BUYER_RETURN_WINDOW, "2026-12-01"],
    ["LAZADA", RETENTION_DAYS.BUYER_RETURN_WINDOW_LAZADA, "2026-12-16"],
  ])("%s → giao 13/11 + %i + 3 ngày", (platform, window, expected) => {
    const d = decideRetention(video(), order({ platform }), NOW);
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: expected, rule: "L4" });
    expect(addDays("2026-11-13", window + RETENTION_DAYS.AFTER_DEADLINE)).toBe(expected);
  });

  it("Lazada: sổ không phân biệt LazMall → mọi gian Lazada dùng mốc dài 30 ngày", () => {
    expect(RETENTION_DAYS.BUYER_RETURN_WINDOW_LAZADA).toBeGreaterThanOrEqual(30);
  });

  it("đã giao nhưng thiếu mốc giao → CHỜ, không đoán", () => {
    expect(decideRetention(video(), order({ deliveredAt: null }), NOW)).toEqual({ kind: "WAIT" });
  });

  it("mốc giao tính theo NGÀY VN (giao 23:30 VN ngày 13 vẫn là ngày 13)", () => {
    const d = decideRetention(video(), order({ deliveredAt: new Date("2026-11-13T16:30:00.000Z") }), NOW);
    expect(d).toMatchObject({ deleteAfter: "2026-12-01" });
  });

  it("đã đối soát KHÔNG phải mốc xóa: luật không đọc cột đối soát nào", () => {
    // Kiểu RetentionOrder không có isSettled / settledAt — đổi kiểu mà thêm vào là phải sửa test này.
    const keys = Object.keys(order());
    expect(keys).not.toContain("isSettled");
    expect(keys).not.toContain("settledAt");
  });
});

describe("SÀN — không xóa video nào trước ngày quay + 7 ngày", () => {
  it("quay hôm nay cho đơn đã giao từ tháng trước: hạn theo đơn ở quá khứ → lấy ngày quay + 7 (ca thật tuần chạy bóng)", () => {
    const d = decideRetention(
      video({ recordedDate: TODAY }),
      order({ deliveredAt: new Date("2026-10-13T05:00:00.000Z") }),
      NOW
    );
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-25", rule: "L4" });
  });

  it("hủy ngang ngay sau khi quay: hôm nay + 1 < ngày quay + 7 → lấy ngày quay + 7", () => {
    const d = decideRetention(
      video({ recordedDate: "2026-11-17" }),
      order({ shippingStatus: "CANCELLED", deliveredAt: null, stockShippedAt: null }),
      NOW
    );
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-24", rule: "L2" });
  });
});

describe("đơn chưa xong → CHỜ", () => {
  it.each(["PENDING", "PROCESSED", "SHIPPING"])("%s", (shippingStatus) => {
    expect(decideRetention(video(), order({ shippingStatus, deliveredAt: null }), NOW)).toEqual({ kind: "WAIT" });
  });
});

describe("L1 — video đóng hàng không khớp đơn: ngày quay + 7", () => {
  it("xóa ở ngày quay + 7", () => {
    expect(decideRetention(video({ orderId: null }), null, NOW)).toEqual({
      kind: "DELETE_AFTER",
      deleteAfter: "2026-11-17",
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

  it("hủy khi kiện đã rời kho, chưa có dấu hiệu hoàn → GIỮ chờ kiện quay về", () => {
    const d = decideRetention(video(), order({ shippingStatus: "CANCELLED", deliveredAt: null }), NOW);
    expect(d).toEqual({ kind: "HOLD", reason: "PARCEL_RETURNING" });
  });

  it("L3 kiện quay đầu đã về kho nguyên vẹn → ngày nhận + 3", () => {
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
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-23", rule: "L3" });
  });

  it("kiện quay đầu về kho HỎNG → GIỮ (khiếu nại hãng vận chuyển)", () => {
    const d = decideRetention(
      video(),
      order({ shippingStatus: "CANCELLED", deliveredAt: null, returnStatus: "DAMAGED", returnedAt: NOW }),
      NOW
    );
    expect(d).toEqual({ kind: "HOLD", reason: "RETURN_DAMAGED" });
  });
});

describe("L7 — đơn hoàn còn mở: hết HẠN KHIẾU NẠI + 3 ngày", () => {
  const due = (iso: string, provisional = false): RetentionOrder["complaintDue"] => ({
    state: "DUE",
    dueAt: new Date(iso),
    provisional,
  });

  it.each(["AWAITING", "RECEIVED"])("%s có hạn đã chốt 20/11 14:30 VN → xóa 23/11", (returnStatus) => {
    const d = decideRetention(video(), order({ returnStatus, complaintDue: due("2026-11-20T07:30:00.000Z") }), NOW);
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-23", rule: "L7" });
  });

  it("hạn tính theo NGÀY VN (hạn 23:59 VN ngày 20 vẫn là ngày 20)", () => {
    const d = decideRetention(
      video(),
      order({ returnStatus: "AWAITING", complaintDue: due("2026-11-20T16:59:59.000Z") }),
      NOW
    );
    expect(d).toMatchObject({ deleteAfter: "2026-11-23" });
  });

  it("hạn đã qua từ lâu (kiện về mà kho không quét) → không sớm hơn sàn ngày quay + 7", () => {
    const d = decideRetention(
      video({ recordedDate: "2026-11-15" }),
      order({ returnStatus: "AWAITING", complaintDue: due("2026-11-12T03:00:00.000Z") }),
      NOW
    );
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-22", rule: "L7" });
  });

  it("hạn TẠM của sàn (kiện còn trên đường) → GIỮ, chưa dùng làm mốc xóa", () => {
    const d = decideRetention(
      video(),
      order({ returnStatus: "AWAITING", complaintDue: due("2026-11-20T16:59:59.000Z", true) }),
      NOW
    );
    expect(d).toEqual({ kind: "HOLD", reason: "RETURN_OPEN" });
  });

  it.each(["NOT_STARTED", "UNKNOWN"] as const)("hạn %s (kiện chưa về / thiếu mốc) → GIỮ", (state) => {
    const d = decideRetention(video(), order({ returnStatus: "AWAITING", complaintDue: { state } }), NOW);
    expect(d).toEqual({ kind: "HOLD", reason: "RETURN_OPEN" });
  });

  it("kho báo hỏng → GIỮ dù hạn khiếu nại đã qua (video là bằng chứng đang dùng)", () => {
    const d = decideRetention(
      video(),
      order({ returnStatus: "DAMAGED", complaintDue: due("2026-11-12T03:00:00.000Z") }),
      NOW
    );
    expect(d).toEqual({ kind: "HOLD", reason: "RETURN_DAMAGED" });
  });

  it("video KHUI của đơn hoàn có hạn → cùng luật L7", () => {
    const d = decideRetention(
      video({ kind: "UNBOX" }),
      order({ returnStatus: "RECEIVED", complaintDue: due("2026-11-20T07:30:00.000Z") }),
      NOW
    );
    expect(d).toMatchObject({ deleteAfter: "2026-11-23", rule: "L7" });
  });
});

describe("mọi dấu hiệu hoàn đều đưa video sang nhánh đơn hoàn (không xóa theo L4)", () => {
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

  it.each(signals)("%s, chưa có hạn khiếu nại → GIỮ", (_label, patch) => {
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
});

describe("L5 — đơn hoàn đã xử lý xong: lúc ca đóng + 3 ngày", () => {
  it.each(["RECEIVED_INTACT", "CLAIM_SETTLED", "WRITTEN_OFF"])(
    "%s → hôm nay + 3 ngày (không sớm hơn lúc thấy ca đóng)",
    (returnStatus) => {
      const d = decideRetention(
        video(),
        order({ returnStatus, returnRequestedAt: new Date("2026-11-14T00:00:00Z"), returnedAt: new Date("2026-11-16T00:00:00Z") }),
        NOW
      );
      expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-21", rule: "L5" });
    }
  );

  it("ngày kho nhận ở TƯƠNG LAI so với lúc xét → tính từ ngày nhận", () => {
    const d = decideRetention(
      video(),
      order({ returnStatus: "RECEIVED_INTACT", returnRequestedAt: NOW, returnedAt: new Date("2026-11-25T03:00:00Z") }),
      NOW
    );
    expect(d).toMatchObject({ deleteAfter: "2026-11-28", rule: "L5" });
  });

  it("L2 / L3 / L5 tính từ lúc THẤY — lúc tới hạn tính lại không được coi là hạn dời", () => {
    expect(["L2", "L3", "L5"].every(isSeenAnchoredRule)).toBe(true);
    expect(["L1", "L4", "L6", "L7", null, undefined].some(isSeenAnchoredRule)).toBe(false);
  });
});

describe("L6 — trần 60 ngày từ ngày quay, áp cho MỌI video", () => {
  it("L4 vượt trần thì lấy trần", () => {
    const d = decideRetention(
      video({ recordedDate: "2026-08-01" }),
      order({ platform: "LAZADA", deliveredAt: new Date("2026-09-20T03:00:00Z") }),
      NOW
    );
    expect(d).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-09-30", rule: "L6" });
  });

  it("ca hoàn ĐANG MỞ: còn xa trần thì GIỮ, sát trần 3 ngày thì chốt hạn = trần (anh Trung 25/11)", () => {
    // Quay 21/09 → trần 20/11. Hôm nay 18/11 = trần − 2 → đã vào vùng báo trước.
    const near = decideRetention(video({ recordedDate: "2026-09-21" }), order({ returnStatus: "AWAITING" }), NOW);
    expect(near).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-11-20", rule: "L6" });
    // Quay 25/09 → trần 24/11, hôm nay = trần − 6 → còn GIỮ.
    const far = decideRetention(video({ recordedDate: "2026-09-25" }), order({ returnStatus: "AWAITING" }), NOW);
    expect(far).toEqual({ kind: "HOLD", reason: "RETURN_OPEN" });
  });

  it.each<[string, RetentionVideo, RetentionOrder | null]>([
    ["kho báo hỏng", video({ recordedDate: "2026-07-01" }), order({ returnStatus: "DAMAGED" })],
    ["kiện hủy đang quay đầu", video({ recordedDate: "2026-07-01" }), order({ shippingStatus: "CANCELLED", deliveredAt: null })],
    ["đơn không bao giờ giao / hủy trên sổ", video({ recordedDate: "2026-07-01" }), order({ shippingStatus: "SHIPPING", deliveredAt: null })],
    ["video khui chưa khớp đơn", video({ recordedDate: "2026-07-01", kind: "UNBOX", orderId: null }), null],
    ["có mã đơn mà đơn không còn đọc được", video({ recordedDate: "2026-07-01" }), null],
  ])("%s đã quá trần → hạn = trần, không còn giữ vô thời hạn", (_label, v, o) => {
    expect(decideRetention(v, o, NOW)).toEqual({ kind: "DELETE_AFTER", deleteAfter: "2026-08-30", rule: "L6" });
  });
});
