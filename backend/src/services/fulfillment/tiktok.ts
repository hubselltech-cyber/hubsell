// ============================================================
// ADAPTER TIKTOK SHOP — ship package → tracking → vận đơn PDF (16/09/2026)
//
// Luồng thật của sàn (API 202309):
//   1. Order detail trả `packages[].id` — Hubsell lưu kiện đầu vào
//      Order.platformPackageId lúc đồng bộ đơn; thiếu thì hỏi lại sàn.
//   2. GET /packages/{id}/handover_time_slots → can_pickup / drop_off_option +
//      khung giờ LSP tới lấy (pickup).
//   3. POST /packages/{id}/ship { handover_method: PICKUP|DROP_OFF, pickup_slot? }
//   4. GET /packages/{id} → tracking_number + hãng (sàn cấp ngay hoặc vài giây).
//   5. GET /packages/{id}/shipping_documents?document_type=SHIPPING_LABEL&
//      document_size=A6 → doc_url PDF (chỉ kiện "TikTok Shipping" đã ship).
//
// Hộp thoại chung của 3 sàn hỏi pickup/dropoff + địa chỉ + khung giờ: TikTok
// không cho chọn địa chỉ qua API (cài ở Seller Center) → một "địa chỉ" giả
// định mang danh sách khung giờ; DROPOFF không cần bưu cục.
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelName } from "@prisma/client";
import {
  getHandoverTimeSlots,
  getOrderDetail,
  getPackageDetail,
  getShippingDocument,
  shipPackage,
  type TikTokHandoverSlot,
} from "../../integrations/tiktok/client";
import { getValidAccessToken } from "../../integrations/tiktok/service";
import { isTikTokConfigured } from "../../integrations/tiktok/config";
import {
  errMessage,
  humanizeArrangeError,
  isNotReadyError,
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
  shippingDocuments: (packageId: string) =>
    `/fulfillment/202309/packages/${packageId}/shipping_documents`,
} as const;

/** "Địa chỉ" giả định — TikTok lấy hàng tại địa chỉ gian cài trên Seller Center. */
const DEFAULT_ADDRESS_ID = "seller-center";
/** Đợi sàn cấp tracking sau khi ship: 3 vòng × 2s. */
const TRACKING_ROUNDS = 3;
const TRACKING_DELAY_MS = 2000;
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

/** Tải một URL, trả Buffer nếu đúng là PDF; null nếu lỗi/không phải PDF. */
async function fetchPdf(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, 4).toString("latin1") === "%PDF" ? buf : null;
  } catch {
    return null;
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

  async probeLabelReadiness(channel, orders): Promise<LabelReadiness> {
    const out: LabelReadiness = { ready: [], waiting: [], discovered: new Map() };
    const missing = orders.filter((o) => !o.trackingCode || !o.platformPackageId);
    for (const o of orders) if (o.trackingCode && o.platformPackageId) out.ready.push(o.id);
    if (missing.length === 0) return out;
    const auth = await getValidAccessToken(channel);
    for (const o of missing) {
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
    for (const o of orders) {
      try {
        const packageId = await resolvePackageId(auth, o);
        if (!packageId) {
          result.failed.push({ orderId: o.id, orderCode: o.orderCode, reason: "Sàn chưa tạo kiện cho đơn này" });
          continue;
        }
        if (!o.platformPackageId) result.discovered.set(o.id, { packageId });
        const doc = await getShippingDocument({ ...auth, packageId });
        const url = doc.doc_url?.trim();
        const pdf = url ? await fetchPdf(url) : null;
        if (!pdf) {
          throw new Error("sàn không trả file PDF vận đơn (kiện chưa ship hoặc shop tự giao) — in tạm từ Seller Center");
        }
        result.pdfs.set(o.id, pdf);
      } catch (err) {
        result.failed.push({ orderId: o.id, orderCode: o.orderCode, reason: errMessage(err) });
      }
    }
    return result;
  },
};
