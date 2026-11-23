import { describe, expect, it } from "vitest";
import { ReturnStatus } from "@prisma/client";
import {
  COMPLAINT_WINDOW_HOURS,
  complaintDueOf,
  complaintDuePatch,
  isEndOfDayVn,
  shopeeSellerDue,
  type ComplaintDueOrder,
} from "../return-complaint-due";
import { CANCELLED_AFTER_SHIP } from "../../integrations/cancelled-after-ship";

// Số lấy từ payload THẬT (scripts/return-due-date-probe.ts chạy trên prod 23/11/2026, gian Shopee 66 yêu cầu):
//   · kiện trên đường: return_seller_due_date = 1795885199 = 28/11 23:59:59 giờ VN (hạn tạm);
//   · kiện đã về:      return_seller_due_date = 1795153025 = 20/11 12:37:05 (kiện về 18/11 12:37:05 + 48 giờ).
const PROVISIONAL_SEC = 1_795_885_199;
const FINAL_SEC = 1_795_153_025;
const HOUR = 3_600_000;

describe("isEndOfDayVn — dấu hiệu hạn TẠM của Shopee", () => {
  it("23:59:59 giờ VN → true; giờ lẻ → false; 0 / rác → false", () => {
    expect(isEndOfDayVn(PROVISIONAL_SEC)).toBe(true);
    expect(isEndOfDayVn(FINAL_SEC)).toBe(false);
    expect(isEndOfDayVn(PROVISIONAL_SEC + 1)).toBe(false); // 00:00:00 hôm sau
    expect(isEndOfDayVn(0)).toBe(false);
    expect(isEndOfDayVn(Number.NaN)).toBe(false);
  });
});

describe("shopeeSellerDue — đọc return_seller_due_date", () => {
  const NOTHING = { returnComplaintDueAt: null, returnComplaintDueProvisional: false };

  it("kiện trên đường → hạn tạm; kiện đã về → hạn chốt", () => {
    expect(shopeeSellerDue(PROVISIONAL_SEC, NOTHING)).toEqual({
      dueAt: new Date(PROVISIONAL_SEC * 1000),
      provisional: true,
    });
    expect(shopeeSellerDue(FINAL_SEC, NOTHING)).toEqual({ dueAt: new Date(FINAL_SEC * 1000), provisional: false });
  });

  it("sàn trả 0 / trống (khách chưa gửi): chưa lưu gì → giữ nguyên", () => {
    expect(shopeeSellerDue(0, NOTHING)).toBe("keep");
    expect(shopeeSellerDue(undefined, NOTHING)).toBe("keep");
    expect(shopeeSellerDue(null, {})).toBe("keep");
  });

  it("sàn trả 0 khi đang lưu hạn TẠM → xóa; đang lưu hạn CHỐT → giữ", () => {
    expect(
      shopeeSellerDue(0, { returnComplaintDueAt: new Date(PROVISIONAL_SEC * 1000), returnComplaintDueProvisional: true })
    ).toBeNull();
    expect(
      shopeeSellerDue(0, { returnComplaintDueAt: new Date(FINAL_SEC * 1000), returnComplaintDueProvisional: false })
    ).toBe("keep");
  });
});

describe("complaintDuePatch — chỉ ghi khi đổi", () => {
  const due = new Date(FINAL_SEC * 1000);

  it("chưa lưu gì → ghi hạn; cờ tạm chỉ ghi khi khác mặc định", () => {
    expect(complaintDuePatch({ dueAt: due, provisional: false }, {})).toEqual({ returnComplaintDueAt: due });
    expect(complaintDuePatch({ dueAt: due, provisional: true }, {})).toEqual({
      returnComplaintDueAt: due,
      returnComplaintDueProvisional: true,
    });
  });

  it("đã khớp → không ghi gì (idempotent)", () => {
    expect(
      complaintDuePatch(
        { dueAt: new Date(due.getTime()), provisional: false },
        { returnComplaintDueAt: due, returnComplaintDueProvisional: false }
      )
    ).toEqual({});
  });

  it("hạn tạm → kiện về, sàn đặt lại hạn chốt: ghi hạn mới + hạ cờ tạm", () => {
    expect(
      complaintDuePatch(
        { dueAt: due, provisional: false },
        { returnComplaintDueAt: new Date(PROVISIONAL_SEC * 1000), returnComplaintDueProvisional: true }
      )
    ).toEqual({ returnComplaintDueAt: due, returnComplaintDueProvisional: false });
  });

  it("null = xóa hạn đang lưu; chưa lưu thì không ghi; keep = không đụng", () => {
    expect(complaintDuePatch(null, { returnComplaintDueAt: due, returnComplaintDueProvisional: true })).toEqual({
      returnComplaintDueAt: null,
      returnComplaintDueProvisional: false,
    });
    expect(complaintDuePatch(null, {})).toEqual({});
    expect(complaintDuePatch("keep", { returnComplaintDueAt: due })).toEqual({});
  });
});

