// ============================================================
// PROBE CHI DOC: HINH DANG VAN DON THAT cua san — de biet lop "chen bang san pham gon"
// (docs/MOBILE-CHUAN-BI-HANG-IN-PHIEU.md muc 5–6, 19/11/2026) do dung vung tren phieu that
// hay khong, TRUOC khi bat mau cho khach.
//
//   npx tsx scripts/label-shape-probe.ts "<shopName>" [SHOPEE|TIKTOK|LAZADA] [so don, mac dinh 5]
//   vd: npx tsx scripts/label-shape-probe.ts "ANO Official" TIKTOK 8
//
// Lam gi: lay N don DA XU LY gan nhat cua gian (don con in duoc phieu), uu tien don NHIEU
// DONG HANG, goi dung ham dang dung de in (adapter.fetchLabels, tung don) roi voi moi tep in
// MOT dong: so trang, kho trang, co lop chu khong, dong tieu de bang san pham nam o dau, vung
// chen se la bao nhieu mm tu day tem, trong vung do co dong nao KHONG phai bang san pham.
// Cuoi cung gom theo hang van chuyen: vung chen nho nhat / lon nhat.
//
// Tra loi nam gia thuyet G1–G5 cua docs muc 6:
//   G1 bang bat dau o CUNG do cao voi moi don cung hang?   → cot zoneTop + bang tom tat theo hang
//   G2 46 mm dung voi J&T? hang khac bao nhieu?            → nhu tren
//   G3 trang 2 tro di la phan tran cua bang san pham?      → cot pages doi chieu items + dong p2
//   G4 tep co lop chu + tieu de dung "Tong N mat hang"?    → cot text + head
//   G5 trong vung chen khong co gi ngoai bang san pham?    → cot odd + dong "!! la"
//
// TU CHUA: khong import lop label-overlay (chua len prod luc viet script) — luat do vung o day
// CHEP TU backend/src/services/label-overlay/locate.ts; khi lop do len prod thi doi sang import.
// Chu in ra KHONG DAU, moi don mot dong ngan: Render Shell hien loi ky tu co dau va cat dong dai.
//
// KHONG ghi bang nghiep vu, KHONG luu tep, KHONG in ten / SDT / dia chi nguoi mua (chi in dong
// chu nam trong vung bang san pham va cac dong co chu "hang / san pham"). Lenh goi san deu la
// lenh lay phieu cua don chua ban giao — khong doi trang thai don; moi don toi da ~3 lenh san.
// Chay tren Render shell worker (token gian chi co o DB prod).
// ============================================================

import "dotenv/config";
import { ChannelName, ShippingStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getFulfillmentAdapter, type FulfillOrderRef } from "../src/services/fulfillment";

const MM = 25.4 / 72;

