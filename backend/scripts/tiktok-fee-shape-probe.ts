// ============================================================
// PROBE "ten truong phi/ship THAT" cua ban ke TikTok 202501 — 31/10/2026 (docs
// TIKTOK-PHI-BAO-CAO-KINH-DOANH-DOI-CHIEU-API-KHAO-SAT-31-10.md muc 5).
// Bang tiktok_order_settlements KHONG luu payload tho, nen khi "Phi khac"
// (feeOther) != 0 hoac nhom ship khong cong khop shippingCost thi khong biet
// TEN truong sao ke nao chua co cot. Script nay goi lai API THEO DON
// (GET /finance/202501/orders/{id}/statement_transactions) cho cac don do va
// in MOI khoa khac 0 cua fee / tax / shipping (ca khoi con supplementary_component)
// / revenue, kem bang dem tan suat khoa de biet phai them cot nao.
// CHI DOC. Chay tren Render Shell worker (in KHONG DAU vi shell mat dau):
//   npx tsx scripts/tiktok-fee-shape-probe.ts [shopName|-] [limit=15] [since=2026-10-29]
//   shopName "-" = moi gian; since = chi lay ban ke ghi (updatedAt) sau moc nay (gio VN).
// ============================================================
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getOrderStatementTransactionsV2 } from "../src/integrations/tiktok/client";
import { getValidAccessToken } from "../src/integrations/tiktok/service";

type AmountMap = { [k: string]: unknown };

/** Khoa fee da co cot rieng trong mapper tiktok/settlements.ts (FEE_KNOWN) — de danh dau CO COT / CHUA COT. */
const FEE_HAS_COLUMN = new Set([
  "platform_commission_amount", "transaction_fee_amount", "vn_fix_infrastructure_fee",
  "sfp_service_fee_amount", "voucher_xtra_service_fee_amount", "flash_sales_service_fee_amount",
  "affiliate_commission_amount", "affiliate_commission_amount_before_pit", "affiliate_commission_before_pit_amount",
  "affiliate_ads_commission_amount", "affiliate_partner_commission_amount",
  "gmv_max_ad_fee_amount", "gmv_max_coupon_fee", "bonus_cashback_service_fee_amount",
  "shipping_fee_guarantee_service_fee",
]);
/** Khoa ship (cap 1 + supplementary) mapper dang doc. */
const SHIP_READ = new Set([
  "actual_shipping_fee_amount", "customer_paid_shipping_fee_amount", "return_shipping_fee_amount",
  "platform_shipping_fee_discount_amount", "shipping_fee_subsidy_amount", "promo_shipping_incentive_amount",
  "seller_shipping_fee_discount_amount",
  "signature_confirmation_fee_amount", "shipping_insurance_fee_amount", "logistics_service_fee",
  "shipping_app_service_fee_amount", "international_leg_logistics_amount", "seller_self_shipping_service_fee_amount",
  "distant_shipping_fee_amount", "replacement_shipping_fee_amount", "exchange_shipping_fee_amount",
  "sfr_reimbursement", "shipping_fee_guarantee_reimbursement", "failed_delivery_subsidy_amount",
  "free_return_subsidy_amount", "return_shipping_fee_paid_buyer_amount", "fbt_fulfillment_fee_reimbursement_amount",
  "tiktok_shop_shipping_incentive_amount", "fbt_overall_merchant_subsidy", "fbt_key_merchant_subsidy",
]);

