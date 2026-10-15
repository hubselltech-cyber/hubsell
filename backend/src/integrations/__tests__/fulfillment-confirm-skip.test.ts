// ============================================================
// CÂU 409 KHI CHUẨN BỊ HÀNG KHÔNG CÒN ĐƠN NÀO (15/10/2026) — sự cố bấm lần 2
// sau khi lượt 1 đã được sàn nhận: câu báo phải nói rõ đơn đã rời Chờ xử lý,
// không giấu nhóm nào, và giữ nguyên câu riêng cho mẻ toàn đơn chưa thanh toán.
// Hàm thuần — không DB, không sàn.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  CANCELLED_REASON,
  LEFT_PENDING_REASON,
  NOT_FOUND_REASON,
  countSkipReasons,
  describeNoReadyOrders,
} from "../../services/fulfillment/confirm-skip";
import { UNPAID_REASON } from "../../services/fulfillment/types";

const row = (reason: string, n: number) => Array.from({ length: n }, (_, i) => ({ orderCode: `D${i}`, reason }));

describe("describeNoReadyOrders", () => {
  it("toàn đơn chưa thanh toán → giữ câu riêng (sự cố 09/09)", () => {
    const r = describeNoReadyOrders(row(UNPAID_REASON, 5));
    expect(r.error).toBe("Loại 5 đơn chưa chuẩn bị vì khách chưa thanh toán — sàn chưa cho sắp xếp vận chuyển");
    expect(r.counts.unpaid).toBe(5);
  });

  it("30 đơn đã rời Chờ xử lý (bấm lần 2 sau khi sàn đã nhận) → nói rõ + bảo tải lại", () => {
    const r = describeNoReadyOrders(row(LEFT_PENDING_REASON, 30));
    expect(r.error).toContain("30 đơn đã rời trạng thái Chờ xử lý");
    expect(r.error).toContain("sàn đã nhận ở lượt chuẩn bị trước");
    expect(r.error).toContain("tải lại danh sách");
    expect(r.error).not.toContain("·");
  });

  it("trộn nhiều lý do → ưu tiên đã rời Chờ xử lý, đuôi liệt kê phần còn lại", () => {
    const r = describeNoReadyOrders([
      ...row(LEFT_PENDING_REASON, 3),
      ...row(UNPAID_REASON, 2),
      ...row(CANCELLED_REASON, 1),
      ...row(NOT_FOUND_REASON, 1),
      { orderCode: "X", reason: "Lý do lạ" },
    ]);
    expect(r.error).toMatch(/^3 đơn đã rời trạng thái Chờ xử lý/);
    expect(r.error).toContain("2 đơn khách chưa thanh toán");
    expect(r.error).toContain("1 đơn đã hủy");
    expect(r.error).toContain("1 đơn không tìm thấy hoặc ngoài quyền");
    expect(r.error).toContain("1 đơn bị bỏ qua vì lý do khác");
  });

  it("không có đơn rời Chờ xử lý (chỉ hủy + không tìm thấy) → câu chung kèm đuôi", () => {
    const r = describeNoReadyOrders([...row(CANCELLED_REASON, 2), ...row(NOT_FOUND_REASON, 1)]);
    expect(r.error).toMatch(/^Không có đơn nào ở trạng thái Chờ xử lý để chuẩn bị · 2 đơn đã hủy · 1 đơn không tìm thấy/);
  });

  it("danh sách rỗng → câu chung, không đuôi", () => {
    expect(describeNoReadyOrders([]).error).toBe("Không có đơn nào ở trạng thái Chờ xử lý để chuẩn bị");
    expect(countSkipReasons([])).toEqual({ unpaid: 0, leftPending: 0, cancelled: 0, notFound: 0, other: 0 });
  });
});