/** Bo dau tieng Viet + ky tu ngoai ASCII de doc duoc tren Render Shell. */
function ascii(s: string, max = 44): string {
  const t = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/[^ -~]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max)}~` : t;
}

interface Line {
  text: string;
  y: number;
  height: number;
}

/** Gom mau chu cung dong (lech duong goc <= 2 pt), noi theo chieu ngang. */
function groupLines(items: { str: string; x: number; y: number; height: number }[]): Line[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; height: number; parts: { x: number; str: string }[] }[] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 2);
    if (line) {
      line.parts.push({ x: it.x, str: it.str });
      line.height = Math.max(line.height, it.height);
    } else lines.push({ y: it.y, height: it.height, parts: [{ x: it.x, str: it.str }] });
  }
  return lines.map((l) => ({
    y: l.y,
    height: l.height,
    text: l.parts
      .sort((a, b) => a.x - b.x)
      .map((p) => p.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
}

/** Dong tieu de bang san pham (TikTok). Chep tu locate.ts ANCHORS. */
const ANCHOR = /(tổng|tong)\s*\d+\s*(mặt hàng|mat hang)|total\s*\d+\s*items?/i;
/** Dong nghi la cua phan san pham tren phieu bat ky san nao — tim moc cho luat moi. */
const GOODS_HINT = /mặt hàng|sản phẩm|nội dung hàng|tổng sl|items?\b|sku|qty|số lượng/i;
/** Dong KHONG duoc nam trong vung chen: tien thu ho, chu ky, ma van don, ma don. */
const ODD = /cod|thu hộ|tiền thu|chữ ký|ký nhận|mã vận|tracking|order id|người nhận|người gửi/i;
const ANCHOR_PAD = 5;
const BOTTOM = 6;

async function readPages(pdf: Buffer) {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const out: { width: number; height: number; items: number; lines: Line[] }[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 2); n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform?: number[]; height?: number }[])
      .filter((i) => typeof i.str === "string" && Array.isArray(i.transform))
      .map((i) => ({
        str: i.str as string,
        x: i.transform![4],
        y: i.transform![5],
        height: i.height || Math.abs(i.transform![3]) || 0,
      }));
    out.push({ width: vp.width, height: vp.height, items: items.length, lines: groupLines(items) });
  }
  return { pageCount: doc.numPages, pages: out };
}

async function main() {
  const shopName = process.argv[2];
  const platformArg = (process.argv[3] ?? "").toUpperCase();
  const take = Math.min(20, Math.max(1, Number(process.argv[4]) || 5));
  if (!shopName) {
    console.error('Cach dung: npx tsx scripts/label-shape-probe.ts "<shopName>" [SHOPEE|TIKTOK|LAZADA] [so don]');
    process.exit(1);
  }
  const channel = await prisma.channel.findFirst({
    where: { shopName, ...(platformArg in ChannelName ? { channelName: platformArg as ChannelName } : {}) },
  });
  if (!channel) {
    console.error(`Khong tim thay gian "${ascii(shopName)}"${platformArg ? ` (${platformArg})` : ""}`);
    process.exit(1);
  }
  const adapter = getFulfillmentAdapter(channel.channelName);
  if (!adapter?.supported) {
    console.error(`San ${channel.channelName} chua co adapter in phieu`);
    process.exit(1);
  }

  // Don con in duoc phieu = Da xu ly (hang chua lay kien). Nhieu dong hang truoc: do la ca
  // bang san pham dai / tran trang can soi nhat.
  const orders = await prisma.order.findMany({
    where: { channelId: channel.id, shippingStatus: ShippingStatus.PROCESSED },
    orderBy: [{ itemCount: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      orderCode: true,
      trackingCode: true,
      platformPackageId: true,
      itemCount: true,
      shippingCarrierName: true,
    },
  });
  console.log(`GIAN ${channel.channelName} "${ascii(channel.shopName)}" - ${orders.length} don Da xu ly`);
  if (orders.length === 0) return;

  const byCarrier = new Map<string, number[]>();
  let n = 0;
  let withText = 0;
  let located = 0;
  let multiPage = 0;
  let oddTotal = 0;
  for (const o of orders) {
    n += 1;
    const tag = `#${n} ..${o.orderCode.slice(-6)} items=${o.itemCount} ${ascii(o.shippingCarrierName ?? "?", 14)}`;
    const ref: FulfillOrderRef = {
      id: o.id,
      orderCode: o.orderCode,
      trackingCode: o.trackingCode,
      platformPackageId: o.platformPackageId,
    };
    let pdf: Buffer | undefined;
    try {
      const res = await adapter.fetchLabels(channel, [ref]);
      pdf = res.pdfs.get(o.id);
      if (!pdf) {
        console.log(`${tag} | SAN KHONG TRA PHIEU: ${ascii(res.failed[0]?.reason ?? "?", 70)}`);
        continue;
      }
    } catch (err) {
      console.log(`${tag} | LOI lay phieu: ${ascii(err instanceof Error ? err.message : String(err), 70)}`);
      continue;
    }
    let read: Awaited<ReturnType<typeof readPages>>;
    try {
      read = await readPages(pdf);
    } catch (err) {
      console.log(`${tag} | ${(pdf.length / 1024).toFixed(0)}KB KHONG DOC DUOC: ${ascii(String(err), 60)}`);
      continue;
    }
    const p1 = read.pages[0];
    if (p1.items > 0) withText += 1;
    if (read.pageCount > 1) multiPage += 1;
    const anchor = p1.lines.find((l) => ANCHOR.test(l.text));
    const zoneTop = anchor ? anchor.y + anchor.height + ANCHOR_PAD : null;
    const base =
      `${tag} | ${(pdf.length / 1024).toFixed(0)}KB pages=${read.pageCount} ` +
      `${(p1.width * MM).toFixed(0)}x${(p1.height * MM).toFixed(0)}mm text=${p1.items}`;
    if (zoneTop !== null) {
      located += 1;
      const mm = zoneTop * MM;
      const key = ascii(o.shippingCarrierName ?? "?", 14);
      byCarrier.set(key, [...(byCarrier.get(key) ?? []), mm]);
      const inside = p1.lines.filter((l) => l.y <= zoneTop && l.y >= BOTTOM);
      const odd = inside.filter((l) => ODD.test(l.text));
      oddTotal += odd.length;
      console.log(
        `${base} zoneTop=${mm.toFixed(1)}mm(${((zoneTop / p1.height) * 100).toFixed(0)}%) ` +
          `inZone=${inside.length} odd=${odd.length} head="${ascii(anchor!.text, 24)}"`
      );
      for (const l of odd.slice(0, 3)) console.log(`   !! la y=${(l.y * MM).toFixed(0)}mm "${ascii(l.text, 50)}"`);
    } else {
      console.log(`${base} zone=NONE`);
      for (const l of p1.lines.filter((x) => GOODS_HINT.test(x.text)).slice(0, 4)) {
        console.log(`   goi y y=${(l.y * MM).toFixed(0)}mm(${((l.y / p1.height) * 100).toFixed(0)}%) "${ascii(l.text, 50)}"`);
      }
    }
    // G3: trang 2 la gi? In so mau chu + dong dau (dong dau la ten phan loai / san pham thi la
    // phan tran cua bang; la ma van don / ten hang van chuyen thi la tem cua kien khac).
    const p2 = read.pages[1];
    if (p2) console.log(`   p2 text=${p2.items} dong dau: "${ascii(p2.lines[0]?.text ?? "", 50)}"`);
  }

  console.log(
    `TOM TAT: ${orders.length} don | co lop chu ${withText} | do duoc vung ${located} | >1 trang ${multiPage} | dong la trong vung ${oddTotal}`
  );
  for (const [carrier, list] of byCarrier) {
    console.log(
      `  ${carrier}: ${list.length} don, zoneTop ${Math.min(...list).toFixed(1)}..${Math.max(...list).toFixed(1)} mm`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
