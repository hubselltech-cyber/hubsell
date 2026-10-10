/**
 * ADAPTER MISA meInvoice — GỌI API THẬT (nối 23/08/2026 sau khi thông sandbox).
 *
 * Nhận NGUYÊN ROW InvoiceConfig của shop (không chỉ cặp khóa) vì phát hành cần
 * đủ MST/ký hiệu/mẫu số/signMethod. Luồng hiện nối là KÊ KHAI (STANDARD); luồng
 * máy tính tiền (POS) chưa nối — trả FAILED với lời nhắn rõ thay vì phát hành sai loại.
 *
 * HAI ĐƯỜNG THEO PHƯƠNG THỨC KÝ (lát T1 tenant, 08/10/2026 — MISA trả lời ticket
 * 08/10: ký nền SignType 2 chỉ với HSM / "eSign nâng cao"; eSign thường và USB token
 * ký trên web):
 *   · HSM         → cổng phát hành /invoice/publishing SignType 2, ra số ngay.
 *   · ESIGN_CLOUD / USB_TOKEN → nhóm API WEB APP (misa-invoiceweb.ts): đẩy TỜ NHÁP
 *     đầy đủ dữ liệu lên meinvoice.vn, trả PENDING + awaitingSignature; chủ shop ký
 *     theo lô trên web; vòng hỏi gọi findDrafts theo mã tham chiếu rồi nối số.
 *     Mã tham chiếu bên MISA của đường này là UUID v5 của mã Hubsell (webRefIdFor).
 *
 * Theo hợp đồng InvoiceProvider: KHÔNG ném lỗi nghiệp vụ — mọi từ chối/lỗi API
 * (kể cả chốt an toàn MISA_ALLOW_PUBLISH của misa-safety.ts) trả về
 * status FAILED + errorMessage để nơi gọi ghi InvoiceLog và hiển thị.
 */

import { InvoiceLogStatus } from "@prisma/client";
import { mapCqtStatus, seriesHasTaxCode } from "./cqt-status";
import {
  AWAITING_SIGNATURE_CODE,
  awaitingSignatureMessage,
  NUMBER_PENDING_CODE,
  numberPendingMessage,
} from "./draft-signing";
import { explainInvoiceError, InvoiceProviderError, isPublishOutcomeUnknown } from "./invoice-errors";
import { clearMisaTokenCache } from "./misa-auth";
import {
  downloadInvoiceFiles,
  getInvoiceStatuses,
  publishStandardInvoice,
  standardConfigMissing,
  type MisaInvoiceStatusItem,
  type StandardInvoiceConfig,
} from "./misa-einvoice";
import {
  buildWebDraftPayload,
  clearWebTokenCache,
  findWebTemplate,
  getWebInvoices,
  insertWebDraft,
  insertWebDraftPayloads,
  WEB_INSERT_BATCH_SIZE,
  WEB_INSERT_NOT_IN_RESPONSE,
  MEINVOICE_WEB_INVOICES_URL,
  usesWebDraft,
  WEB_GETLIST_BATCH_MAX,
  webRefIdFor,
} from "./misa-invoiceweb";
import type {
  CreateInvoiceInput,
  DraftBatchResult,
  DraftLookup,
  InvoiceProvider,
  InvoiceResult,
  ProviderCapabilities,
  ProviderInvoiceStatus,
  ReferenceLookup,
  StatusBatchResult,
  StatusQuery,
} from "./types";

/**
 * Lát cắt InvoiceConfig adapter cần — khớp row Prisma, khai structural để
 * test/dev truyền object thường không cần Prisma type.
 */
export interface MisaProviderConfig extends StandardInvoiceConfig {
  defaultInvoiceType: string; // STANDARD | POS
}

/**
 * BẢNG KHẢ NĂNG của meInvoice. Nguồn từng dòng:
 *   [doc]        tài liệu meInvoice (doc.meinvoice.vn / portal developer.misa.vn)
 *   [thử 02/10]  bài thử scripts/misa-refid-probe.ts chạy trên sandbox 02/10/2026
 *                (kết quả chép ở docs/HANG-DOI-BEN.md mục 4.6)
 *   [MISA 02/10] Phòng Tích hợp hệ thống MISA trả lời ticket hỗ trợ ngày 02/10/2026
 *                15:34 (nguyên văn ở docs/MISA-TICKET-MA-THAM-CHIEU-HOA-DON-DA-XOA.md)
 */
