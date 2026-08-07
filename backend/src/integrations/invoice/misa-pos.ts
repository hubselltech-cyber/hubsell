/**
 * MISA meInvoice POS — HÓA ĐƠN TỪ MÁY TÍNH TIỀN (InvoiceType.POS — tab 2
 * trang Kết nối & Xuất hóa đơn, dành cho Hộ kinh doanh / bán lẻ).
 *
 * VÌ SAO KHÔNG CẦN KÝ SỐ eSign TỪNG ĐƠN (khác hẳn misa-einvoice.ts):
 *   - NĐ 123/2020 (Điều 11) + TT 78/2021: hóa đơn khởi tạo từ máy tính tiền
 *     dùng ký hiệu riêng (ký tự thứ 4 = "M", VD C26MAA) và CQT cấp sẵn DẢI MÃ
 *     cho máy đã đăng ký — KHÔNG phải xin mã theo từng hóa đơn.
 *   - Loại hóa đơn này được MIỄN chữ ký số của người bán trên từng tờ; dữ liệu
 *     chuyển CQT theo bảng tổng hợp (cuối ngày/theo phiên), nên không có vòng
 *     ký eSign lẻ nào cả.
 *   - Lợi thế ĐỘ TRỄ: phát hành là gán số ngay từ dải mã cấp sẵn tại máy —
 *     mili-giây thay vì giây (kê khai phải: build XML → ký số → gửi CQT → chờ
 *     cấp mã). Đúng nhịp quầy thu ngân bán lẻ hàng trăm đơn/ngày.
 *
 * LƯU Ý SANDBOX: path phát hành POS có thể lệch giữa các bản tài liệu kit —
 * chỉnh MỘT chỗ ở ENDPOINTS. Payload build "best effort" PascalCase; sandbox
 * chê trường nào thì sửa buildPosInvoicePayload().
 */

import {
  getMisaAccessToken,
  misaApiBase,
  type MisaAuthCredentials,
} from "./misa-auth";
import { pick } from "./misa-inbot"; // helper đọc JSON PascalCase "mềm" dùng chung
import type { CreateInvoiceInput } from "./types";

/**
 * Path API (nối sau misaApiBase()). Theo tài liệu portal 07/08/2026, meInvoice
 * KHÔNG có cụm endpoint riêng cho máy tính tiền: vẫn dùng `/invoice/publishing`,
 * chỉ khác ở KÝ HIỆU (ký tự thứ 5 = M) và SignType = 5 (ký sau, không hiển thị
 * CKS trên hóa đơn MTT). Danh mục máy tính tiền suy từ `/invoice/templates`.
 */
const ENDPOINTS = {
  publish: "/invoice/publishing",
  templates: "/invoice/templates", // nguồn suy ra ký hiệu/máy đã đăng ký CQT
};

/** SignType cho hóa đơn máy tính tiền (ký sau, không hiển thị CKS). */
const POS_SIGN_TYPE = 5;

/** Lát cắt InvoiceConfig cần cho luồng máy tính tiền. */
export interface PosInvoiceConfig {
  taxCode: string | null;
  companyName: string | null;
  companyAddress: string | null;
  posClientId: string | null;
  posSecretKey: string | null;
  posCodePrefix: string | null;
  posMachineId: string | null;
  posSeries: string | null;
}

/** Những gì còn thiếu để phát hành hóa đơn máy tính tiền — [] = sẵn sàng. */
export function posConfigMissing(cfg: PosInvoiceConfig): string[] {
  const missing: string[] = [];
  if (!cfg.taxCode) missing.push("Mã số thuế (MST)");
  if (!cfg.companyName) missing.push("Tên Hộ kinh doanh/Shop");
  if (!cfg.posClientId || !cfg.posSecretKey) missing.push("POS Client ID / Secret Key");
  if (!cfg.posCodePrefix) missing.push("Dải mã CQT (Code Prefix)");
  if (!cfg.posMachineId) missing.push("Mã máy tính tiền");
  if (!cfg.posSeries) missing.push("Ký hiệu hóa đơn máy tính tiền (C26MXX)");
  return missing;
}

/** Cặp khóa POS của shop; thiếu thì fallback env MISA_POS_* rồi mới tới bộ
 * meInvoice chung (sandbox MISA có thể cấp chung một app cho cả hai). */
function credsFromConfig(cfg: PosInvoiceConfig): MisaAuthCredentials | undefined {
  if (cfg.posClientId && cfg.posSecretKey) {
    return {
      clientId: cfg.posClientId,
      clientSecret: cfg.posSecretKey,
      taxCode: cfg.taxCode ?? undefined,
    };
  }
  const envId = process.env.MISA_POS_CLIENT_ID?.trim();
  const envSecret = process.env.MISA_POS_CLIENT_SECRET?.trim();
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret, taxCode: cfg.taxCode ?? undefined };
  }
  return undefined; // misa-auth tự fallback MISA_CLIENT_ID/SECRET
}

