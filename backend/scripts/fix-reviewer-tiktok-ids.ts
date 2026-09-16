// ============================================================
// SỬA ID GIẢ LẬP TIKTOK CỦA TÀI KHOẢN REVIEWER (16/09/2026)
//
// TikTok từ chối xét duyệt app vì ảnh/video không thấy dữ liệu TikTok: "order
// ID of TikTok store should start with an 18 digit number of 57 or 58, and the
// product data ID should start with 17". Seed cũ sinh mã đơn TikTok 14 số và
// externalId 9 số → chữa tại chỗ cho gian TikTok của reviewer, KHÔNG seed lại.
//
// Chạy: npx tsx scripts/fix-reviewer-tiktok-ids.ts            (xem trước)
//       npx tsx scripts/fix-reviewer-tiktok-ids.ts --apply    (ghi thật)
// Production: đặt $env:DATABASE_URL (session pooler) như lúc chạy seed.
// Mã mới sinh xác định từ mã cũ (không đổi khi chạy lại), giữ duy nhất.
// ============================================================
import "dotenv/config";
import { ChannelName, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const EMAIL = process.env.REVIEWER_EMAIL ?? "reviewer@hubsell.vn";

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** n chữ số xác định từ khóa (ghép nhiều vòng băm). */
function digitsFrom(key: string, n: number): string {
  let out = "";
  let round = 0;
  while (out.length < n) out += String(fnv1a(`${key}#${round++}`)).padStart(10, "0");
  return out.slice(0, n);
}
const tiktokOrderCode = (old: string) => (/^58\d{16}$/.test(old) ? old : `5860${digitsFrom(`order:${old}`, 14)}`);
const tiktokProductId = (old: string | null, key: string) =>
  old && /^17\d{17}$/.test(old) ? old : `17${digitsFrom(`product:${key}`, 17)}`;

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) throw new Error(`Không thấy tài khoản ${EMAIL}`);
  const channels = await prisma.channel.findMany({
    where: { userId: user.id, channelName: ChannelName.TIKTOK },
    select: { id: true, shopName: true },
  });
  if (channels.length === 0) throw new Error("Reviewer chưa có gian TikTok");
  const ids = channels.map((c) => c.id);
  console.log(`Gian TikTok của ${EMAIL}:`, channels.map((c) => c.shopName).join(", "));

  const orders = await prisma.order.findMany({
    where: { channelId: { in: ids } },
    select: { id: true, orderCode: true },
  });
  const badOrders = orders.filter((o) => !/^58\d{16}$/.test(o.orderCode));
  const products = await prisma.channelProduct.findMany({
    where: { channelId: { in: ids } },
    select: { id: true, channelSku: true, externalId: true },
  });
  const badProducts = products.filter((p) => !(p.externalId && /^17\d{17}$/.test(p.externalId)));
  console.log(`Đơn: ${orders.length} (cần sửa ${badOrders.length}) · SKU sàn: ${products.length} (cần sửa ${badProducts.length})`);
  for (const o of badOrders.slice(0, 3)) console.log("  vd đơn:", o.orderCode, "→", tiktokOrderCode(o.orderCode));
  for (const p of badProducts.slice(0, 3)) console.log("  vd SP:", p.channelSku, p.externalId, "→", tiktokProductId(p.externalId, p.id));

  if (!APPLY) {
    console.log("Xem trước xong — thêm --apply để ghi.");
    return;
  }
  let n = 0;
  for (const o of badOrders) {
    await prisma.order.update({ where: { id: o.id }, data: { orderCode: tiktokOrderCode(o.orderCode) } });
    if (++n % 200 === 0) console.log(`  đã sửa ${n}/${badOrders.length} đơn`);
  }
  for (const p of badProducts) {
    await prisma.channelProduct.update({ where: { id: p.id }, data: { externalId: tiktokProductId(p.externalId, p.id) } });
  }
  console.log(`XONG: ${badOrders.length} đơn + ${badProducts.length} SKU sàn đã đúng định dạng TikTok.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
