/**
 * HỢP ĐỒNG CHUNG CHO MỌI NHÀ CUNG CẤP HÓA ĐƠN ĐIỆN TỬ (Multi-Vendor).
 *
 * Mỗi NCC (MISA / BKAV / Viettel…) là một adapter cài `InvoiceProvider`. Code
 * nghiệp vụ CHỈ được gọi qua interface này — không import thẳng adapter — để
 * thêm NCC mới chỉ là thêm một file + một dòng đăng ký ở index.ts, không phải
 * sửa chỗ phát hành hóa đơn.
 *
 * Trạng thái trả về dùng chung enum InvoiceLogStatus của Prisma để ghi thẳng
 * vào bảng InvoiceLog, khỏi phải map qua lại hai bộ trạng thái.
 */

import type { InvoiceLogStatus } from "@prisma/client";

import type { CqtStatus } from "./cqt-status";

/**
 * Một dòng hàng hóa trên hóa đơn.
 *
 * QUY ƯỚC TIỀN (đổi 24/08 — anh Trung chốt BÓC NGƯỢC sau khảo sát Salework +
 * chuẩn kế toán TMĐT): giá bán trên sàn là giá ĐÃ GỒM thuế GTGT, nơi dựng dòng
 * (issue-order.buildInvoiceLines) bóc ngược ra tiền chưa thuế + tiền thuế sao
 * cho amountWithoutVat + vatAmount = ĐÚNG giá bán từng dòng hàng (tổng hóa đơn
 * = TIỀN HÀNG của đơn, không gồm ship thu hộ — anh chỉnh chữ 25/08).
 * Adapter NCC dùng THẲNG hai số này, không tự suy lại từ
 * unitPrice × quantity (nhân lại là lệch làm tròn).
 */
export interface InvoiceLine {
  /** Tên hàng hóa IN TRÊN HÓA ĐƠN — ưu tiên Product.taxName, fallback tên bán. */
  name: string;
  sku: string;
  /**
   * ĐƠN VỊ TÍNH in trên hóa đơn (19/09) — nội dung bắt buộc của hóa đơn mà sàn
   * không trả qua API: Product.unitName khai riêng, fallback defaultUnitName của
   * shop. Vắng mặt ở snapshot InvoiceLog.lines đời trước 19/09.
   */
  unitName?: string;
  /**
   * Dòng QUÀ TẶNG / hàng khuyến mại không thu tiền (giá bán 0đ trên đơn sàn) —
   * vẫn phải có mặt trên hóa đơn nhưng ghi đúng tính chất "khuyến mại" thay vì
   * một dòng hàng bán giá 0. Adapter map sang tính chất dòng của NCC.
   */
  promotion?: boolean;
  quantity: number;
  /** Đơn giá CHƯA thuế (bóc từ giá bán — có thể lẻ 2 số thập phân khi SL>1). */
  unitPrice: number;
  /** % thuế suất GTGT đầu ra của dòng: 0 / 5 / 8 / 10 (SKU khai riêng, fallback defaultVatRate của shop). */
  vatRate: number;
  /** Thành tiền CHƯA thuế của dòng (VND nguyên) — số liệu chính của payload. */
  amountWithoutVat: number;
  /** Tiền thuế GTGT dòng = giá bán dòng hàng − amountWithoutVat. */
  vatAmount: number;
}

/**
 * Tham chiếu hóa đơn GỐC khi lập hóa đơn ĐIỀU CHỈNH (khách trả hàng hoàn tiền
 * — điểm c khoản 5 Điều 10 TT 91/2026: người bán lập hóa đơn điều chỉnh ghi
 * số ÂM, không hủy/không thay thế). Adapter tự tách mẫu số từ ký hiệu.
 */
export interface InvoiceAdjustmentRef {
  /** Số hóa đơn gốc bị điều chỉnh (VD "00000066"). */
  orgInvNo: string;
  /** Ký hiệu ĐẦY ĐỦ 7 ký tự của hóa đơn gốc (VD "1K26TYY"). */
  orgInvSeries: string;
  /** Ngày phát hành hóa đơn gốc, định dạng yyyy-MM-dd. */
  orgInvDate: string;
  /** Lý do điều chỉnh — in vào ghi chú hóa đơn (VD "Khách trả hàng hoàn tiền"). */
  reason: string;
}

