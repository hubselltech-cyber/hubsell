// ============================================================
// ADAPTER TIKTOK SHOP — ship package → tracking → vận đơn PDF (16/09/2026)
//
// Luồng thật của sàn (API 202309):
//   1. Order detail trả `packages[].id` — Hubsell lưu kiện đầu vào
//      Order.platformPackageId lúc đồng bộ đơn; thiếu thì hỏi lại sàn.
//   2. GET /packages/{id}/handover_time_slots → can_pickup / drop_off_option +
//      khung giờ LSP tới lấy (pickup).
//   3. POST /packages/{id}/ship { handover_method: PICKUP|DROP_OFF, pickup_slot? }
//      — THEO MẺ (14/10/2026): POST /packages/ship body `packages[]` (Batch Ship
//      Packages, docs không ghi trần → Hubsell cắt 50 kiện/lượt như Shopee);
//      code 0 vẫn có thể kèm data.errors[] theo kiện.
//   4. GET /packages/{id} → tracking_number + hãng (sàn cấp ngay hoặc vài giây).
//      Theo mẻ: GET /order/202309/orders?ids= (50 đơn/lượt) có sẵn tracking_number
//      + shipping_provider → không hỏi từng kiện.
//   5. GET /packages/{id}/shipping_documents?document_type=
//      SHIPPING_LABEL_AND_PACKING_SLIP&document_size=A6 → doc_url PDF (chỉ
//      kiện "TikTok Shipping" đã ship). 16/09 anh Trung test đơn thật: tem
//      SHIPPING_LABEL trần KHÔNG có danh sách sản phẩm, còn Seller Center in
//      bản gộp tem + phiếu đóng gói → Hubsell xin bản gộp như sàn, sàn từ chối
//      (LSP không hỗ trợ) mới lùi về tem trần. Shop bán ngành 1 món/đơn nhờ đó
//      không cần in thêm phiếu xuất hàng Hubsell. Sàn chỉ có API từng kiện →
//      tải song song LABEL_CONCURRENCY kiện một lúc.
//
// Hộp thoại chung của 3 sàn hỏi pickup/dropoff + địa chỉ + khung giờ: TikTok
// không cho chọn địa chỉ qua API (cài ở Seller Center) → một "địa chỉ" giả
// định mang danh sách khung giờ; DROPOFF không cần bưu cục.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelName } from "@prisma/client";
import {
  batchShipPackages,
  getHandoverTimeSlots,
  getOrderDetail,
  getPackageDetail,
  getShippingDocument,
  shipPackage,
  type TikTokHandoverSlot,
  type TikTokOrder,
} from "../../integrations/tiktok/client";
import { getValidAccessToken } from "../../integrations/tiktok/service";
import { isTikTokConfigured } from "../../integrations/tiktok/config";
import { platformFetch } from "../../lib/platform-http";
import {
  chunk,
  errMessage,
  humanizeArrangeError,
  isNotReadyError,
  mapWithLimit,
  type AdapterShippingOptions,
  type ArrangeResult,
  type FulfillMethod,
  type FulfillOrderRef,
  type FulfillmentAdapter,
  type LabelFetchResult,
  type LabelReadiness,
  type ShippingOptionSlot,
} from "./types";

export const TIKTOK_FULFILLMENT_PATHS = {
  shipPackage: (packageId: string) => `/fulfillment/202309/packages/${packageId}/ship`,
  batchShip: "/fulfillment/202309/packages/ship",
  shippingDocuments: (packageId: string) =>
    `/fulfillment/202309/packages/${packageId}/shipping_documents`,
} as const;

