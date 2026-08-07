/**
 * MISA meInvoice — PHÁT HÀNH HÓA ĐƠN ĐIỆN TỬ THÔNG THƯỜNG (luồng KÊ KHAI,
 * InvoiceType.STANDARD — tab 1 trang Kết nối & Xuất hóa đơn).
 *
 * Luồng chuẩn NĐ 123/2020 cho doanh nghiệp kê khai:
 *   1. Lấy Bearer token bằng cặp khóa meInvoice của SHOP (misa-auth.ts).
 *   2. Build payload hóa đơn: pháp nhân (MST/tên/địa chỉ) + MẪU SỐ + KÝ HIỆU
 *      đã đăng ký CQT + dòng hàng.
 *   3. KÝ SỐ từng hóa đơn: signMethod = ESIGN_CLOUD thì ký nền qua MISA eSign
 *      (misa-esign.ts) — không cần cắm USB; USB_TOKEN thì ký phía client.
 *   4. Gửi meInvoice phát hành → CHỜ CQT CẤP MÃ cho từng hóa đơn → nhận số
 *      hóa đơn + mã CQT.
 *
 * KHÁC misa-pos.ts (máy tính tiền): luồng này ký lẻ + đợi mã CQT theo từng
 * hóa đơn nên độ trễ tính bằng giây; đổi lại dùng được cho mọi loại hóa đơn
 * kê khai của doanh nghiệp.
 *
 * LƯU Ý SANDBOX: path phát hành có thể lệch giữa các bản tài liệu kit — chỉnh
 * MỘT chỗ ở ENDPOINTS dưới. Payload build "best effort" PascalCase v3; sandbox
 * chê trường nào thì sửa buildStandardInvoicePayload().
 */

import {
  getMisaAccessToken,
  misaApiBase,
  type MisaAuthCredentials,
} from "./misa-auth";
import { esignLogin } from "./misa-esign";
import { pick } from "./misa-inbot"; // helper đọc JSON PascalCase "mềm" dùng chung
import { assertPublishAllowed } from "./misa-safety";
import type { CreateInvoiceInput } from "./types";

/**
 * Path API (nối sau misaApiBase() = https://developer.misa.vn/apis/itg/meinvoice).
 * Lấy ĐÚNG từ tài liệu portal developer.misa.vn ngày 07/08/2026.
 */
const ENDPOINTS = {
  publish: "/invoice/publishing", // phát hành + xin cấp mã CQT
  templates: "/invoice/templates", // danh sách mẫu/ký hiệu đã đăng ký với CQT
  status: "/invoice/status", // tra trạng thái hóa đơn
};

/**
 * SignType của meInvoice (tài liệu "Lưu ý khi bắt đầu"):
 *   1 = ký qua USB token / file mềm
 *   2 = ký qua HSM (ký số từ xa, có hiển thị CKS) ← MISA eSign
 *   5 = hóa đơn máy tính tiền, ký sau, không hiển thị CKS
 */
export const MISA_SIGN_TYPE = { USB_TOKEN: 1, ESIGN_CLOUD: 2, POS: 5 } as const;

/** Map signMethod của Hubsell → SignType meInvoice. */
export function misaSignType(signMethod: string): number {
  return signMethod === "ESIGN_CLOUD" ? MISA_SIGN_TYPE.ESIGN_CLOUD : MISA_SIGN_TYPE.USB_TOKEN;
}

// ============================================================
// VALIDATE THEO TT 78/2021 — nguồn regex DUY NHẤT, route + UI cùng dùng.
// ============================================================

/**
 * MST người bán: 10 số (doanh nghiệp), 12 số (hộ kinh doanh/cá nhân — VD MST
 * của HKD Hubsell 026093012010), hoặc 13 số / 10-3 số (đơn vị phụ thuộc).
 */
export const TAX_CODE_RE = /^\d{10}(-?\d{3})?$|^\d{12}$/;

/**
 * MẪU SỐ hóa đơn = KÝ TỰ ĐẦU của ký hiệu (tài liệu "Lưu ý khi bắt đầu"):
 *   1 = HĐ GTGT · 2 = HĐ bán hàng · 5 = vé điện tử · 6 = phiếu xuất kho
 */
