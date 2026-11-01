import { describe, expect, it } from "vitest";
import { ShippingStatus } from "@prisma/client";
import {
  decidePackingScan,
  groupByCarrier,
  handoverSheetCode,
  type PackingScanInput,
} from "../packing-scan";

const base: PackingScanInput = {
  shippingStatus: ShippingStatus.PROCESSED,
  packingDoneAt: null,
  handoverSheetId: null,
  labelPrintedAt: new Date("2026-11-01T02:00:00Z"),
  cancelRequestedAt: null,
};

describe("decidePackingScan — bước Đã đóng gói", () => {
  it("đơn Đã xử lý, đã in, chưa quét → ghi, không cảnh báo", () => {
    expect(decidePackingScan(base)).toEqual({ action: "mark", warnings: [] });
  });

  it("đơn ĐÃ HỦY → chặn cứng, lý do CANCELLED (mục đích chính của bước quét)", () => {
    const d = decidePackingScan({
      ...base,
      shippingStatus: ShippingStatus.CANCELLED,
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toBe("CANCELLED");
  });

  it("đơn hủy mà trước đó đã quét rồi vẫn phải chặn (hủy sau khi gói)", () => {
    const d = decidePackingScan({
      ...base,
      shippingStatus: ShippingStatus.CANCELLED,
      packingDoneAt: new Date(),
    });
    expect(d).toMatchObject({ action: "reject", reason: "CANCELLED" });
  });

  it("đơn Chờ xử lý (chưa chuẩn bị hàng) → chặn NOT_CONFIRMED", () => {
    expect(
      decidePackingScan({ ...base, shippingStatus: ShippingStatus.PENDING }),
    ).toMatchObject({
      action: "reject",
      reason: "NOT_CONFIRMED",
    });
  });

  it("đơn Đã giao → chặn DELIVERED", () => {
    expect(
      decidePackingScan({ ...base, shippingStatus: ShippingStatus.DELIVERED }),
    ).toMatchObject({
      action: "reject",
      reason: "DELIVERED",
    });
  });

  it("đã quét trước đó, chưa lên biên bản → báo trùng, không ghi lại", () => {
    const d = decidePackingScan({ ...base, packingDoneAt: new Date() });
    expect(d.action).toBe("already");
  });

  it("đã nằm trong biên bản bàn giao → chặn ON_HANDOVER_SHEET", () => {
    const d = decidePackingScan({
      ...base,
      packingDoneAt: new Date(),
      handoverSheetId: "hs1",
    });
    expect(d).toMatchObject({ action: "reject", reason: "ON_HANDOVER_SHEET" });
  });

  it("khách đang xin hủy → vẫn ghi nhưng cảnh báo CANCEL_REQUESTED (cảnh báo, không khóa cứng)", () => {
    const d = decidePackingScan({ ...base, cancelRequestedAt: new Date() });
    expect(d.action).toBe("mark");
    expect(d.warnings).toEqual(["CANCEL_REQUESTED"]);
  });

  it("chưa in phiếu → ghi + cảnh báo NOT_PRINTED", () => {
    const d = decidePackingScan({ ...base, labelPrintedAt: null });
    expect(d).toEqual({ action: "mark", warnings: ["NOT_PRINTED"] });
  });

  it("sàn đã báo Đang giao (shipper quét trước) → vẫn ghi để lên biên bản + cảnh báo", () => {
    const d = decidePackingScan({
      ...base,
      shippingStatus: ShippingStatus.SHIPPING,
    });
    expect(d).toEqual({ action: "mark", warnings: ["ALREADY_SHIPPING"] });
  });

  it("nhiều cảnh báo xếp theo thứ tự cố định: xin hủy → chưa in → đang giao", () => {
    const d = decidePackingScan({
      ...base,
      shippingStatus: ShippingStatus.SHIPPING,
      labelPrintedAt: null,
      cancelRequestedAt: new Date(),
    });
    expect(d.warnings).toEqual([
      "CANCEL_REQUESTED",
      "NOT_PRINTED",
      "ALREADY_SHIPPING",
    ]);
  });
});

describe("handoverSheetCode", () => {
  it("BG-yyMMdd theo giờ VN + 4 ký tự cuối id viết hoa", () => {
    // 01/11/2026 23:30 UTC = 02/11/2026 06:30 VN → ngày phải là 02/11
    expect(
      handoverSheetCode("cmh1abcdxyz9", new Date("2026-11-01T23:30:00Z")),
    ).toBe("BG-261102-XYZ9");
  });
});

describe("groupByCarrier", () => {
  it("mỗi hãng một nhóm, null gom riêng, giữ thứ tự gặp đầu", () => {
    const g = groupByCarrier([
      { id: 1, carrier: "SPX" },
      { id: 2, carrier: null },
      { id: 3, carrier: "GHN" },
      { id: 4, carrier: "SPX" },
    ]);
    expect([...g.keys()]).toEqual(["SPX", "", "GHN"]);
    expect(g.get("SPX")?.map((o) => o.id)).toEqual([1, 4]);
    expect(g.get("")?.map((o) => o.id)).toEqual([2]);
  });
});