/** Dữ liệu cần để phát hành một hóa đơn cho một đơn hàng. */
export interface CreateInvoiceInput {
  /** Mã đơn hàng nội bộ — NCC lưu làm số tham chiếu, dùng đối soát 2 chiều. */
  orderCode: string;
  buyerName: string;
  /** Họ tên NGƯỜI ĐẶT khi mua danh nghĩa công ty — in dòng "Họ tên người mua hàng". */
  buyerContactName?: string;
  /** MST người mua (công ty/hộ KD) hoặc số định danh cá nhân — trống với khách lẻ. */
  buyerTaxCode?: string;
  /** Địa chỉ người mua — bắt buộc kèm khi xuất theo đơn vị (BuyerLegalName). */
  buyerAddress?: string;
  /** Email người mua — NCC gửi hóa đơn điện tử về địa chỉ này. */
  buyerEmail?: string;
  /** SĐT người mua in trên hóa đơn / nhận SMS (dạng "0912…"). */
  buyerPhone?: string;
  /** Số định danh cá nhân (CCCD 12 số) của người mua cá nhân — NĐ 254/2026. */
  buyerIdNumber?: string;
  lines: InvoiceLine[];
  /** Tổng tiền hàng đã gồm thuế (đối chiếu với tổng tính từ lines). */
  totalAmount: number;
  /**
   * Có mặt = đây là hóa đơn ĐIỀU CHỈNH cho hóa đơn gốc bên trong (lines khi đó
   * mang số ÂM); vắng mặt = hóa đơn phát hành thường.
   */
  adjustment?: InvoiceAdjustmentRef;
}

/** Kết quả một thao tác với NCC — dùng chung cho cả create/cancel/checkStatus. */
export interface InvoiceResult {
  status: InvoiceLogStatus;
  /** Số hóa đơn NCC cấp (chỉ có khi đã phát hành). */
  invoiceNo?: string;
  /** Mã giao dịch phía NCC — giữ lại để checkStatus/cancel về sau. */
  transactionId?: string;
  /** Tiền thuế GTGT đầu ra NCC tính. */
  vatAmount?: number;
  /** Thông điệp lỗi khi status = FAILED — ĐÃ dịch ra việc cần làm (invoice-errors.ts). */
  errorMessage?: string;
  /** Mã lỗi nguyên văn của NCC (nếu bóc được) — cho worker gom lỗi lặp. */
  errorCode?: string;
  /**
   * Tầm ảnh hưởng của lỗi: ACCOUNT = hỏng ở tài khoản/cấu hình (đơn nào cũng sẽ
   * lỗi y hệt → worker tự động NGẮT MẠCH); ORDER = riêng đơn này; TRANSIENT =
   * sự cố tạm (mạng, NCC bận) — lượt sau thử lại.
   */
  errorScope?: "ACCOUNT" | "ORDER" | "TRANSIENT";
  /**
   * TỜ NHÁP CHỜ CHỦ SHOP KÝ (chỉ có nghĩa khi status = PENDING, lát T1 tenant 08/10/2026):
   * nhà cung cấp đã nhận tờ nháp đầy đủ dữ liệu, chủ shop phải ký trên web của họ (eSign /
   * USB token không ký nền được). Chưa có mã tra cứu; lõi đánh dấu InvoiceLog.awaitingSignatureAt
   * và vòng hỏi tra lại qua findDrafts theo mã tham chiếu. `errorMessage` khi đó là câu
   * hướng dẫn chỗ ký (không phải lỗi). Chỉ có khi capabilities.draftSigning.supported.
   */
  awaitingSignature?: boolean;
  /**
   * CHƯA RÕ KẾT QUẢ (chỉ có nghĩa khi status = FAILED): lệnh phát hành đã gửi sang
   * NCC nhưng không có câu trả lời rõ "đã lập" hay "từ chối" (đứt mạng sau khi gửi,
   * NCC lỗi máy chủ, trả lời thành công mà không kèm số lẫn mã tra cứu, báo trùng
   * mã mà tra ngược không ra). Tờ hóa đơn CÓ THỂ đã tồn tại bên NCC. Nơi gọi không
   * được coi đây là "chắc chắn chưa lập": chỉ được gửi lại ĐÚNG mã tham chiếu cũ
   * (khi NCC chặn trùng theo mã) hoặc tra ngược trước, theo bảng khả năng của NCC.
   * Vắng mặt / false = NCC đã trả lời rõ, hoặc lệnh chưa hề được gửi.
   */
  outcomeUnknown?: boolean;
}