export const INVOICE_PATTERN_RE = /^[1256]$/;

/**
 * KÝ HIỆU hóa đơn MISA — 7 KÝ TỰ, cấu trúc `XY##ZWW` (VD "1C26TAA"):
 *   X (1) : loại hóa đơn — 1/2/5/6 (khớp mẫu số)
 *   Y (2) : C = có mã CQT · K = không mã
 *   ## (3-4): 2 số cuối của năm
 *   Z (5) : T = hóa đơn thường · M = hóa đơn từ máy tính tiền
 *   WW (6-7): 2 ký tự do người bán tự đặt
 * MISA TỰ đổi số năm theo InvDate nên không cần sửa tay mỗi năm.
 */
export const INVOICE_SERIES_RE = /^[1256][CK]\d{2}T[A-Z0-9]{2}$/;

/** KÝ HIỆU hóa đơn MÁY TÍNH TIỀN: ký tự thứ 5 BẮT BUỘC là M, VD "1C26MAA". */
export const POS_SERIES_RE = /^[1256][CK]\d{2}M[A-Z0-9]{2}$/;

// ============================================================

/** Lát cắt InvoiceConfig cần cho luồng kê khai (truyền thẳng row Prisma). */
export interface StandardInvoiceConfig {
  taxCode: string | null;
  companyName: string | null;
  companyAddress: string | null;
  clientId: string | null;
  secretKey: string | null;
  invoicePattern: string | null;
  invoiceSeries: string | null;
  signMethod: string;
  esignClientId: string | null;
  esignSecretKey: string | null;
  esignUsername: string | null;
  esignPassword: string | null;
  certSerial: string | null;
}

/** Những gì còn thiếu để phát hành được hóa đơn kê khai — [] = sẵn sàng. */
export function standardConfigMissing(cfg: StandardInvoiceConfig): string[] {
  const missing: string[] = [];
  if (!cfg.taxCode) missing.push("Mã số thuế (MST)");
  if (!cfg.companyName) missing.push("Tên pháp nhân");
  if (!cfg.clientId || !cfg.secretKey) missing.push("Client ID / Secret Key meInvoice");
  if (!cfg.invoicePattern) missing.push("Mẫu số hóa đơn (Pattern)");
  if (!cfg.invoiceSeries) missing.push("Ký hiệu hóa đơn (Serial)");
  if (cfg.signMethod === "ESIGN_CLOUD") {
    if (!cfg.esignClientId || !cfg.esignSecretKey || !cfg.esignUsername || !cfg.esignPassword) {
      missing.push("Bộ khóa MISA eSign (ký nền)");
    }
  }
  return missing;
}

function credsFromConfig(cfg: StandardInvoiceConfig): MisaAuthCredentials | undefined {
  if (!cfg.clientId || !cfg.secretKey) return undefined; // fallback env sandbox
  return {
    clientId: cfg.clientId,
    clientSecret: cfg.secretKey,
    taxCode: cfg.taxCode ?? undefined,
  };
}

/**
 * Kiểm tra kết nối luồng kê khai: lấy token meInvoice; nếu ký nền eSign thì
 * đăng nhập eSign luôn — hai hệ đều sống mới coi là sẵn sàng phát hành.
 */
export async function testStandardConnection(cfg: StandardInvoiceConfig): Promise<{
  meinvoiceTokenLength: number;
  esignChecked: boolean;
}> {
  const token = await getMisaAccessToken(credsFromConfig(cfg));
  let esignChecked = false;
  if (cfg.signMethod === "ESIGN_CLOUD") {
    await esignLogin({
      clientId: cfg.esignClientId ?? undefined,
      clientKey: cfg.esignSecretKey ?? undefined,
      username: cfg.esignUsername ?? undefined,
      password: cfg.esignPassword ?? undefined,
    });
    esignChecked = true;
  }
  return { meinvoiceTokenLength: token.length, esignChecked };
}

