// ============================================================
// ADAPTER SHOPEE — sắp xếp vận chuyển + vận đơn thật (04/09/2026)
//
// get_shipping_parameter → ship_order → get_tracking_number → (in) get_shipping_
// document_parameter → create_shipping_document → get_shipping_document_result
// → download_shipping_document. Mỗi bước lỗi đều trả lý do tiếng người cho
// từng đơn; không ném cả mẻ vì 1 đơn hỏng.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelName } from "@prisma/client";
import {
  createShippingDocument,
  downloadShippingDocument,
  getShippingDocumentParameter,
  getShippingDocumentResult,
  getShippingParameter,
  getTrackingNumber,
  shipOrder,
  type ShopeePickupAddress,
  type ShopeeShipOrderBody,
  type ShopeeShippingParameter,
} from "../../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../../integrations/shopee/service";
import { isShopeeConfigured } from "../../integrations/shopee/config";
import {
  errMessage,
  type AdapterShippingOptions,
  type ArrangeResult,
  type FulfillChoice,
  type FulfillMethod,
  type FulfillOrderRef,
  type FulfillmentAdapter,
  type LabelFetchResult,
  type ShippingOptionAddress,
} from "./types";

const PREFERRED_DOC = "THERMAL_AIR_WAYBILL"; // khổ A6 máy in nhiệt
const FALLBACK_DOC = "NORMAL_AIR_WAYBILL";
const POLL_TRIES = 8;
const POLL_DELAY_MS = 1200;
const BATCH = 50; // trần order_list của các endpoint document

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function addressLabel(a: ShopeePickupAddress): string {
  return [a.address, a.town, a.district, a.city, a.state].filter(Boolean).join(", ");
}

