// ============================================================
// PROBE "Get Order Price Details" 202407 cua TikTok — LAT 3 (29/10/2026, docs
// DONG-TIEN-TONG-GIA-TRI-SAN-PHAM-KHAO-SAT-29-10.md muc 9/11): ban ke gop
// "giam gia san pham" + "voucher shop" vao mot so seller_discount_amount; API
// price_detail tach duoc (subtotal_deduction_seller / voucher_deduction_seller /
// seller_funded_product_promotions[].discount_type COUPON|ACTIVITY). Truoc khi
// code lat 3 phai chung minh tren don that:
//   (a) sku_list_price                      = grossSales ban ke (gia goc)
//   (b) deduction_seller + voucher_seller   = |sellerDiscount| ban ke (gop)
//   (c) sku_sale_price (list - ded_seller - ded_platform) so voi gia trong gio
//       (grossSales + sellerDiscount) va Σ OrderItem.price (sale_price don hang)
// CHI DOC. Chay tren Render Shell worker (in KHONG DAU vi shell mat dau):
//   npx tsx scripts/tiktok-price-detail-probe.ts [shopName] [limit=20] [settled]
//   (tham so 3 = "settled": chi lay don DA GIAO + ban ke THAT (estimated=false) de
//   kiem voucher shop co bi tru trong ban ke that hay khong — lan 1 29/10 toan uoc tinh)
// ============================================================
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { callApi } from "../src/integrations/tiktok/client";
import { getValidAccessToken } from "../src/integrations/tiktok/service";

type Amount = string | undefined;
interface PriceLine {
  id?: string;
  sku_list_price?: Amount;
  sku_sale_price?: Amount;
  subtotal?: Amount;
  subtotal_deduction_seller?: Amount;
  subtotal_deduction_platform?: Amount;
  voucher_deduction_seller?: Amount;
  voucher_deduction_platform?: Amount;
  payment?: Amount;
  seller_funded_product_promotions?: { activity_id?: string; discount_amount?: Amount; discount_type?: string }[];
}
interface PriceDetail extends PriceLine {
  currency?: string;
  total?: Amount;
  line_items?: PriceLine[];
}

