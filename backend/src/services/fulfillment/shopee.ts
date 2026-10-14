// ============================================================
// ADAPTER SHOPEE — sắp xếp vận chuyển + vận đơn thật (04/09/2026)
//
// Từng đơn: get_shipping_parameter → ship_order → get_tracking_number → (in)
// get_shipping_document_parameter → create_shipping_document →
// get_shipping_document_result → download_shipping_document.
//
// THEO MẺ (14/10/2026 — anh Trung: "chuẩn bị đơn chậm, Seller Center nhanh"):
// bộ "mass" API của sàn đi theo MÃ KIỆN, 50 kiện/lần, các kiện phải cùng kho
// (product_location_id) + cùng kênh vận chuyển (logistics_channel_id, do người
// mua chọn lúc đặt). Luồng: get_order_detail(package_list) 50 đơn/lần → gom nhóm
// (kho, kênh) → get_mass_shipping_parameter → mass_ship_order → get_mass_
// tracking_number. Mẻ 50 đơn một hãng: ~4 lượt gọi thay vì ~150. Nhóm nào sàn
// từ chối CẢ MẺ (API chưa mở cho gian, tham số lạ…) thì lùi về từng đơn như cũ
// nên không bao giờ tệ hơn trước. Lỗi theo từng kiện (fail_list) ghi đúng đơn.
//
// Mỗi bước lỗi đều trả lý do tiếng người cho từng đơn; không ném cả mẻ vì 1
// đơn hỏng.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelName } from "@prisma/client";
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
  type ShopeeMassShipBody,
  type ShopeePickupAddress,
  type ShopeeShipOrderBody,
  type ShopeeShippingParameter,
} from "../../integrations/shopee/client";
import { getValidShopeeAccessToken } from "../../integrations/shopee/service";
import { isShopeeConfigured } from "../../integrations/shopee/config";
import {
  chunk,
  errMessage,
  type AdapterShippingOptions,
  type ArrangeResult,
  type FulfillChoice,
  type FulfillMethod,
  type FulfillOrderRef,
  type FulfillmentAdapter,
  type LabelFetchOptions,
  type LabelFetchResult,
  type LabelReadiness,
  type ShippingOptionAddress,
  humanizeArrangeError,
  isNotReadyError,
} from "./types";

const PREFERRED_DOC = "THERMAL_AIR_WAYBILL"; // khổ A6 máy in nhiệt
const FALLBACK_DOC = "NORMAL_AIR_WAYBILL";
const POLL_TRIES = 8;
const POLL_DELAY_MS = 1200;
const BATCH = 50; // trần order_list của các endpoint document
/** Trần package_list của bộ mass API (docs 14/10/2026: limit [1, 50]). */
export const MASS_BATCH = 50;
/** Đợi sàn cấp tracking_number ngay trong lúc lấy phiếu: 3 vòng × 2s (giao
 *  diện đã đợi trước ở bước probe, đây chỉ là lưới đỡ khi in tay). */
const TRACKING_ROUNDS = 3;
const TRACKING_DELAY_MS = 2000;
/** Sàn báo "chưa sẵn" khi dựng vận đơn → thử lại một lần sau khoảng này. */
const CREATE_RETRY_DELAY_MS = 2500;
/** Nhịp giữa hai ship_order cùng gian khi phải lùi về từng đơn. */
const ARRANGE_GAP_MS = 300;

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

/** Cờ địa chỉ lấy hàng của sàn: API từng đơn viết HOA, mass API viết thường. */
function isPickupFlag(flags: string[] | undefined): boolean {
  return (flags ?? []).some((f) => /^(pickup_address|current_address)$/i.test(f));
}

/**
 * Phần pickup/dropoff của body ship_order / mass_ship_order từ lựa chọn của
 * seller + tham số sàn trả (khung giờ khác nhau giữa đơn thường và hỏa tốc).
 * Dùng chung cho một đơn lẫn một nhóm kiện. Trả lỗi tiếng người khi thiếu dữ
 * liệu bắt buộc thay vì để sàn trả mã lỗi khó hiểu.
 */
