// ============================================================
// XUẤT HĐĐT CỦA CHÍNH CÔNG TY HUBSELL (bán gói dịch vụ — tab Sổ quỹ HQ).
// Tái dùng nguyên tầng client meInvoice của tenant (publishStandardInvoice
// nhận StandardInvoiceConfig thuần); file này chỉ lo 2 việc:
//  1. Map bản ghi PlatformInvoiceConfig (singleton) → StandardInvoiceConfig
//     (clientId/secretKey để null → rơi về khóa app env MISA_CLIENT_ID/SECRET
//     đúng như mô hình tenant).
//  2. Dựng dòng hóa đơn 1 dòng dịch vụ từ bút toán THU, theo vatMode:
//     "KCT" (mặc định — dịch vụ phần mềm không chịu thuế GTGT) hoặc 0/5/8/10%
//     (bóc ngược thuế từ số THỰC THU như buildInvoiceLines của tenant).
// ============================================================

import type { PlatformInvoiceConfig } from "@prisma/client";

import type { StandardInvoiceConfig } from "./misa-einvoice";
import type { CreateInvoiceInput, InvoiceLine } from "./types";

export const HQ_VAT_MODES = ["KCT", "0", "5", "8", "10"] as const;
export type HqVatMode = (typeof HQ_VAT_MODES)[number];

export function isHqVatMode(v: unknown): v is HqVatMode {
  return typeof v === "string" && (HQ_VAT_MODES as readonly string[]).includes(v);
}

/** vatRate số cho InvoiceLine: KCT → -1 (misaVatRateName in "KCT", thuế 0). */
function hqVatRate(mode: HqVatMode): number {
  return mode === "KCT" ? -1 : Number(mode);
}

export function hqStandardConfig(row: PlatformInvoiceConfig): StandardInvoiceConfig {
  return {
    taxCode: row.taxCode,
    companyName: row.companyName,
    companyAddress: row.companyAddress,
    clientId: null, // dùng khóa app Hubsell từ env như mọi shop
    secretKey: null,
    meinvoiceUsername: row.meinvoiceUsername,
    meinvoicePassword: row.meinvoicePassword,
    invoicePattern: row.invoicePattern,
    invoiceSeries: row.invoiceSeries,
    signMethod: row.signMethod,
    esignClientId: row.esignClientId,
    esignSecretKey: row.esignSecretKey,
    esignUsername: row.esignUsername,
    esignPassword: row.esignPassword,
    certSerial: row.certSerial,
  };
}

/**
 * Một dòng dịch vụ từ số THỰC THU (đã gồm thuế nếu chịu thuế). KCT/0%:
 * amountWithoutVat = đúng số thu, thuế 0; 5/8/10%: bóc ngược cùng công thức
 * làm tròn với buildInvoiceLines (cộng lại luôn bằng đúng số thu).
 */
export function buildHqInvoiceLine(
  itemName: string,
  amount: number,
  mode: HqVatMode
): InvoiceLine {
  const rate = hqVatRate(mode);
  const pct = rate > 0 ? rate : 0;
  const amountWithoutVat = Math.round((amount * 100) / (100 + pct));
  return {
    name: itemName,
    sku: "HUBSELL-SAAS",
    quantity: 1,
    unitPrice: amountWithoutVat,
    vatRate: rate,
    amountWithoutVat,
    vatAmount: amount - amountWithoutVat,
  };
}

export function buildHqInvoiceInput(args: {
  /** RefID chống trùng phía MISA — quy ước "HQLEDGER-<id bút toán>". */
  refId: string;
  buyerName: string;
  buyerTaxCode?: string;
  buyerAddress?: string;
  buyerEmail?: string;
  itemName: string;
  amount: number;
  vatMode: HqVatMode;
}): CreateInvoiceInput {
  return {
    orderCode: args.refId,
    buyerName: args.buyerName,
    buyerTaxCode: args.buyerTaxCode || undefined,
    buyerAddress: args.buyerAddress || undefined,
    buyerEmail: args.buyerEmail || undefined,
    lines: [buildHqInvoiceLine(args.itemName, args.amount, args.vatMode)],
    totalAmount: args.amount,
  };
}
