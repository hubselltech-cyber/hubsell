// ============================================================
// PROBE "san co tra HAN XU LY / HAN KHIEU NAI cua yeu cau hoan khong" — 23/11/2026
// (docs/HAN-KHIEU-NAI-DON-HOAN.md muc 6).
//
// Vi sao: muon co cot "Han khieu nai" o don hoan. Tai lieu API ghi san co cac truong han:
//   Shopee  get_return_list   : due_date, return_ship_due_date, return_seller_due_date
//           get_return_detail : + seller_proof.seller_evidence_deadline,
//                               seller_compensation.seller_compensation_due_date,
//                               negotiation.offer_due_date
//   TikTok  returns/search    : seller_next_action_response[] { action, deadline }  (da kiem 23/11)
//   Lazada  getreverseordersforseller : reverse_order_lines[].sla  (nghia chua ro)
// Tai lieu chi co mot dong mo ta moi truong → script nay in GIA TRI THAT canh cac moc Hubsell
// dang luu (kho quet, san bao kien ve) de biet: truong nao la han 2 ngay sau khi kien ve,
// co san trong luot LIST (0 call them) hay phai goi DETAIL.
//
// CHI DOC, khong ghi DB, khong ghi san.
//   Shopee: toi da 2 trang list + 6 detail.  TikTok: 1 trang.  Lazada: 1 trang.
// Chay tren Render Shell worker (in KHONG DAU vi shell mat dau):
//   npx tsx scripts/return-due-date-probe.ts <channelId> [soNgay=3]
// ============================================================
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getReturnDetail, getReturnList } from "../src/integrations/shopee/client";
import { getValidShopeeAccessToken } from "../src/integrations/shopee/service";
import { searchReturns } from "../src/integrations/tiktok/client";
import { getValidAccessToken as getValidTikTokAccessToken } from "../src/integrations/tiktok/service";
import { getReverseOrders } from "../src/integrations/lazada/client";
import { getValidLazadaAccessToken } from "../src/integrations/lazada/service";

const MAX_SHOPEE_DETAILS = 6;

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
  return new Date(ms + 7 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
};

const toMs = (t: unknown): number => {
  const n = Number(t ?? 0);
  if (!n) return 0;
  return n > 1e12 ? n : n * 1000;
};

/** Khoang cach b - a theo gio (1 chu so le); "-" neu thieu mot dau. */
const gapH = (a: unknown, b: unknown): string => {
  const x = toMs(a);
  const y = toMs(b);
  if (!x || !y) return "-";
  return ((y - x) / 3_600_000).toFixed(1) + "h";
};

/** Moi khoa (o moi tang) co chu due / deadline / sla / expire → in ra de khong sot truong la. */
function deadlineKeys(obj: unknown, prefix = "", out: string[] = []): string[] {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      if (v[0] && typeof v[0] === "object") deadlineKeys(v[0], `${path}[0]`, out);
    } else if (v && typeof v === "object") {
      deadlineKeys(v, path, out);
    }
    if (/due|deadline|sla|expire/i.test(k) && (typeof v !== "object" || v === null)) {
      out.push(`${path}=${String(v)}(${vn(v)})`);
    }
  }
  return out;
}

type HubsellRow = {
  orderCode: string;
  returnStatus: string;
  returnedAt: Date | null;
  returnDeliveredAt: Date | null;
  returnRequestedAt: Date | null;
  platformReturnStatus: string | null;
};

async function hubsellRows(channelId: string, codes: string[]): Promise<Map<string, HubsellRow>> {
  const rows = codes.length
    ? await prisma.order.findMany({
        where: { channelId, orderCode: { in: codes } },
        select: {
          orderCode: true,
          returnStatus: true,
          returnedAt: true,
          returnDeliveredAt: true,
          returnRequestedAt: true,
          platformReturnStatus: true,
        },
      })
    : [];
  return new Map(rows.map((r) => [r.orderCode, r]));
}

const hub = (h: HubsellRow | undefined): string =>
  h
    ? `kho=${h.returnStatus} khoNhan=${vn(h.returnedAt?.getTime())} sanBaoVe=${vn(h.returnDeliveredAt?.getTime())}`
    : "(Hubsell khong co don)";

