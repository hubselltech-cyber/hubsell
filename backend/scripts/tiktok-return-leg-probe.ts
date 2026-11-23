// ============================================================
// PROBE "kien TRA HANG TikTok da ve toi shop chua" — 23/11/2026
// (docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md muc 18).
//
// Vi sao: don 587267766969206097 — TikTok Seller Center bao kien tra da giao ve
// shop, nhung returns/search van tra return_status = BUYER_SHIPPED_ITEM (docs
// 202309: trang thai nay giu toi khi hoan tien xong, KHONG co buoc "kien da ve
// shop") nen cot Trang thai van chuyen o Doi soat don hoan van ghi "Dang hoan ve".
// Script nay in payload THAT cua 3 nguon de tim xem nguon nao co moc "hang da
// giao ve shop" truoc khi yeu cau hoan dong:
//   1. POST /return_refund/202309/returns/search (order_ids)  — moi khoa cua yeu cau
//   2. GET  /return_refund/202309/returns/{return_id}/records — nhat ky su kien
//   3. GET  /fulfillment/202309/orders/{order_id}/tracking    — hanh trinh hang van chuyen
//
// Truong dang ngo nhat (doc tai lieu 23/11): seller_next_action_response[] =
// { action: SELLER_RESPOND_RECEIVE_PACKAGE, deadline } — da nam san trong
// returns/search ma luot quet nao cung doc. Can biet no xuat hien TU LUC KHACH GUI
// hay CHI KHI KIEN DA VE SHOP → them "--mau" de so don moi gui voi don gui da lau.
//
// CHI DOC, khong ghi DB, khong ghi san. Moi don ton 2 + (so yeu cau hoan) call.
// Chay tren Render Shell worker (in KHONG DAU vi shell mat dau):
//   npx tsx scripts/tiktok-return-leg-probe.ts <channelId> <maDon1,maDon2,...> [--mau]
//   --mau = lay them 2 don BUYER_SHIPPED_ITEM cho ve LAU nhat + 2 don MOI nhat cua gian.
//   Toi da 5 don moi lan chay.
// ============================================================
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { callApi, getOrderTracking, searchReturns } from "../src/integrations/tiktok/client";
import { getValidAccessToken } from "../src/integrations/tiktok/service";

const MAX_ORDERS = 5;

/** Bo dau tieng Viet + ky tu ngoai ASCII de doc duoc tren Render Shell. */
const ascii = (s: unknown): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[^ -~]/g, "?");

/** Gio Viet Nam tu moc giay hoac mili giay. */
const vn = (t: unknown): string => {
  const n = Number(t ?? 0);
  if (!n) return "-";
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms + 7 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
};

/** Khoa da in rieng o dong tom tat — phan con lai in nguyen de khong sot truong la. */
const RETURN_KEYS_SHOWN = new Set([
  "return_id",
  "order_id",
  "return_type",
  "return_status",
  "arbitration_status",
  "role",
  "create_time",
  "update_time",
  "return_tracking_number",
  "return_provider_name",
  "shipment_type",
  "handover_method",
  "can_buyer_keep_item",
  // dai, khong lien quan chang ve:
  "return_line_items",
  "refund_amount",
  "return_reason",
  "return_reason_text",
]);