function slotLabel(date?: number, timeText?: string): string {
  if (!date) return timeText ?? "Khung giờ";
  const d = new Date(date * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
  return timeText ? `${day} · ${timeText}` : day;
}

function toOptions(param: ShopeeShippingParameter): AdapterShippingOptions {
  const methods: FulfillMethod[] = [];
  if (param.info_needed?.pickup) methods.push("PICKUP");
  if (param.info_needed?.dropoff) methods.push("DROPOFF");
  const pickupAddresses: ShippingOptionAddress[] = (param.pickup?.address_list ?? []).map((a) => ({
    id: String(a.address_id),
    label: addressLabel(a) || `Địa chỉ #${a.address_id}`,
    isDefault: (a.address_flag ?? []).includes("PICKUP_ADDRESS"),
    timeSlots: (a.time_slot_list ?? [])
      .filter((s) => s.pickup_time_id)
      .map((s) => ({ id: String(s.pickup_time_id), label: slotLabel(s.date, s.time_text) })),
  }));
  // Địa chỉ đánh dấu lấy hàng lên đầu để hộp thoại chọn sẵn
  pickupAddresses.sort((x, y) => Number(y.isDefault) - Number(x.isDefault));
  const dropoffBranches = (param.dropoff?.branch_list ?? []).map((b) => ({
    id: String(b.branch_id),
    label: [b.address, b.town, b.district, b.city].filter(Boolean).join(", ") || `Bưu cục #${b.branch_id}`,
  }));
  return { methods, pickupAddresses, dropoffBranches };
}

/**
 * Dựng body ship_order từ lựa chọn của seller + tham số sàn trả cho ĐÚNG đơn
 * này (khung giờ lấy hàng khác nhau giữa đơn thường và hỏa tốc). Trả lỗi
 * tiếng người khi thiếu dữ liệu bắt buộc thay vì để sàn trả mã lỗi khó hiểu.
 */
function buildShipBody(
  order: FulfillOrderRef,
  param: ShopeeShippingParameter,
  choice: FulfillChoice,
  shopName: string
): { body?: ShopeeShipOrderBody; error?: string; note?: string } {
  const allowPickup = Boolean(param.info_needed?.pickup);
  const allowDropoff = Boolean(param.info_needed?.dropoff);
  let method = choice.method;
  let note: string | undefined;
  if (method === "PICKUP" && !allowPickup && allowDropoff) {
    method = "DROPOFF";
    note = "Sàn không cho lấy tận nơi với đơn này — đã chuyển sang gửi bưu cục";
  } else if (method === "DROPOFF" && !allowDropoff && allowPickup) {
    method = "PICKUP";
    note = "Sàn không cho gửi bưu cục với đơn này — đã chuyển sang lấy tận nơi";
  }
  if (!allowPickup && !allowDropoff) {
    return { error: "Sàn không cho sắp xếp vận chuyển cho đơn này (chưa thanh toán hoặc đã xử lý)" };
  }

  const body: ShopeeShipOrderBody = { order_sn: order.orderCode };
  if (method === "PICKUP") {
    const list = param.pickup?.address_list ?? [];
    const addr =
      list.find((a) => String(a.address_id) === choice.addressId) ??
      list.find((a) => (a.address_flag ?? []).includes("PICKUP_ADDRESS")) ??
      list[0];
    if (!addr) return { error: "Gian chưa có địa chỉ lấy hàng trên Shopee — thêm ở Seller Center" };
    const needSlot = (param.info_needed?.pickup ?? []).includes("pickup_time_id");
    const slots = (addr.time_slot_list ?? []).filter((s) => s.pickup_time_id);
    const slot = slots.find((s) => s.pickup_time_id === choice.pickupTimeId) ?? slots[0];
    if (needSlot && !slot) return { error: "Sàn chưa mở khung giờ lấy hàng cho địa chỉ này" };
    body.pickup = {
      address_id: addr.address_id,
      ...(slot?.pickup_time_id ? { pickup_time_id: slot.pickup_time_id } : {}),
    };
  } else {
    const need = param.info_needed?.dropoff ?? [];
    const branches = param.dropoff?.branch_list ?? [];
    const dropoff: NonNullable<ShopeeShipOrderBody["dropoff"]> = {};
    if (need.includes("branch_id")) {
      const br = branches.find((b) => String(b.branch_id) === choice.branchId) ?? branches[0];
      if (!br) return { error: "Sàn yêu cầu chọn bưu cục nhưng không trả danh sách bưu cục" };
      dropoff.branch_id = br.branch_id;
    }
    if (need.includes("sender_real_name")) dropoff.sender_real_name = shopName;
    body.dropoff = dropoff;
  }
  return { body, note };
}

export const shopeeFulfillment: FulfillmentAdapter = {
  channelName: ChannelName.SHOPEE,
  supported: true,

  async getShippingOptions(channel, sample) {
    if (!isShopeeConfigured()) throw new Error("Máy chủ chưa cấu hình Shopee");
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const param = await getShippingParameter(accessToken, shopId, sample.orderCode);
    return toOptions(param);
  },

  async arrangeShipment(channel, order, choice): Promise<ArrangeResult> {
    try {
      const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
      const param = await getShippingParameter(accessToken, shopId, order.orderCode);
      const built = buildShipBody(order, param, choice, channel.shopName);
      if (!built.body) return { ok: false, error: built.error };
      await shipOrder(accessToken, shopId, built.body);
      // Sàn cấp mã vận đơn ngay sau ship_order với đa số kênh; chưa có thì để
      // null — lúc in phiếu sẽ hỏi lại.
      let trackingCode: string | null = null;
      try {
        trackingCode = await getTrackingNumber(accessToken, shopId, order.orderCode);
      } catch {
        trackingCode = null;
      }
      return { ok: true, trackingCode, note: built.note };
    } catch (err) {
      return { ok: false, error: errMessage(err) };
    }
  },

  async fetchLabels(channel, orders): Promise<LabelFetchResult> {
    const result: LabelFetchResult = { pdfs: new Map(), discovered: new Map(), failed: [] };
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const byCode = new Map(orders.map((o) => [o.orderCode, o]));
    const fail = (o: FulfillOrderRef, reason: string) =>
      result.failed.push({ orderId: o.id, orderCode: o.orderCode, reason });

    // (1) Đảm bảo mã vận đơn — create_shipping_document cần tracking_number
    const ready: { order: FulfillOrderRef; tracking: string }[] = [];
    for (const o of orders) {
      let tracking = o.trackingCode;
      if (!tracking) {
        try {
          tracking = await getTrackingNumber(accessToken, shopId, o.orderCode);
        } catch (err) {
          fail(o, `Không lấy được mã vận đơn: ${errMessage(err)}`);
          continue;
        }
        if (tracking) result.discovered.set(o.id, { trackingCode: tracking });
      }
      if (!tracking) {
        fail(o, "Sàn chưa cấp mã vận đơn — đợi ít phút rồi in lại");
        continue;
      }
      ready.push({ order: o, tracking });
    }

    for (let i = 0; i < ready.length; i += BATCH) {
      const chunk = ready.slice(i, i + BATCH);
      // (2) Loại phiếu khả dụng theo từng đơn — ưu tiên nhiệt A6
      const docType = new Map<string, string>();
      try {
        const rows = await getShippingDocumentParameter(
          accessToken,
          shopId,
          chunk.map((c) => ({ order_sn: c.order.orderCode }))
        );
        for (const r of rows) {
          if (r.fail_error) {
            const o = byCode.get(r.order_sn);
            if (o) fail(o, r.fail_message || r.fail_error);
            continue;
          }
          const selectable = r.selectable_shipping_document_type ?? [];
          docType.set(
            r.order_sn,
            selectable.includes(PREFERRED_DOC)
              ? PREFERRED_DOC
              : r.suggest_shipping_document_type || selectable[0] || FALLBACK_DOC
          );
        }
      } catch (err) {
        // Không hỏi được loại phiếu thì thử thẳng loại nhiệt cho cả lô
        console.warn("[fulfillment.shopee] get_shipping_document_parameter:", errMessage(err));
        for (const c of chunk) docType.set(c.order.orderCode, PREFERRED_DOC);
      }
      const toCreate = chunk.filter((c) => docType.has(c.order.orderCode));
      if (toCreate.length === 0) continue;

      // (3) Yêu cầu dựng file — đã dựng rồi sàn báo lỗi "exist" thì coi như xong
      try {
        const rows = await createShippingDocument(
          accessToken,
          shopId,
          toCreate.map((c) => ({
            order_sn: c.order.orderCode,
            tracking_number: c.tracking,
            shipping_document_type: docType.get(c.order.orderCode),
          }))
        );
        for (const r of rows) {
          if (!r.fail_error) continue;
          const text = `${r.fail_error} ${r.fail_message ?? ""}`.toLowerCase();
          if (text.includes("exist") || text.includes("already")) continue;
          const o = byCode.get(r.order_sn);
          if (o) {
            fail(o, r.fail_message || r.fail_error);
            docType.delete(r.order_sn);
          }
        }
      } catch (err) {
        for (const c of toCreate) fail(c.order, `Sàn không dựng được vận đơn: ${errMessage(err)}`);
        continue;
      }

      // (4) Chờ sàn dựng xong
      let pending = toCreate.filter((c) => docType.has(c.order.orderCode));
      const readyCodes = new Set<string>();
      for (let t = 0; t < POLL_TRIES && pending.length > 0; t++) {
        if (t > 0) await sleep(POLL_DELAY_MS);
        let rows;
        try {
          rows = await getShippingDocumentResult(
            accessToken,
            shopId,
            pending.map((c) => ({
              order_sn: c.order.orderCode,
              shipping_document_type: docType.get(c.order.orderCode),
            }))
          );
        } catch (err) {
          console.warn("[fulfillment.shopee] get_shipping_document_result:", errMessage(err));
          continue;
        }
        const still: typeof pending = [];
        for (const c of pending) {
          const r = rows.find((x) => x.order_sn === c.order.orderCode);
          const status = (r?.status ?? "").toUpperCase();
          if (status === "READY") readyCodes.add(c.order.orderCode);
          else if (status === "FAILED") fail(c.order, r?.fail_message || r?.fail_error || "Sàn dựng vận đơn thất bại");
          else still.push(c);
        }
        pending = still;
      }
      for (const c of pending) fail(c.order, "Sàn dựng vận đơn quá lâu — bấm in lại sau ít giây");

      // (5) Tải từng đơn một để ghép đúng cặp vận đơn + phiếu nhặt
      for (const c of toCreate) {
        if (!readyCodes.has(c.order.orderCode)) continue;
        try {
          const pdf = await downloadShippingDocument(
            accessToken,
            shopId,
            docType.get(c.order.orderCode) ?? PREFERRED_DOC,
            [{ order_sn: c.order.orderCode }]
          );
          result.pdfs.set(c.order.id, pdf);
        } catch (err) {
          fail(c.order, `Tải vận đơn lỗi: ${errMessage(err)}`);
        }
      }
    }
    return result;
  },
};