export function buildShipChoice(
  param: ShopeeShippingParameter,
  choice: FulfillChoice,
  shopName: string
): {
  pickup?: { address_id: number; pickup_time_id?: string };
  dropoff?: { branch_id?: number; sender_real_name?: string };
  error?: string;
  note?: string;
} {
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

  if (method === "PICKUP") {
    const list = param.pickup?.address_list ?? [];
    const addr =
      list.find((a) => String(a.address_id) === choice.addressId) ??
      list.find((a) => isPickupFlag(a.address_flag)) ??
      list[0];
    if (!addr) return { error: "Gian chưa có địa chỉ lấy hàng trên Shopee — thêm ở Seller Center" };
    const needSlot = (param.info_needed?.pickup ?? []).includes("pickup_time_id");
    const slots = (addr.time_slot_list ?? []).filter((s) => s.pickup_time_id);
    const slot =
      slots.find((s) => s.pickup_time_id === choice.pickupTimeId) ??
      slots.find((s) => ((s as { flags?: string[] }).flags ?? []).includes("recommended")) ??
      slots[0];
    if (needSlot && !slot) return { error: "Sàn chưa mở khung giờ lấy hàng cho địa chỉ này" };
    return {
      pickup: {
        address_id: addr.address_id,
        ...(slot?.pickup_time_id ? { pickup_time_id: slot.pickup_time_id } : {}),
      },
      note,
    };
  }
  const need = param.info_needed?.dropoff ?? [];
  const branches = param.dropoff?.branch_list ?? [];
  const dropoff: { branch_id?: number; sender_real_name?: string } = {};
  if (need.includes("branch_id")) {
    const br = branches.find((b) => String(b.branch_id) === choice.branchId) ?? branches[0];
    if (!br) return { error: "Sàn yêu cầu chọn bưu cục nhưng không trả danh sách bưu cục" };
    dropoff.branch_id = br.branch_id;
  }
  if (need.includes("sender_real_name")) dropoff.sender_real_name = shopName;
  return { dropoff, note };
}

/** Body ship_order cho MỘT đơn (đường từng đơn / đường lùi). */
function buildShipBody(
  order: FulfillOrderRef,
  param: ShopeeShippingParameter,
  choice: FulfillChoice,
  shopName: string
): { body?: ShopeeShipOrderBody; error?: string; note?: string } {
  const built = buildShipChoice(param, choice, shopName);
  if (built.error) return { error: built.error };
  const body: ShopeeShipOrderBody = { order_sn: order.orderCode };
  if (built.pickup) body.pickup = built.pickup;
  if (built.dropoff) body.dropoff = built.dropoff;
  return { body, note: built.note };
}

// ---------- Kiện + nhóm cho mass API ----------

/** Một kiện của sàn gắn với đơn Hubsell. */
export interface ShopeePackageRef {
  order: FulfillOrderRef;
  packageNumber: string;
  logisticsChannelId?: number;
  productLocationId?: string;
}

/**
 * Gom kiện thành các mẻ hợp lệ cho mass API: cùng kho + cùng kênh vận chuyển,
 * tối đa MASS_BATCH kiện. Giữ thứ tự xuất hiện để tiến độ chạy theo thứ tự
 * seller chọn.
 */