async function main() {
  const channelId = (process.argv[2] ?? "").trim();
  const codes = (process.argv[3] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_ORDERS);
  const withSamples = process.argv.includes("--mau");
  if (!channelId || codes.length === 0) {
    console.log("Cach dung: npx tsx scripts/tiktok-return-leg-probe.ts <channelId> <maDon1,maDon2,...> [--mau]");
    return;
  }

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.channelName !== "TIKTOK") {
    console.log(`Khong thay gian TikTok id ${channelId}`);
    return;
  }
  const auth = await getValidAccessToken(channel);

  // Don mau de so sanh: khach da gui kien, kho chua quet — cu nhat (nhieu kha nang kien da
  // ve shop) va moi nhat (nhieu kha nang con tren duong). Doc qua chi muc Order_return_awaiting_idx.
  if (withSamples) {
    const sample = (dir: "asc" | "desc") =>
      prisma.order.findMany({
        where: { channelId, returnStatus: "AWAITING", platformReturnStatus: "BUYER_SHIPPED_ITEM" },
        orderBy: { returnRequestedAt: dir },
        take: 2,
        select: { orderCode: true, returnRequestedAt: true },
      });
    for (const [label, rows] of [["LAU NHAT", await sample("asc")], ["MOI NHAT", await sample("desc")]] as const) {
      for (const r of rows) {
        if (codes.length >= MAX_ORDERS || codes.includes(r.orderCode)) continue;
        codes.push(r.orderCode);
        console.log(`[MAU ${label}] ${r.orderCode} khach mo yeu cau ${vn(r.returnRequestedAt?.getTime())}`);
      }
    }
  }

  // (0) Hubsell dang luu gi.
  const orders = await prisma.order.findMany({
    where: { channelId, orderCode: { in: codes } },
    select: {
      orderCode: true,
      shippingStatus: true,
      returnStatus: true,
      returnedAt: true,
      returnDeliveredAt: true,
      platformReturnStatus: true,
      returnTrackingCode: true,
      trackingCode: true,
    },
  });
  for (const o of orders) {
    console.log(
      `[HUBSELL] ${o.orderCode} ship=${o.shippingStatus} kho=${o.returnStatus} khoNhan=${vn(o.returnedAt?.getTime())} ` +
        `mocSan=${vn(o.returnDeliveredAt?.getTime())} san=${o.platformReturnStatus ?? "-"} ` +
        `maVanDonDi=${o.trackingCode ?? "-"} maVanDonHoan=${o.returnTrackingCode ?? "-"}`
    );
  }

  // (1) Yeu cau hoan theo ma don.
  const page = await searchReturns({ ...auth, orderIds: codes, pageSize: 50 });
  console.log(`\n===== (1) returns/search: ${page.return_orders.length} yeu cau =====`);
  for (const ro of page.return_orders) {
    console.log(
      `[RETURN] don=${ro.order_id} return_id=${ro.return_id} type=${ro.return_type} status=${ro.return_status} ` +
        `arbitration=${ascii(ro.arbitration_status)} tao=${vn(ro.create_time)} capNhat=${vn(ro.update_time)} ` +
        `maHoan=${ro.return_tracking_number ?? "-"} hang=${ascii(ro.return_provider_name)} ` +
        `shipment=${ro.shipment_type ?? "-"} handover=${ascii(ro.handover_method)} giuHang=${String(ro.can_buyer_keep_item)}`
    );
    const next = (ro.seller_next_action_response ?? []) as { action?: string; deadline?: number }[];
    console.log(
      `  VIEC KE CUA NGUOI BAN: ${next.length ? next.map((a) => `${ascii(a.action)} han=${vn(a.deadline)}`).join(" ; ") : "(khong co)"}`
    );
    console.log(`  keys=[${Object.keys(ro).join(",")}]`);
    for (const [k, v] of Object.entries(ro)) {
      if (RETURN_KEYS_SHOWN.has(k)) continue;
      console.log(`  + ${k} = ${ascii(JSON.stringify(v)).slice(0, 400)}`);
    }

    // (2) Nhat ky su kien cua yeu cau.
    try {
      const d = await callApi<{ records?: Record<string, unknown>[] }>({
        path: `/return_refund/202309/returns/${encodeURIComponent(String(ro.return_id))}/records`,
        accessToken: auth.accessToken,
        shopCipher: auth.shopCipher,
        query: { locale: "vi-VN" },
      });
      const records = d.records ?? [];
      console.log(`  ----- (2) records: ${records.length} su kien -----`);
      if (records[0]) console.log(`  record keys=[${Object.keys(records[0]).join(",")}]`);
      for (const r of records) {
        console.log(
          `  [REC] ${vn(r.create_time)} event=${ascii(r.event)} role=${ascii(r.role)} | ${ascii(r.description).slice(0, 200)}` +
            (r.note ? ` | note: ${ascii(r.note).slice(0, 120)}` : "")
        );
      }
    } catch (err) {
      console.log(`  records LOI: ${ascii((err as Error).message)}`);
    }
  }

  // (3) Hanh trinh hang van chuyen cua don (API dang dung cho Chi tiet don + kien giao that bai).
  for (const code of codes) {
    try {
      const events = await getOrderTracking({ ...auth, orderId: code });
      console.log(`\n===== (3) tracking don ${code}: ${events.length} moc =====`);
      if (events[0]) console.log(`  keys=[${Object.keys(events[0]).join(",")}]`);
      for (const e of [...events].sort((a, b) => (b.update_time_millis ?? 0) - (a.update_time_millis ?? 0))) {
        console.log(
          `  [TRK] ${vn(e.update_time_millis)} action=${ascii(e.action_code ?? e.tracking_event_type)} | ${ascii(e.description).slice(0, 200)}`
        );
      }
    } catch (err) {
      console.log(`\n===== (3) tracking don ${code} LOI: ${ascii((err as Error).message)} =====`);
    }
  }
}

main()
  .catch((err) => {
    console.error("LOI:", ascii((err as Error).message));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
