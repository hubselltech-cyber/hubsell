/**
 * DỊCH LỖI NCC HÓA ĐƠN → VIỆC CẦN LÀM (19/09/2026).
 *
 * Trước 19/09 mọi lỗi in nguyên "ErrorCode=XYZ" tiếng Anh lên Lịch sử hóa đơn,
 * và worker tự động cứ thế thử tiếp đơn kế — sai mật khẩu meInvoice là 20 đơn
 * FAILED mỗi lượt, ngày nào cũng lặp. File này là NGUỒN DUY NHẤT trả lời 2 câu:
 *   1. Nói với chủ shop thế nào (message — chuyện gì xảy ra + làm gì tiếp).
 *   2. Lỗi hỏng ở TẦM nào (scope) để worker quyết định thử tiếp hay ngắt mạch:
 *        ACCOUNT   — hỏng ở tài khoản/cấu hình: đơn nào cũng sẽ lỗi y hệt.
 *        ORDER     — riêng dữ liệu của đơn này.
 *        TRANSIENT — sự cố tạm (mạng, NCC bận, số đang cấp dở) — lượt sau thử lại.
 *
 * NGUỒN MÃ LỖI (đừng thêm mã đoán mò — ghi rõ nguồn khi bổ sung):
 *   [doc]  bảng mã lỗi trang "Tạo, ký và phát hành hóa đơn" doc.meinvoice.vn/api
 *   [live] bắt được bằng request thật vào sandbox (ngày ghi kèm)
 * Mã lạ không có trong bảng → giữ nguyên mã + mô tả tiếng Việt của chính MISA
 * (DescriptionErrorCode), scope ORDER; lưới "cùng mã lặp liên tiếp" ở worker sẽ
 * bắt trường hợp mã lạ thực chất là lỗi tài khoản (VD hết số hóa đơn đã mua —
 * chưa bắt được mã thật vì sandbox không giới hạn số).
 */

export type InvoiceErrorScope = "ACCOUNT" | "ORDER" | "TRANSIENT";

