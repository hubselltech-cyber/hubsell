// ============================================================
// ĐỌC HÓA ĐƠN ĐẦU VÀO của CHÍNH công ty Hubsell (tab Hóa đơn đầu vào HQ,
// anh Trung 28/09/2026: "anh cứ up hóa đơn lên HQ, còn lại HQ tự lưu tự đọc").
//
// Hai đường đọc, ưu tiên đường rẻ + chính xác:
//  1. XML HĐĐT Việt Nam chuẩn TCTN (QĐ 1450/QĐ-TCT, thẻ HDon/DLHDon/TTChung/
//     NDHDon/TToan) — parser thuần, không tốn AI, số lấy nguyên văn hóa đơn.
//  2. PDF / ảnh chụp (Supabase, Render, hóa đơn giấy…) — Claude đọc, trả JSON
//     theo schema cố định. Dùng KEY RIÊNG `ANTHROPIC_API_KEY_HQ` (workspace
//     riêng trong console, trần chi tiêu riêng) để chi phí HQ không lẫn với
//     tính năng AI bán cho khách (ANTHROPIC_API_KEY). Thiếu key → tệp vẫn được
//     lưu, dòng hóa đơn để trống chờ nhập tay (không lỗi).
//
// Ngoại tệ: chỉ có tỷ giá THAM KHẢO (open.er-api.com, không cần key) để ra số
// VND tạm; số chuẩn để hạch toán là số ngân hàng trừ thật trên sao kê — UI
// ghi rõ "sửa theo sao kê".
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { XMLParser } from "fast-xml-parser";

export interface ExtractedInvoice {
  invoiceNo: string | null;
  invoiceSerial: string | null;
  /** "yyyy-mm-dd" */
  invoiceDate: string | null;
  sellerName: string | null;
  sellerTaxCode: string | null;
  isForeign: boolean;
  description: string | null;
  currency: string; // "VND" | "USD" | ...
  subtotal: number; // theo currency
  vatRate: string | null; // "KCT" | "0" | "5" | "8" | "10"
  vatAmount: number;
  total: number;
  paymentMethod: "BANK" | "CASH" | null;
  /** Gợi ý khoản mục chi (key HQ_EXPENSE_CATEGORIES) — AI đoán, người duyệt. */
  expenseCategory: string | null;
  /** Ghi chú của máy đọc: trường thiếu, độ tin cậy thấp… */
  note: string | null;
}

export const EXPENSE_KEYS = [
  "RENT",
  "SALARY",
  "INSURANCE",
  "SOFTWARE",
  "MARKETING",
  "BANK_FEE",
  "TAX_FEE",
  "EQUIPMENT",
  "OTHER_EXPENSE",
] as const;

// ---------------- XML chuẩn TCTN ----------------