/** Thông tin kết nối đọc từ bảng InvoiceConfig của shop. */
export interface ProviderCredentials {
  clientId: string | null;
  secretKey: string | null;
  /** API key riêng theo gian hàng (nếu shop cấu hình). */
  apiKey: string | null;
  /** Endpoint tùy biến — chỉ dùng khi provider = CUSTOM. */
  customApiUrl: string | null;
  /** Mã đại lý ISV của Hubsell — NCC ghi nhận hoa hồng theo mã này. */
  partnerCode: string | null;
}

/**
 * BẢNG KHẢ NĂNG của một NCC (02/10/2026 — giai đoạn 2 bước 5, docs/HANG-DOI-BEN.md
 * mục 4.6). Phần lõi (phát hành, tra lại tờ chưa rõ kết quả, hỏi trạng thái) CHỈ
 * đọc bảng này để quyết định cách làm, không giả định NCC nào cũng giống MISA.
 *
 * Hóa đơn đã gửi cơ quan thuế thì không xóa được, nên mỗi giá trị khai ở adapter
 * phải ghi NGUỒN: tài liệu của NCC, hoặc kết quả chạy bài thử trên sandbox của
 * chính NCC đó (khuôn bài thử: scripts/misa-refid-probe.ts). Chưa kiểm được thì
 * khai giá trị AN TOÀN (false / không hỗ trợ) — lõi khi đó tự chọn đường thận
 * trọng: không tự gửi lại, chờ người xác nhận.
 */
export interface ProviderCapabilities {
  /**
   * Trong MỘT shop phải phát hành lần lượt từng tờ (NCC cấp số liên tục theo ký
   * hiệu, bắn song song bị từ chối). false = NCC nhận nhiều lệnh cùng lúc.
   */
  sequentialIssue: boolean;
  /**
   * Nghỉ TỐI THIỂU (ms) giữa hai lệnh phát hành liên tiếp của một shop; 0 = NCC
   * không yêu cầu. Người gọi lặp qua nhiều tờ (worker tự phát hành, phát hành hàng
   * loạt) phải chờ đủ khoảng này trước tờ kế — lõi đưa số ra qua
   * IssueOrderResult.pauseBeforeNextMs. MISA (trả lời ticket 02/10/2026): mỗi
   * lệnh cách nhau 1–3 giây, cùng ký hiệu phải tuần tự.
   */
  publishGapMs: number;
  /**
   * NCC chặn trùng theo MÃ THAM CHIẾU Hubsell gửi kèm: gửi lại đúng mã của một
   * tờ đã lập thì bị từ chối, không lập tờ thứ hai. Đây là chốt cuối chống phát
   * hành trùng khi Hubsell không biết lượt trước đã lập hay chưa.
   */
  dedupesByReference: boolean;
  /**
   * Mã tham chiếu của một lượt bị TỪ CHỐI (không tờ nào được lập) gửi lại được.
   * false = lượt bị từ chối cũng "đốt" mã, lượt sau phải dùng mã mới.
   */
  referenceReusableAfterReject: boolean;
  /**
   * Tra ngược "mã tham chiếu này đã có hóa đơn chưa". `settleSeconds`: sau khi
   * NCC lập xong, tối đa bao lâu thì lượt tra chắc chắn thấy — kết quả "không
   * thấy" trước mốc đó KHÔNG được coi là kết luận.
   */
  findByReference: { supported: false } | { supported: true; settleSeconds: number };
  /** Số tờ tối đa trong một lệnh hỏi trạng thái (1 = NCC chỉ hỏi được từng tờ). */
  statusBatchSize: number;
  /** NCC tự đẩy sự kiện đổi trạng thái về (webhook). */
  webhook: boolean;
  /** Hủy hóa đơn qua API được (false = chủ shop phải hủy trên trang của NCC). */
  cancelViaApi: boolean;
  /**
   * Khi nhận hóa đơn ĐIỀU CHỈNH, NCC có kiểm hóa đơn gốc tồn tại không. false =
   * NCC lập cả tờ điều chỉnh trỏ vào số hóa đơn gốc sai, Hubsell phải tự bảo đảm.
   */
  validatesAdjustmentOriginal: boolean;
  /**
   * NCC nhận TỜ NHÁP để chủ shop ký trên web của họ (lát T1 tenant, 08/10/2026) — đường
   * đi của chữ ký số từ xa / USB token không ký nền được. `signUrl` = trang chủ shop vào
   * ký. Adapter khai true thì phải cài findDrafts và trả awaitingSignature từ createInvoice.
   */
  draftSigning: { supported: false } | { supported: true; signUrl: string };
  /**
   * Số tờ tối đa adapter nhận trong MỘT lệnh lập hóa đơn (createInvoices). 1 = từng tờ
   * một lệnh (createInvoice). Lớn hơn 1 thì adapter PHẢI cài createInvoices. Lõi
   * issue-order gom đơn theo số này; khoảng nghỉ publishGapMs áp giữa hai LỆNH.
   */
  createBatchSize: number;
}