/** Lỗi có cấu trúc từ API của NCC — giữ đủ mã + mô tả gốc thay vì nhét vào message. */
export class InvoiceProviderError extends Error {
  constructor(
    message: string,
    readonly detail: {
      /** ErrorCode cấp ngoài cùng hoặc cấp từng hóa đơn. */
      code?: string | null;
      /** Mã con trong mảng Errors (VD UnAuthorize → MisaIdError / TaxCodeNotExist). */
      subCodes?: string[];
      /** DescriptionErrorCode — mô tả tiếng Việt của chính NCC. */
      description?: string | null;
      httpStatus?: number;
      /** true = không tới được máy chủ NCC (DNS, timeout, reset). */
      network?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "InvoiceProviderError";
  }
}

/**
 * Dựng InvoiceProviderError từ body envelope meInvoice
 * `{Success, ErrorCode, DescriptionErrorCode, Errors[]}` (PascalCase lẫn
 * camelCase). Body không phải JSON → vẫn trả lỗi có httpStatus để phân loại.
 */
export function providerErrorFromBody(
  prefix: string,
  text: string,
  httpStatus?: number
): InvoiceProviderError {
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch {
    /* body không phải JSON */
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const code = str(json?.ErrorCode) ?? str(json?.errorCode);
  const description = str(json?.DescriptionErrorCode) ?? str(json?.descriptionErrorCode);
  const rawErrors = json?.Errors ?? json?.errors;
  const subCodes = Array.isArray(rawErrors)
    ? rawErrors.filter((e): e is string => typeof e === "string")
    : [];
  return new InvoiceProviderError(
    `${prefix}${httpStatus ? ` (HTTP ${httpStatus})` : ""}: ${code ? `ErrorCode=${code}` : text.slice(0, 300)}`,
    { code, subCodes, description, httpStatus }
  );
}

export interface ExplainedInvoiceError {
  code: string | null;
  scope: InvoiceErrorScope;
  /** Câu hiển thị cho chủ shop — đã gồm việc cần làm + mã gốc trong ngoặc. */
  message: string;
}

interface Rule {
  scope: InvoiceErrorScope;
  text: string;
}

const CONFIG_PAGE = "Kết nối & Xuất hóa đơn → Cấu hình kết nối";

/** Mã con của UnAuthorize — [live 19/09/2026] gọi /invoice/token với từng thông tin sai. */
const AUTH_SUB_RULES: Record<string, string> = {
  MisaIdError: `Sai email/SĐT hoặc mật khẩu meInvoice (có thể vừa đổi mật khẩu bên MISA) — nhập lại tại ${CONFIG_PAGE}.`,
  TaxCodeNotExist: `Mã số thuế chưa có trên meInvoice — kiểm tra lại MST tại ${CONFIG_PAGE}.`,
  UserNotExist: `Tài khoản meInvoice này chưa được phân quyền trên mã số thuế của shop — dùng đúng tài khoản quản trị meInvoice hoặc nhờ MISA phân quyền.`,
};

const RULES: Record<string, Rule> = {
  // ---- Tài khoản / cấu hình: đơn nào cũng lỗi → ngắt mạch ----
  UnAuthorize: {
    scope: "ACCOUNT",
    text: `meInvoice từ chối đăng nhập — kiểm tra tài khoản tại ${CONFIG_PAGE}.`, // [live 19/09]
  },
  InvoicePublishNotExist: {
    scope: "ACCOUNT",
    text: `Ký hiệu hóa đơn đang chọn chưa có thông báo phát hành (hoặc đã ngừng dùng) trên meInvoice — bấm "Tải ký hiệu" chọn lại tại ${CONFIG_PAGE}.`, // [doc]
  },
  APINotSupportTypeInvoice: {
    scope: "ACCOUNT",
    text: "meInvoice không nhận kiểu ký đang cấu hình cho loại hóa đơn này — liên hệ Hubsell để kiểm tra phương thức ký.", // [live 23/08]
  },
  SignatureEmpty: {
    scope: "ACCOUNT",
    text: "meInvoice không ký được hóa đơn — chứng thư số của shop chưa cấu hình ký tự động (HSM) hoặc đã hết hạn. Kiểm tra mục Chữ ký số trên meInvoice.", // [doc]
  },
  InvalidSignature: {
    scope: "ACCOUNT",
    text: "Chữ ký số không hợp lệ — chứng thư số có thể đã hết hạn hoặc bị thu hồi. Kiểm tra mục Chữ ký số trên meInvoice.", // [doc]
  },
  InvoiceIssuedDateSmallerThanLastest: {
    scope: "ACCOUNT",
    text: "Trên meInvoice đã có hóa đơn cùng ký hiệu mang ngày MUỘN HƠN hôm nay (thường do lập tay với ngày tương lai) nên mọi hóa đơn mới đều bị từ chối — xử lý hóa đơn đó trên meInvoice, hoặc chờ qua ngày đó.", // [doc]
  },
  // ---- Riêng đơn này ----
  InvoiceIssuedDate: {
    scope: "ORDER",
    text: "meInvoice báo ngày hóa đơn không hợp lệ — thử xuất lại; còn lặp thì báo Hubsell.", // [doc]
  },
  InvoiceDuplicated: {
    scope: "ORDER",
    text: "meInvoice ĐÃ CÓ hóa đơn cho mã đơn này (có thể lần trước phát hành xong nhưng mất kết nối lúc trả kết quả) — tra mã đơn trên meInvoice trước khi làm gì tiếp, ĐỪNG lập tay thêm tờ nữa.", // [doc]
  },
  DuplicateInvoiceRefID: {
    scope: "ORDER",
    text: "meInvoice ĐÃ CÓ hóa đơn cho mã đơn này — tra mã đơn trên meInvoice trước khi làm gì tiếp, ĐỪNG lập tay thêm tờ nữa.", // [live 24/08]
  },
  InvalidTaxCode: {
    scope: "ORDER",
    text: "Mã số thuế NGƯỜI MUA không hợp lệ (khách điền sai trên sàn) — liên hệ khách lấy MST đúng rồi lập hóa đơn cho đơn này trực tiếp trên meInvoice.", // [doc]
  },
  InvalidVatPercentage: {
    scope: "ORDER",
    text: `Thuế suất của một dòng hàng không được meInvoice chấp nhận — kiểm tra thuế suất mặc định tại ${CONFIG_PAGE} và thuế suất khai riêng ở sản phẩm.`, // [doc]
  },
  InvalidXMLData: {
    scope: "ORDER",
    text: "meInvoice báo dữ liệu hóa đơn không hợp lệ — thường do tên hàng chứa ký tự lạ. Khai Tên in hóa đơn cho sản phẩm rồi xuất lại.", // [doc]
  },
  InvalidInvNo: {
    scope: "TRANSIENT",
    text: "meInvoice cấp số hóa đơn bị lệch — hệ thống sẽ tự thử lại.", // [doc]
  },
  // ---- Tạm thời ----
  InvoiceNumberNotCotinuous: {
    scope: "TRANSIENT",
    text: "meInvoice đang cấp số cho một hóa đơn khác cùng ký hiệu (có người đang lập tay song song?) — hệ thống sẽ tự thử lại.", // [doc] — chính tả "Cotinuous" là của MISA
  },
  TokenExpiredCode: {
    scope: "TRANSIENT",
    text: "Phiên đăng nhập meInvoice hết hạn — hệ thống tự đăng nhập lại ở lượt sau.", // [doc]
  },
};

/** "RequireInfo_BuyerAddress", "Invalid_[Invoice.TotalSaleAmount]" → tên trường. */
function fieldOf(code: string): string | null {
  const m = /^RequireInfo_(.+)$/.exec(code) ?? /^Invalid_\[?([^\]]+)\]?$/.exec(code);
  return m ? m[1] : null;
}

function suffix(code: string | null, description?: string | null): string {
  const parts = [code, description?.trim()].filter(Boolean);
  return parts.length > 0 ? ` (meInvoice: ${parts.join(" – ")})` : "";
}

export function explainInvoiceError(err: unknown): ExplainedInvoiceError {
  if (!(err instanceof InvoiceProviderError)) {
    // Lỗi thường (thiếu cấu hình, chốt an toàn…) — message vốn đã là tiếng Việt.
    return { code: null, scope: "ORDER", message: (err as Error).message };
  }
  const { code = null, subCodes = [], description, httpStatus, network } = err.detail;

  if (network || (httpStatus !== undefined && httpStatus >= 500)) {
    return {
      code,
      scope: "TRANSIENT",
      message: `Không kết nối được meInvoice (máy chủ MISA bận hoặc mạng chập chờn) — hệ thống sẽ tự thử lại.${suffix(code, description ?? (httpStatus ? `HTTP ${httpStatus}` : null))}`,
    };
  }

  if (code === "UnAuthorize") {
    const sub = subCodes.find((s) => AUTH_SUB_RULES[s]);
    return {
      code: sub ?? code,
      scope: "ACCOUNT",
      message: `${sub ? AUTH_SUB_RULES[sub] : RULES.UnAuthorize.text}${suffix(sub ?? code, description)}`,
    };
  }

  if (code && RULES[code]) {
    return { code, scope: RULES[code].scope, message: `${RULES[code].text}${suffix(code, description)}` };
  }

  const field = code ? fieldOf(code) : null;
  if (field) {
    return {
      code,
      scope: "ORDER",
      message: `meInvoice báo thiếu hoặc sai thông tin "${field}" trên hóa đơn của đơn này — báo Hubsell kèm mã đơn để kiểm tra.${suffix(code, description)}`,
    };
  }

  return {
    code,
    scope: "ORDER",
    message: `meInvoice từ chối phát hành${description ? `: ${description.trim()}` : ""} — thử xuất lại; còn lặp thì báo Hubsell kèm mã đơn.${suffix(code, null)}`,
  };
}