/** "Địa chỉ" giả định — TikTok lấy hàng tại địa chỉ gian cài trên Seller Center. */
const DEFAULT_ADDRESS_ID = "seller-center";
/** Đợi sàn cấp tracking sau khi ship: 3 vòng × 2s. */
const TRACKING_ROUNDS = 3;
const TRACKING_DELAY_MS = 2000;
/** Trần id/lượt của GET /order/202309/orders (docs 14/10/2026: "One to 50"). */
const ORDER_DETAIL_BATCH = 50;
/** Số kiện mỗi lượt Batch Ship — docs không ghi trần, tự chọn bằng Shopee để đo. */
export const SHIP_BATCH = 50;
/** Số vận đơn tải song song — sàn chỉ có API từng kiện; 4 để không dồn 429. */
const LABEL_CONCURRENCY = 4;
/** Nhịp giữa hai lượt ship từng kiện khi lùi về đường cũ. */
const ARRANGE_GAP_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Auth = { accessToken: string; shopCipher: string };

/** Khung giờ → id "start-end" + nhãn giờ VN. */
function slotOf(s: TikTokHandoverSlot): ShippingOptionSlot | null {
  const start = Number(s.start_time ?? 0);
  const end = Number(s.end_time ?? 0);
  if (!start || !end) return null;
  if (s.available === false || s.avaliable === false) return null;
  const fmt = (sec: number) =>
    new Date(sec * 1000).toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  return { id: `${start}-${end}`, label: `${fmt(start)} – ${fmt(end)}` };
}

function parseSlotId(id?: string): { start_time: number; end_time: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(id ?? "");
  if (!m) return null;
  return { start_time: Number(m[1]), end_time: Number(m[2]) };
}

/** Sàn từ chối vì app THIẾU SCOPE (code 105005 — 16/09: handover_time_slots
 *  không nằm trong Fulfillment Basic). Khi đó bỏ khung giờ, vẫn ship theo
 *  phương thức; ship package/shipping_documents thuộc scope cơ bản. */
function isScopeError(err: unknown): boolean {
  const m = errMessage(err).toLowerCase();
  return m.includes("105005") || m.includes("access scope") || m.includes("permission");
}

const NO_SLOT_NOTE =
  "TikTok lấy hàng tại địa chỉ gian đã cài trên Seller Center; app Hubsell chưa có quyền đọc khung giờ (sàn tự xếp khung gần nhất).";

/** Kiện của đơn: đã lưu thì dùng, chưa thì hỏi lại chi tiết đơn (packages[0]). */
async function resolvePackageId(auth: Auth, order: FulfillOrderRef): Promise<string | null> {
  if (order.platformPackageId) return order.platformPackageId;
  const details = await getOrderDetail({ ...auth, orderIds: [order.orderCode] });
  const id = details[0]?.packages?.[0]?.id?.trim();
  return id || null;
}

/** Chi tiết nhiều đơn theo mẻ 50 id → map theo mã đơn. */
async function loadOrderDetails(auth: Auth, orders: FulfillOrderRef[]): Promise<Map<string, TikTokOrder>> {
  const out = new Map<string, TikTokOrder>();
  for (const part of chunk(orders, ORDER_DETAIL_BATCH)) {
    const details = await getOrderDetail({ ...auth, orderIds: part.map((o) => o.orderCode) });
    for (const d of details) if (d.id) out.set(String(d.id), d);
  }
  return out;
}

/** Thứ tự xin vận đơn: bản gộp tem + danh sách sản phẩm (như Seller Center)
 *  trước, tem trần sau — sàn/LSP nào không hỗ trợ bản gộp thì vẫn ra tem. */
export const TIKTOK_LABEL_DOC_TYPES = ["SHIPPING_LABEL_AND_PACKING_SLIP", "SHIPPING_LABEL"] as const;

/** Vận đơn PDF của một kiện: thử từng loại phiếu theo TIKTOK_LABEL_DOC_TYPES,
 *  trả PDF đầu tiên tải được; null nếu loại nào cũng không ra file. */