/**
 * Kết quả tra ngược theo mã tham chiếu. Ba trạng thái tách bạch vì hậu quả khác
 * hẳn nhau: "không thấy" cho phép gửi lại, còn "không tra được" thì CHƯA biết gì
 * và không được làm gì tiếp.
 */
export type ReferenceLookup =
  | {
      state: "FOUND";
      invoiceNo: string | null;
      transactionId: string | null;
      /** NCC đã phát hành xong tờ này (có hiệu lực). */
      issued: boolean;
      /** Tờ này đã bị xóa bỏ / hủy phía NCC. */
      deleted: boolean;
      /** Số tờ NCC trả về cho mã này — lớn hơn 1 là NCC đang có hóa đơn trùng mã. */
      matches: number;
    }
  | { state: "NOT_FOUND" }
  | {
      state: "LOOKUP_FAILED";
      /** Vì sao không tra được — câu đã viết cho chủ shop đọc khi adapter dịch được lỗi. */
      message: string;
      /**
       * true = hỏng ở tài khoản / cấu hình của shop (sai mật khẩu, sai mã số thuế...):
       * thử lại không tự hết, chủ shop phải sửa kết nối. false = sự cố tạm (mạng, NCC bận).
       */
      accountProblem: boolean;
    };

/**
 * Kết quả tra MỘT tờ nháp theo mã tham chiếu (lát T1 tenant). Tách bạch vì hậu quả khác nhau:
 * SIGNED nối số; WAITING hẹn hỏi lại; GONE/DELETED = không còn hóa đơn nào, đơn quay lại hàng chờ.
 */
export type DraftLookup =
  | { state: "SIGNED"; invoiceNo: string | null; transactionId: string }
  | { state: "WAITING" }
  /** Không có tờ nào mang mã này ở cả web lẫn cổng tra cứu — chủ shop đã xóa nháp. */
  | { state: "GONE" }
  /** NCC có tờ nhưng báo đã xóa bỏ / hủy. */
  | { state: "DELETED" };

/** Kết quả tra MỘT LÔ tờ nháp. Mã không có trong `found` = adapter không kết luận được, hẹn hỏi lại. */
export type DraftBatchResult =
  | { ok: true; found: Map<string, DraftLookup> }
  | { ok: false; message: string; accountProblem: boolean };

/** Một tờ cần hỏi trạng thái: mã tra cứu NCC cấp + ký hiệu lúc phát hành (nếu Hubsell có lưu). */
export interface StatusQuery {
  transactionId: string;
  invoiceSeries: string | null;
}

/** Trạng thái ĐÃ CHUẨN HÓA của một tờ phía NCC — lõi không đọc bảng mã riêng của NCC nào. */
export interface ProviderInvoiceStatus {
  transactionId: string;
  /** NCC đã phát hành xong tờ này. */
  issued: boolean;
  /** Tờ đã bị xóa bỏ / hủy phía NCC. */
  deleted: boolean;
  /** Số hóa đơn NCC trả kèm (nếu có). */
  invoiceNo: string | null;
  /** Kết quả phía cơ quan thuế; null = NCC không trả hoặc trả mã lạ (giữ giá trị cũ). */
  taxStatus: CqtStatus | null;
}