/** Kiểm tra kết nối POS: lấy token bằng cặp khóa POS (đủ chứng minh khóa sống). */
export async function testPosConnection(cfg: PosInvoiceConfig): Promise<{
  tokenLength: number;
  usingShopKeys: boolean;
}> {
  const creds = credsFromConfig(cfg);
  const token = await getMisaAccessToken(creds);
  return {
    tokenLength: token.length,
    usingShopKeys: Boolean(cfg.posClientId && cfg.posSecretKey),
  };
}

/** Một máy tính tiền đã đăng ký với CQT (rút gọn từ danh mục MISA trả về). */
export interface PosMachine {
  machineId: string | null;
  codePrefix: string | null;
  serial: string | null;
}

/**
 * Danh mục máy tính tiền của tài khoản — nguồn AUTO-FILL cho ô "Mã máy tính
 * tiền"/"Dải mã CQT" trên UI (nút Kiểm tra kết nối POS gọi kèm).
 *
 * BEST-EFFORT CÓ CHỦ ĐÍCH: endpoint danh mục có thể chưa mở trên sandbox/kit —
 * lỗi gì cũng trả null (đã có token là kết nối OK rồi, auto-fill chỉ là quà
 * thêm). Đừng đổi thành throw kẻo nút test báo đỏ oan.
 */
export async function listPosMachines(cfg: PosInvoiceConfig): Promise<PosMachine[] | null> {
  try {
    const creds = credsFromConfig(cfg);
    const token = await getMisaAccessToken(creds);
    const res = await fetch(`${misaApiBase()}${ENDPOINTS.templates}`, {
      headers: {
        ...(creds ? { ClientID: creds.clientId } : {}),
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const raw: unknown = JSON.parse(await res.text());
    if (pick(raw, "Success", "success") === false) return null;
    const data = pick(raw, "Data", "data") ?? raw;
    const list = Array.isArray(data)
      ? data
      : (pick(data, "Templates", "Items", "List") as unknown[] | undefined);
    if (!Array.isArray(list)) return null;
    return (
      list
        .map((m) => {
          const serial = pick(m, "InvSeries", "InvoiceSeries", "Serial", "TemplateNo");
          const machineId = pick(m, "MachineCode", "MachineID", "MachineId", "Code");
          const codePrefix = pick(m, "CodePrefix", "InvoiceCodePrefix", "Prefix");
          return {
            machineId: typeof machineId === "string" ? machineId : null,
            codePrefix: typeof codePrefix === "string" ? codePrefix : null,
            serial: typeof serial === "string" ? serial : null,
          };
        })
        // Chỉ giữ mẫu của HÓA ĐƠN MÁY TÍNH TIỀN (ký tự thứ 5 của ký hiệu = M).
        .filter((m) => !m.serial || /^[1256][CK]\d{2}M/.test(m.serial))
    );
  } catch {
    return null;
  }
}

/** Payload phát hành POS PascalCase — sandbox chê trường nào sửa ở đây. */
export function buildPosInvoicePayload(input: CreateInvoiceInput, cfg: PosInvoiceConfig) {
  return {
    RefID: input.orderCode,
    InvSeries: cfg.posSeries, // ký hiệu 1C26MXX — CQT nhận diện hóa đơn máy tính tiền
    SignType: POS_SIGN_TYPE, // 5 = ký sau, không hiển thị CKS (đúng chuẩn HĐ MTT)
    CodePrefix: cfg.posCodePrefix, // dải mã CQT cấp sẵn
    MachineCode: cfg.posMachineId, // mã máy đã đăng ký với CQT
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
      UnitPrice: l.unitPrice,
      VATRate: l.vatRate,
      VATAmount: Math.round((l.unitPrice * l.quantity * l.vatRate) / 100),
      Amount: l.unitPrice * l.quantity,
    })),
  };
}

export interface PosPublishResult {
  /** Số hóa đơn gán NGAY từ dải mã — không có pha chờ CQT như kê khai. */
  invoiceNo: string | null;
  transactionId: string | null;
  raw: unknown;
}

/** Phát hành một hóa đơn MÁY TÍNH TIỀN trên sandbox (tức thì, không ký lẻ). */
export async function publishPosInvoice(
  input: CreateInvoiceInput,
  cfg: PosInvoiceConfig
): Promise<PosPublishResult> {
  const missing = posConfigMissing(cfg);
  if (missing.length > 0) {
    throw new Error(`Chưa đủ cấu hình máy tính tiền — thiếu: ${missing.join(", ")}`);
  }

  const token = await getMisaAccessToken(credsFromConfig(cfg));
  const url = `${misaApiBase()}${ENDPOINTS.publish}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ClientID: cfg.posClientId ?? "",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(buildPosInvoicePayload(input, cfg)),
    });
  } catch (err) {
    throw new Error(`Không gọi được ${url}: ${(err as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`meInvoice POS từ chối phát hành (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }
  if (pick(raw, "Success", "success") === false) {
    const code = pick(raw, "ErrorCode", "errorCode") ?? "?";
    throw new Error(`meInvoice POS từ chối phát hành: ErrorCode=${String(code)}`);
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