/** Payload phát hành PascalCase theo mẫu v3 — sandbox chê trường nào sửa ở đây. */
export function buildStandardInvoicePayload(
  input: CreateInvoiceInput,
  cfg: StandardInvoiceConfig
) {
  return {
    RefID: input.orderCode, // mã đơn Hubsell — meInvoice lưu làm tham chiếu 2 chiều
    TemplateNo: cfg.invoicePattern,
    InvSeries: cfg.invoiceSeries,
    SignType: misaSignType(cfg.signMethod), // 1 = USB token · 2 = HSM (eSign)
    SellerTaxCode: cfg.taxCode,
    SellerLegalName: cfg.companyName,
    SellerAddress: cfg.companyAddress,
    BuyerLegalName: input.buyerName,
    BuyerTaxCode: input.buyerTaxCode ?? "",
    TotalAmount: input.totalAmount,
    OriginalInvoiceDetail: input.lines.map((l, i) => ({
      ItemIndex: i + 1,
      ItemName: l.name,
      ItemCode: l.sku,
      Quantity: l.quantity,
      UnitPrice: l.unitPrice, // CHƯA thuế — cùng quy ước InvoiceLine.unitPrice
      VATRate: l.vatRate,
      VATAmount: Math.round((l.unitPrice * l.quantity * l.vatRate) / 100),
      Amount: l.unitPrice * l.quantity,
    })),
  };
}

export interface StandardPublishResult {
  /** Số hóa đơn + mã CQT khi phát hành xong (sandbox có thể trả trễ qua webhook). */
  invoiceNo: string | null;
  transactionId: string | null;
  /** Response nguyên văn của MISA — giai đoạn sandbox luôn giữ lại để dò map. */
  raw: unknown;
}

/**
 * Phát hành một hóa đơn KÊ KHAI trên sandbox. Ký nền eSign (nếu ESIGN_CLOUD)
 * hiện mới XÁC THỰC phiên ký trước khi gửi — bước ký hash XML hóa đơn nối vào
 * sau khi kit sandbox xác nhận định dạng (một chỗ duy nhất: hàm này).
 */
export async function publishStandardInvoice(
  input: CreateInvoiceInput,
  cfg: StandardInvoiceConfig
): Promise<StandardPublishResult> {
  // Hàng rào ĐẦU TIÊN — chặn trước cả khi kiểm cấu hình, để không có đường
  // nào chạm tới API phát hành khi chưa được phép (xem misa-safety.ts).
  assertPublishAllowed("hóa đơn kê khai");

  const missing = standardConfigMissing(cfg);
  if (missing.length > 0) {
    throw new Error(`Chưa đủ cấu hình phát hành kê khai — thiếu: ${missing.join(", ")}`);
  }

  // ESIGN_CLOUD: xác thực phiên ký nền TRƯỚC khi gửi — fail sớm còn hơn treo đơn.
  if (cfg.signMethod === "ESIGN_CLOUD") {
    await esignLogin({
      clientId: cfg.esignClientId ?? undefined,
      clientKey: cfg.esignSecretKey ?? undefined,
      username: cfg.esignUsername ?? undefined,
      password: cfg.esignPassword ?? undefined,
    });
  }

  const token = await getMisaAccessToken(credsFromConfig(cfg));
  const url = `${misaApiBase()}${ENDPOINTS.publish}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ClientID: cfg.clientId ?? "",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(buildStandardInvoicePayload(input, cfg)),
    });
  } catch (err) {
    throw new Error(`Không gọi được ${url}: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`meInvoice từ chối phát hành (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }
  if (pick(raw, "Success", "success") === false) {
    const code = pick(raw, "ErrorCode", "errorCode") ?? "?";
    throw new Error(`meInvoice từ chối phát hành: ErrorCode=${String(code)}`);
  }
  const data = pick(raw, "Data", "data") ?? raw;
  const invoiceNo = pick(data, "InvNo", "InvoiceNo", "InvoiceNumber");
  const transactionId = pick(data, "TransactionID", "TransactionId", "RefID");
  return {
    invoiceNo: typeof invoiceNo === "string" ? invoiceNo : null,
    transactionId: typeof transactionId === "string" ? transactionId : null,
    raw,
  };
}