const n = (v: unknown): number => Number(v ?? 0) || 0;
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wantShop = process.argv[2]?.trim();
  const limit = Math.max(1, Math.min(100, Number(process.argv[3] ?? 20) || 20));
  const settledOnly = (process.argv[4] ?? "").trim() === "settled";

  const channels = await prisma.channel.findMany({
    where: {
      channelName: "TIKTOK",
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(wantShop ? { shopName: wantShop } : {}),
    },
  });
  if (channels.length === 0) {
    console.log("Khong co gian TikTok ACTIVE" + (wantShop ? ` ten "${wantShop}"` : ""));
    await prisma.$disconnect();
    return;
  }

  const tally = { n: 0, aOk: 0, bOk: 0, cGioOk: 0, cItemsOk: 0, hasVoucher: 0, hasCoupon: 0, hasActivity: 0, err: 0 };

  for (const channel of channels) {
    console.log(`\n===== ${channel.shopName} =====`);
    let auth: { accessToken: string; shopCipher: string };
    try {
      auth = await getValidAccessToken(channel);
    } catch (err) {
      console.log(`  token loi: ${(err as Error).message}`);
      continue;
    }
    // Don moi nhat co ban ke: tron thuong / huy / hoan de thay du hinh dang.
    const orders = await prisma.order.findMany({
      where: {
        channelId: channel.id,
        ...(settledOnly
          ? { shippingStatus: "DELIVERED", tiktokSettlement: { is: { estimated: false } } }
          : { tiktokSettlement: { isNot: null } }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        tiktokSettlement: true,
        items: { select: { price: true, quantity: true } },
      },
    });
    console.log(`  ${orders.length} don co ban ke${settledOnly ? " THAT, da giao" : ""} (moi nhat truoc)`);
    let rawPrinted = 0;

    for (const o of orders) {
      const st = o.tiktokSettlement!;
      const gross = Number(st.grossSales);
      const disc = Number(st.sellerDiscount); // am
      const gio = gross + disc;
      const itemsSum = o.items.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
      let pd: PriceDetail;
      try {
        pd = await callApi<PriceDetail>({
          path: `/order/202407/orders/${o.orderCode}/price_detail`,
          accessToken: auth.accessToken,
          shopCipher: auth.shopCipher,
          kind: "read",
        });
      } catch (err) {
        tally.err++;
        console.log(`  ${o.orderCode} ${o.shippingStatus}: LOI ${(err as Error).message}`);
        await sleep(400);
        continue;
      }
      const list = n(pd.sku_list_price);
      const dedS = n(pd.subtotal_deduction_seller);
      const dedP = n(pd.subtotal_deduction_platform);
      const sale = n(pd.sku_sale_price);
      const vS = n(pd.voucher_deduction_seller);
      const vP = n(pd.voucher_deduction_platform);
      const promos = (pd.line_items ?? []).flatMap((l) => l.seller_funded_product_promotions ?? []);
      const coupon = promos.filter((p) => p.discount_type === "COUPON").reduce((s, p) => s + n(p.discount_amount), 0);
      const activity = promos.filter((p) => p.discount_type === "ACTIVITY").reduce((s, p) => s + n(p.discount_amount), 0);
      const other = promos.filter((p) => p.discount_type !== "COUPON" && p.discount_type !== "ACTIVITY");

      const aOk = Math.abs(list - gross) <= 1;
      const bOk = Math.abs(dedS + vS - Math.abs(disc)) <= 1;
      const cGioOk = Math.abs(sale - gio) <= 1; // sale da tru ca ded_platform → thuong KHONG bang gio
      const cGio2Ok = Math.abs(list - dedS - gio) <= 1; // gia trong gio = list - giam gia SP cua shop?
      const cItemsOk = Math.abs(sale - itemsSum) <= 1;
      tally.n++;
      if (aOk) tally.aOk++;
      if (bOk) tally.bOk++;
      if (cGio2Ok) tally.cGioOk++;
      if (cItemsOk) tally.cItemsOk++;
      if (vS > 0) tally.hasVoucher++;
      if (coupon > 0) tally.hasCoupon++;
      if (activity > 0) tally.hasActivity++;

      console.log(
        `  ${o.orderCode} ${o.shippingStatus}${st.estimated ? " (uoc tinh)" : ""}: list ${fmt(list)} | dedS ${fmt(dedS)} dedP ${fmt(dedP)} | sale ${fmt(sale)} | vS ${fmt(vS)} vP ${fmt(vP)} | promo COUPON ${fmt(coupon)} ACTIVITY ${fmt(activity)}${other.length ? ` KHAC ${other.map((p) => `${p.discount_type}:${p.discount_amount}`).join(",")}` : ""}` +
          `\n      ban ke: gross ${fmt(gross)} disc ${fmt(disc)} gio ${fmt(gio)} | items sale_price ${fmt(itemsSum)} | psub ${fmt(Number(o.platformSubsidy))}` +
          `\n      (a) list=gross ${aOk ? "OK" : "LECH " + fmt(list - gross)} | (b) dedS+vS=|disc| ${bOk ? "OK" : "LECH " + fmt(dedS + vS - Math.abs(disc))} | (c1) list-dedS=gio ${cGio2Ok ? "OK" : "LECH " + fmt(list - dedS - gio)} | (c2) sale=gio ${cGioOk ? "OK" : "LECH " + fmt(sale - gio)} | (c3) sale=items ${cItemsOk ? "OK" : "LECH " + fmt(sale - itemsSum)}`
      );
      // In payload tho: don dau tien cua gian + don dau tien CO voucher shop (de doc ten truong).
      if (rawPrinted === 0 || (rawPrinted === 1 && vS > 0)) {
        rawPrinted++;
        console.log(`      THO: ${JSON.stringify(pd).slice(0, 1800)}`);
      }
      await sleep(400);
    }
  }

  console.log(
    `\nTONG KET ${tally.n} don (loi ${tally.err}): (a) list=gross ${tally.aOk}/${tally.n} | (b) dedS+vS=|disc| ${tally.bOk}/${tally.n} | (c1) list-dedS=gio ${tally.cGioOk}/${tally.n} | (c3) sale=items ${tally.cItemsOk}/${tally.n} | don co voucher shop ${tally.hasVoucher} | COUPON ${tally.hasCoupon} | ACTIVITY ${tally.hasActivity}`
  );
  console.log(
    "Ket luan can: (a)+(b) du 100% => lat 3 lay voucher_deduction_seller lam dong 'Voucher & xu cua shop' TikTok; (c1) cho biet gia trong gio co = list - giam gia SP shop (tach voucher ra) hay khong."
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Probe loi:", (err as Error).message);
  await prisma.$disconnect();
  process.exit(1);
});