/** Tìm node con theo tên ở bất kỳ độ sâu nào (HĐ có thể bọc thêm envelope). */
function findNode(obj: unknown, name: string, depth = 0): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object" || depth > 8) return null;
  const rec = obj as Record<string, unknown>;
  if (rec[name] && typeof rec[name] === "object") return rec[name] as Record<string, unknown>;
  for (const v of Object.values(rec)) {
    if (v && typeof v === "object") {
      const hit = findNode(v, name, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function text(node: Record<string, unknown> | null, key: string): string | null {
  if (!node) return null;
  const v = node[key];
  if (v === undefined || v === null) return null;
  if (typeof v === "object") {
    const inner = (v as Record<string, unknown>)["#text"];
    return inner === undefined || inner === null ? null : String(inner).trim() || null;
  }
  const s = String(v).trim();
  return s || null;
}

function num(node: Record<string, unknown> | null, key: string): number {
  const s = text(node, key);
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** "2026-09-28" | "2026-09-28T00:00:00" | "28/09/2026" → "yyyy-mm-dd". */
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const vn = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (vn) return `${vn[3]}-${vn[2].padStart(2, "0")}-${vn[1].padStart(2, "0")}`;
  return null;
}

/** Thuế suất TCTN: "10%" | "10" | "KCT" | "KKKNT" | "0%" → "10" | "KCT" | "0". */
function normalizeVatRate(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s.startsWith("KCT") || s.startsWith("KKKNT")) return "KCT";
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? String(Number(m[1])) : null;
}

export function looksLikeXml(buf: Buffer): boolean {
  const head = buf.subarray(0, 512).toString("utf8").trimStart();
  return head.startsWith("<");
}

/**
 * Đọc XML HĐĐT chuẩn TCTN. Trả null khi không thấy khối TTChung (không phải
 * hóa đơn chuẩn) — nơi gọi chuyển sang AI đọc như văn bản.
 */
export function parseVnEInvoiceXml(xml: string): ExtractedInvoice | null {
  let doc: unknown;
  try {
    doc = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false, // giữ chuỗi để số 0 đầu (SHDon "00001234") không mất
      trimValues: true,
    }).parse(xml);
  } catch {
    return null;
  }
  const ttChung = findNode(doc, "TTChung");
  if (!ttChung) return null;
  const nBan = findNode(doc, "NBan");
  const tToan = findNode(doc, "TToan");
  const dsHH = findNode(doc, "DSHHDVu");

  // Dòng hàng đầu tiên làm diễn giải; nhiều dòng thì ghi "+ n mục khác".
  let description: string | null = null;
  if (dsHH) {
    const raw = dsHH["HHDVu"];
    const rows = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
    const first = rows[0] ? text(rows[0], "THHDVu") : null;
    if (first) description = rows.length > 1 ? `${first} (+${rows.length - 1} mục khác)` : first;
  }

  // Thuế suất: lấy từ tổng hợp theo thuế suất (LTSuat) — hóa đơn 1 thuế suất
  // là phổ biến; nhiều thuế suất thì ghi dòng đầu + note.
  let vatRate: string | null = null;
  let note: string | null = null;
  if (tToan) {
    const thtt = tToan["THTTLTSuat"] as Record<string, unknown> | undefined;
    const raw = thtt?.["LTSuat"];
    const rates = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
    if (rates.length > 0) vatRate = normalizeVatRate(text(rates[0], "TSuat"));
    if (rates.length > 1) note = `Hóa đơn có ${rates.length} thuế suất — kiểm lại tiền thuế.`;
  }

  const currency = (text(ttChung, "DVTTe") ?? "VND").toUpperCase();
  const httt = (text(ttChung, "HTTToan") ?? "").toUpperCase();
  const paymentMethod: ExtractedInvoice["paymentMethod"] = /TM|TIỀN MẶT|TIEN MAT/.test(httt)
    ? /CK|CHUYỂN|CHUYEN/.test(httt)
      ? null // "TM/CK" — chưa rõ, để người duyệt chọn
      : "CASH"
    : httt
      ? "BANK"
      : null;

  return {
    invoiceNo: text(ttChung, "SHDon"),
    invoiceSerial: [text(ttChung, "KHMSHDon"), text(ttChung, "KHHDon")].filter(Boolean).join(""),
    invoiceDate: normalizeDate(text(ttChung, "NLap")),
    sellerName: text(nBan, "Ten"),
    sellerTaxCode: text(nBan, "MST"),
    isForeign: false,
    description,
    currency,
    subtotal: num(tToan, "TgTCThue"),
    vatRate,
    vatAmount: num(tToan, "TgTThue"),
    total: num(tToan, "TgTTTBSo"),
    paymentMethod,
    expenseCategory: null,
    note,
  };
}

// ---------------- Claude đọc PDF / ảnh ----------------

const SYSTEM_PROMPT = `Bạn là kế toán đọc HÓA ĐƠN MUA VÀO cho một công ty phần mềm nhỏ ở Việt Nam (CÔNG TY TNHH CÔNG NGHỆ HUBSELL). Nhiệm vụ: trích xuất số liệu trên hóa đơn/biên nhận được đưa vào, trả đúng JSON theo schema.

Quy tắc:
- Chỉ lấy số ghi trên chứng từ; không tự tính ra số không có. Không thấy → để null hoặc 0 và ghi vào "note" trường nào thiếu.
- "sellerName"/"sellerTaxCode" là NGƯỜI BÁN (nhà cung cấp), không phải người mua Hubsell.
- Hóa đơn nước ngoài (Supabase, Render, Vercel, Anthropic, Google, Zoho ngoài VN…): isForeign=true, sellerTaxCode=null, currency theo chứng từ (USD/EUR…), subtotal/vatAmount/total theo đồng tiền đó.
- Hóa đơn Việt Nam: currency="VND"; ký hiệu là chuỗi 7 ký tự kiểu "1C26TAA"; số hóa đơn giữ nguyên số 0 đầu; vatRate là "KCT" (không chịu thuế), "0", "5", "8" hoặc "10".
- invoiceDate định dạng yyyy-mm-dd.
- description: một dòng ngắn (≤ 80 ký tự) nêu dịch vụ/hàng mua, ví dụ "Gói Supabase Pro tháng 09/2026" hoặc "Chữ ký số EFY-CA 3 năm + USB token".
- expenseCategory chọn một trong: SOFTWARE (phần mềm, hosting, domain, AI, chữ ký số), RENT, SALARY, INSURANCE, MARKETING, BANK_FEE, TAX_FEE, EQUIPMENT, OTHER_EXPENSE.
- paymentMethod: "CASH" nếu chứng từ ghi tiền mặt; "BANK" nếu thẻ/chuyển khoản/online; không rõ → null.
- Ảnh mờ, số khó đọc → vẫn điền số khả dĩ nhất và ghi rõ trong note "số X đọc không chắc".`;