export async function fetchTikTokLabelPdf(auth: Auth, packageId: string): Promise<Buffer | null> {
  let lastErr: unknown = null;
  for (const documentType of TIKTOK_LABEL_DOC_TYPES) {
    try {
      const doc = await getShippingDocument({ ...auth, packageId, documentType });
      const url = doc.doc_url?.trim();
      const pdf = url ? await fetchPdf(url) : null;
      if (pdf) return pdf;
      lastErr = null; // sàn trả lời nhưng không có file — thử loại phiếu kế
    } catch (err) {
      // Kiện chưa ship/chưa sẵn: đổi loại phiếu không cứu được → ném ngay.
      if (isNotReadyError(errMessage(err))) throw err;
      lastErr = err;
      console.warn(`[fulfillment.tiktok] shipping_documents ${documentType} kiện ${packageId}:`, errMessage(err));
    }
  }
  // Loại phiếu cuối cùng cũng bị sàn từ chối → ném để route ghi đúng lý do.
  if (lastErr) throw lastErr;
  return null;
}

/** Tải một URL, trả Buffer nếu đúng là PDF; null nếu lỗi/không phải PDF. */
async function fetchPdf(url: string): Promise<Buffer | null> {
  try {
    const res = await platformFetch("TIKTOK_FILE", url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, 4).toString("latin1") === "%PDF" ? buf : null;
  } catch {
    return null;
  }
}

/** Sắp xếp từng kiện tuần tự (đường cũ) — đường lùi khi Batch Ship lỗi cả mẻ. */
async function arrangeSequential(
  channel: Channel,
  orders: FulfillOrderRef[],
  choice: Parameters<FulfillmentAdapter["arrangeShipment"]>[2],
  results: Map<string, ArrangeResult>,
  onProgress?: (done: number) => void
): Promise<void> {
  for (const [idx, o] of orders.entries()) {
    if (idx > 0) await sleep(ARRANGE_GAP_MS);
    results.set(o.id, await tiktokFulfillment.arrangeShipment(channel, o, choice));
    onProgress?.(results.size);
  }
}