const n = (v: unknown): number => (typeof v === "object" ? 0 : Number(v ?? 0) || 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "khoa:gia_tri" cua moi khoa so khac 0, de quy vao khoi con (tien to "sup."). */
function nonZero(m: unknown, prefix = ""): string[] {
  if (!m || typeof m !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(m as AmountMap)) {
    if (v && typeof v === "object") out.push(...nonZero(v, `${prefix}${k === "supplementary_component" ? "sup" : k}.`));
    else if (n(v) !== 0) out.push(`${prefix}${k}:${String(v)}`);
  }
  return out;
}

async function main() {
  const wantShop = (process.argv[2] ?? "").trim();
  const limit = Math.max(1, Math.min(100, Number(process.argv[3] ?? 15) || 15));
  const since = new Date(`${(process.argv[4] ?? "2026-10-29").trim()}T00:00:00+07:00`);

  const channels = await prisma.channel.findMany({
    where: {
      channelName: "TIKTOK",
      status: "ACTIVE",
      refreshToken: { not: null },
      ...(wantShop && wantShop !== "-" ? { shopName: wantShop } : {}),
    },
  });
  if (channels.length === 0) {
    console.log("Khong co gian TikTok ACTIVE" + (wantShop ? ` ten "${wantShop}"` : ""));
    await prisma.$disconnect();
    return;
  }

  const feeKeyCount = new Map<string, number>();
  const shipKeyCount = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  let probed = 0;
  let errors = 0;

  for (const channel of channels) {
    // Don co ban ke THAT ghi sau `since` ma (a) Phi khac != 0 hoac (b) nhom ship khong cong khop shippingCost.
    const rows = await prisma.$queryRaw<{ orderId: string; orderCode: string; feeOther: number; lech: number }[]>`
      select s."orderId", o."orderCode", s."feeOther"::float8 as "feeOther",
             (s."shipActual"+s."shipCustomerPaid"+s."shipPlatformDiscount"+s."shipSubsidy"+s."shipSellerDiscount"
              +s."shipReturn"+s."shipOther"+s."shipReimbursement"-s."shippingCost")::float8 as lech
      from tiktok_order_settlements s join "Order" o on o.id = s."orderId"
      where o."channelId" = ${channel.id} and s.estimated = false and s."updatedAt" > ${since}
        and (s."feeOther" <> 0
             or abs(s."shipActual"+s."shipCustomerPaid"+s."shipPlatformDiscount"+s."shipSubsidy"+s."shipSellerDiscount"
                    +s."shipReturn"+s."shipOther"+s."shipReimbursement"-s."shippingCost") > 1)
      order by s."updatedAt" desc
      limit ${limit}`;
    if (rows.length === 0) continue;
    console.log(`\n===== ${channel.shopName}: ${rows.length} don can soi =====`);

    let auth: { accessToken: string; shopCipher: string };
    try {
      auth = await getValidAccessToken(channel);
    } catch (err) {
      console.log(`  token loi: ${(err as Error).message}`);
      continue;
    }

    for (const r of rows) {
      let data: Record<string, unknown>;
      try {
        data = await getOrderStatementTransactionsV2({
          accessToken: auth.accessToken,
          shopCipher: auth.shopCipher,
          orderId: r.orderCode,
        });
      } catch (err) {
        errors++;
        console.log(`  ${r.orderCode}: LOI ${(err as Error).message}`);
        await sleep(400);
        continue;
      }
      probed++;
      const skus = (data.sku_transactions as AmountMap[] | undefined) ?? [];
      console.log(
        `  ${r.orderCode} feeOther=${Math.round(r.feeOther)} shipLech=${Math.round(r.lech)} ` +
          `settlement=${String(data.settlement_amount ?? "?")} fee_and_tax=${String(data.fee_and_tax_amount ?? "?")} ` +
          `ship=${String(data.shipping_cost_amount ?? "?")} sku=${skus.length}`
      );
      for (const s of skus) {
        const ft = (s.fee_tax_breakdown as AmountMap | undefined) ?? {};
        const fee = nonZero(ft.fee);
        const tax = nonZero(ft.tax);
        const ship = nonZero(s.shipping_cost_breakdown);
        const rev = nonZero(s.revenue_breakdown);
        console.log(`    sku ${String(s.sku_id ?? "?")} x${String(s.quantity ?? "?")} settle=${String(s.settlement_amount ?? "?")}`);
        console.log(`      fee  [${fee.join(", ")}]`);
        console.log(`      tax  [${tax.join(", ")}]`);
        console.log(`      ship [${ship.join(", ")}]`);
        console.log(`      rev  [${rev.join(", ")}]`);
        for (const f of fee) bump(feeKeyCount, f.split(":")[0]);
        for (const f of ship) bump(shipKeyCount, f.split(":")[0].replace(/^sup\./, ""));
      }
      await sleep(300);
    }
  }

  console.log(`\n===== TONG KET: ${probed} don goi API, ${errors} loi =====`);
  console.log("Khoa fee (so SKU co khoa; CO COT = mapper da co cot rieng):");
  for (const [k, c] of [...feeKeyCount].sort((a, b) => b[1] - a[1]))
    console.log(`  ${c.toString().padStart(5)}  ${k}  ${FEE_HAS_COLUMN.has(k) ? "CO COT" : "CHUA COT -> roi vao Phi khac"}`);
  console.log("Khoa ship (ca khoi supplementary):");
  for (const [k, c] of [...shipKeyCount].sort((a, b) => b[1] - a[1]))
    console.log(`  ${c.toString().padStart(5)}  ${k}  ${SHIP_READ.has(k) ? "DANG DOC" : "CHUA DOC -> nhom ship khong cong khop"}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
