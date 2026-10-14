// ============================================================
// CHUẨN BỊ HÀNG THEO MẺ (14/10/2026) — Shopee mass API + TikTok Batch Ship
//
// Anh Trung: "chuẩn bị đơn chậm, Seller Center nhanh". Adapter gom kiện theo
// (kho, kênh vận chuyển) ≤50 kiện rồi gọi mass_ship_order; nhóm nào sàn từ
// chối cả mẻ thì lùi về từng đơn. TikTok: Batch Ship 50 kiện/lượt, đọc mã vận
// đơn qua chi tiết đơn 50/lượt. Tầng gọi sàn MOCK hoàn toàn — không chạm API
// thật, không cần DB.
// ============================================================
import "./load-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@prisma/client";

vi.mock("../shopee/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../shopee/client")>();
  return {
    ...mod,
    getOrderPackages: vi.fn(),
    getMassShippingParameter: vi.fn(),
    massShipOrder: vi.fn(),
    getMassTrackingNumber: vi.fn(),
    getShippingParameter: vi.fn(),
    shipOrder: vi.fn(),
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
vi.mock("../tiktok/client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../tiktok/client")>();
  return {
    ...mod,
    batchShipPackages: vi.fn(),
    getOrderDetail: vi.fn(),
    getHandoverTimeSlots: vi.fn(),
    shipPackage: vi.fn(),
    getPackageDetail: vi.fn(),
  };
});
vi.mock("../tiktok/service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../tiktok/service")>();
  return {
    ...mod,
    getValidAccessToken: vi.fn().mockResolvedValue({ accessToken: "t", shopCipher: "c" }),
  };
});

import {
  createShippingDocument,
  downloadShippingDocument,
  getMassShippingParameter,
  getMassTrackingNumber,
  getOrderPackages,
  getShippingDocumentParameter,
  getShippingDocumentResult,
  getShippingParameter,
  getTrackingNumber,
  massShipOrder,
  shipOrder,
} from "../shopee/client";
import { batchShipPackages, getHandoverTimeSlots, getOrderDetail, shipPackage } from "../tiktok/client";
import {
  MASS_BATCH,
  groupPackagesForMassShip,
  shopeeFulfillment,
  type ShopeePackageRef,
} from "../../services/fulfillment/shopee";
import { tiktokFulfillment } from "../../services/fulfillment/tiktok";
import type { FulfillOrderRef } from "../../services/fulfillment/types";

const channel = { id: "ch1", shopName: "Shop test" } as unknown as Channel;
const ref = (id: string, extra: Partial<FulfillOrderRef> = {}): FulfillOrderRef => ({
  id,
  orderCode: `SN-${id}`,
  trackingCode: null,
  platformPackageId: null,
  ...extra,
});

const sp = {
  packages: vi.mocked(getOrderPackages),
  massParam: vi.mocked(getMassShippingParameter),
  massShip: vi.mocked(massShipOrder),
  massTracking: vi.mocked(getMassTrackingNumber),
  param: vi.mocked(getShippingParameter),
  ship: vi.mocked(shipOrder),
  tracking: vi.mocked(getTrackingNumber),
  docParam: vi.mocked(getShippingDocumentParameter),
  create: vi.mocked(createShippingDocument),
  result: vi.mocked(getShippingDocumentResult),
  download: vi.mocked(downloadShippingDocument),
};
const tt = {
  batchShip: vi.mocked(batchShipPackages),
  detail: vi.mocked(getOrderDetail),
  slots: vi.mocked(getHandoverTimeSlots),
  ship: vi.mocked(shipPackage),
};

/** get_order_detail(package_list): mỗi đơn một kiện, kênh theo hàm `channelOf`. */
function packagesOf(channelOf: (sn: string) => number, location = "VN0001") {
  sp.packages.mockImplementation(async (_t, _s, sns) => {
    const m = new Map<string, { orderStatus?: string; packages: { package_number: string; logistics_channel_id: number; item_list: { product_location_id: string }[] }[] }>();
    for (const sn of sns) {
      m.set(sn, {
        packages: [{ package_number: `PKG-${sn}`, logistics_channel_id: channelOf(sn), item_list: [{ product_location_id: location }] }],
      });
    }
    return m;
  });
}