export function groupPackagesForMassShip(refs: ShopeePackageRef[]): ShopeePackageRef[][] {
  const groups = new Map<string, ShopeePackageRef[]>();
  for (const r of refs) {
    const key = `${r.productLocationId ?? ""}|${r.logisticsChannelId ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].flatMap((g) => chunk(g, MASS_BATCH));
}

/**
 * Hỏi sàn danh sách kiện của các đơn (50 đơn/lần). Đơn sàn không trả kiện
 * (chưa thanh toán, đơn lạ) nằm trong `missing` để đi đường từng đơn — ở đó
 * sàn trả lý do đúng cho từng đơn.
 */
async function loadPackages(
  accessToken: string,
  shopId: string,
  orders: FulfillOrderRef[]
): Promise<{ refs: ShopeePackageRef[]; missing: FulfillOrderRef[] }> {
  const refs: ShopeePackageRef[] = [];
  const missing: FulfillOrderRef[] = [];
  for (const part of chunk(orders, BATCH)) {
    const map = await getOrderPackages(accessToken, shopId, part.map((o) => o.orderCode));
    for (const o of part) {
      const pkgs = (map.get(o.orderCode)?.packages ?? []).filter((p) => p.package_number);
      if (pkgs.length === 0) {
        missing.push(o);
        continue;
      }
      for (const p of pkgs) {
        refs.push({
          order: o,
          packageNumber: p.package_number!,
          logisticsChannelId: p.logistics_channel_id,
          productLocationId: p.item_list?.find((i) => i.product_location_id)?.product_location_id,
        });
      }
    }
  }
  return { refs, missing };
}

/** Sắp xếp từng đơn tuần tự (đường cũ) — dùng làm đường lùi của mass API. */
async function arrangeSequential(
  channel: Channel,
  orders: FulfillOrderRef[],
  choice: FulfillChoice,
  results: Map<string, ArrangeResult>,
  onProgress?: (done: number) => void
): Promise<void> {
  for (const [idx, o] of orders.entries()) {
    if (idx > 0) await sleep(ARRANGE_GAP_MS);
    results.set(o.id, await shopeeFulfillment.arrangeShipment(channel, o, choice));
    onProgress?.(results.size);
  }
}

/** Mã vận đơn theo kiện (50 kiện/lần); kiện sàn chưa cấp → null. */
async function massTracking(
  accessToken: string,
  shopId: string,
  packageNumbers: string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const part of chunk(packageNumbers, MASS_BATCH)) {
    const r = await getMassTrackingNumber(accessToken, shopId, part);
    for (const [k, v] of r.tracking) out.set(k, v);
  }
  return out;
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
      return { ok: false, error: humanizeArrangeError(errMessage(err)) };
    }
  },

  /**
   * Sắp xếp vận chuyển theo mẻ bằng mass API. Mỗi nhóm (kho, kênh vận chuyển)
   * ≤50 kiện: 1 lượt hỏi tham số + 1 lượt ship; mã vận đơn hỏi 1 lượt/50 kiện
   * cuối cùng. Nhóm nào sàn từ chối cả mẻ → lùi về từng đơn cho riêng nhóm đó.
   */
  async arrangeShipmentBatch(channel, orders, choice, onProgress): Promise<Map<string, ArrangeResult>> {
    const results = new Map<string, ArrangeResult>();
    let auth: { accessToken: string; shopId: string };
    try {
      auth = await getValidShopeeAccessToken(channel);
    } catch (err) {
      const error = humanizeArrangeError(errMessage(err));
      for (const o of orders) results.set(o.id, { ok: false, error });
      return results;
    }
    const { accessToken, shopId } = auth;

    let refs: ShopeePackageRef[];
    let missing: FulfillOrderRef[];
    try {
      ({ refs, missing } = await loadPackages(accessToken, shopId, orders));
    } catch (err) {
      console.warn(`[fulfillment.shopee] get_order_detail(package_list) gian "${channel.shopName}" lỗi, lùi về từng đơn:`, errMessage(err));
      await arrangeSequential(channel, orders, choice, results, onProgress);
      return results;
    }

    // Đơn nhiều kiện: thành công khi MỌI kiện ok; lỗi kiện nào ghi lý do kiện đó.
    const perOrder = new Map<string, { total: number; ok: string[]; errors: string[]; note?: string }>();
    for (const r of refs) {
      const cur = perOrder.get(r.order.id) ?? { total: 0, ok: [], errors: [] };
      cur.total += 1;
      perOrder.set(r.order.id, cur);
    }
    const okPackages: string[] = [];
    const reportProgress = () => onProgress?.(results.size + [...perOrder.values()].filter((p) => p.ok.length + p.errors.length >= p.total).length);

    for (const group of groupPackagesForMassShip(refs)) {
      const byPackage = new Map(group.map((r) => [r.packageNumber, r]));
      const fail = (packageNumber: string | undefined, reason: string) => {
        const r = packageNumber ? byPackage.get(packageNumber) : undefined;
        if (!r) return;
        perOrder.get(r.order.id)!.errors.push(humanizeArrangeError(reason));
      };
      try {
        const param = await getMassShippingParameter(accessToken, shopId, {
          packageNumbers: group.map((r) => r.packageNumber),
          logisticsChannelId: group[0].logisticsChannelId,
          productLocationId: group[0].productLocationId,
        });
        for (const f of param.fail_list ?? []) fail(f.package_number, f.fail_reason || "Sàn từ chối");
        const failedParam = new Set((param.fail_list ?? []).map((f) => f.package_number));
        const shippable = group.filter((r) => !failedParam.has(r.packageNumber));
        if (shippable.length === 0) {
          reportProgress();
          continue;
        }
        const built = buildShipChoice(param, choice, channel.shopName);
        if (built.error) {
          for (const r of shippable) fail(r.packageNumber, built.error);
          reportProgress();
          continue;
        }
        const body: ShopeeMassShipBody = {
          package_list: shippable.map((r) => ({ package_number: r.packageNumber })),
        };
        if (group[0].logisticsChannelId != null) body.logistics_channel_id = group[0].logisticsChannelId;
        if (group[0].productLocationId) body.product_location_id = group[0].productLocationId;
        if (built.pickup) body.pickup = built.pickup;
        if (built.dropoff) body.dropoff = built.dropoff;
        const r = await massShipOrder(accessToken, shopId, body);
        for (const f of r.failed) fail(f.package_number, f.fail_reason || "Sàn từ chối");
        const succeeded = new Set(r.success);
        const failedShip = new Set(r.failed.map((f) => f.package_number));
        for (const ref of shippable) {
          const p = perOrder.get(ref.order.id)!;
          if (succeeded.has(ref.packageNumber)) {
            p.ok.push(ref.packageNumber);
            okPackages.push(ref.packageNumber);
            if (built.note) p.note = built.note;
          } else if (!failedShip.has(ref.packageNumber)) {
            // Sàn không nhắc tới kiện này ở cả hai danh sách — coi là lỗi để
            // seller nhìn thấy, không tự đoán thành công.
            p.errors.push("Sàn không xác nhận kiện này — kiểm tra trên Seller Center");
          }
        }
      } catch (err) {
        // Lỗi CẢ NHÓM (mass API chưa mở cho gian, tham số lạ, mạng…) → từng đơn
        // như cũ cho riêng nhóm này; đơn đã ok ở nhóm khác không bị gọi lại.
        console.warn(`[fulfillment.shopee] mass ship gian "${channel.shopName}" nhóm ${group.length} kiện lỗi, lùi về từng đơn:`, errMessage(err));
        const orderIds = [...new Set(group.map((r) => r.order.id))];
        for (const id of orderIds) perOrder.delete(id);
        const fallbackOrders = orderIds.map((id) => group.find((r) => r.order.id === id)!.order);
        await arrangeSequential(channel, fallbackOrders, choice, results, () => reportProgress());
      }
      reportProgress();
    }

    // Mã vận đơn: 1 lượt / 50 kiện; sàn chưa cấp thì để null — probe sẽ hỏi lại.
    let tracking = new Map<string, string | null>();
    if (okPackages.length > 0) {
      try {
        tracking = await massTracking(accessToken, shopId, okPackages);
      } catch (err) {
        console.warn(`[fulfillment.shopee] get_mass_tracking_number gian "${channel.shopName}":`, errMessage(err));
      }
    }
    for (const [orderId, p] of perOrder) {
      if (results.has(orderId)) continue;
      if (p.errors.length > 0) {
        results.set(orderId, {
          ok: false,
          error: p.ok.length > 0 ? `Sàn nhận ${p.ok.length}/${p.total} kiện; kiện lỗi: ${p.errors.join("; ")}` : p.errors[0],
        });
      } else {
        results.set(orderId, {
          ok: true,
          trackingCode: tracking.get(p.ok[0]) ?? null,
          note: p.total > 1 ? `Sàn tách ${p.total} kiện` : p.note,
        });
      }
    }

    // Đơn sàn không trả kiện → đường từng đơn để lấy đúng lý do (chưa thanh toán…)
    if (missing.length > 0) await arrangeSequential(channel, missing, choice, results, () => onProgress?.(results.size));
    onProgress?.(results.size);
    return results;
  },

  /**
   * Sàn đã cấp tracking_number chưa? Hỏi theo mẻ (get_order_detail 50 đơn →
   * get_mass_tracking_number 50 kiện) cho đơn còn thiếu mã; mass API lỗi thì
   * hỏi từng đơn như trước. Lỗi kiểu "chưa có" coi là ĐANG CHỜ; chỉ lỗi thật
   * (token hỏng…) mới ném ra cho route xử.
   */
  async probeLabelReadiness(channel, orders): Promise<LabelReadiness> {
    const out: LabelReadiness = { ready: [], waiting: [], discovered: new Map() };
    const missing = orders.filter((o) => !o.trackingCode);
    for (const o of orders) if (o.trackingCode) out.ready.push(o.id);
    if (missing.length === 0) return out;

    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    let leftover = missing;
    try {
      const { refs, missing: noPackage } = await loadPackages(accessToken, shopId, missing);
      const tracking = await massTracking(accessToken, shopId, refs.map((r) => r.packageNumber));
      const seen = new Set<string>();
      for (const r of refs) {
        if (seen.has(r.order.id)) continue;
        seen.add(r.order.id);
        const code = tracking.get(r.packageNumber) ?? null;
        if (code) {
          out.ready.push(r.order.id);
          out.discovered.set(r.order.id, { trackingCode: code });
        } else {
          out.waiting.push({ orderId: r.order.id, orderCode: r.order.orderCode, reason: "Sàn chưa cấp mã vận đơn" });
        }
      }
      leftover = noPackage;
    } catch (err) {
      const msg = errMessage(err);
      if (/invalid_access_token|error_auth/i.test(msg)) throw err;
      console.warn(`[fulfillment.shopee] probe theo mẻ gian "${channel.shopName}" lỗi, hỏi từng đơn:`, msg);
      leftover = missing;
    }
    for (const o of leftover) {
      try {
        const tracking = await getTrackingNumber(accessToken, shopId, o.orderCode);
        if (tracking) {
          out.ready.push(o.id);
          out.discovered.set(o.id, { trackingCode: tracking });
        } else {
          out.waiting.push({ orderId: o.id, orderCode: o.orderCode, reason: "Sàn chưa cấp mã vận đơn" });
        }
      } catch (err) {
        const msg = errMessage(err);
        if (!isNotReadyError(msg)) throw err;
        out.waiting.push({ orderId: o.id, orderCode: o.orderCode, reason: msg });
      }
    }
    return out;
  },

  async fetchLabels(channel, orders, opts?: LabelFetchOptions): Promise<LabelFetchResult> {
    const result: LabelFetchResult = { pdfs: new Map(), discovered: new Map(), failed: [] };
    const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
    const byCode = new Map(orders.map((o) => [o.orderCode, o]));
    const fail = (o: FulfillOrderRef, reason: string) =>
      result.failed.push({ orderId: o.id, orderCode: o.orderCode, reason });

    // (1) Đảm bảo mã vận đơn — create_shipping_document cần tracking_number.
    // Đơn vừa ship_order có thể chưa có mã: hỏi lại vài vòng thay vì bỏ ngay
    // (đây là lý do "chuẩn bị 4 in được 1" trước 05/09). Hỏi theo mẻ trước
    // (2 lượt / 50 đơn), mass API lỗi mới hỏi từng đơn.
    const ready: { order: FulfillOrderRef; tracking: string }[] = [];
    let missing: FulfillOrderRef[] = [];
    for (const o of orders) {
      if (o.trackingCode) ready.push({ order: o, tracking: o.trackingCode });
      else missing.push(o);
    }
    const lastReason = new Map<string, string>();
    for (let round = 0; round < TRACKING_ROUNDS && missing.length > 0; round++) {
      if (round > 0) await sleep(TRACKING_DELAY_MS);
      const still: FulfillOrderRef[] = [];
      let perOrderList = missing;
      try {
        const { refs, missing: noPackage } = await loadPackages(accessToken, shopId, missing);
        const tracking = await massTracking(accessToken, shopId, refs.map((r) => r.packageNumber));
        const seen = new Set<string>();
        for (const r of refs) {
          if (seen.has(r.order.id)) continue;
          seen.add(r.order.id);
          const code = tracking.get(r.packageNumber) ?? null;
          if (code) {
            result.discovered.set(r.order.id, { trackingCode: code });
            ready.push({ order: r.order, tracking: code });
          } else {
            lastReason.set(r.order.id, "Sàn chưa cấp mã vận đơn — đợi ít phút rồi in lại");
            still.push(r.order);
          }
        }
        perOrderList = noPackage;
      } catch (err) {
        console.warn(`[fulfillment.shopee] tracking theo mẻ gian "${channel.shopName}" lỗi, hỏi từng đơn:`, errMessage(err));
      }
      for (const o of perOrderList) {
        try {
          const tracking = await getTrackingNumber(accessToken, shopId, o.orderCode);
          if (tracking) {
            result.discovered.set(o.id, { trackingCode: tracking });
            ready.push({ order: o, tracking });
          } else {
            lastReason.set(o.id, "Sàn chưa cấp mã vận đơn — đợi ít phút rồi in lại");
            still.push(o);
          }
        } catch (err) {
          const msg = errMessage(err);
          lastReason.set(o.id, `Không lấy được mã vận đơn: ${msg}`);
          if (isNotReadyError(msg)) still.push(o);
          else fail(o, `Không lấy được mã vận đơn: ${msg}`);
        }
      }
      missing = still;
    }
    for (const o of missing) fail(o, lastReason.get(o.id) ?? "Sàn chưa cấp mã vận đơn — đợi ít phút rồi in lại");
    // Giữ thứ tự seller chọn (đơn có mã sẵn và đơn vừa lấy mã trộn nhau)
    const position = new Map(orders.map((o, i) => [o.id, i]));
    ready.sort((a, b) => (position.get(a.order.id) ?? 0) - (position.get(b.order.id) ?? 0));

    for (let i = 0; i < ready.length; i += BATCH) {
      const chunkList = ready.slice(i, i + BATCH);
      // (2) Loại phiếu khả dụng theo từng đơn — ưu tiên nhiệt A6
      const docType = new Map<string, string>();
      try {
        const rows = await getShippingDocumentParameter(
          accessToken,
          shopId,
          chunkList.map((c) => ({ order_sn: c.order.orderCode }))
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
        for (const c of chunkList) docType.set(c.order.orderCode, PREFERRED_DOC);
      }
      const toCreate = chunkList.filter((c) => docType.has(c.order.orderCode));
      if (toCreate.length === 0) continue;

      // (3) Yêu cầu dựng file — đã dựng rồi sàn báo lỗi "exist" thì coi như xong.
      // Sàn báo "chưa sẵn" (đơn vừa ship_order xong) → đợi rồi thử lại MỘT lần
      // cho riêng các đơn đó thay vì loại khỏi file in.
      let createList = toCreate;
      for (let attempt = 0; attempt < 2 && createList.length > 0; attempt++) {
        if (attempt > 0) await sleep(CREATE_RETRY_DELAY_MS);
        const retry: typeof toCreate = [];
        try {
          const rows = await createShippingDocument(
            accessToken,
            shopId,
            createList.map((c) => ({
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
            if (!o) continue;
            const item = createList.find((c) => c.order.orderCode === r.order_sn);
            if (attempt === 0 && item && isNotReadyError(text)) {
              retry.push(item);
              continue;
            }
            fail(o, r.fail_message || r.fail_error);
            docType.delete(r.order_sn);
          }
        } catch (err) {
          for (const c of createList) {
            fail(c.order, `Sàn không dựng được vận đơn: ${errMessage(err)}`);
            docType.delete(c.order.orderCode);
          }
          break;
        }
        createList = retry;
      }
      if (!toCreate.some((c) => docType.has(c.order.orderCode))) continue;

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

      const downloadable = toCreate.filter((c) => readyCodes.has(c.order.orderCode));

      // (5a) Tải GỘP: một file cho cả nhóm cùng loại phiếu (sàn ràng "cùng
      // hãng" — nhóm có nhiều hãng sàn từ chối → lùi về từng đơn). Chỉ khi
      // không in kèm phiếu xuất hàng.
      const perOrderDownload: typeof downloadable = [];
      if (opts?.combined) {
        const byType = new Map<string, typeof downloadable>();
        for (const c of downloadable) {
          const t = docType.get(c.order.orderCode) ?? PREFERRED_DOC;
          byType.set(t, [...(byType.get(t) ?? []), c]);
        }
        for (const [type, list] of byType) {
          if (list.length === 1) {
            perOrderDownload.push(...list);
            continue;
          }
          try {
            const pdf = await downloadShippingDocument(
              accessToken,
              shopId,
              type,
              list.map((c) => ({ order_sn: c.order.orderCode }))
            );
            (result.combined ??= []).push({ orderIds: list.map((c) => c.order.id), pdf });
          } catch (err) {
            console.warn(`[fulfillment.shopee] tải gộp ${list.length} vận đơn lỗi, tải từng đơn:`, errMessage(err));
            perOrderDownload.push(...list);
          }
        }
      } else {
        perOrderDownload.push(...downloadable);
      }

      // (5b) Tải từng đơn một để ghép đúng cặp vận đơn + phiếu nhặt
      for (const c of perOrderDownload) {
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
