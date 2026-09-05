// ============================================================
// ĐỢI SÀN CẤP VẬN ĐƠN (05/09/2026) — sự cố "chuẩn bị 4 đơn, in ra 1"
//
// Shopee nhận ship_order xong nhưng cấp tracking_number trễ vài giây. Adapter
// phải: (1) probeLabelReadiness báo đúng đơn nào đang chờ để giao diện hỏi lại,
// (2) fetchLabels hỏi lại mã vài vòng + thử lại create_shipping_document khi
// sàn báo "chưa sẵn", thay vì loại đơn khỏi file in.
//
// Tầng gọi Shopee được MOCK hoàn toàn — không chạm API thật, không cần DB.
// ============================================================
import "./load-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@prisma/client";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return {
    ...mod,
    getTrackingNumber: vi.fn(),
    getShippingDocumentParameter: vi.fn(),
    createShippingDocument: vi.fn(),
    getShippingDocumentResult: vi.fn(),
    downloadShippingDocument: vi.fn(),
  };
});
vi.mock("../shopee/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/service")>();
  return {
    ...mod,
    getValidShopeeAccessToken: vi.fn().mockResolvedValue({ accessToken: "t", shopId: "1" }),
  };
});

import {
  createShippingDocument,
  downloadShippingDocument,
  getShippingDocumentParameter,
  getShippingDocumentResult,
  getTrackingNumber,
} from "../shopee/client";
import { shopeeFulfillment } from "../../services/fulfillment/shopee";
import { isNotReadyError, type FulfillOrderRef } from "../../services/fulfillment/types";

const channel = { id: "ch1", shopName: "Shop test" } as unknown as Channel;
const ref = (id: string, trackingCode: string | null = null): FulfillOrderRef => ({
  id,
  orderCode: `SN-${id}`,
  trackingCode,
  platformPackageId: null,
});

const mocked = {
  tracking: vi.mocked(getTrackingNumber),
  docParam: vi.mocked(getShippingDocumentParameter),
  create: vi.mocked(createShippingDocument),
  result: vi.mocked(getShippingDocumentResult),
  download: vi.mocked(downloadShippingDocument),
};