const PARAM_PICKUP = {
  info_needed: { pickup: ["address_id", "pickup_time_id"] },
  pickup: {
    address_list: [
      { address_id: 11, address_flag: ["pickup_address"], time_slot_list: [{ date: 1, pickup_time_id: "slot-1" }] },
    ],
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  for (const m of [...Object.values(sp), ...Object.values(tt)]) m.mockReset();
  sp.massTracking.mockImplementation(async (_t, _s, pkgs) => ({
    tracking: new Map(pkgs.map((p) => [p, `TRK-${p}`])),
    failed: [],
  }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("groupPackagesForMassShip — gom theo (kho, kênh vận chuyển) ≤50 kiện", () => {
  const mk = (i: number, ch: number, loc = "A"): ShopeePackageRef => ({
    order: ref(`o${i}`),
    packageNumber: `P${i}`,
    logisticsChannelId: ch,
    productLocationId: loc,
  });

  it("2 hãng + 2 kho → 3 nhóm, giữ thứ tự xuất hiện", () => {
    const groups = groupPackagesForMassShip([mk(1, 50), mk(2, 60), mk(3, 50), mk(4, 50, "B")]);
    expect(groups.map((g) => g.map((r) => r.packageNumber))).toEqual([["P1", "P3"], ["P2"], ["P4"]]);
  });

  it("một hãng 120 kiện → cắt 50/50/20", () => {
    const refs = Array.from({ length: 120 }, (_, i) => mk(i, 50));
    const groups = groupPackagesForMassShip(refs);
    expect(groups.map((g) => g.length)).toEqual([MASS_BATCH, MASS_BATCH, 20]);
  });
});

describe("shopeeFulfillment.arrangeShipmentBatch", () => {
  it("50 đơn 2 hãng → 2 lượt mass_ship_order, 0 lượt ship_order, mã vận đơn 1 lượt/50 kiện", async () => {
    const orders = Array.from({ length: 50 }, (_, i) => ref(`o${i}`));
    packagesOf((sn) => (Number(sn.slice(4)) % 2 === 0 ? 50 : 60));
    sp.massParam.mockResolvedValue(PARAM_PICKUP);
    sp.massShip.mockImplementation(async (_t, _s, body) => ({
      success: body.package_list.map((p) => p.package_number),
      failed: [],
    }));
    const progress: number[] = [];

    const r = await shopeeFulfillment.arrangeShipmentBatch!(channel, orders, { method: "PICKUP", addressId: "11" }, (n) =>
      progress.push(n)
    );

    expect(sp.massShip).toHaveBeenCalledTimes(2);
    expect(sp.ship).not.toHaveBeenCalled();
    expect(sp.massTracking).toHaveBeenCalledTimes(1);
    expect(sp.massShip.mock.calls[0][2]).toMatchObject({
      logistics_channel_id: 50,
      product_location_id: "VN0001",
      pickup: { address_id: 11, pickup_time_id: "slot-1" },
    });
    expect([...r.values()].every((x) => x.ok)).toBe(true);
    expect(r.get("o3")?.trackingCode).toBe("TRK-PKG-SN-o3");
    expect(progress.at(-1)).toBe(50);
  });

  it("fail_list theo kiện → chỉ đơn đó lỗi với lý do tiếng người, đơn khác vẫn ok", async () => {
    packagesOf(() => 50);
    sp.massParam.mockResolvedValue(PARAM_PICKUP);
    sp.massShip.mockResolvedValue({
      success: ["PKG-SN-a"],
      failed: [{ package_number: "PKG-SN-b", fail_reason: "This package has already been arranged shipment" }],
    });

    const r = await shopeeFulfillment.arrangeShipmentBatch!(channel, [ref("a"), ref("b")], { method: "PICKUP" });

    expect(r.get("a")).toMatchObject({ ok: true, trackingCode: "TRK-PKG-SN-a" });
    expect(r.get("b")).toMatchObject({ ok: false, error: expect.stringMatching(/đã được sắp xếp/) });
  });

  it("sàn từ chối CẢ nhóm (mass API chưa mở) → lùi về ship_order từng đơn cho nhóm đó", async () => {
    packagesOf(() => 50);
    sp.massParam.mockRejectedValue(new Error("Shopee get_mass_shipping_parameter lỗi: error_permission — no permission"));
    sp.param.mockResolvedValue(PARAM_PICKUP);
    sp.ship.mockResolvedValue(undefined);
    sp.tracking.mockResolvedValue("SPX-OLD");

    const p = shopeeFulfillment.arrangeShipmentBatch!(channel, [ref("a"), ref("b")], { method: "PICKUP" });
    await vi.runAllTimersAsync();
    const r = await p;

    expect(sp.massShip).not.toHaveBeenCalled();
    expect(sp.ship).toHaveBeenCalledTimes(2);
    expect(r.get("a")).toMatchObject({ ok: true, trackingCode: "SPX-OLD" });
    expect(r.get("b")?.ok).toBe(true);
  });

  it("đơn sàn không trả kiện (chưa thanh toán) → đi đường từng đơn để lấy đúng lý do", async () => {
    sp.packages.mockResolvedValue(new Map()); // không đơn nào có kiện
    sp.param.mockRejectedValue(new Error("error_param — Shipping parameters can only be obtained when package is ready to be shipped"));

    const r = await shopeeFulfillment.arrangeShipmentBatch!(channel, [ref("a")], { method: "PICKUP" });

    expect(sp.massShip).not.toHaveBeenCalled();
    expect(r.get("a")).toMatchObject({ ok: false, error: expect.stringMatching(/chưa thanh toán/) });
  });

  it("mẻ ok nhưng sàn chưa cấp mã → trackingCode null (probe hỏi lại sau), vẫn ok", async () => {
    packagesOf(() => 50);
    sp.massParam.mockResolvedValue(PARAM_PICKUP);
    sp.massShip.mockResolvedValue({ success: ["PKG-SN-a"], failed: [] });
    sp.massTracking.mockResolvedValue({ tracking: new Map([["PKG-SN-a", null]]), failed: [] });

    const r = await shopeeFulfillment.arrangeShipmentBatch!(channel, [ref("a")], { method: "PICKUP" });
    expect(r.get("a")).toMatchObject({ ok: true, trackingCode: null });
  });
});

describe("shopeeFulfillment.probeLabelReadiness theo mẻ", () => {
  it("50 đơn thiếu mã → 1 lượt get_order_detail + 1 lượt get_mass_tracking_number, không hỏi từng đơn", async () => {
    const orders = Array.from({ length: 50 }, (_, i) => ref(`o${i}`));
    packagesOf(() => 50);
    sp.massTracking.mockImplementation(async (_t, _s, pkgs) => ({
      tracking: new Map(pkgs.map((p) => [p, p.endsWith("o7") ? null : `TRK-${p}`])),
      failed: [],
    }));

    const r = await shopeeFulfillment.probeLabelReadiness!(channel, orders);

    expect(sp.packages).toHaveBeenCalledTimes(1);
    expect(sp.massTracking).toHaveBeenCalledTimes(1);
    expect(sp.tracking).not.toHaveBeenCalled();
    expect(r.ready).toHaveLength(49);
    expect(r.waiting.map((w) => w.orderId)).toEqual(["o7"]);
    expect(r.discovered.get("o0")?.trackingCode).toBe("TRK-PKG-SN-o0");
  });
});

describe("shopeeFulfillment.fetchLabels — tải gộp khi không in phiếu xuất hàng", () => {
  function documentFlow() {
    sp.docParam.mockImplementation(async (_t, _s, list) =>
      list.map((x) => ({ order_sn: x.order_sn, selectable_shipping_document_type: ["THERMAL_AIR_WAYBILL"] }))
    );
    sp.create.mockImplementation(async (_t, _s, list) => list.map((x) => ({ order_sn: x.order_sn })));
    sp.result.mockImplementation(async (_t, _s, list) => list.map((x) => ({ order_sn: x.order_sn, status: "READY" })));
  }

  it("combined: 3 đơn cùng loại phiếu → MỘT lượt download, trả phần gộp đúng thứ tự", async () => {
    documentFlow();
    sp.download.mockImplementation(async (_t, _s, _type, list) => Buffer.from(`%PDF-${list.map((x) => x.order_sn).join("+")}`));
    const orders = [ref("a", { trackingCode: "T1" }), ref("b", { trackingCode: "T2" }), ref("c", { trackingCode: "T3" })];

    const r = await shopeeFulfillment.fetchLabels(channel, orders, { combined: true });

    expect(sp.download).toHaveBeenCalledTimes(1);
    expect(r.combined).toHaveLength(1);
    expect(r.combined![0].orderIds).toEqual(["a", "b", "c"]);
    expect(r.combined![0].pdf.toString()).toBe("%PDF-SN-a+SN-b+SN-c");
    expect(r.pdfs.size).toBe(0);
    expect(r.failed).toEqual([]);
  });

  it("combined bị sàn từ chối (khác hãng) → lùi về tải từng đơn, không mất đơn nào", async () => {
    documentFlow();
    let calls = 0;
    sp.download.mockImplementation(async (_t, _s, _type, list) => {
      calls++;
      if (list.length > 1) throw new Error("logistics.packages_can_not_download_together");
      return Buffer.from(`%PDF-${list[0].order_sn}`);
    });
    const orders = [ref("a", { trackingCode: "T1" }), ref("b", { trackingCode: "T2" })];

    const r = await shopeeFulfillment.fetchLabels(channel, orders, { combined: true });

    expect(calls).toBe(3); // 1 gộp lỗi + 2 lẻ
    expect(r.combined ?? []).toHaveLength(0);
    expect([...r.pdfs.keys()]).toEqual(["a", "b"]);
  });

  it("không combined (in kèm phiếu xuất hàng) → tải từng đơn như cũ", async () => {
    documentFlow();
    sp.download.mockImplementation(async (_t, _s, _type, list) => Buffer.from(`%PDF-${list[0].order_sn}`));
    const orders = [ref("a", { trackingCode: "T1" }), ref("b", { trackingCode: "T2" })];

    const r = await shopeeFulfillment.fetchLabels(channel, orders);

    expect(sp.download).toHaveBeenCalledTimes(2);
    expect(r.pdfs.size).toBe(2);
  });
});

describe("tiktokFulfillment.arrangeShipmentBatch", () => {
  it("60 kiện → 2 lượt Batch Ship (50 + 10), lỗi theo kiện ghi đúng đơn, mã vận đơn đọc theo mẻ 50", async () => {
    const orders = Array.from({ length: 60 }, (_, i) => ref(`o${i}`, { platformPackageId: `PK${i}` }));
    tt.slots.mockResolvedValue({ can_pickup: true, handover_time_slots: [{ start_time: 100, end_time: 200 }] });
    tt.batchShip.mockImplementation(async ({ packages }) => {
      const errors = new Map<string, string>();
      if (packages.some((p) => p.id === "PK5")) errors.set("PK5", "package in freeze status (10007014)");
      return errors;
    });
    tt.detail.mockImplementation(async ({ orderIds }) =>
      orderIds.map((id) => ({ id, tracking_number: `TT-${id}`, shipping_provider: "J&T Express", packages: [{ id: `PK${id.slice(4)}` }] }))
    );

    const r = await tiktokFulfillment.arrangeShipmentBatch!(channel, orders, { method: "PICKUP" });

    expect(tt.batchShip).toHaveBeenCalledTimes(2);
    expect(tt.batchShip.mock.calls[0][0].packages).toHaveLength(50);
    expect(tt.batchShip.mock.calls[0][0].packages[0]).toMatchObject({ handoverMethod: "PICKUP", pickupSlot: { start_time: 100, end_time: 200 } });
    expect(tt.ship).not.toHaveBeenCalled();
    expect(tt.slots).toHaveBeenCalledTimes(1); // khung giờ hỏi một lần cho cả mẻ
    expect(r.get("o5")).toMatchObject({ ok: false, error: expect.stringMatching(/freeze/) });
    expect(r.get("o0")).toMatchObject({ ok: true, trackingCode: "TT-SN-o0", carrierName: "J&T Express", packageId: "PK0" });
    expect([...r.values()].filter((x) => x.ok)).toHaveLength(59);
  });

  it("Batch Ship lỗi cả lượt → lùi về ship từng kiện", async () => {
    tt.slots.mockRejectedValue(new Error("105005 access scope"));
    tt.batchShip.mockRejectedValue(new Error("TikTok 36009003 Internal error"));
    tt.ship.mockResolvedValue({});
    vi.mocked(getOrderDetail).mockResolvedValue([]);
    const { getPackageDetail } = await import("../tiktok/client");
    vi.mocked(getPackageDetail).mockResolvedValue({ tracking_number: "TT-1", shipping_provider_name: "SPX" });

    const p = tiktokFulfillment.arrangeShipmentBatch!(channel, [ref("a", { platformPackageId: "PK-a" })], { method: "PICKUP" });
    await vi.runAllTimersAsync();
    const r = await p;

    expect(tt.ship).toHaveBeenCalledTimes(1);
    expect(r.get("a")).toMatchObject({ ok: true, trackingCode: "TT-1" });
  });
});
