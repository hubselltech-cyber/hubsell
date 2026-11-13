import { describe, expect, it } from "vitest";
import { ReturnStatus } from "@prisma/client";
import { CANCELLED_AFTER_SHIP } from "../../integrations/cancelled-after-ship";
import { returnShippingOf } from "../return-shipping";

const BASE = {
  returnStatus: ReturnStatus.AWAITING,
  returnedAt: null,
  returnDeliveredAt: null,
  platformReturnStatus: null,
  returnTrackingCode: null,
};
const T1 = new Date("2026-11-10T03:00:00Z");
const T2 = new Date("2026-11-12T03:00:00Z");

describe("returnShippingOf — trạng thái vận chuyển chiều hoàn (anh Trung 13/11/2026)", () => {
  it("sàn báo kiện đã về mà kho chưa quét → RETURNED, nguồn sàn, có mốc giờ", () => {
    const r = returnShippingOf({ ...BASE, platformReturnStatus: "ACCEPTED", returnDeliveredAt: T1 });
    expect(r).toEqual({ state: "RETURNED", at: T1, source: "platform", failedDelivery: false });
  });

  it("sàn báo về TRƯỚC khi kho quét → vẫn lấy mốc sàn", () => {
    const r = returnShippingOf({
      ...BASE,
      returnStatus: ReturnStatus.RECEIVED,
      returnedAt: T2,
      returnDeliveredAt: T1,
    });
    expect(r.source).toBe("platform");
    expect(r.at).toBe(T1);
  });

  it("kho quét trước, đồng bộ ghi mốc sàn sau (giờ đồng bộ) → nguồn kho, mốc kho nhận", () => {
    const r = returnShippingOf({
      ...BASE,
      returnStatus: ReturnStatus.RECEIVED_INTACT,
      returnedAt: T1,
      returnDeliveredAt: T2,
    });
    expect(r).toEqual({ state: "RETURNED", at: T1, source: "warehouse", failedDelivery: false });
  });

  it("kho đã nhận kiện giao thất bại, sàn không báo gì → RETURNED nguồn kho, giữ cờ giao thất bại", () => {
    const r = returnShippingOf({
      ...BASE,
      returnStatus: ReturnStatus.DAMAGED,
      returnedAt: T1,
      platformReturnStatus: CANCELLED_AFTER_SHIP,
    });
    expect(r).toEqual({ state: "RETURNED", at: T1, source: "warehouse", failedDelivery: true });
  });

  it("kiện giao thất bại đang chờ về → NO_SIGNAL, không đoán là đang hoàn về", () => {
    const r = returnShippingOf({
      ...BASE,
      platformReturnStatus: CANCELLED_AFTER_SHIP,
      returnTrackingCode: "SPX123",
    });
    expect(r).toEqual({ state: "NO_SIGNAL", at: null, source: null, failedDelivery: true });
  });

  it("đơn chờ về không có trạng thái sàn → NO_SIGNAL", () => {
    expect(returnShippingOf(BASE).state).toBe("NO_SIGNAL");
  });

  it("khách trả hàng: chưa có mã vận đơn hoàn → chờ khách gửi; có mã → đang hoàn về", () => {
    expect(returnShippingOf({ ...BASE, platformReturnStatus: "REQUESTED" }).state).toBe("WAITING_BUYER");
    expect(returnShippingOf({ ...BASE, platformReturnStatus: "AWAITING_BUYER_SHIP" }).state).toBe(
      "WAITING_BUYER"
    );
    expect(
      returnShippingOf({ ...BASE, platformReturnStatus: "PROCESSING", returnTrackingCode: "SPXVN06" }).state
    ).toBe("RETURNING");
  });

  it("TikTok báo khách đã gửi mà chưa có mã vận đơn → vẫn là đang hoàn về", () => {
    expect(returnShippingOf({ ...BASE, platformReturnStatus: "BUYER_SHIPPED_ITEM" }).state).toBe("RETURNING");
  });

  it("Lazada RTM_RECEIVE_ITEM → RETURNED nguồn sàn, không có mốc giờ", () => {
    const r = returnShippingOf({ ...BASE, platformReturnStatus: "RTM_RECEIVE_ITEM", returnTrackingCode: "LZ1" });
    expect(r).toEqual({ state: "RETURNED", at: null, source: "platform", failedDelivery: false });
  });
});
