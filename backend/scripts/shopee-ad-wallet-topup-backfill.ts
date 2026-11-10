// ============================================================
// BÙ MỘT LẦN: CỘT "NẠP VÍ QUẢNG CÁO" CHO ĐƠN SHOPEE CŨ (10/11/2026)
//
// Khách gian "Mẹ mua đi, Bố trả tiền Store" kêu Dòng tiền trừ quảng cáo hai lần:
// Shopee trích tiền đơn để nạp ví quảng cáo (order_income
// .ads_escrow_top_up_fee_or_technical_support_fee) mà Hubsell chưa đọc vào cột
// Order.adWalletTopup → khoản trích nằm trong tiền về ví, rồi AdSpend (tiền tiêu
// từ chính ví đó) lại cộng vào Chi phí. Mã mới (mapShopeeEscrowFields) ghi cột
// này cho mọi lần hỏi sàn SAU khi deploy; script này bù cho đơn đã có bản ước
// tính từ trước (docs/SHOPEE-NAP-VI-QUANG-CAO-TRU-TRUNG.md).
//
// KHÔNG GỌI SÀN. Nguồn = Order.expectedIncome (bản chụp order_income ước tính
// đang lưu). Đơn quyết toán trong 7 ngày gần nhất được worker ghi lại số THẬT ở
// nhịp giờ kế tiếp; đơn quyết toán cũ hơn giữ số ước tính (đo prod 10/11: phần
// chốt muộn chưa bóc được của nhóm này ≤ 265 nghìn / 31,6 triệu, dưới 1 %).
//
// An toàn: chỉ ghi dòng adWalletTopup = 0 mà bản ước tính có số > 0 → chạy lặp
// không đổi gì thêm; mỗi gian một câu UPDATE riêng (không giao dịch dài — bẫy
// deadlock với worker 30/09). Trigger sổ cái tự đánh dấu tính lại các đơn này.
//
// Chạy (Render Web Shell, nơi có DATABASE_URL prod):
//   npx tsx scripts/shopee-ad-wallet-topup-backfill.ts            xem trước (không ghi)
//   npx tsx scripts/shopee-ad-wallet-topup-backfill.ts --apply    ghi thật
//   --since=YYYY-MM-DD  mốc ngày tạo đơn (mặc định 2026-07-01: tháng đầu tiên prod có trường này)
// Output ASCII để Render Shell không vỡ chữ; gian in bằng id.
// ============================================================
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const FIELD = "ads_escrow_top_up_fee_or_technical_support_fee";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const sinceArg = args.find((a) => a.startsWith("--since="))?.slice("--since=".length) ?? "2026-07-01";

async function main() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) throw new Error(`--since sai dang YYYY-MM-DD: ${sinceArg}`);
  const since = new Date(`${sinceArg}T00:00:00+07:00`);
  const channels = await prisma.channel.findMany({ where: { channelName: "SHOPEE" }, select: { id: true } });
  console.log(`[topup-backfill] ${apply ? "GHI THAT" : "XEM TRUOC"} | ${channels.length} gian Shopee | don tao tu ${sinceArg}`);

  // Điều kiện chung: bản ước tính có trường là SỐ > 0 và cột chưa có số.
  const pending = (channelId: string) => Prisma.sql`
    "channelId" = ${channelId}
    AND "createdAt" >= ${since}
    AND "adWalletTopup" = 0
    AND jsonb_typeof("expectedIncome" -> ${FIELD}) = 'number'
    AND ("expectedIncome" ->> ${FIELD})::numeric > 0`;

  let shops = 0;
  let orders = 0;
  let amount = 0;
  for (const ch of channels) {
    const [stat] = await prisma.$queryRaw<{ n: bigint; s: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT count(*) AS n, sum(("expectedIncome" ->> ${FIELD})::numeric) AS s
      FROM "Order" WHERE ${pending(ch.id)}`);
    const n = Number(stat?.n ?? 0);
    if (n === 0) continue;
    const s = Number(stat?.s ?? 0);
    let written = n;
    if (apply) {
      written = await prisma.$executeRaw(Prisma.sql`
        UPDATE "Order" SET "adWalletTopup" = ("expectedIncome" ->> ${FIELD})::numeric
        WHERE ${pending(ch.id)}`);
    }
    shops += 1;
    orders += written;
    amount += s;
    console.log(`[topup-backfill] gian ${ch.id}: ${written} don, ${Math.round(s)} d`);
  }
  console.log(
    `[topup-backfill] XONG ${apply ? "(da ghi)" : "(chua ghi - them --apply de ghi)"}: ${shops} gian, ${orders} don, ${Math.round(amount)} d`
  );
}

main()
  .catch((err) => {
    console.error("[topup-backfill] LOI:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