export const MISA_CAPABILITIES: ProviderCapabilities = {
  // [doc] "Lưu ý khi bắt đầu": số hóa đơn cấp liên tục theo ký hiệu, lệnh chen
  // ngang bị từ chối với InvoiceNumberNotCotinuous. [MISA 02/10] xác nhận: "yêu cầu
  // phát hành tuần tự với 1 ký hiệu hóa đơn (InvSeries)", phát hành đồng thời là
  // "làm sai quy tắc mà sản phẩm đặt ra".
  sequentialIssue: true,
  // [MISA 02/10] "mỗi request nên cách nhau 1-3s". Lấy mức thấp nhất MISA nêu; số
  // 1 giây cũng là nhịp đã chốt 01/10 (docs/HANG-DOI-BEN.md mục 3.8).
  publishGapMs: 1000,
  // [thử 02/10] gửi lại mã đã lập → DuplicateInvoiceRefID (cả hóa đơn bán lẫn điều
  // chỉnh); hai lệnh CÙNG LÚC cùng một mã → đúng một tờ được lập, lệnh kia báo trùng.
  // [MISA 02/10] "RefID là Key để check trùng hóa đơn", trùng "gần như sẽ không xảy
  // ra" — MISA không cam kết tuyệt đối, nên vẫn giữ chỉ mục duy nhất phía Hubsell.
  dedupesByReference: true,
  // [thử 02/10] một mã bị từ chối hai kiểu (ký hiệu không tồn tại, thuế suất sai)
  // rồi gửi lại hợp lệ thì được nhận (hóa đơn bán). Hóa đơn điều chỉnh: bị từ chối
  // vì thuế suất sai rồi gửi lại đúng mã đó thì được nhận (tờ sandbox 00000137).
  referenceReusableAfterReject: true,
  // [thử 02/10] /invoice/status?inputType=2 tra theo RefID. Mã chưa từng gửi trả
  // danh sách rỗng. Hóa đơn bán thấy ngay (3/3 lượt); hóa đơn điều chỉnh có 2/2
  // lượt tra ngay sau khi lập trả RỖNG, 140 ms sau thì thấy. 60 giây là mức TỰ
  // CHỌN, gấp vài trăm lần độ trễ đã thấy. [MISA 02/10] không cho con số; chỉ nói
  // phát hành xong không cần tra lại ngay vì câu trả lời đã có đủ thông tin (đúng
  // với mã: createInvoice chỉ tra ngược khi báo trùng hoặc chưa rõ kết quả).
  findByReference: { supported: true, settleSeconds: 60 },
  // Cỡ lô worker hỏi trạng thái đang chạy từ 03/09/2026 (body là mảng mã tra cứu).
  // [thử 03/10] scripts/misa-status-batch-probe.ts: lô 50 mã được nhận, lô 80 mã bị
  // từ chối HTTP 400 InvoiceQuantityTooLarge. Chưa dò mức chính xác giữa 51 và 80.
  statusBatchSize: 50,
  // [doc] chỉ có /invoice/status để hỏi; không có webhook.
  webhook: false,
  // [doc] portal đọc 23/08/2026 không có endpoint hủy. (doc.meinvoice.vn/itg có
  // nhắc POST /cancel — CHƯA kiểm, nên khai mức an toàn.) [MISA 02/10] không trả
  // lời câu hủy qua API; chỉ nói hóa đơn đã phát hành KHÔNG xóa được, sai thì phải
  // xử lý sai sót (điều chỉnh / thay thế).
  cancelViaApi: false,
  // [thử 02/10] sandbox nhận và lập cả tờ điều chỉnh trỏ vào số hóa đơn gốc không tồn tại.
  // [MISA 02/10] xác nhận cả production: "vẫn cho phép điều chỉnh/thay thế hóa đơn của
  // hệ thống khác, nên thông tin của hóa đơn gốc sẽ không validate"; gốc không có thì
  // cơ quan thuế từ chối. Hubsell tự kiểm trước (adjust-precheck.ts, lát 3).
  validatesAdjustmentOriginal: false,
  // [doc] nhóm "API WEB APP (hóa đơn nháp)" trên developer.misa.vn; [thử 07/10] sandbox
  // trọn vòng đời insert → getlist → delete; [thật 07/10 đêm] tờ 1C26THB 00000001 của HQ
  // lập từ nháp, ký eSign trên web, nối số + PDF; [MISA 08/10] ticket xác nhận "để tạo
  // hóa đơn nháp tham khảo API WEB APP". Chủ shop ký ở app3.meinvoice.vn/v3/hoa-don.
  draftSigning: { supported: true, signUrl: MEINVOICE_WEB_INVOICES_URL },
  // Cổng phát hành HSM: một tờ một lệnh (tài liệu cho tới 30, MISA 02/10 khuyên 20–30 —
  // CHƯA đo, chưa có khách ký HSM). Đường tờ nháp khai số khác ở `capabilities` của
  // adapter (WEB_INSERT_BATCH_SIZE, đo sandbox 10/10/2026).
  createBatchSize: 1,
};