beforeEach(() => {
  vi.useFakeTimers();
  for (const m of Object.values(mocked)) m.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("isNotReadyError", () => {
  it("nhận diện lỗi sàn kiểu chưa sẵn, bỏ qua lỗi thật", () => {
    expect(isNotReadyError("logistics.tracking_number_not_ready")).toBe(true);
    expect(isNotReadyError("Shopee get_tracking_number lỗi: error_not_found — order not found")).toBe(true);
    expect(isNotReadyError("error_auth — Invalid access_token")).toBe(false);
    expect(isNotReadyError("Máy chủ chưa cấu hình Shopee")).toBe(false);
  });
});

describe("shopeeFulfillment.probeLabelReadiness", () => {
  it("đơn có mã sẵn → ready; sàn chưa cấp → waiting; sàn vừa cấp → ready + discovered", async () => {
    mocked.tracking.mockImplementation(async (_t, _s, sn) => (sn === "SN-c" ? "SPXVN00C" : null));
    const r = await shopeeFulfillment.probeLabelReadiness!(channel, [ref("a", "SPXVN00A"), ref("b"), ref("c")]);
    expect(r.ready.sort()).toEqual(["a", "c"]);
    expect(r.waiting.map((w) => w.orderId)).toEqual(["b"]);
    expect(r.discovered.get("c")?.trackingCode).toBe("SPXVN00C");
    // không hỏi sàn cho đơn đã có mã
    expect(mocked.tracking).toHaveBeenCalledTimes(2);
  });

  it("sàn ném lỗi kiểu chưa sẵn → waiting (không ném ra ngoài)", async () => {
    mocked.tracking.mockRejectedValue(new Error("Shopee get_tracking_number lỗi: logistics.not_ready — pending"));
    const r = await shopeeFulfillment.probeLabelReadiness!(channel, [ref("b")]);
    expect(r.ready).toEqual([]);
    expect(r.waiting).toHaveLength(1);
  });

  it("lỗi thật (token) → ném để route báo cả gian", async () => {
    mocked.tracking.mockRejectedValue(new Error("error_auth — Invalid access_token"));
    await expect(shopeeFulfillment.probeLabelReadiness!(channel, [ref("b")])).rejects.toThrow(/access_token/);
  });
});

describe("shopeeFulfillment.fetchLabels — mã cấp trễ không làm rơi đơn", () => {
  function happyDocumentFlow() {
    mocked.docParam.mockImplementation(async (_t, _s, list) =>
      list.map((x) => ({ order_sn: x.order_sn, selectable_shipping_document_type: ["THERMAL_AIR_WAYBILL"] }))
    );
    mocked.result.mockImplementation(async (_t, _s, list) =>
      list.map((x) => ({ order_sn: x.order_sn, status: "READY" }))
    );
    mocked.download.mockImplementation(async (_t, _s, _type, list) =>
      Buffer.from(`%PDF-${list[0].order_sn}`)
    );
  }

  it("tracking_number về ở vòng hỏi thứ 2 → cả 2 đơn đều có PDF, đúng thứ tự chọn", async () => {
    happyDocumentFlow();
    let calls = 0;
    mocked.tracking.mockImplementation(async () => (++calls >= 2 ? "SPXVN00B" : null));
    mocked.create.mockImplementation(async (_t, _s, list) => list.map((x) => ({ order_sn: x.order_sn })));

    const p = shopeeFulfillment.fetchLabels(channel, [ref("b"), ref("a", "SPXVN00A")]);
    await vi.runAllTimersAsync();
    const r = await p;

    expect(r.failed).toEqual([]);
    expect([...r.pdfs.keys()]).toEqual(["b", "a"]);
    expect(r.discovered.get("b")?.trackingCode).toBe("SPXVN00B");
    expect(mocked.tracking).toHaveBeenCalledTimes(2);
  });

  it("sàn báo 'not ready' khi dựng vận đơn → thử lại một lần rồi vẫn ra PDF", async () => {
    happyDocumentFlow();
    let attempt = 0;
    mocked.create.mockImplementation(async (_t, _s, list) => {
      attempt++;
      return list.map((x) =>
        attempt === 1
          ? { order_sn: x.order_sn, fail_error: "logistics.not_ready", fail_message: "package not ready" }
          : { order_sn: x.order_sn }
      );
    });

    const p = shopeeFulfillment.fetchLabels(channel, [ref("a", "SPXVN00A")]);
    await vi.runAllTimersAsync();
    const r = await p;

    expect(mocked.create).toHaveBeenCalledTimes(2);
    expect(r.failed).toEqual([]);
    expect(r.pdfs.has("a")).toBe(true);
  });

  it("hết vòng vẫn không có mã → báo lỗi tiếng người cho riêng đơn đó, đơn khác vẫn in", async () => {
    happyDocumentFlow();
    mocked.tracking.mockResolvedValue(null);
    mocked.create.mockImplementation(async (_t, _s, list) => list.map((x) => ({ order_sn: x.order_sn })));

    const p = shopeeFulfillment.fetchLabels(channel, [ref("b"), ref("a", "SPXVN00A")]);
    await vi.runAllTimersAsync();
    const r = await p;

    expect(r.pdfs.has("a")).toBe(true);
    expect(r.pdfs.has("b")).toBe(false);
    expect(r.failed).toEqual([
      { orderId: "b", orderCode: "SN-b", reason: expect.stringMatching(/chưa cấp mã vận đơn/) },
    ]);
    expect(mocked.tracking).toHaveBeenCalledTimes(3); // TRACKING_ROUNDS
  });
});
