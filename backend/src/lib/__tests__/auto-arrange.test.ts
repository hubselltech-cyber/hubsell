import { describe, expect, it } from "vitest";

import {
  carrierNameRequired,
  classifyArrangeFailure,
  isAuthFailure,
  isCarrierUnknown,
  isChannelWideFailure,
  jittered,
  selectAutoArrangeCandidates,
  type AutoArrangeCandidate,
} from "../auto-arrange";

const NOW = new Date("2026-11-04T16:00:00Z");
const MIN = 60_000;

const order = (over: Partial<AutoArrangeCandidate> & { id: string }): AutoArrangeCandidate => ({
  orderCode: over.id,
  createdAt: new Date("2026-11-04T15:00:00Z"),
  paymentStatus: "PAID",
  cancelRequestedAt: null,
  shippingCarrierName: "SPX Express",
  autoArrangeTriedAt: null,
  autoArrangeAttempts: 0,
  autoArrangeBlockedAt: null,
  ...over,
});

const opts = (over: Partial<Parameters<typeof selectAutoArrangeCandidates>[1]> = {}) => ({
  now: NOW,
  runningOrderIds: new Set<string>(),
  maxAttempts: 6,
  retryAfterMs: 30 * MIN,
  maxPerRun: 150,
  ...over,
});