/**
 * Kết quả hỏi trạng thái MỘT LÔ. Tờ không có mặt trong `found` là NCC KHÔNG TRẢ DÒNG
 * cho mã đó — chưa phải kết luận (MISA sandbox 03/10/2026: mã không tồn tại và mã bị
 * hỏi sai loại ký hiệu đều bị bỏ qua im lặng), lõi chỉ ghi nhận đã hỏi rồi hỏi lại sau.
 */
export type StatusBatchResult =
  | { ok: true; found: Map<string, ProviderInvoiceStatus> }
  | {
      ok: false;
      /** Vì sao không hỏi được — câu đã viết cho người đọc khi adapter dịch được lỗi. */
      message: string;
      /** true = hỏng ở tài khoản / cấu hình của shop; false = sự cố tạm. */
      accountProblem: boolean;
    };

/**
 * Interface mọi adapter NCC hóa đơn phải cài đủ.
 *
 * Các phương thức đều KHÔNG được ném lỗi vì sự cố nghiệp vụ (NCC từ chối,
 * sai MST…) — trả `status: FAILED` + errorMessage để nơi gọi ghi log và hiển
 * thị; chỉ ném khi lỗi lập trình thật sự (thiếu tham số bắt buộc).
 */
export interface InvoiceProvider {
  /** Tên định danh khớp cột InvoiceConfig.provider: "MISA" | "BKAV" | … */
  readonly name: string;

  /** Bảng khả năng của NCC này — xem ProviderCapabilities. */
  readonly capabilities: ProviderCapabilities;

  /** Gửi yêu cầu phát hành hóa đơn cho một đơn hàng. */
  createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult>;

  /**
   * Lập MỘT LÔ tờ trong một lệnh (anh Trung chốt 10/10/2026: tờ nháp gửi 20 tờ một lệnh).
   * Trả đúng một kết quả cho mỗi phần tử, cùng thứ tự. Không ném lỗi nghiệp vụ: lệnh hỏng
   * cả lô thì mỗi phần tử mang kết quả hỏng. Bắt buộc có khi capabilities.createBatchSize
   * > 1; nơi gọi bảo đảm lô không quá số đó.
   */
  createInvoices?(inputs: CreateInvoiceInput[]): Promise<InvoiceResult[]>;

  /** Hủy một hóa đơn đã phát hành (theo transactionId NCC cấp lúc tạo). */
  cancelInvoice(transactionId: string, reason: string): Promise<InvoiceResult>;

  /** Tra trạng thái hiện tại của một hóa đơn phía NCC. */
  checkStatus(transactionId: string): Promise<InvoiceResult>;

  /**
   * Tra ngược theo mã tham chiếu đã gửi lúc phát hành (CreateInvoiceInput.orderCode).
   * Bắt buộc có khi capabilities.findByReference.supported = true.
   */
  findByReference?(reference: string): Promise<ReferenceLookup>;

  /**
   * Hỏi trạng thái một lô tờ (phát hành xong chưa, đã xóa chưa, cơ quan thuế nói gì).
   * Nơi gọi bảo đảm lô không quá capabilities.statusBatchSize. CHỈ ĐỌC phía NCC. Không
   * ném lỗi: hỏi không được trả `ok: false`. Adapter không có phương thức này thì vòng
   * hỏi trạng thái bỏ qua tờ của NCC đó (không có cách hỏi).
   */
  checkStatuses?(items: StatusQuery[]): Promise<StatusBatchResult>;

  /**
   * Tra một lô TỜ NHÁP theo mã tham chiếu đã gửi lúc lập (CreateInvoiceInput.orderCode):
   * đã ký chưa, số + mã tra cứu, hay đã bị xóa. Bắt buộc có khi capabilities.draftSigning
   * .supported = true. Lô không quá capabilities.statusBatchSize. CHỈ ĐỌC. Không ném lỗi.
   */
  findDrafts?(references: string[]): Promise<DraftBatchResult>;
}
