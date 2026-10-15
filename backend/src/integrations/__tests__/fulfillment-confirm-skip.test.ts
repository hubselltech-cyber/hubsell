// ============================================================
// CÂU 409 KHI CHUẨN BỊ HÀNG KHÔNG CÒN ĐƠN NÀO (15/10/2026) — sự cố bấm lần 2
// sau khi lượt 1 đã được sàn nhận: câu báo phải nói rõ đơn đã rời Chờ xử lý,
// không giấu nhóm nào, và giữ nguyên câu riêng cho mẻ toàn đơn chưa thanh toán.
// Hàm thuần — không DB, không sàn.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  CANCELLED_REASON,
  IN_RUNNING_BATCH_REASON,
  LEFT_PENDING_REASON,
  NOT_FOUND_REASON,
  countSkipReasons,
  describeNoReadyOrders,
  splitByRunningBatches,
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
    expect(countSkipReasons([])).toEqual({
      unpaid: 0,
      leftPending: 0,
      cancelled: 0,
      notFound: 0,
      inRunning: 0,
      other: 0,
    });
  });

  it("đơn đang ở lượt trước (rải ≥2 lượt) → bảo ĐỢI, xét trước 'đã rời Chờ xử lý'", () => {
    const r = describeNoReadyOrders([...row(IN_RUNNING_BATCH_REASON, 10), ...row(LEFT_PENDING_REASON, 20)]);
    expect(r.counts.inRunning).toBe(10);
    expect(r.error).toMatch(/^10 đơn đang được sắp xếp ở lượt chuẩn bị trước — đợi lượt đó xong/);
    expect(r.error).toContain("không bấm lại");
    expect(r.error).toContain("20 đơn đã rời Chờ xử lý");
  });
});

// ------------------------------------------------------------
// Chặn lượt chồng lên lượt đang chạy (sự cố 15/10 08:40: bấm lại sau 6 giây,
// lượt 2 cùng 30 đơn tạo khi lượt 1 còn RUNNING → 20 đơn Shopee bị gọi lại).
// ------------------------------------------------------------
describe("splitByRunningBatches", () => {
  const ids = (n: number, prefix = "o") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it("không có lượt nào đang chạy → mọi đơn tự do, không reattach", () => {
    const r = splitByRunningBatches([], ids(3));
    expect(r.free).toEqual(["o0", "o1", "o2"]);
    expect(r.held.size).toBe(0);
    expect(r.reattachTo).toBeNull();
  });

  it("bấm lại đúng 30 đơn khi lượt trước còn chạy → reattach vào lượt đó, không đơn tự do", () => {
    const r = splitByRunningBatches([{ id: "b1", orderIds: ids(30) }], ids(30));
    expect(r.free).toEqual([]);
    expect(r.held.size).toBe(30);
    expect(r.reattachTo).toBe("b1");
  });

  it("chọn thêm đơn mới ngoài lượt đang chạy → đơn cũ bị giữ, đơn mới tự do, không reattach", () => {
    const r = splitByRunningBatches([{ id: "b1", orderIds: ids(30) }], [...ids(30), "n1", "n2"]);
    expect(r.free).toEqual(["n1", "n2"]);
    expect(r.held.size).toBe(30);
    expect(r.held.get("o0")).toBe("b1");
    expect(r.reattachTo).toBeNull();
  });

  it("đơn bị giữ rải ở hai lượt, không còn đơn tự do → không reattach (route trả 409 bảo đợi)", () => {
    const r = splitByRunningBatches(
      [
        { id: "b1", orderIds: ["a", "b"] },
        { id: "b2", orderIds: ["c"] },
      ],
      ["a", "c"]
    );
    expect(r.free).toEqual([]);
    expect(r.held.get("a")).toBe("b1");
    expect(r.held.get("c")).toBe("b2");
    expect(r.reattachTo).toBeNull();
  });

  it("đơn chọn không thuộc lượt đang chạy (lượt đó xử lý đơn khác) → tự do hết", () => {
    const r = splitByRunningBatches([{ id: "b1", orderIds: ["x", "y"] }], ["a", "b"]);
    expect(r.free).toEqual(["a", "b"]);
    expect(r.reattachTo).toBeNull();
  });

  it("cùng một đơn nằm ở hai lượt (không nên xảy ra) → gán cho lượt đứng trước", () => {
    const r = splitByRunningBatches(
      [
        { id: "new", orderIds: ["a"] },
        { id: "old", orderIds: ["a"] },
      ],
      ["a"]
    );
    expect(r.held.get("a")).toBe("new");
    expect(r.reattachTo).toBe("new");
  });
});