async function probeShopee(channel: Parameters<typeof getValidShopeeAccessToken>[0], days: number) {
  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  const nowSec = Math.floor(Date.now() / 1000);
  const entries: Record<string, unknown>[] = [];
  for (let pageNo = 0; pageNo < 2; pageNo++) {
    const page = await getReturnList({
      accessToken,
      shopId,
      pageNo,
      pageSize: 50,
      updateTimeFrom: nowSec - days * 86_400,
      updateTimeTo: nowSec,
    });
    const list = (page.response?.return ?? []) as Record<string, unknown>[];
    entries.push(...list);
    if (!page.response?.more || list.length === 0) break;
  }
  console.log(`===== SHOPEE get_return_list ${days} ngay: ${entries.length} yeu cau =====`);
  if (entries[0]) console.log(`keys=[${Object.keys(entries[0]).join(",")}]`);
  const hubs = await hubsellRows(channel.id, entries.map((e) => String(e.order_sn ?? "")).filter(Boolean));

  for (const e of entries) {
    console.log(
      `[LIST] ${e.return_sn} don=${e.order_sn} st=${e.status} sol=${e.return_solution} loai=${e.return_refund_request_type ?? "-"} ` +
        `val=${ascii(e.validation_type)} tao=${vn(e.create_time)} capNhat=${vn(e.update_time)} | ` +
        `due=${vn(e.due_date)} shipDue=${vn(e.return_ship_due_date)} sellerDue=${vn(e.return_seller_due_date)} ` +
        `(sellerDue-capNhat=${gapH(e.update_time, e.return_seller_due_date)}) | ` +
        `nego=${ascii(e.negotiation_status)} proof=${ascii(e.seller_proof_status)} comp=${ascii(e.seller_compensation_status)} | ` +
        hub(hubs.get(String(e.order_sn)))
    );
  }

  // Detail: uu tien yeu cau hang PHAI VE (sol 0) da qua buoc khach gui, kho da quet truoc → co moc de so.
  const alive = entries.filter(
    (e) => Number(e.return_solution ?? 0) === 0 && !/CANCEL|CLOSED|REQUESTED/i.test(String(e.status ?? ""))
  );
  const scanned = alive.filter((e) => hubs.get(String(e.order_sn))?.returnedAt);
  const rest = alive.filter((e) => !hubs.get(String(e.order_sn))?.returnedAt);
  const picks = [...scanned.slice(0, 4), ...rest.slice(0, MAX_SHOPEE_DETAILS)].slice(0, MAX_SHOPEE_DETAILS);
  console.log(`\n===== SHOPEE get_return_detail: ${picks.length} yeu cau =====`);
  for (const e of picks) {
    try {
      const d = (await getReturnDetail(accessToken, shopId, String(e.return_sn))) as Record<string, unknown> | null;
      if (!d) {
        console.log(`[DETAIL] ${e.return_sn} rong`);
        continue;
      }
      const h = hubs.get(String(e.order_sn));
      const logi = d.reverse_logistics_status ?? d.reverse_logistic_status ?? d.logistics_status;
      console.log(
        `[DETAIL] ${d.return_sn} don=${d.order_sn} st=${d.status} logi=${ascii(logi)} logiCapNhat=${vn(d.reverse_logistics_update_time)} ` +
          `capNhat=${vn(d.update_time)} | ${hub(h)}`
      );
      console.log(
        `   sellerDue=${vn(d.return_seller_due_date)} | sellerDue-khoNhan=${gapH(h?.returnedAt?.getTime(), d.return_seller_due_date)} ` +
          `sellerDue-sanBaoVe=${gapH(h?.returnDeliveredAt?.getTime(), d.return_seller_due_date)} ` +
          `sellerDue-logiCapNhat=${gapH(d.reverse_logistics_update_time, d.return_seller_due_date)}`
      );
      console.log(`   MOI TRUONG HAN: ${deadlineKeys(d).join(" ; ") || "(khong co)"}`);
      console.log(`   keys=[${Object.keys(d).join(",")}]`);
      for (const k of ["seller_proof", "seller_compensation", "negotiation"]) {
        if (d[k]) console.log(`   ${k}=${ascii(JSON.stringify(d[k])).slice(0, 300)}`);
      }
    } catch (err) {
      console.log(`[DETAIL] ${e.return_sn} LOI: ${ascii((err as Error).message)}`);
    }
  }
}