/** Tờ nháp đã được ký trên web (có mã tra cứu; số có thể cấp trễ). */
interface SignedDraft {
  invoiceNo: string | null;
  transactionId: string;
}

/**
 * Kết quả "CHƯA RÕ" của một lệnh phát hành (bước 5 lát 5). Vẫn là FAILED để đơn
 * không mang nhãn đã có hóa đơn, kèm cờ outcomeUnknown cho lõi. Câu báo đúng với
 * MISA vì MISA chặn trùng theo mã tham chiếu (bảng khả năng): lượt làm lại gửi
 * đúng mã cũ, MISA báo trùng, recoverDuplicate nối lại số của tờ đã lập.
 */
function unknownOutcome(detail: string): InvoiceResult {
  return {
    status: InvoiceLogStatus.FAILED,
    outcomeUnknown: true,
    errorScope: "TRANSIENT",
    errorCode: "HUBSELL_OUTCOME_UNKNOWN",
    errorMessage:
      "Chưa rõ hóa đơn này đã lập hay chưa: lệnh đã gửi sang meInvoice nhưng không nhận được câu trả lời rõ ràng. " +
      "ĐỪNG lập tay trên meInvoice. Làm lại thao tác này: nếu tờ trước đã lập, Hubsell tự nhận lại đúng số hóa đơn đó, không lập thêm tờ nào. " +
      `(meInvoice: ${detail})`,
  };
}

export class MisaInvoiceProvider implements InvoiceProvider {
  readonly name = "MISA";
  readonly capabilities: ProviderCapabilities;

  constructor(private cfg: MisaProviderConfig) {
    // Đường tờ nháp (eSign / USB token) gom 20 tờ một lệnh insert (anh Trung chốt
    // 10/10/2026); cổng HSM giữ một tờ một lệnh.
    this.capabilities = usesWebDraft(cfg.signMethod)
      ? { ...MISA_CAPABILITIES, createBatchSize: WEB_INSERT_BATCH_SIZE }
      : MISA_CAPABILITIES;
  }

  /** Lỗi cấu hình chặn trước khi gọi nhà cung cấp — dùng chung cho một tờ và cả lô. */
  private configBlocked(): InvoiceResult | null {
    if (this.cfg.defaultInvoiceType === "POS") {
      return {
        status: InvoiceLogStatus.FAILED,
        errorScope: "ACCOUNT",
        errorCode: "HUBSELL_POS_NOT_SUPPORTED",
        errorMessage:
          "Luồng hóa đơn máy tính tiền (POS) chưa được nối API — tạm chọn luồng Kê khai ở trang Kết nối & Xuất hóa đơn.",
      };
    }
    const missing = standardConfigMissing(this.cfg);
    if (missing.length > 0) {
      return {
        status: InvoiceLogStatus.FAILED,
        errorScope: "ACCOUNT",
        errorCode: "HUBSELL_CONFIG_MISSING",
        errorMessage: `Chưa đủ cấu hình phát hành — thiếu: ${missing.join(", ")}. Vào Kết nối & Xuất hóa đơn để bổ sung.`,
      };
    }
    return null;
  }

