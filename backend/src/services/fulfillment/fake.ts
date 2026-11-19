// ============================================================
// ADAPTER GIẢ LẬP SÀN — CHỈ MÁY DEV (19/11/2026)
//
// Gian seed trên máy dev không có token thật nên luồng Chuẩn bị hàng → In phiếu không
// chạy thử được (web lẫn app). Đặt FULFILLMENT_FAKE=1 khi chạy backend local: mọi sàn
// trả phương án vận chuyển mẫu, "nhận" đơn sau một nhịp ngắn và trả vận đơn MẪU do
// fake-label-pdf dựng. Không bao giờ chạy ở production (index.ts chặn theo NODE_ENV).
//
// Ca lỗi để soi giao diện: mã đơn kết thúc bằng "FAIL" → sàn từ chối; kết thúc bằng
// "NOLABEL" → sàn nhận nhưng không trả vận đơn.
// ============================================================

import { ChannelName, type Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { buildFakeLabelPdf } from "./fake-label-pdf";
import type {
  AdapterShippingOptions,
  ArrangeResult,
  FulfillChoice,
  FulfillmentAdapter,
  FulfillOrderRef,
  LabelFetchResult,
} from "./types";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Nhịp giả giữa hai đơn — đủ để thấy thanh tiến độ chạy, không làm test chậm. */
const FAKE_GAP_MS = Number(process.env.FULFILLMENT_FAKE_GAP_MS ?? 120);

function fakeTracking(channelName: ChannelName, orderCode: string): string {
  const digits = [...orderCode].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 1_000_000_000, 7);
  const prefix = channelName === ChannelName.SHOPEE ? "SPXVN0" : channelName === ChannelName.TIKTOK ? "8627" : "LZDVN";
  return `${prefix}${String(digits).padStart(9, "0")}`;
}

function options(channelName: ChannelName): AdapterShippingOptions {
  if (channelName === ChannelName.LAZADA) {
    return {
      methods: [],
      pickupAddresses: [],
      dropoffBranches: [],
      note: "Lazada tự sắp xếp vận chuyển theo cài đặt của gian trên Seller Center",
    };
  }
  const slots = [
    { id: "slot-1", label: "Hôm nay, 14:00 – 18:00" },
    { id: "slot-2", label: "Ngày mai, 08:00 – 12:00" },
    { id: "slot-3", label: "Ngày mai, 14:00 – 18:00" },
  ];
  return {
    methods: ["PICKUP", "DROPOFF"],
    pickupAddresses: [
      {
        id: "addr-1",
        label: "Kho chính — 12 ngõ 34 Nguyễn Văn Cừ, Phường Bồ Đề, Hà Nội",
        isDefault: true,
        timeSlots: slots,
      },
      {
        id: "addr-2",
        label: "Kho phụ — Lô B2 Khu công nghiệp Tân Bình, Phường Tây Thạnh, TP. Hồ Chí Minh",
        isDefault: false,
        timeSlots: slots.slice(1),
      },
    ],
    dropoffBranches:
      channelName === ChannelName.SHOPEE
        ? [
            { id: "br-1", label: "Bưu cục SPX Long Biên" },
            { id: "br-2", label: "Bưu cục SPX Gia Lâm" },
          ]
        : [],
  };
}

function arrangeOne(channel: Channel, order: FulfillOrderRef, _choice: FulfillChoice): ArrangeResult {
  if (/FAIL$/i.test(order.orderCode)) {
    return { ok: false, error: "Sàn báo đơn đã được sắp xếp vận chuyển trên Seller Center rồi" };
  }
  return {
    ok: true,
    trackingCode: fakeTracking(channel.channelName, order.orderCode),
    packageId: `PKG-${order.orderCode}`,
  };
}

export function fakeFulfillment(channelName: ChannelName): FulfillmentAdapter {
  return {
    channelName,
    supported: true,
    async getShippingOptions() {
      await sleep(FAKE_GAP_MS * 3);
      return options(channelName);
    },
    async arrangeShipment(channel, order, choice) {
      await sleep(FAKE_GAP_MS);
      return arrangeOne(channel, order, choice);
    },
    async arrangeShipmentBatch(channel, orders, choice, onProgress) {
      const out = new Map<string, ArrangeResult>();
      for (const o of orders) {
        await sleep(FAKE_GAP_MS);
        out.set(o.id, arrangeOne(channel, o, choice));
        onProgress?.(out.size);
      }
      return out;
    },
    async fetchLabels(channel, orders): Promise<LabelFetchResult> {
      const result: LabelFetchResult = { pdfs: new Map(), discovered: new Map(), failed: [] };
      const rows = await prisma.order.findMany({
        where: { id: { in: orders.map((o) => o.id) } },
        select: {
          id: true,
          orderCode: true,
          trackingCode: true,
          shippingCarrierName: true,
          items: { select: { productName: true, variantName: true, channelSku: true, quantity: true } },
        },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const o of orders) {
        const row = byId.get(o.id);
        if (!row || /NOLABEL$/i.test(o.orderCode)) {
          result.failed.push({ orderId: o.id, orderCode: o.orderCode, reason: "Sàn chưa cấp vận đơn cho đơn này" });
          continue;
        }
        const pdf = await buildFakeLabelPdf({
          platform: channel.channelName,
          shopName: channel.shopName,
          orderCode: row.orderCode,
          trackingCode: row.trackingCode ?? fakeTracking(channel.channelName, row.orderCode),
          carrierName: row.shippingCarrierName ?? (channel.channelName === ChannelName.TIKTOK ? "J&T Express" : "SPX Express"),
          items: row.items.map((i) => ({
            name: i.productName,
            variant: i.variantName,
            sku: i.channelSku,
            quantity: i.quantity,
          })),
        });
        result.pdfs.set(o.id, Buffer.from(pdf));
      }
      return result;
    },
  };
}