async function probeTikTok(channel: Parameters<typeof getValidTikTokAccessToken>[0], days: number) {
  const auth = await getValidTikTokAccessToken(channel);
  const page = await searchReturns({
    ...auth,
    pageSize: 50,
    updateTimeGe: Math.floor(Date.now() / 1000) - days * 86_400,
  });
  console.log(`===== TIKTOK returns/search ${days} ngay: ${page.return_orders.length} yeu cau =====`);
  const hubs = await hubsellRows(channel.id, page.return_orders.map((r) => String(r.order_id ?? "")).filter(Boolean));
  for (const ro of page.return_orders) {
    const next = (ro.seller_next_action_response ?? []) as { action?: string; deadline?: number }[];
    console.log(
      `[RETURN] don=${ro.order_id} type=${ro.return_type} st=${ro.return_status} arb=${ascii(ro.arbitration_status)} ` +
        `tao=${vn(ro.create_time)} capNhat=${vn(ro.update_time)} | ` +
        (next.length
          ? next.map((a) => `${ascii(a.action)} han=${vn(a.deadline)} (han-capNhat=${gapH(ro.update_time, a.deadline)})`).join(" ; ")
          : "(khong co viec ke)") +
        ` | ${hub(hubs.get(String(ro.order_id)))}`
    );
    const extra = deadlineKeys(ro).filter((s) => !s.startsWith("seller_next_action_response"));
    if (extra.length) console.log(`   TRUONG HAN KHAC: ${extra.join(" ; ")}`);
  }
}

async function probeLazada(channel: Parameters<typeof getValidLazadaAccessToken>[0], days: number) {
  const accessToken = await getValidLazadaAccessToken(channel);
  const nowSec = Math.floor(Date.now() / 1000);
  // Don vi GIAY (data that tra giay — returns-sync.ts).
  const page = await getReverseOrders({
    accessToken,
    pageNo: 1,
    pageSize: 50,
    modifiedFromMs: nowSec - days * 86_400,
    modifiedToMs: nowSec,
  });
  console.log(`===== LAZADA getreverseordersforseller ${days} ngay: ${page.items.length} / tong ${page.total} =====`);
  const hubs = await hubsellRows(channel.id, page.items.map((r) => String(r.trade_order_id ?? "")).filter(Boolean));
  let shownKeys = false;
  for (const ro of page.items) {
    const lines = ro.reverse_order_lines ?? ro.reverseOrderLineDTOList ?? [];
    if (!shownKeys) {
      console.log(`order keys=[${Object.keys(ro).join(",")}]`);
      if (lines[0]) console.log(`line keys=[${Object.keys(lines[0]).join(",")}]`);
      shownKeys = true;
    }
    console.log(
      `[REVERSE] ${ro.reverse_order_id} don=${ro.trade_order_id} type=${ascii(ro.request_type)} rtm=${String(ro.is_rtm)} | ` +
        hub(hubs.get(String(ro.trade_order_id)))
    );
    const l = lines[0] as Record<string, unknown> | undefined;
    if (l) {
      console.log(
        `   dong: st=${ascii(l.reverse_status)} ofc=${ascii(l.ofc_status)} qc=${ascii(l.whqc_decision)} dispute=${String(l.is_dispute)} ` +
          `tao=${vn(l.return_order_line_gmt_create)} sua=${vn(l.return_order_line_gmt_modified)} | ` +
          `sla=${String(l.sla ?? "-")} (neu la moc: ${vn(l.sla)}; sla-sua=${gapH(l.return_order_line_gmt_modified, l.sla)})`
      );
    }
    const extra = deadlineKeys(ro);
    if (extra.length) console.log(`   MOI TRUONG HAN: ${extra.slice(0, 8).join(" ; ")}`);
  }
}

async function main() {
  const channelId = (process.argv[2] ?? "").trim();
  const days = Math.min(15, Math.max(1, Number(process.argv[3] ?? 3) || 3));
  if (!channelId) {
    console.log("Cach dung: npx tsx scripts/return-due-date-probe.ts <channelId> [soNgay=3]");
    return;
  }
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    console.log(`Khong thay gian id ${channelId}`);
    return;
  }
  console.log(`Gian ${ascii(channel.shopName ?? channel.id)} san=${channel.channelName} | bay gio ${vn(Date.now())}`);
  if (channel.channelName === "SHOPEE") await probeShopee(channel, days);
  else if (channel.channelName === "TIKTOK") await probeTikTok(channel, days);
  else if (channel.channelName === "LAZADA") await probeLazada(channel, days);
  else console.log("San nay khong co API hoan.");
}

main()
  .catch((err) => {
    console.error("LOI:", ascii((err as Error).message));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