export const tiktokFulfillment: FulfillmentAdapter = {
  channelName: ChannelName.TIKTOK,
  supported: true,

  async getShippingOptions(channel, sample): Promise<AdapterShippingOptions> {
    if (!isTikTokConfigured()) throw new Error("Máy chủ chưa cấu hình TikTok Shop");
    const auth = await getValidAccessToken(channel);
    const packageId = await resolvePackageId(auth, sample);
    if (!packageId) {
      return {
        methods: [],
        pickupAddresses: [],
        dropoffBranches: [],
        note: "Sàn chưa tạo kiện cho đơn mẫu — TikTok sẽ tự sắp xếp theo cài đặt gian trên Seller Center.",
      };
    }
    let slots: Awaited<ReturnType<typeof getHandoverTimeSlots>>;
    try {
      slots = await getHandoverTimeSlots({ ...auth, packageId });
    } catch (err) {
      if (!isScopeError(err)) throw err;
      // Không đọc được khung giờ → vẫn cho chọn phương thức, không có khung giờ.
      return {
        methods: ["PICKUP", "DROPOFF"],
        pickupAddresses: [
          {
            id: DEFAULT_ADDRESS_ID,
            label: "Địa chỉ lấy hàng của gian (cài trên TikTok Seller Center)",
            isDefault: true,
            timeSlots: [],
          },
        ],
        dropoffBranches: [],
        note: NO_SLOT_NOTE,
      };
    }
    const methods: FulfillMethod[] = [];
    if (slots.can_pickup !== false) methods.push("PICKUP");
    if (slots.drop_off_option) methods.push("DROPOFF");
    const timeSlots = (slots.handover_time_slots ?? [])
      .map(slotOf)
      .filter((s): s is ShippingOptionSlot => Boolean(s));
    return {
      methods,
      pickupAddresses: methods.includes("PICKUP")
        ? [
            {
              id: DEFAULT_ADDRESS_ID,
              label: "Địa chỉ lấy hàng của gian (cài trên TikTok Seller Center)",
              isDefault: true,
              timeSlots,
            },
          ]
        : [],
      dropoffBranches: [],
      note: "TikTok lấy hàng tại địa chỉ gian đã cài trên Seller Center; chọn khung giờ nếu để shipper tới lấy.",
    };
  },

  async arrangeShipment(channel, order, choice): Promise<ArrangeResult> {
    try {
      const auth = await getValidAccessToken(channel);
      const packageId = await resolvePackageId(auth, order);
      if (!packageId) return { ok: false, error: "Sàn chưa tạo kiện cho đơn này — đợi ít phút hoặc xử lý trên Seller Center" };

      let note: string | undefined;
      let handoverMethod: "PICKUP" | "DROP_OFF" = choice.method === "DROPOFF" ? "DROP_OFF" : "PICKUP";
      let pickupSlot = handoverMethod === "PICKUP" ? parseSlotId(choice.pickupTimeId) ?? undefined : undefined;
      if (handoverMethod === "PICKUP" && !pickupSlot) {
        // Seller không chọn khung giờ → lấy khung sớm nhất sàn còn mở. App thiếu
        // scope đọc khung giờ → ship không kèm pickup_slot (sàn tự xếp).
        try {
          const slots = await getHandoverTimeSlots({ ...auth, packageId });
          const first = (slots.handover_time_slots ?? []).map(slotOf).find(Boolean);
          pickupSlot = first ? parseSlotId(first.id) ?? undefined : undefined;
          if (!pickupSlot && slots.drop_off_option) {
            handoverMethod = "DROP_OFF";
            note = "Sàn không còn khung giờ lấy hàng — chuyển sang tự mang ra bưu cục";
          }
        } catch (err) {
          if (!isScopeError(err)) throw err;
          note = "Sàn tự xếp khung giờ lấy hàng (app chưa có quyền đọc khung giờ)";
        }
      }
      await shipPackage({ ...auth, packageId, handoverMethod, pickupSlot });

      // Sàn cấp tracking ngay hoặc vài giây sau — hỏi lại vài vòng.
      let trackingCode: string | null = null;
      let carrierName: string | null = null;
      for (let round = 0; round < TRACKING_ROUNDS; round++) {
        if (round > 0) await sleep(TRACKING_DELAY_MS);
        try {
          const pkg = await getPackageDetail({ ...auth, packageId });
          trackingCode = pkg.tracking_number?.trim() || null;
          carrierName = pkg.shipping_provider_name?.trim() || null;
          if (trackingCode) break;
        } catch {
          // chưa sẵn — thử vòng sau
        }
      }
      return { ok: true, packageId, trackingCode, carrierName, note };
    } catch (err) {
      return { ok: false, error: humanizeArrangeError(errMessage(err)) };
    }
  },

  /**
   * Theo mẻ: chi tiết đơn 50/lượt (lấy kiện) → Batch Ship 50 kiện/lượt →
   * chi tiết đơn 50/lượt lấy mã vận đơn + hãng (3 vòng cho kiện sàn cấp trễ).
   * Khung giờ: một lượt hỏi trên kiện đầu, dùng chung cho cả mẻ (cùng địa chỉ
   * gian). Mẻ nào sàn từ chối cả lượt → lùi về từng kiện cho riêng mẻ đó.
   */
  async arrangeShipmentBatch(channel, orders, choice, onProgress): Promise<Map<string, ArrangeResult>> {
    const results = new Map<string, ArrangeResult>();
    let auth: Auth;
    try {
      auth = await getValidAccessToken(channel);
    } catch (err) {
      const error = humanizeArrangeError(errMessage(err));
      for (const o of orders) results.set(o.id, { ok: false, error });
      return results;
    }

    // 1. Mã kiện: đã lưu thì dùng; thiếu thì hỏi chi tiết đơn theo mẻ.
    const packageOf = new Map<string, string>();
    const needDetail = orders.filter((o) => !o.platformPackageId);
    for (const o of orders) if (o.platformPackageId) packageOf.set(o.id, o.platformPackageId);
    if (needDetail.length > 0) {
      try {
        const details = await loadOrderDetails(auth, needDetail);
        for (const o of needDetail) {
          const id = details.get(o.orderCode)?.packages?.[0]?.id?.trim();
          if (id) packageOf.set(o.id, id);
        }
      } catch (err) {
        console.warn(`[fulfillment.tiktok] chi tiết đơn theo mẻ gian "${channel.shopName}" lỗi, lùi về từng kiện:`, errMessage(err));
        await arrangeSequential(channel, orders, choice, results, onProgress);
        return results;
      }
    }
    const shippable = orders.filter((o) => packageOf.has(o.id));
    for (const o of orders) {
      if (!packageOf.has(o.id)) {
        results.set(o.id, { ok: false, error: "Sàn chưa tạo kiện cho đơn này — đợi ít phút hoặc xử lý trên Seller Center" });
      }
    }
    onProgress?.(results.size);
    if (shippable.length === 0) return results;

    // 2. Phương thức + khung giờ dùng chung cho mẻ (hỏi trên kiện đầu).
    let note: string | undefined;
    let handoverMethod: "PICKUP" | "DROP_OFF" = choice.method === "DROPOFF" ? "DROP_OFF" : "PICKUP";
    let pickupSlot = handoverMethod === "PICKUP" ? parseSlotId(choice.pickupTimeId) ?? undefined : undefined;
    if (handoverMethod === "PICKUP" && !pickupSlot) {
      try {
        const slots = await getHandoverTimeSlots({ ...auth, packageId: packageOf.get(shippable[0].id)! });
        const first = (slots.handover_time_slots ?? []).map(slotOf).find(Boolean);
        pickupSlot = first ? parseSlotId(first.id) ?? undefined : undefined;
        if (!pickupSlot && slots.drop_off_option) {
          handoverMethod = "DROP_OFF";
          note = "Sàn không còn khung giờ lấy hàng — chuyển sang tự mang ra bưu cục";
        }
      } catch (err) {
        if (isScopeError(err)) note = "Sàn tự xếp khung giờ lấy hàng (app chưa có quyền đọc khung giờ)";
        else console.warn(`[fulfillment.tiktok] handover_time_slots gian "${channel.shopName}":`, errMessage(err));
      }
    }

    // 3. Batch Ship từng mẻ SHIP_BATCH kiện.
    const shipped: FulfillOrderRef[] = [];
    for (const part of chunk(shippable, SHIP_BATCH)) {
      try {
        const errors = await batchShipPackages({
          ...auth,
          packages: part.map((o) => ({ id: packageOf.get(o.id)!, handoverMethod, pickupSlot })),
        });
        for (const o of part) {
          const reason = errors.get(packageOf.get(o.id)!);
          if (reason) results.set(o.id, { ok: false, error: humanizeArrangeError(reason) });
          else shipped.push(o);
        }
      } catch (err) {
        console.warn(`[fulfillment.tiktok] Batch Ship gian "${channel.shopName}" mẻ ${part.length} kiện lỗi, lùi về từng kiện:`, errMessage(err));
        await arrangeSequential(channel, part, choice, results, () => onProgress?.(results.size));
      }
      onProgress?.(results.size + shipped.length);
    }

    // 4. Mã vận đơn + hãng theo mẻ 50 đơn; sàn cấp trễ → hỏi lại tối đa 3 vòng.
    const tracking = new Map<string, { trackingCode: string | null; carrierName: string | null }>();
    let pending = shipped;
    for (let round = 0; round < TRACKING_ROUNDS && pending.length > 0; round++) {
      if (round > 0) await sleep(TRACKING_DELAY_MS);
      let details: Map<string, TikTokOrder>;
      try {
        details = await loadOrderDetails(auth, pending);
      } catch (err) {
        console.warn(`[fulfillment.tiktok] đọc mã vận đơn theo mẻ gian "${channel.shopName}":`, errMessage(err));
        break;
      }
      const still: FulfillOrderRef[] = [];
      for (const o of pending) {
        const d = details.get(o.orderCode);
        const code = d?.tracking_number?.trim() || null;
        if (code) tracking.set(o.id, { trackingCode: code, carrierName: d?.shipping_provider?.trim() || null });
        else still.push(o);
      }
      pending = still;
    }
    for (const o of shipped) {
      const t = tracking.get(o.id);
      results.set(o.id, {
        ok: true,
        packageId: packageOf.get(o.id),
        trackingCode: t?.trackingCode ?? null,
        carrierName: t?.carrierName ?? null,
        note,
      });
    }
    onProgress?.(results.size);
    return results;
  },

  /**
   * Sàn đã cấp mã vận đơn chưa? Hỏi chi tiết đơn theo mẻ 50 (có sẵn kiện + mã)
   * thay vì từng kiện; mẻ lỗi thì hỏi từng kiện như trước.
   */
  async probeLabelReadiness(channel, orders): Promise<LabelReadiness> {
    const out: LabelReadiness = { ready: [], waiting: [], discovered: new Map() };
    const missing = orders.filter((o) => !o.trackingCode || !o.platformPackageId);
    for (const o of orders) if (o.trackingCode && o.platformPackageId) out.ready.push(o.id);
    if (missing.length === 0) return out;
    const auth = await getValidAccessToken(channel);

    let leftover = missing;
    try {
      const details = await loadOrderDetails(auth, missing);
      leftover = [];
      for (const o of missing) {
        const d = details.get(o.orderCode);
        if (!d) {
          leftover.push(o);
          continue;
        }
        const packageId = o.platformPackageId || d.packages?.[0]?.id?.trim() || null;
        const tracking = d.tracking_number?.trim() || null;
        if (!packageId) {
          out.waiting.push({ orderId: o.id, orderCode: o.orderCode, reason: "Sàn chưa tạo kiện cho đơn" });
          continue;
        }
        if (tracking) {
          out.ready.push(o.id);
          out.discovered.set(o.id, { packageId, trackingCode: tracking });
        } else {
          out.discovered.set(o.id, { packageId });
          out.waiting.push({ orderId: o.id, orderCode: o.orderCode, reason: "Sàn chưa cấp mã vận đơn" });
        }
      }
    } catch (err) {
      const msg = errMessage(err);
      if (/token|permission|scope/i.test(msg) && !isNotReadyError(msg)) throw err;
      console.warn(`[fulfillment.tiktok] probe theo mẻ gian "${channel.shopName}" lỗi, hỏi từng kiện:`, msg);
      leftover = missing;
    }
    for (const o of leftover) {
      try {
        const packageId = await resolvePackageId(auth, o);
        if (!packageId) {
          out.waiting.push({ orderId: o.id, orderCode: o.orderCode, reason: "Sàn chưa tạo kiện cho đơn" });
          continue;
        }
        const pkg = await getPackageDetail({ ...auth, packageId });
        const tracking = pkg.tracking_number?.trim() || null;
        if (tracking) {
          out.ready.push(o.id);
          out.discovered.set(o.id, { packageId, trackingCode: tracking });
        } else {
          out.discovered.set(o.id, { packageId });
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

  async fetchLabels(channel, orders): Promise<LabelFetchResult> {
    const result: LabelFetchResult = { pdfs: new Map(), discovered: new Map(), failed: [] };
    const auth = await getValidAccessToken(channel);
    // Sàn chỉ có API vận đơn từng kiện → tải song song có giới hạn; kết quả ghi
    // theo id đơn nên thứ tự hoàn thành không ảnh hưởng thứ tự in (route ghép
    // theo thứ tự seller chọn).
    await mapWithLimit(orders, LABEL_CONCURRENCY, async (o) => {
      try {
        const packageId = await resolvePackageId(auth, o);
        if (!packageId) {
          result.failed.push({ orderId: o.id, orderCode: o.orderCode, reason: "Sàn chưa tạo kiện cho đơn này" });
          return;
        }
        if (!o.platformPackageId) result.discovered.set(o.id, { packageId });
        const pdf = await fetchTikTokLabelPdf(auth, packageId);
        if (!pdf) {
          throw new Error("sàn không trả file PDF vận đơn (kiện chưa ship hoặc shop tự giao) — in tạm từ Seller Center");
        }
        result.pdfs.set(o.id, pdf);
      } catch (err) {
        result.failed.push({ orderId: o.id, orderCode: o.orderCode, reason: errMessage(err) });
      }
    });
    return result;
  },
};