  /**
   * MỘT LÔ tờ (createBatchSize = 20 ở đường tờ nháp). Cổng HSM chưa gom: lập lần lượt
   * từng tờ qua createInvoice để giữ đúng hợp đồng "mỗi phần tử một kết quả".
   */
  async createInvoices(inputs: CreateInvoiceInput[]): Promise<InvoiceResult[]> {
    if (inputs.length === 0) return [];
    const blocked = this.configBlocked();
    if (blocked) return inputs.map(() => ({ ...blocked }));
    if (!usesWebDraft(this.cfg.signMethod)) {
      const out: InvoiceResult[] = [];
      for (const input of inputs) out.push(await this.createInvoice(input));
      return out;
    }
    return this.createViaWebDraftBatch(inputs);
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
    const blocked = this.configBlocked();
    if (blocked) return blocked;

    // Chữ ký số từ xa / USB token: không ký nền được → đường tờ nháp (xem đầu tệp).
    if (usesWebDraft(this.cfg.signMethod)) return this.createViaWebDraft(input);

    try {
      const result = await this.publishWithRetry(input);
      // MISA trả lời thành công mà không kèm số hóa đơn lẫn mã tra cứu: không có gì
      // để chứng minh tờ đã lập và cũng không có gì để hỏi trạng thái về sau, nên
      // KHÔNG ghi "đã phát hành" (trước 02/10/2026 ca này ghi ISSUED với số để
      // trống). Mã tra cứu trùng đúng mã tham chiếu Hubsell gửi đi là MISA chỉ
      // nhắc lại RefID, không phải mã của họ cấp.
      const trackingCode = result.transactionId !== input.orderCode ? result.transactionId : null;
      if (!result.invoiceNo && !trackingCode) {
        return unknownOutcome("trả lời thành công nhưng không kèm số hóa đơn và mã tra cứu");
      }
      // Tiền thuế lấy THẲNG từ InvoiceLine.vatAmount (đã bóc ngược, đúng số
      // in trên hóa đơn) — KHÔNG nhân lại unitPrice × SL × % (lệch 1đ làm tròn
      // so với chứng từ, đã dính ở HĐ 00000060: log 14.298 vs PDF 14.299).
      const vatAmount = input.lines.reduce((s, l) => s + l.vatAmount, 0);
      return {
        status: InvoiceLogStatus.ISSUED,
        invoiceNo: result.invoiceNo ?? undefined,
        transactionId: result.transactionId ?? undefined,
        vatAmount,
      };
    } catch (err) {
      const recovered = await this.recoverDuplicate(input, err);
      if (recovered) return recovered;
      // Dịch mã lỗi NCC ra VIỆC CẦN LÀM + phân tầm ảnh hưởng (invoice-errors.ts)
      // — worker tự động dựa vào errorScope để ngắt mạch thay vì đốt cả lô.
      const explained = explainInvoiceError(err);
      // Token bị MISA thu hồi trước hạn (đổi mật khẩu…) → bỏ cache để lượt sau
      // đăng nhập lại thay vì cầm token chết tới hết 14 ngày.
      if (explained.code === "TokenExpiredCode" || explained.code === "InvalidTokenCode") {
        clearMisaTokenCache();
      }
      // Lệnh đã gửi mà không có câu trả lời rõ (đứt mạng, MISA lỗi máy chủ, mã lỗi
      // "không rõ nguyên nhân") → báo CHƯA RÕ, không báo "hỏng" trơn.
      if (isPublishOutcomeUnknown(err)) {
        const { network, httpStatus, timedOut } = err instanceof InvoiceProviderError ? err.detail : {};
        return unknownOutcome(
          explained.code ??
            (timedOut ? "không trả lời trong thời hạn chờ" : !network && httpStatus ? `HTTP ${httpStatus}` : "mất kết nối")
        );
      }
      return {
        status: InvoiceLogStatus.FAILED,
        errorMessage: explained.message,
        errorCode: explained.code ?? undefined,
        errorScope: explained.scope,
      };
    }
  }

  /**
   * ĐƯỜNG TỜ NHÁP (eSign / USB token). Thứ tự: tra web theo RefID (lượt trước có thể đã
   * đẩy; chủ shop có thể đã ký) → không thấy trên web thì hỏi cổng tra cứu theo RefID
   * (lưới đỡ: tờ đã phát hành có thể không còn ở danh sách web) → vẫn không có thì đẩy
   * nháp mới. Gọi lại bao nhiêu lần cũng ra cùng RefID (UUID v5) nên không sinh tờ thừa.
   * Kết quả: đã ký → ISSUED (hoặc PENDING + mã tra cứu khi chưa cấp số); còn lại →
   * PENDING + awaitingSignature. Lỗi mạng giữa chừng KHÔNG phải "chưa rõ kết quả" kiểu
   * phát hành: tờ nháp không ăn số, lượt sau tra lại rồi chỉ đẩy khi thiếu.
   */
  private async createViaWebDraft(input: CreateInvoiceInput): Promise<InvoiceResult> {
    const vatAmount = input.lines.reduce((s, l) => s + l.vatAmount, 0);
    try {
      const refId = webRefIdFor(input.orderCode);
      const [onWeb] = await getWebInvoices([refId], this.cfg);
      let signed: SignedDraft | null =
        onWeb?.transactionId ? { invoiceNo: onWeb.invoiceNo, transactionId: onWeb.transactionId } : null;
      if (!onWeb) {
        const rows = await getInvoiceStatuses([refId], this.cfg, "refId");
        const live = rows.find((r) => !r.isDeleted && r.transactionId);
        if (live?.transactionId) signed = { invoiceNo: live.invoiceNo, transactionId: live.transactionId };
      }
      if (signed) return this.signedDraftResult(signed, vatAmount);
      const pushedNow = !onWeb;
      if (pushedNow) await insertWebDraft(input, this.cfg);
      return this.awaitingDraftResult(vatAmount, pushedNow);
    } catch (err) {
      return this.draftErrorResult(err);
    }
  }