describe("selectAutoArrangeCandidates", () => {
  it("đơn đã thanh toán, không cờ gì → đem đi; cũ nhất trước", () => {
    const r = selectAutoArrangeCandidates(
      [
        order({ id: "B", createdAt: new Date("2026-11-04T15:30:00Z") }),
        order({ id: "A", createdAt: new Date("2026-11-04T15:00:00Z") }),
      ],
      opts()
    );
    expect(r.ready.map((o) => o.id)).toEqual(["A", "B"]);
    expect(r.more).toBe(false);
    expect(Object.values(r.skipped).every((n) => n === 0)).toBe(true);
  });

  it("chưa thanh toán bị bỏ qua, không đếm vào lần thử", () => {
    const r = selectAutoArrangeCandidates([order({ id: "U", paymentStatus: "UNPAID" })], opts());
    expect(r.ready).toHaveLength(0);
    expect(r.skipped.unpaid).toBe(1);
  });

  it("khách đang xin hủy bị bỏ qua", () => {
    const r = selectAutoArrangeCandidates([order({ id: "C", cancelRequestedAt: NOW })], opts());
    expect(r.skipped.cancel_requested).toBe(1);
  });

  it("hỏa tốc để người làm (SPX Instant, Hỏa tốc, Grab)", () => {
    const r = selectAutoArrangeCandidates(
      [
        order({ id: "H1", shippingCarrierName: "SPX Instant" }),
        order({ id: "H2", shippingCarrierName: "Hỏa Tốc" }),
        order({ id: "N", shippingCarrierName: "J&T Express" }),
      ],
      opts()
    );
    expect(r.ready.map((o) => o.id)).toEqual(["N"]);
    expect(r.skipped.express).toBe(2);
  });

  it("sàn không bắt buộc tên hãng (Lazada/TikTok): đơn không có tên vẫn đem đi", () => {
    const r = selectAutoArrangeCandidates([order({ id: "X", shippingCarrierName: null })], opts());
    expect(r.ready).toHaveLength(1);
  });

  // Sự cố 09/11/2026: đơn Shopee vừa về chưa kèm tên hãng, máy chuẩn bị luôn, vài
  // phút sau tên mới thành "SPX Instant".
  it("sàn bắt buộc tên hãng (Shopee): đơn chưa rõ hãng thì chờ, không đem đi, không đếm lần thử", () => {
    const r = selectAutoArrangeCandidates(
      [
        order({ id: "N1", shippingCarrierName: null }),
        order({ id: "N2", shippingCarrierName: "   " }),
        order({ id: "N3", shippingCarrierName: "Đang Điều Phối ĐVVC" }),
        order({ id: "OK", shippingCarrierName: "SPX Express" }),
        order({ id: "H", shippingCarrierName: "SPX Instant" }),
      ],
      opts({ requireCarrierName: true })
    );
    expect(r.ready.map((o) => o.id)).toEqual(["OK"]);
    expect(r.skipped.carrier_unknown).toBe(3);
    expect(r.skipped.express).toBe(1);
  });

  it("chưa rõ hãng xét SAU chưa thanh toán / xin hủy, TRƯỚC đã chặn", () => {
    const r = selectAutoArrangeCandidates(
      [
        order({ id: "U", shippingCarrierName: null, paymentStatus: "UNPAID" }),
        order({ id: "C", shippingCarrierName: null, cancelRequestedAt: NOW }),
        order({ id: "B", shippingCarrierName: null, autoArrangeBlockedAt: NOW }),
      ],
      opts({ requireCarrierName: true })
    );
    expect(r.skipped).toMatchObject({ unpaid: 1, cancel_requested: 1, carrier_unknown: 1, blocked: 0 });
  });

  it("đơn đã chặn không bao giờ thử lại", () => {
    const r = selectAutoArrangeCandidates([order({ id: "D", autoArrangeBlockedAt: NOW })], opts());
    expect(r.skipped.blocked).toBe(1);
  });

  it("quá số lần thử bị bỏ; vừa thử dưới 30′ bị bỏ; thử đủ lâu thì vào lại", () => {
    const r = selectAutoArrangeCandidates(
      [
        order({ id: "M", autoArrangeAttempts: 6 }),
        order({ id: "R", autoArrangeAttempts: 2, autoArrangeTriedAt: new Date(NOW.getTime() - 10 * MIN) }),
        order({ id: "O", autoArrangeAttempts: 2, autoArrangeTriedAt: new Date(NOW.getTime() - 31 * MIN) }),
      ],
      opts()
    );
    expect(r.ready.map((o) => o.id)).toEqual(["O"]);
    expect(r.skipped.max_attempts).toBe(1);
    expect(r.skipped.tried_recently).toBe(1);
  });

  it("đơn đang trong mẻ RUNNING (người đang bấm) bị bỏ qua", () => {
    const r = selectAutoArrangeCandidates(
      [order({ id: "P" }), order({ id: "Q" })],
      opts({ runningOrderIds: new Set(["P"]) })
    );
    expect(r.ready.map((o) => o.id)).toEqual(["Q"]);
    expect(r.skipped.in_running_batch).toBe(1);
  });

  it("quá trần một lượt → cắt và báo còn nữa", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      order({ id: `O${String(i).padStart(3, "0")}`, createdAt: new Date(NOW.getTime() - (200 - i) * MIN) })
    );
    const r = selectAutoArrangeCandidates(many, opts({ maxPerRun: 150 }));
    expect(r.ready).toHaveLength(150);
    expect(r.ready[0].id).toBe("O000");
    expect(r.more).toBe(true);
  });

  it("mỗi đơn bị loại đúng một lý do, xét theo thứ tự: chưa thanh toán trước hỏa tốc trước chặn", () => {
    const r = selectAutoArrangeCandidates(
      [order({ id: "Z", paymentStatus: "UNPAID", shippingCarrierName: "SPX Instant", autoArrangeBlockedAt: NOW })],
      opts()
    );
    expect(r.skipped.unpaid).toBe(1);
    expect(r.skipped.express).toBe(0);
    expect(r.skipped.blocked).toBe(0);
  });
});