describe("complaintDueOf — hạn để hiện: hạn sàn trả trước, thiếu thì tính theo luật", () => {
  const ARRIVED = new Date("2026-11-22T05:20:00.000Z");
  const SCANNED = new Date("2026-11-22T08:16:00.000Z");
  const order = (over: Partial<ComplaintDueOrder>): ComplaintDueOrder => ({
    platform: "SHOPEE",
    returnStatus: ReturnStatus.AWAITING,
    returnedAt: null,
    returnDeliveredAt: null,
    platformReturnStatus: "PROCESSING",
    returnTrackingCode: "SPXVN0001",
    returnComplaintDueAt: null,
    returnComplaintDueProvisional: false,
    ...over,
  });

  it.each([ReturnStatus.NONE, ReturnStatus.RECEIVED_INTACT, ReturnStatus.CLAIM_SETTLED, ReturnStatus.WRITTEN_OFF])(
    "ca đã đóng (%s) → không cần hạn, kể cả khi còn lưu hạn sàn",
    (returnStatus) => {
      expect(complaintDueOf(order({ returnStatus, returnComplaintDueAt: ARRIVED }))).toEqual({ state: "NOT_NEEDED" });
    }
  );

  it("có hạn sàn trả → dùng nguyên văn, phân biệt chốt / tạm", () => {
    const due = new Date(FINAL_SEC * 1000);
    expect(complaintDueOf(order({ returnComplaintDueAt: due }))).toEqual({
      state: "DUE",
      dueAt: due,
      source: "platform",
      failedDelivery: false,
      windowHours: null,
    });
    expect(
      complaintDueOf(order({ returnComplaintDueAt: due, returnComplaintDueProvisional: true }))
    ).toMatchObject({ state: "DUE", source: "platform_provisional" });
  });

  it("hạn sàn trả thắng mốc tự tính, kể cả khi kho đã báo hỏng", () => {
    const due = new Date(FINAL_SEC * 1000);
    expect(
      complaintDueOf(
        order({ returnStatus: ReturnStatus.DAMAGED, returnedAt: SCANNED, returnDeliveredAt: ARRIVED, returnComplaintDueAt: due })
      )
    ).toMatchObject({ state: "DUE", dueAt: due, source: "platform" });
  });

  it("kiện chưa về, sàn chưa cho hạn → chưa bắt đầu tính", () => {
    expect(complaintDueOf(order({}))).toEqual({ state: "NOT_STARTED", failedDelivery: false });
    expect(complaintDueOf(order({ platformReturnStatus: CANCELLED_AFTER_SHIP, returnTrackingCode: null }))).toEqual({
      state: "NOT_STARTED",
      failedDelivery: true,
    });
  });

  it("không hạn sàn, có mốc SÀN báo kiện về → luật 48 giờ, nguồn rule", () => {
    expect(complaintDueOf(order({ platform: "TIKTOK", returnDeliveredAt: ARRIVED }))).toEqual({
      state: "DUE",
      dueAt: new Date(ARRIVED.getTime() + 48 * HOUR),
      source: "rule",
      failedDelivery: false,
      windowHours: 48,
    });
  });

  it("chỉ có giờ KHO quét → ước tính (hạn sàn có thể sớm hơn)", () => {
    expect(
      complaintDueOf(order({ platform: "LAZADA", returnStatus: ReturnStatus.RECEIVED, returnedAt: SCANNED }))
    ).toEqual({
      state: "DUE",
      dueAt: new Date(SCANNED.getTime() + 48 * HOUR),
      source: "estimate",
      failedDelivery: false,
      windowHours: 48,
    });
  });

  it("mốc sàn ghi SAU giờ kho quét (Shopee ghi bằng giờ đồng bộ) → không tin mốc sàn, tính từ kho = ước tính", () => {
    const later = new Date(SCANNED.getTime() + 10 * 60_000);
    expect(
      complaintDueOf(order({ returnStatus: ReturnStatus.RECEIVED, returnedAt: SCANNED, returnDeliveredAt: later }))
    ).toMatchObject({ state: "DUE", dueAt: new Date(SCANNED.getTime() + 48 * HOUR), source: "estimate" });
  });

  it.each([
    ["SHOPEE", 7 * 24],
    ["LAZADA", 7 * 24],
    ["TIKTOK", 40 * 24],
  ])("kiện giao thất bại %s → luật %i giờ từ lúc kho nhận", (platform, hours) => {
    expect(COMPLAINT_WINDOW_HOURS[platform].failedDelivery).toBe(hours);
    expect(
      complaintDueOf(
        order({
          platform,
          returnStatus: ReturnStatus.DAMAGED,
          returnedAt: SCANNED,
          platformReturnStatus: CANCELLED_AFTER_SHIP,
          returnTrackingCode: null,
        })
      )
    ).toEqual({
      state: "DUE",
      dueAt: new Date(SCANNED.getTime() + hours * HOUR),
      source: "estimate",
      failedDelivery: true,
      windowHours: hours,
    });
  });

  it("sàn không có luật (đơn ngoài sàn) → không đoán", () => {
    expect(
      complaintDueOf(order({ platform: "OFFLINE", returnStatus: ReturnStatus.RECEIVED, returnedAt: SCANNED }))
    ).toEqual({ state: "UNKNOWN", failedDelivery: false });
  });

  it("Lazada báo kiện đã về (RTM_RECEIVE_ITEM) mà không có mốc giờ nào → không đoán", () => {
    expect(
      complaintDueOf(order({ platform: "LAZADA", platformReturnStatus: "RTM_RECEIVE_ITEM", returnTrackingCode: null }))
    ).toEqual({ state: "UNKNOWN", failedDelivery: false });
  });
});