  /**
   * ĐƯỜNG TỜ NHÁP THEO LÔ (anh Trung chốt 10/10/2026: 20 tờ một lệnh). Cùng thứ tự với
   * một tờ nhưng mỗi bước MỘT lệnh cho cả lô: getlist theo mọi RefID → tờ không có trên
   * web hỏi cổng tra cứu một lệnh → tờ còn thiếu dựng payload, MỘT lệnh insert. Kết quả
   * gắn về từng tờ theo RefID (mapWebInsertResponse); tờ MISA không trả phần tử (đo
   * sandbox: trùng RefID bị bỏ lặng lẽ) tra lại web một lần rồi mới kết luận. Lỗi trước
   * khi insert (đăng nhập, getlist) hay lệnh insert hỏng cả lô → mọi tờ chưa có kết quả
   * mang cùng kết quả lỗi của một tờ (draftErrorResult).
   */
  private async createViaWebDraftBatch(inputs: CreateInvoiceInput[]): Promise<InvoiceResult[]> {
    const vat = inputs.map((input) => input.lines.reduce((s, l) => s + l.vatAmount, 0));
    const refIds = inputs.map((input) => webRefIdFor(input.orderCode));
    const results: (InvoiceResult | undefined)[] = inputs.map(() => undefined);
    const fillRest = (r: InvoiceResult) => results.map((x) => x ?? { ...r });
    try {
      const onWeb = new Map<string, { invoiceNo: string | null; transactionId: string | null }>();
      for (let i = 0; i < refIds.length; i += WEB_GETLIST_BATCH_MAX) {
        for (const item of await getWebInvoices(refIds.slice(i, i + WEB_GETLIST_BATCH_MAX), this.cfg)) {
          onWeb.set(item.refId.toLowerCase(), { invoiceNo: item.invoiceNo, transactionId: item.transactionId });
        }
      }
      const missing = refIds.filter((r) => !onWeb.has(r.toLowerCase()));
      const signedElsewhere = new Map<string, SignedDraft>();
      if (missing.length > 0) {
        for (const row of await getInvoiceStatuses(missing, this.cfg, "refId")) {
          if (!row.isDeleted && row.transactionId && row.refId) {
            signedElsewhere.set(row.refId.toLowerCase(), { invoiceNo: row.invoiceNo, transactionId: row.transactionId });
          }
        }
      }
      const toPush: number[] = [];
      inputs.forEach((_input, i) => {
        const key = refIds[i].toLowerCase();
        const web = onWeb.get(key);
        const signed: SignedDraft | null = web?.transactionId
          ? { invoiceNo: web.invoiceNo, transactionId: web.transactionId }
          : (signedElsewhere.get(key) ?? null);
        if (signed) results[i] = this.signedDraftResult(signed, vat[i]);
        else if (web) results[i] = this.awaitingDraftResult(vat[i], false);
        else toPush.push(i);
      });
      if (toPush.length === 0) return fillRest(this.draftErrorResult(new Error("không có tờ nào")));

      const template = await findWebTemplate(this.cfg);
      const payloads = toPush.map((i) => buildWebDraftPayload(inputs[i], this.cfg, template));
      const batch = await insertWebDraftPayloads(payloads, this.cfg);
      const recheck: number[] = [];
      batch.items.forEach((item, k) => {
        const i = toPush[k];
        if (!item.errorCode) results[i] = this.awaitingDraftResult(vat[i], true);
        else if (item.errorCode === WEB_INSERT_NOT_IN_RESPONSE) recheck.push(i);
        else {
          results[i] = this.draftErrorResult(
            new InvoiceProviderError(`meInvoice web từ chối tờ nháp: ErrorCode=${item.errorCode}`, {
              code: item.errorCode,
              description: item.description,
              publishSent: true,
            })
          );
        }
      });
      if (recheck.length > 0) {
        // Tờ không có trong câu trả lời: tra lại web MỘT lần — thấy thì coi như đã có từ
        // trước (không đẩy thêm), không thấy thì báo lỗi tạm để lượt sau làm lại.
        const seen = new Set(
          (await getWebInvoices(recheck.map((i) => refIds[i]), this.cfg)).map((x) => x.refId.toLowerCase())
        );
        for (const i of recheck) {
          results[i] = seen.has(refIds[i].toLowerCase())
            ? this.awaitingDraftResult(vat[i], false)
            : {
                status: InvoiceLogStatus.FAILED,
                errorScope: "TRANSIENT",
                errorCode: WEB_INSERT_NOT_IN_RESPONSE,
                errorMessage:
                  "meInvoice không trả kết quả cho tờ này trong lô và tra lại cũng không thấy — Hubsell sẽ lập lại ở lượt sau.",
              };
        }
      }
      return results.map((r) => r ?? this.draftErrorResult(new Error("tờ không được xử lý")));
    } catch (err) {
      return fillRest(this.draftErrorResult(err));
    }
  }