describe("isCarrierUnknown / carrierNameRequired", () => {
  it("trống, toàn dấu cách, chữ giữ chỗ 'đang điều phối' = chưa rõ; tên thật thì không", () => {
    for (const n of [null, undefined, "", "  ", "Đang Điều Phối ĐVVC", "đang điều phối đvvc", "Dang dieu phoi DVVC"]) {
      expect(isCarrierUnknown(n), String(n)).toBe(true);
    }
    for (const n of ["SPX Express", "SPX Instant", "Nhanh", "Hỏa Tốc", "Giao Hàng Nhanh", "Điểm nhận hàng"]) {
      expect(isCarrierUnknown(n), n).toBe(false);
    }
  });

  it("chỉ Shopee bắt buộc biết hãng trước khi máy chuẩn bị", () => {
    expect(carrierNameRequired("SHOPEE")).toBe(true);
    expect(carrierNameRequired("TIKTOK")).toBe(false);
    expect(carrierNameRequired("LAZADA")).toBe(false);
  });
});

describe("classifyArrangeFailure", () => {
  it("mất kết nối / thiếu quyền / 429 / sàn 5xx → lỗi cả gian", () => {
    for (const m of [
      "Gian mất kết nối với sàn — vào Kênh bán để kết nối lại",
      "Sàn chưa cấp quyền API này cho Hubsell — cần xin thêm scope rồi ủy quyền lại gian (x)",
      "HTTP 429 Too Many Requests",
      "Shopee 503 Service Unavailable",
      "fetch failed",
      "Máy chủ chưa cấu hình Shopee",
    ]) {
      expect(classifyArrangeFailure(m), m).toBe("channel");
    }
  });

  it("sàn chưa sẵn sàng → thử lại", () => {
    for (const m of [
      "Sàn báo đơn chưa sẵn sàng giao — thường do khách chưa thanh toán hoặc đơn đã được sắp xếp vận chuyển trên Seller Center rồi",
      "package is not ready to be shipped",
      "Sàn không trả kết quả cho đơn này",
      "order is processing, try again later",
    ]) {
      expect(classifyArrangeFailure(m), m).toBe("retry");
    }
  });

  it("lỗi cứng của riêng đơn → chặn", () => {
    for (const m of [
      "Package 12345 not eligible for rescheduling",
      "Địa chỉ lấy hàng không hợp lệ",
      "Đơn đã được sắp xếp vận chuyển trên sàn rồi",
      "Sàn từ chối",
    ]) {
      expect(classifyArrangeFailure(m), m).toBe("block");
    }
  });

  it("câu 'chưa sẵn sàng' có chữ 'chưa thanh toán' vẫn là thử lại, không phải chặn", () => {
    expect(classifyArrangeFailure("Khách chưa thanh toán — sàn chưa cho chuẩn bị")).toBe("retry");
  });
});

describe("isChannelWideFailure / isAuthFailure / jittered", () => {
  it("mọi đơn cùng một câu lỗi gian → lỗi cả gian; khác câu hoặc có đơn thành công thì không", () => {
    const conn = { reason: "Gian mất kết nối với sàn — vào Kênh bán để kết nối lại" };
    expect(isChannelWideFailure([conn, conn], 2)).toBe(true);
    expect(isChannelWideFailure([conn], 2)).toBe(false);
    expect(isChannelWideFailure([conn, { reason: "Sàn từ chối" }], 2)).toBe(false);
    expect(isChannelWideFailure([{ reason: "Sàn từ chối" }, { reason: "Sàn từ chối" }], 2)).toBe(false);
    expect(isChannelWideFailure([], 0)).toBe(false);
  });

  it("mất kết nối là lỗi ủy quyền; 429 thì không", () => {
    expect(isAuthFailure("Gian mất kết nối với sàn — vào Kênh bán để kết nối lại")).toBe(true);
    expect(isAuthFailure("HTTP 429")).toBe(false);
  });

  it("lệch nhịp nằm trong ± jitter và không âm", () => {
    expect(jittered(1000, 100, () => 0)).toBe(900);
    expect(jittered(1000, 100, () => 1)).toBe(1100);
    expect(jittered(1000, 100, () => 0.5)).toBe(1000);
    expect(jittered(50, 100, () => 0)).toBe(0);
  });
});