const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    invoiceNo: { type: ["string", "null"] },
    invoiceSerial: { type: ["string", "null"] },
    invoiceDate: { type: ["string", "null"] },
    sellerName: { type: ["string", "null"] },
    sellerTaxCode: { type: ["string", "null"] },
    isForeign: { type: "boolean" },
    description: { type: ["string", "null"] },
    currency: { type: "string" },
    subtotal: { type: "number" },
    vatRate: { type: ["string", "null"] },
    vatAmount: { type: "number" },
    total: { type: "number" },
    // enum + kiểu ["string","null"] bị API từ chối (400 "Enum value 'BANK' does
    // not match declared type") → tách anyOf string-enum | null.
    paymentMethod: { anyOf: [{ type: "string", enum: ["BANK", "CASH"] }, { type: "null" }] },
    expenseCategory: { anyOf: [{ type: "string", enum: [...EXPENSE_KEYS] }, { type: "null" }] },
    note: { type: ["string", "null"] },
  },
  required: [
    "invoiceNo",
    "invoiceSerial",
    "invoiceDate",
    "sellerName",
    "sellerTaxCode",
    "isForeign",
    "description",
    "currency",
    "subtotal",
    "vatRate",
    "vatAmount",
    "total",
    "paymentMethod",
    "expenseCategory",
    "note",
  ],
  additionalProperties: false,
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY_HQ });
  return client;
}

export function invoiceAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY_HQ);
}

type ImageMime = "image/jpeg" | "image/png" | "image/webp";

/**
 * Claude đọc PDF/ảnh/văn bản. `mime` quyết định khối nội dung gửi đi:
 * application/pdf → document; image/* → image; còn lại (XML lạ) → text.
 */
export async function readInvoiceWithAi(
  buf: Buffer,
  mime: string,
  fileName: string
): Promise<ExtractedInvoice> {
  const model = process.env.HQ_INVOICE_MODEL || "claude-sonnet-5";
  const content: Anthropic.ContentBlockParam[] = [];
  if (mime === "application/pdf") {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
    });
  } else if (mime.startsWith("image/")) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: mime as ImageMime, data: buf.toString("base64") },
    });
  } else {
    content.push({ type: "text", text: `Nội dung tệp ${fileName}:\n${buf.toString("utf8").slice(0, 60_000)}` });
  }
  content.push({ type: "text", text: `Tên tệp: ${fileName}. Hãy trích xuất số liệu hóa đơn này.` });

  const response = await getClient().messages.create({
    model,
    max_tokens: 2048,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("AI từ chối đọc tệp này");
  const raw = response.content.find((b) => b.type === "text")?.text ?? "";
  const p = JSON.parse(raw) as Partial<ExtractedInvoice>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const category = str(p.expenseCategory);
  return {
    invoiceNo: str(p.invoiceNo),
    invoiceSerial: str(p.invoiceSerial),
    invoiceDate: normalizeDate(str(p.invoiceDate)),
    sellerName: str(p.sellerName),
    sellerTaxCode: str(p.sellerTaxCode),
    isForeign: Boolean(p.isForeign),
    description: str(p.description),
    currency: (str(p.currency) ?? "VND").toUpperCase(),
    subtotal: n(p.subtotal),
    vatRate: normalizeVatRate(str(p.vatRate)),
    vatAmount: n(p.vatAmount),
    total: n(p.total),
    paymentMethod: p.paymentMethod === "CASH" || p.paymentMethod === "BANK" ? p.paymentMethod : null,
    expenseCategory:
      category && (EXPENSE_KEYS as readonly string[]).includes(category) ? category : null,
    note: str(p.note),
  };
}

// ---------------- Tỷ giá tham khảo ----------------

const rateCache = new Map<string, { rate: number; at: number }>();

/** VND cho 1 đơn vị `currency` — tham khảo, cache 6 giờ; null khi không lấy được. */
export async function fetchReferenceRate(currency: string): Promise<number | null> {
  const code = currency.toUpperCase();
  if (code === "VND") return 1;
  const hit = rateCache.get(code);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.rate;
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(code)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: Record<string, number> };
    const rate = body.rates?.VND;
    if (!rate || !Number.isFinite(rate)) return null;
    rateCache.set(code, { rate, at: Date.now() });
    return rate;
  } catch {
    return null;
  }
}