  private signedDraftResult(signed: SignedDraft, vatAmount: number): InvoiceResult {
    return signed.invoiceNo
      ? { status: InvoiceLogStatus.ISSUED, invoiceNo: signed.invoiceNo, transactionId: signed.transactionId, vatAmount }
      : {
          status: InvoiceLogStatus.PENDING,
          transactionId: signed.transactionId,
          vatAmount,
          errorCode: NUMBER_PENDING_CODE,
          errorMessage: numberPendingMessage(this.name),
        };
  }

  private awaitingDraftResult(vatAmount: number, pushedNow: boolean): InvoiceResult {
    return {
      status: InvoiceLogStatus.PENDING,
      awaitingSignature: true,
      vatAmount,
      errorCode: AWAITING_SIGNATURE_CODE,
      errorMessage: awaitingSignatureMessage(this.name, MEINVOICE_WEB_INVOICES_URL, pushedNow),
    };
  }

  /**
   * Lỗi trên đường tờ nháp. Lỗi mạng giữa chừng KHÔNG phải "chưa rõ kết quả" kiểu phát
   * hành: tờ nháp không ăn số, lượt sau tra lại rồi chỉ đẩy khi thiếu → báo lỗi TẠM.
   */
  private draftErrorResult(err: unknown): InvoiceResult {
    const explained = explainInvoiceError(err);
    if (explained.code === "TokenExpiredCode" || explained.code === "InvalidTokenCode") {
      clearMisaTokenCache();
      clearWebTokenCache();
    }
    if (isPublishOutcomeUnknown(err)) {
      return {
        status: InvoiceLogStatus.FAILED,
        errorScope: "TRANSIENT",
        errorCode: explained.code ?? "HUBSELL_DRAFT_UNKNOWN",
        errorMessage:
          "Chưa rõ tờ nháp đã lên meinvoice.vn chưa (mất kết nối giữa chừng). Lượt sau Hubsell tra lại rồi chỉ lập khi còn thiếu — không sinh tờ thừa. " +
          `(meInvoice: ${explained.message})`,
      };
    }
    return {
      status: InvoiceLogStatus.FAILED,
      errorMessage: explained.message,
      errorCode: explained.code ?? undefined,
      errorScope: explained.scope,
    };
  }

  /**
   * Tra một lô tờ nháp theo mã tham chiếu Hubsell (≤ statusBatchSize = 50, bằng trần
   * getlist). Web trả tờ (có mã tra cứu = đã ký); mã không có trên web thì hỏi cổng tra
   * cứu theo RefID; cả hai nơi đều không có → GONE (chủ shop đã xóa nháp). So RefID
   * không phân biệt hoa thường (MISA có thể trả GUID chữ hoa).
   */
  async findDrafts(references: string[]): Promise<DraftBatchResult> {
    const found = new Map<string, DraftLookup>();
    const byGuid = new Map<string, string>();
    for (const ref of references) byGuid.set(webRefIdFor(ref).toLowerCase(), ref);
    const guids = [...byGuid.keys()];
    try {
      for (let i = 0; i < guids.length; i += WEB_GETLIST_BATCH_MAX) {
        const chunk = guids.slice(i, i + WEB_GETLIST_BATCH_MAX);
        const seen = new Set<string>();
        for (const item of await getWebInvoices(chunk, this.cfg)) {
          const key = item.refId.toLowerCase();
          const ref = byGuid.get(key);
          if (!ref) continue;
          seen.add(key);
          found.set(
            ref,
            item.transactionId
              ? { state: "SIGNED", invoiceNo: item.invoiceNo, transactionId: item.transactionId }
              : { state: "WAITING" }
          );
        }
        const missing = chunk.filter((g) => !seen.has(g));
        if (missing.length === 0) continue;
        for (const row of await getInvoiceStatuses(missing, this.cfg, "refId")) {
          const key = row.refId?.toLowerCase();
          const ref = key ? byGuid.get(key) : undefined;
          if (!ref || !key) continue;
          seen.add(key);
          found.set(
            ref,
            row.isDeleted
              ? { state: "DELETED" }
              : row.transactionId
                ? { state: "SIGNED", invoiceNo: row.invoiceNo, transactionId: row.transactionId }
                : { state: "WAITING" }
          );
        }
        for (const g of missing) {
          if (!seen.has(g)) found.set(byGuid.get(g) as string, { state: "GONE" });
        }
      }
      return { ok: true, found };
    } catch (err) {
      if (err instanceof InvoiceProviderError) {
        const explained = explainInvoiceError(err);
        if (explained.code === "TokenExpiredCode" || explained.code === "InvalidTokenCode") {
          clearMisaTokenCache();
          clearWebTokenCache();
        }
        return { ok: false, message: explained.message, accountProblem: explained.scope === "ACCOUNT" };
      }
      return { ok: false, message: (err as Error).message, accountProblem: false };
    }
  }

