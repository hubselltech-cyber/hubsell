import { describe, expect, it } from "vitest";
import { ReturnStatus } from "@prisma/client";
import {
  BULK_PROCESS_FROM,
  BULK_RECEIVE_FROM,
  RETURN_BULK_MAX,
  appendReturnNote,
  parseBulkIds,
} from "../return-bulk";

describe("parseBulkIds — danh sách đơn đang tích trên một trang (anh Trung 13/11/2026)", () => {
  it("nhận mảng id, bỏ trùng và khoảng trắng thừa", () => {
    expect(parseBulkIds(["a", " b ", "a"])).toEqual(["a", "b"]);
  });

  it("từ chối khi không phải mảng, rỗng, hoặc có phần tử không phải chuỗi", () => {
    expect(parseBulkIds(undefined)).toBeNull();
    expect(parseBulkIds("a")).toBeNull();
    expect(parseBulkIds([])).toBeNull();
    expect(parseBulkIds(["a", 1])).toBeNull();
    expect(parseBulkIds(["a", "  "])).toBeNull();
  });

  it("trần = cỡ trang lớn nhất (100 đơn): đủ 100 thì nhận, 101 thì từ chối", () => {
    const ids = Array.from({ length: RETURN_BULK_MAX }, (_, i) => `id-${i}`);
    expect(parseBulkIds(ids)).toHaveLength(RETURN_BULK_MAX);
    expect(parseBulkIds([...ids, "them-1"])).toBeNull();
  });
});

describe("trạng thái được thao tác hàng loạt", () => {
  it("Nhận hàng chỉ áp cho đơn Chờ hàng về", () => {
    expect(BULK_RECEIVE_FROM).toEqual([ReturnStatus.AWAITING]);
  });

  it("Nhập kho / Báo hỏng áp cho Chờ hàng về + Đã nhận, không đụng đơn đã xử lý xong", () => {
    expect(new Set(BULK_PROCESS_FROM)).toEqual(
      new Set([ReturnStatus.AWAITING, ReturnStatus.RECEIVED])
    );
    for (const done of [
      ReturnStatus.NONE,
      ReturnStatus.RECEIVED_INTACT,
      ReturnStatus.DAMAGED,
      ReturnStatus.CLAIM_SETTLED,
      ReturnStatus.WRITTEN_OFF,
    ]) {
      expect(BULK_PROCESS_FROM).not.toContain(done);
    }
  });
});

describe("appendReturnNote — ghi chú mới nối sau ghi chú cũ", () => {
  it("giữ ghi chú cũ, nối lý do rồi ghi chú", () => {
    expect(appendReturnNote("hộp bẹp", "Hỏng / vỡ", "lô 13/11")).toBe(
      "hộp bẹp · Hỏng / vỡ · lô 13/11"
    );
  });

  it("bỏ phần rỗng; không có gì thì trả null", () => {
    expect(appendReturnNote(null, "", "  ", undefined)).toBeNull();
    expect(appendReturnNote(null, "Thiếu hàng")).toBe("Thiếu hàng");
    expect(appendReturnNote("cũ", undefined, " ")).toBe("cũ");
  });
});