  /**
   * MISA báo TRÙNG mã đơn = hóa đơn ĐÃ phát hành ở lần trước nhưng Hubsell không
   * nhận được kết quả (đứt mạng / server restart giữa chừng) → log kẹt FAILED,
   * ngày nào worker cũng thử lại và ngày nào cũng trùng, còn seller không thấy số
   * hóa đơn nên dễ lập tay thêm một tờ. Tra ngược theo RefID: tờ đó còn sống thì
   * NỐI LẠI vào log như một lần phát hành thành công; đã bị xóa/hủy bên MISA thì
   * để nguyên lỗi cho seller tự quyết. MISA báo trùng mà Hubsell chưa lấy được số
   * (tra không được, chưa thấy, tờ chưa phát hành xong) thì giữ thông điệp lỗi
   * trùng nhưng gắn cờ CHƯA RÕ: tờ đó có thật bên MISA, chỉ là chưa nối được.
   */
  private async recoverDuplicate(
    input: CreateInvoiceInput,
    err: unknown
  ): Promise<InvoiceResult | null> {
    const explained = explainInvoiceError(err);
    if (explained.code !== "InvoiceDuplicated" && explained.code !== "DuplicateInvoiceRefID") return null;
    const found = await this.findByReference(input.orderCode);
    // Tờ đã bị xóa bên MISA: đã có kết luận, rơi về thông điệp lỗi trùng như cũ.
    if (found.state === "FOUND" && found.deleted) return null;
    if (found.state === "FOUND" && found.issued && found.transactionId && found.invoiceNo) {
      return {
        status: InvoiceLogStatus.ISSUED,
        invoiceNo: found.invoiceNo,
        transactionId: found.transactionId,
        vatAmount: input.lines.reduce((s, l) => s + l.vatAmount, 0),
      };
    }
    return {
      status: InvoiceLogStatus.FAILED,
      errorMessage: explained.message,
      errorCode: explained.code ?? undefined,
      errorScope: explained.scope,
      outcomeUnknown: true,
    };
  }

  /**
   * Tra ngược theo mã tham chiếu (RefID) đã gửi lúc phát hành. MISA trả danh sách
   * rỗng cho mã chưa có hóa đơn. Nhiều tờ cùng mã (không mong đợi — MISA chặn
   * trùng) thì ưu tiên tờ còn hiệu lực và báo số tờ ở `matches`.
   * Hỏi CẢ HAI dạng mã trong một lệnh: mã Hubsell (đường HSM) và UUID v5 của nó
   * (đường tờ nháp) — shop đổi phương thức ký giữa chừng vẫn tìm được tờ.
   */
  async findByReference(reference: string): Promise<ReferenceLookup> {
    let items: MisaInvoiceStatusItem[];
    try {
      items = await getInvoiceStatuses([reference, webRefIdFor(reference)], this.cfg, "refId");
    } catch (err) {
      // Lỗi có mã của MISA (đăng nhập sai, tài khoản chưa phân quyền...) thì dịch ra
      // việc cần làm như lúc phát hành; lỗi mạng / lỗi lạ coi là sự cố tạm.
      if (err instanceof InvoiceProviderError) {
        const explained = explainInvoiceError(err);
        return { state: "LOOKUP_FAILED", message: explained.message, accountProblem: explained.scope === "ACCOUNT" };
      }
      return { state: "LOOKUP_FAILED", message: (err as Error).message, accountProblem: false };
    }
    if (items.length === 0) return { state: "NOT_FOUND" };
    const live = items.find((it) => !it.isDeleted && it.publishStatus === 1);
    const chosen = live ?? items[0];
    return {
      state: "FOUND",
      invoiceNo: chosen.invoiceNo,
      transactionId: chosen.transactionId,
      issued: chosen.publishStatus === 1,
      deleted: chosen.isDeleted,
      matches: items.length,
    };
  }

  /**
   * Hỏi trạng thái một lô theo mã tra cứu (bước 5 lát 12). meInvoice bắt khai loại ký
   * hiệu (có mã / không mã) cho CẢ lệnh, và [thử 03/10] khai lệch loại thì trả 0 dòng,
   * không báo lỗi; mã không tồn tại cũng bị bỏ qua im lặng. Nên: tách lô theo ký hiệu
   * lúc phát hành của từng tờ (thiếu thì theo ký hiệu đang cấu hình), tờ nào không có
   * dòng trả về thì hỏi lại MỘT lần với loại ngược lại. Bảng mã SendTaxStatus đọc theo
   * loại đã hỏi ra dòng đó (cqt-status.ts).
   */
  async checkStatuses(items: StatusQuery[]): Promise<StatusBatchResult> {
    const found = new Map<string, ProviderInvoiceStatus>();
    const ask = async (ids: string[], withCode: boolean) => {
      if (ids.length === 0) return;
      const rows = await getInvoiceStatuses(ids, this.cfg, "transactionId", withCode);
      for (const row of rows) {
        if (!row.transactionId || found.has(row.transactionId)) continue;
        found.set(row.transactionId, {
          transactionId: row.transactionId,
          issued: row.publishStatus === 1,
          deleted: row.isDeleted,
          invoiceNo: row.invoiceNo,
          taxStatus: mapCqtStatus(row.sendTaxStatus, withCode),
        });
      }
    };
    const idsOf = (withCode: boolean) => [
      ...new Set(
        items
          .filter((it) => seriesHasTaxCode(it.invoiceSeries ?? this.cfg.invoiceSeries) === withCode)
          .map((it) => it.transactionId)
      ),
    ];
    try {
      for (const withCode of [true, false]) {
        const ids = idsOf(withCode);
        await ask(ids, withCode);
        await ask(ids.filter((id) => !found.has(id)), !withCode);
      }
      return { ok: true, found };
    } catch (err) {
      if (err instanceof InvoiceProviderError) {
        const explained = explainInvoiceError(err);
        if (explained.code === "TokenExpiredCode" || explained.code === "InvalidTokenCode") clearMisaTokenCache();
        return { ok: false, message: explained.message, accountProblem: explained.scope === "ACCOUNT" };
      }
      return { ok: false, message: (err as Error).message, accountProblem: false };
    }
  }

  /**
   * Tài liệu meInvoice ("Lưu ý khi bắt đầu") yêu cầu RETRY với lỗi cấp số
   * InvoiceNumberNotCotinuous: MISA cấp số liên tục theo ký hiệu, một hóa đơn
   * khác (seller lập tay trên meInvoice, hoặc instance khác) đang giữ số là bị
   * từ chối. Thử lại ĐÚNG 1 lần sau 2 giây — RefID chống trùng phía MISA nên
   * retry không thể sinh 2 hóa đơn; còn lỗi nữa thì trả về để lượt sau xử lý.
   */
  private async publishWithRetry(input: CreateInvoiceInput) {
    try {
      return await publishStandardInvoice(input, this.cfg);
    } catch (err) {
      if (explainInvoiceError(err).code !== "InvoiceNumberNotCotinuous") throw err;
      await new Promise((r) => setTimeout(r, 2000));
      return publishStandardInvoice(input, this.cfg);
    }
  }

  /**
   * meInvoice Open API CHƯA có endpoint hủy hóa đơn (khảo sát tài liệu portal
   * 23/08/2026 — chỉ có sendemail/status/publishview/Download/voucher-paper/
   * paging). Hủy phải thao tác trên app3.meinvoice.vn; trạng thái hủy sẽ về
   * Hubsell qua webhook hoặc checkStatus (IsDelete=true).
   */
  async cancelInvoice(
    transactionId: string,
    _reason: string
  ): Promise<InvoiceResult> {
    return {
      status: InvoiceLogStatus.FAILED,
      transactionId,
      errorMessage:
        "meInvoice chưa hỗ trợ hủy hóa đơn qua API — vui lòng hủy trực tiếp trên meInvoice (app3.meinvoice.vn), Hubsell sẽ tự cập nhật trạng thái.",
    };
  }

  async checkStatus(transactionId: string): Promise<InvoiceResult> {
    try {
      const [item] = await getInvoiceStatuses([transactionId], this.cfg);
      if (!item) {
        return {
          status: InvoiceLogStatus.FAILED,
          transactionId,
          errorMessage: "meInvoice không tìm thấy hóa đơn theo mã tra cứu này.",
        };
      }
      if (item.isDeleted) {
        return { status: InvoiceLogStatus.CANCELLED, transactionId };
      }
      if (item.publishStatus === 1) {
        return { status: InvoiceLogStatus.ISSUED, transactionId };
      }
      return { status: InvoiceLogStatus.PENDING, transactionId };
    } catch (err) {
      return {
        status: InvoiceLogStatus.FAILED,
        transactionId,
        errorMessage: (err as Error).message,
      };
    }
  }

  /** Tải bản thể hiện PDF (base64, đã ký HSM) — cho nút tải trên UI sau này. */
  async downloadPdf(transactionId: string): Promise<string | null> {
    const [file] = await downloadInvoiceFiles([transactionId], "Pdf", this.cfg);
    return file?.errorCode ? null : (file?.data ?? null);
  }
}
